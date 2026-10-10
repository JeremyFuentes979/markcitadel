import { createHash } from "crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { pageviews } from "@db/schema";

/**
 * First-party site analytics.
 *
 * Middleware records one row per real page view. Stats endpoints are
 * owner-only. No cookies; visitors are counted by a truncated sha256 of
 * IP + user-agent + day (rotates daily, can't be reversed to an IP).
 */

const BOT_UA =
  /bot|crawl|spider|slurp|headless|pingdom|uptime|facebookexternal|preview|fetch|curl|wget|python|axios|node|go-http|scanner/i;

export function isBotUa(ua: string): boolean {
  return BOT_UA.test(ua);
}

function dayUtc(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function visitorHash(ip: string, ua: string, day: string): string {
  return createHash("sha256")
    .update(`${ip}|${ua}|${day}`)
    .digest("hex")
    .slice(0, 24);
}

/** Best-effort client IP from proxy headers. */
export function clientIp(c: {
  req: { header: (n: string) => string | undefined };
}): string {
  return (
    c.req.header("cf-connecting-ip") ||
    (c.req.header("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "unknown"
  );
}

/** Record one page view. Never throws — analytics must not break the site. */
export async function recordPageview(input: {
  path: string;
  ip: string;
  ua: string;
  referrer?: string;
}): Promise<void> {
  try {
    const db = getDb();
    if (!db) return;
    const day = dayUtc();
    let ref = (input.referrer ?? "").slice(0, 255) || null;
    if (ref) {
      try {
        const u = new URL(ref);
        ref = u.hostname === "" ? null : u.host; // keep host only, drop query strings
      } catch {
        ref = null;
      }
    }
    await db.insert(pageviews).values({
      day,
      path: input.path.slice(0, 255),
      visitorHash: visitorHash(input.ip, input.ua, day),
      referrer: ref,
      isBot: isBotUa(input.ua),
    });
  } catch (e) {
    console.warn("[analytics] record failed:", e instanceof Error ? e.message : e);
  }
}

export interface SiteStats {
  days: number;
  totals: { views: number; uniqueVisitors: number; botViews: number };
  byDay: { day: string; views: number; visitors: number }[];
  topPages: { path: string; views: number; visitors: number }[];
  referrers: { host: string; views: number }[];
}

export async function getSiteStats(days = 30): Promise<SiteStats> {
  const db = getDb();
  const since = dayUtc(new Date(Date.now() - days * 86_400_000));
  const human = and(gte(pageviews.day, since), eq(pageviews.isBot, false));

  const totalsRow = (
    await db
      .select({
        views: sql<number>`count(*)`,
        uniqueVisitors: sql<number>`count(distinct ${pageviews.visitorHash})`,
      })
      .from(pageviews)
      .where(human)
  )[0] ?? { views: 0, uniqueVisitors: 0 };

  const botsRow = (
    await db
      .select({ views: sql<number>`count(*)` })
      .from(pageviews)
      .where(and(gte(pageviews.day, since), eq(pageviews.isBot, true)))
  )[0] ?? { views: 0 };

  const byDay = await db
    .select({
      day: pageviews.day,
      views: sql<number>`count(*)`,
      visitors: sql<number>`count(distinct ${pageviews.visitorHash})`,
    })
    .from(pageviews)
    .where(human)
    .groupBy(pageviews.day)
    .orderBy(pageviews.day);

  const topPages = await db
    .select({
      path: pageviews.path,
      views: sql<number>`count(*)`,
      visitors: sql<number>`count(distinct ${pageviews.visitorHash})`,
    })
    .from(pageviews)
    .where(human)
    .groupBy(pageviews.path)
    .orderBy(desc(sql`count(*)`))
    .limit(20);

  const refRows = await db
    .select({
      host: pageviews.referrer,
      views: sql<number>`count(*)`,
    })
    .from(pageviews)
    .where(human)
    .groupBy(pageviews.referrer)
    .orderBy(desc(sql`count(*)`))
    .limit(20);

  const referrers = refRows
    .map((r) => ({ host: r.host ?? "(direct)", views: Number(r.views) }))
    .filter((r) => r.host !== "");

  return {
    days,
    totals: {
      views: Number(totalsRow.views),
      uniqueVisitors: Number(totalsRow.uniqueVisitors),
      botViews: Number(botsRow.views),
    },
    byDay: byDay.map((r) => ({
      day: r.day,
      views: Number(r.views),
      visitors: Number(r.visitors),
    })),
    topPages: topPages.map((r) => ({
      path: r.path,
      views: Number(r.views),
      visitors: Number(r.visitors),
    })),
    referrers,
  };
}
