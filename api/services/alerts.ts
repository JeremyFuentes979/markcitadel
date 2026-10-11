import { eq, and, desc, isNull } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { alertEvents, watches, type Watch } from "@db/schema";
import { getPatentTotal, getTrademarkTotal } from "./uspto";
import type { TrademarkStatus } from "@contracts/types";

const MIN_CHECK_INTERVAL_MS = 60 * 60 * 1000; // don't hammer USPTO

async function currentTotal(watch: Watch): Promise<number> {
  if (watch.type === "trademarks") {
    return getTrademarkTotal(
      watch.query,
      (watch.option || "all") as TrademarkStatus,
    );
  }
  return getPatentTotal(watch.query);
}

/**
 * Re-check a user's active watches against live USPTO data and create alert
 * events for any whose result count changed. Watches checked within the last
 * hour are skipped unless `force` is set.
 */
export async function checkWatchesForUser(
  userId: number,
  force = false,
): Promise<{ checked: number; newAlerts: number }> {
  const db = getDb();
  const userWatches = await db
    .select()
    .from(watches)
    .where(and(eq(watches.userId, userId), eq(watches.active, true)));

  let checked = 0;
  let newAlerts = 0;
  const now = new Date();

  for (const w of userWatches) {
    if (
      !force &&
      w.lastCheckedAt &&
      now.getTime() - w.lastCheckedAt.getTime() < MIN_CHECK_INTERVAL_MS
    ) {
      continue;
    }
    let total: number;
    try {
      total = await currentTotal(w);
    } catch {
      continue; // USPTO hiccup — leave watch untouched, retry next time
    }
    checked++;

    if (w.lastTotal !== null && total !== w.lastTotal) {
      const delta = total - w.lastTotal;
      const direction = delta > 0 ? "new" : "fewer";
      const kind = w.type === "trademarks" ? "trademarks" : "patent documents";
      await db.insert(alertEvents).values({
        userId,
        watchId: w.id,
        message: `“${w.label}”: ${Math.abs(delta).toLocaleString()} ${direction} ${kind} (${w.lastTotal.toLocaleString()} → ${total.toLocaleString()})`,
        previousTotal: w.lastTotal,
        newTotal: total,
      });
      newAlerts++;
    }

    await db
      .update(watches)
      .set({ lastTotal: total, lastCheckedAt: now })
      .where(eq(watches.id, w.id));
  }

  return { checked, newAlerts };
}

export async function unreadAlertCount(userId: number): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: alertEvents.id })
    .from(alertEvents)
    .where(and(eq(alertEvents.userId, userId), isNull(alertEvents.readAt)));
  return rows.length;
}

export async function listAlerts(userId: number) {
  const db = getDb();
  return db
    .select()
    .from(alertEvents)
    .where(eq(alertEvents.userId, userId))
    .orderBy(desc(alertEvents.createdAt))
    .limit(100);
}

export async function markAllAlertsRead(userId: number) {
  const db = getDb();
  await db
    .update(alertEvents)
    .set({ readAt: new Date() })
    .where(and(eq(alertEvents.userId, userId), isNull(alertEvents.readAt)));
}
