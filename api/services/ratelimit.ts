import { lt, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { rateLimits } from "@db/schema";

/**
 * Fixed-window rate limiter backed by Postgres, so limits hold across
 * serverless invocations. One atomic upsert per check.
 */
export async function hitRateLimit(
  key: string,
  limit: number,
  windowSec = 60,
): Promise<{ allowed: boolean; remaining: number; resetInSec: number }> {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const [row] = await getDb()
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  const count = row?.count ?? 1;
  const resetInSec = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000));
  // Opportunistic cleanup of old windows (~1% of calls)
  if (Math.random() < 0.01) {
    void getDb()
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, new Date(now - 3600_000)))
      .catch(() => {});
  }
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetInSec };
}
