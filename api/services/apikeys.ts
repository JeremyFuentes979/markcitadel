import { createHash, randomBytes } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { apiKeys, apiUsage, type ApiKey } from "@db/schema";
import { getUserPlan, planFor } from "./plans";
import { hitRateLimit } from "./ratelimit";

/**
 * API key authentication, rate limiting, and usage metering for the public
 * connector endpoints. Raw keys are never stored — only their SHA-256 hash.
 * Limits come from the key's plan (see services/plans.ts).
 */

export const FREE_TIER = {
  requestsPerMinute: 30,
  requestsPerMonth: 1000,
} as const;

const KEY_PREFIX = "pmk_";

// ─── Key lifecycle ──────────────────────────────────────────────────────────

export async function createApiKey(
  userId: number,
  name: string,
): Promise<{ key: ApiKey; rawKey: string }> {
  const db = getDb();
  // Enforce the plan's active-key cap; new keys inherit the user's plan
  const existing = await db
    .select({ plan: apiKeys.plan })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.active, true)));
  const activeCount = existing.length;
  const userPlan = await getUserPlan(userId); // users.plan, set by Stripe webhook
  const def = planFor(userPlan);
  if (activeCount >= def.maxActiveKeys) {
    throw new Error(
      `The ${def.name} plan allows up to ${def.maxActiveKeys} active API keys.`,
    );
  }
  const rawKey = KEY_PREFIX + randomBytes(24).toString("hex"); // pmk_ + 48 hex chars
  const keyHash = hashKey(rawKey);
  const prefix = rawKey.slice(0, 12);
  const [key] = await db
    .insert(apiKeys)
    .values({
      userId,
      name: name.slice(0, 100),
      prefix,
      keyHash,
      plan: userPlan,
    })
    .returning();
  return { key, rawKey };
}

export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

// ─── Authentication + metering ──────────────────────────────────────────────

export type KeyAuthResult =
  | {
      ok: true;
      key: ApiKey;
      plan: string;
      rateLimit: number;
      rateRemaining: number;
      rateResetInSec: number;
      monthlyUsed: number;
      monthlyLimit: number;
    }
  | { ok: false; status: number; error: string; message: string };

/**
 * Validate the Bearer key, enforce per-minute and monthly limits, and meter
 * the request. Returns enough info to set rate-limit response headers.
 */
export async function authenticateApiKey(
  authHeader: string | null,
): Promise<KeyAuthResult> {
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      ok: false,
      status: 401,
      error: "MISSING_API_KEY",
      message:
        "This endpoint requires an API key. Send 'Authorization: Bearer <key>'. Create a free key on the Developers page.",
    };
  }
  const rawKey = authHeader.slice(7).trim();
  if (!rawKey.startsWith(KEY_PREFIX)) {
    return {
      ok: false,
      status: 401,
      error: "INVALID_API_KEY",
      message: "Unrecognized API key format.",
    };
  }
  const db = getDb();
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hashKey(rawKey)));
  if (!key || !key.active) {
    return {
      ok: false,
      status: 401,
      error: "INVALID_API_KEY",
      message: "This API key is invalid or has been revoked.",
    };
  }

  const plan = planFor(key.plan);

  // Per-minute rate limit
  const rate = await hitRateLimit(`key:${key.id}`, plan.requestsPerMinute, 60);
  if (!rate.allowed) {
    return {
      ok: false,
      status: 429,
      error: "RATE_LIMITED",
      message: `Rate limit exceeded: ${plan.requestsPerMinute} requests/minute on the ${plan.name} plan. Retry in ${rate.resetInSec}s.`,
    };
  }

  // Monthly quota
  const month = new Date().toISOString().slice(0, 7);
  const [usage] = await db
    .select()
    .from(apiUsage)
    .where(and(eq(apiUsage.apiKeyId, key.id), eq(apiUsage.month, month)));
  const monthlyUsed = usage?.requests ?? 0;
  if (monthlyUsed >= plan.requestsPerMonth) {
    return {
      ok: false,
      status: 429,
      error: "MONTHLY_QUOTA_EXCEEDED",
      message: `Monthly ${plan.name}-plan quota of ${plan.requestsPerMonth.toLocaleString()} requests reached. Usage resets next month${plan.id === "free" ? " — or upgrade to Pro for 25,000/month" : ""}.`,
    };
  }

  // Meter: upsert monthly rollup + touch lastUsedAt
  await db
    .insert(apiUsage)
    .values({ apiKeyId: key.id, month, requests: 1 })
    .onConflictDoUpdate({
      target: [apiUsage.apiKeyId, apiUsage.month],
      set: { requests: sql`${apiUsage.requests} + 1` },
    });
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id));

  return {
    ok: true,
    key,
    plan: plan.id,
    rateLimit: plan.requestsPerMinute,
    rateRemaining: rate.remaining,
    rateResetInSec: rate.resetInSec,
    monthlyUsed: monthlyUsed + 1,
    monthlyLimit: plan.requestsPerMonth,
  };
}

// ─── Key management (for tRPC) ──────────────────────────────────────────────

export async function listKeysForUser(userId: number) {
  const db = getDb();
  const keys = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(apiKeys.createdAt);
  const month = new Date().toISOString().slice(0, 7);
  const usageRows = await db
    .select()
    .from(apiUsage)
    .where(eq(apiUsage.month, month));
  const usageByKey = new Map(
    usageRows.map((u) => [Number(u.apiKeyId), u.requests]),
  );
  return keys.map((k) => {
    const plan = planFor(k.plan);
    return {
      id: Number(k.id),
      name: k.name,
      prefix: k.prefix,
      plan: k.plan,
      active: k.active,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
      monthlyUsed: usageByKey.get(Number(k.id)) ?? 0,
      monthlyLimit: plan.requestsPerMonth,
      rateLimitPerMinute: plan.requestsPerMinute,
    };
  });
}

export async function revokeKey(userId: number, keyId: number) {
  const db = getDb();
  await db
    .update(apiKeys)
    .set({ active: false })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)));
}
