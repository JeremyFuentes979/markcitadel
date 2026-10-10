import { createHash, randomBytes } from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { apiKeys, upgradeTokens, users } from "@db/schema";
import { env } from "../lib/env";

/**
 * Plan definitions and billing activation.
 *
 * Plans gate API limits; activation is via one-time upgrade tokens the user
 * pastes into Stripe Checkout (client_reference_id) and then back into the
 * site. On self-hosted infra this upgrades to Stripe webhooks without
 * changing any customer-facing flow.
 */

export type PlanId = "free" | "pro";

export interface PlanDef {
  id: PlanId;
  name: string;
  priceMonthly: number; // USD
  requestsPerMinute: number;
  requestsPerMonth: number;
  maxActiveKeys: number;
  features: string[];
}

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free",
    name: "Free",
    priceMonthly: 0,
    requestsPerMinute: 30,
    requestsPerMonth: 1_000,
    maxActiveKeys: 5,
    features: [
      "1,000 API requests / month",
      "30 requests / minute",
      "Up to 5 API keys",
      "Full patent, trademark & image search",
      "MCP connector for AI assistants",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthly: 29,
    requestsPerMinute: 120,
    requestsPerMonth: 25_000,
    maxActiveKeys: 25,
    features: [
      "25,000 API requests / month",
      "120 requests / minute",
      "Up to 25 API keys",
      "Everything in Free",
      "Priority support",
    ],
  },
};

export function planFor(plan: string): PlanDef {
  return PLANS[(plan as PlanId) in PLANS ? (plan as PlanId) : "free"];
}

/** Per-user plan = the highest plan across their active keys. */
export async function getUserPlan(userId: number): Promise<PlanId> {
  const db = getDb();
  const keys = await db
    .select({ plan: apiKeys.plan })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.active, true)));
  return keys.some((k) => k.plan === "pro") ? "pro" : "free";
}

// ─── Upgrade tokens ─────────────────────────────────────────────────────────

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Mint a one-time upgrade token (raw token shown once to the user). */
export async function createUpgradeToken(userId: number): Promise<string> {
  const raw = "mku_" + randomBytes(16).toString("hex"); // mku_ + 32 hex chars
  const db = getDb();
  await db.insert(upgradeTokens).values({ userId, tokenHash: hashToken(raw) });
  return raw;
}

/**
 * Activate Pro for the user holding a valid, unused token.
 * Upgrades all of the user's active keys. Returns false if the token is
 * unknown or already used.
 */
export async function activatePlan(
  userId: number,
  rawToken: string,
): Promise<boolean> {
  const db = getDb();
  const [tok] = await db
    .select()
    .from(upgradeTokens)
    .where(eq(upgradeTokens.tokenHash, hashToken(rawToken.trim())));
  if (!tok || tok.usedAt || Number(tok.userId) !== userId) return false;
  await db
    .update(upgradeTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(upgradeTokens.id, tok.id), isNull(upgradeTokens.usedAt)));
  await db
    .update(apiKeys)
    .set({ plan: "pro" })
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.active, true)));
  return true;
}

/** Whether Stripe checkout is configured (payment link present). */
export function paymentsConfigured(): boolean {
  return !!env.stripePaymentLink;
}

/** Stripe payment link for the Pro plan, or null if not configured. */
export function paymentLink(): string | null {
  return env.stripePaymentLink || null;
}

// ─── Owner billing admin (reconcile Stripe payments ↔ activations) ──────────

/** Recent upgrade activity, newest first. Owner-only view. */
export async function listUpgradeActivity(limit = 100) {
  const db = getDb();
  const rows = await db
    .select({
      id: upgradeTokens.id,
      userId: upgradeTokens.userId,
      createdAt: upgradeTokens.createdAt,
      usedAt: upgradeTokens.usedAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(upgradeTokens)
    .innerJoin(users, eq(upgradeTokens.userId, users.id))
    .orderBy(desc(upgradeTokens.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: Number(r.id),
    userId: Number(r.userId),
    userName: r.userName,
    userEmail: r.userEmail,
    createdAt: r.createdAt,
    usedAt: r.usedAt,
  }));
}

/** Downgrade a user back to Free (e.g. activation without a matching payment). */
export async function downgradeUser(userId: number): Promise<void> {
  const db = getDb();
  await db
    .update(apiKeys)
    .set({ plan: "free" })
    .where(eq(apiKeys.userId, userId));
}
