import { doubleMetaphone } from "double-metaphone";
import {
  CONFLICT_DISCLAIMER,
  DEFAULT_CLASSES,
  type ConflictSummary,
  type FlaggedMark,
  type OwnerSummary,
  type Verdict,
} from "@contracts/conflicts";
import {
  DEGRADED_MESSAGE,
  escapeTmQuery,
  phoneticVariants,
  tmRawQuery,
  type RawTmHit,
} from "./uspto";

/**
 * Trademark conflict summary: answers "is this name taken?" without making
 * anyone page through hundreds of raw results.
 *
 * 1. Fetch (in parallel, each call ≤8s on Netlify, all cached in Postgres):
 *    - main: phrase + contains-wildcard + fuzzy + sound-alike variants (live, up to 250)
 *    - components: marks that are a 5+ letter piece of a compound name, e.g.
 *      CITADEL inside MARKCITADEL (live, up to 100)
 *    - counts: all statuses; live in the user's classes; exact live
 * 2. Score every live mark: wording similarity × status × class overlap,
 *    plus a strong/famous-owner boost.
 * 3. Verdict + top conflicts + top owners.
 */

const MAIN_SAMPLE = 250;
const COMPONENT_SAMPLE = 100;
const GENERIC = new Set([
  "the", "and", "llc", "inc", "co", "corp", "company", "group", "of", "for", "a", "an",
  "services", "service", "solutions", "ltd", "pllc", "lp", "pc",
]);

// ─── text helpers ──────────────────────────────────────────────────────────

const normalize = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const compactOf = (s: string) => normalize(s).replace(/ /g, "");

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function sounds(a: string, b: string): boolean {
  if (!a || !b) return false;
  const [pa, sa] = doubleMetaphone(a);
  const [pb, sb] = doubleMetaphone(b);
  if (!pa || !pb) return false;
  return pa === pb || pa === sb || sa === pb || (!!sa && sa === sb);
}

export function cleanOwner(o: string | null): string | null {
  if (!o) return null;
  // "Acme LLC (LIMITED LIABILITY COMPANY; DELAWARE, USA)" → "Acme LLC"
  const t = o.trim();
  if (t.endsWith(")") && t.includes(";")) {
    const semi = t.indexOf(";");
    const open = t.lastIndexOf(" (", semi);
    if (open > 0) return t.slice(0, open).trim();
  }
  return t;
}

const ownerKey = (o: string) => o.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|llc|l l c|ltd|corp|corporation|co|company|the)\b/g, "").replace(/\s+/g, " ").trim();

type Sim = { value: number; kind: FlaggedMark["similarity"]; why: string };

function similarity(markRaw: string, name: string): Sim | null {
  const markN = normalize(markRaw);
  const mc = markN.replace(/ /g, "");
  const nc = compactOf(name);
  if (!mc || !nc) return null;
  const markTokens = markN.split(" ");
  const nameTokens = normalize(name).split(" ").filter((t) => t.length >= 3 && !GENERIC.has(t));

  if (mc === nc) return { value: 1, kind: "exact", why: "Identical wording" };
  const ratio = 1 - lev(mc, nc) / Math.max(mc.length, nc.length);
  if (sounds(mc, nc) && ratio >= 0.5)
    return { value: 0.75 + 0.15 * ratio, kind: "sound-alike", why: "Sounds alike when spoken" };
  if (markTokens.includes(nc) || (nc.length >= 4 && markN.includes(normalize(name))))
    return { value: 0.8, kind: "contains", why: `Contains "${name.toUpperCase()}" as a word` };
  const r = 1 - lev(mc, nc) / Math.max(mc.length, nc.length);
  if (r >= (nc.length < 6 ? 0.8 : 0.75) && nc.length >= 4)
    return { value: 0.85 * r, kind: "similar spelling", why: `Spelled almost the same (${Math.round(r * 100)}% match)` };
  if (nc.length >= 4 && mc.includes(nc))
    return {
      value: 0.45 + 0.3 * (nc.length / mc.length),
      kind: "contains",
      why: `Your name appears inside "${markRaw.toUpperCase()}"`,
    };
  if (mc.length >= 5 && nc.includes(mc))
    return {
      value: 0.55 + 0.3 * (mc.length / nc.length),
      kind: "contains",
      why: `Your name contains the existing mark "${markRaw.toUpperCase()}"`,
    };
  const shared = nameTokens.filter((t) => t.length >= 4 && markTokens.includes(t));
  if (shared.length)
    return { value: 0.45, kind: "shares a word", why: `Shares the word "${shared[0].toUpperCase()}"` };
  if (markTokens.some((t) => t.length >= 4 && sounds(t, nc)))
    return { value: 0.5, kind: "sound-alike", why: "Part of the mark sounds like your name" };
  return { value: 0.15, kind: "shares a word", why: "Loose match" };
}

// ─── query builders ────────────────────────────────────────────────────────

function mainClause(name: string): string {
  const norm = normalize(name);
  const nc = norm.replace(/ /g, "");
  const parts = [`wordmark:"${escapeTmQuery(norm)}"`];
  if (nc.length >= 4) parts.push(`wordmark:(*${escapeTmQuery(nc)}*)`);
  if (nc.length >= 6) parts.push(`wordmark:(${escapeTmQuery(nc)}~1)`);
  const variants = phoneticVariants(name)
    .map(compactOf)
    .filter((v) => v.length >= 3 && v !== nc)
    .slice(0, 8);
  if (variants.length) parts.push(`wordmark:(${variants.map(escapeTmQuery).join(" OR ")})`);
  const tokens = norm.split(" ").filter((t) => t.length >= 4 && !GENERIC.has(t));
  if (tokens.length > 1) parts.push(`wordmark:(${tokens.map(escapeTmQuery).join(" OR ")})`);
  return `(${parts.join(" OR ")})`;
}

/** 5+ letter pieces of a single-word compound name (MARKCITADEL → CITADEL …). */
function componentClause(name: string): string | null {
  const norm = normalize(name);
  if (norm.includes(" ")) return null;
  const nc = norm;
  if (nc.length < 8) return null;
  const minLen = Math.max(5, Math.ceil(nc.length / 2));
  const subs = new Set<string>();
  for (let len = nc.length - 1; len >= minLen; len--)
    for (let i = 0; i + len <= nc.length; i++) subs.add(nc.slice(i, i + len));
  if (!subs.size) return null;
  return `wordmark:(${[...subs].slice(0, 40).map(escapeTmQuery).join(" OR ")})`;
}

const classClause = (classes: number[]) =>
  `internationalClass:(${classes.map((c) => `"IC ${String(c).padStart(3, "0")}"`).join(" OR ")})`;

// ─── main entry ────────────────────────────────────────────────────────────

export async function checkTrademarkConflicts(
  nameRaw: string,
  classesIn?: number[],
): Promise<ConflictSummary> {
  const name = nameRaw.trim().slice(0, 100);
  const classes = [...new Set((classesIn?.length ? classesIn : DEFAULT_CLASSES).filter((c) => c >= 1 && c <= 45))].sort((a, b) => a - b);
  const main = mainClause(name);
  const comp = componentClause(name);
  const exactQ = `wordmark:"${escapeTmQuery(normalize(name))}" AND alive:true`;

  // "relevant" = main variants plus (for compound names) their components
  const all = comp ? `(${main} OR ${comp})` : main;
  const [liveR, compR, totalR, inClassR, exactR] = await Promise.allSettled([
    tmRawQuery(`${all} AND alive:true`, MAIN_SAMPLE),
    comp ? tmRawQuery(`${comp} AND alive:true`, COMPONENT_SAMPLE) : Promise.resolve({ total: 0, hits: [] as RawTmHit[] }),
    tmRawQuery(all, 0),
    tmRawQuery(`${all} AND alive:true AND ${classClause(classes)}`, 0),
    tmRawQuery(exactQ, 0),
  ]);

  const failed = [liveR, compR, totalR, inClassR, exactR].filter((r) => r.status === "rejected").length;
  const ok = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);
  const live = ok(liveR);
  const compo = ok(compR);

  // Merge + dedupe live hits
  const bySerial = new Map<string, RawTmHit>();
  for (const h of [...(live?.hits ?? []), ...(compo?.hits ?? [])]) if (h.alive) bySerial.set(h.serialNumber, h);
  const hits = [...bySerial.values()].filter((h) => h.wordmark);

  // Owner strength (same-word live marks per owner)
  const ownerCounts = new Map<string, { n: number; classes: Set<number>; display: string }>();
  const sims = new Map<string, Sim>();
  for (const h of hits) {
    const s = similarity(h.wordmark, name);
    if (!s) continue;
    sims.set(h.serialNumber, s);
    const o = cleanOwner(h.owner);
    if (o && s.value >= 0.55) {
      const k = ownerKey(o);
      const e = ownerCounts.get(k) ?? { n: 0, classes: new Set<number>(), display: o };
      e.n++;
      h.classes.forEach((c) => e.classes.add(c));
      ownerCounts.set(k, e);
    }
  }

  const classSet = new Set(classes);
  const scored: FlaggedMark[] = [];
  for (const h of hits) {
    const s = sims.get(h.serialNumber);
    if (!s) continue;
    const owner = cleanOwner(h.owner);
    const ownerN = owner ? ownerCounts.get(ownerKey(owner))?.n ?? 0 : 0;
    const strong = ownerN >= 5;
    const famous = ownerN >= 15;
    const inYourClasses = h.classes.some((c) => classSet.has(c));
    const statusF = h.registered ? 1 : 0.85;
    let classF = inYourClasses ? 1 : h.classes.length ? 0.5 : 0.7;
    if (famous) classF = Math.max(classF, 0.85); // famous marks reach across classes
    let score = 100 * s.value * statusF * classF + (strong ? 10 : 0);
    score = Math.max(0, Math.min(100, Math.round(score)));

    const reasons = [s.why];
    reasons.push(h.registered ? "Live and registered" : "Live application (pending)");
    if (inYourClasses)
      reasons.push(`Covers your classes (${h.classes.filter((c) => classSet.has(c)).join(", ")})`);
    else if (h.classes.length) reasons.push(`Different classes (${h.classes.slice(0, 4).join(", ")})`);
    if (strong) reasons.push(`${owner} holds ${ownerN} live marks for this word${famous ? " (a strong, possibly famous brand)" : ""}`);

    scored.push({
      serialNumber: h.serialNumber,
      wordmark: h.wordmark,
      owner,
      classes: h.classes,
      registered: h.registered,
      status: h.status,
      registrationNumber: h.registrationNumber,
      url: h.url,
      score,
      similarity: s.kind,
      inYourClasses,
      reasons,
    });
  }
  scored.sort((a, b) => b.score - a.score || Number(b.registered) - Number(a.registered));
  // Top list: at most 2 marks per owner so one big owner doesn't hide others
  const perOwner = new Map<string, number>();
  const topConflicts: FlaggedMark[] = [];
  for (const m of scored) {
    if (m.score < 30 || topConflicts.length >= 10) continue;
    const k = m.owner ? ownerKey(m.owner) : m.serialNumber;
    const n = perOwner.get(k) ?? 0;
    if (n >= 2) continue;
    perOwner.set(k, n + 1);
    topConflicts.push(m);
  }

  const topOwners: OwnerSummary[] = [...ownerCounts.entries()]
    .map(([, e]) => ({ owner: e.display, liveMarks: e.n, classes: [...e.classes].sort((a, b) => a - b) }))
    .filter((o) => o.liveMarks >= 2)
    .sort((a, b) => b.liveMarks - a.liveMarks)
    .slice(0, 5);

  const liveCount = live?.total ?? bySerial.size;
  const counts = {
    total: ok(totalR)?.total ?? (live?.total ?? 0),
    live: liveCount,
    liveInYourClasses: ok(inClassR)?.total ?? scored.filter((m) => m.inYourClasses).length,
    exactLive: ok(exactR)?.total ?? scored.filter((m) => m.similarity === "exact").length,
    analyzed: scored.length,
  };

  // Verdict
  const top = topConflicts[0]?.score ?? 0;
  const highCount = scored.filter((m) => m.score >= 75).length;
  let verdict: Verdict;
  if (!live && !compo) verdict = "unknown";
  else if (top >= 75) verdict = "high";
  else if (top >= 40) verdict = "possible";
  else verdict = "clear";

  const N = name.toUpperCase();
  const cls = classes.join(", ");
  let headline: string;
  let explanation: string;
  if (verdict === "unknown") {
    headline = "Couldn't check right now";
    explanation = DEGRADED_MESSAGE;
  } else if (verdict === "high") {
    const lead = topOwners[0];
    headline = `High risk: ${highCount} live mark${highCount === 1 ? " closely matches" : "s closely match"} "${N}"`;
    explanation =
      `${counts.liveInYourClasses} live mark${counts.liveInYourClasses === 1 ? "" : "s"} for this name cover your classes (${cls}).` +
      (lead && lead.liveMarks >= 5 ? ` ${lead.owner} alone holds ${lead.liveMarks} live marks for this word.` : "") +
      " Expect a refusal or an objection. Consider a different name or talk to an attorney first.";
  } else if (verdict === "possible") {
    headline = `Possible conflict: similar live marks exist for "${N}"`;
    const t0 = topConflicts[0];
    explanation =
      `No identical live mark in your classes (${cls}), but ${topConflicts.length} similar mark${topConflicts.length === 1 ? "" : "s"} could be cited against you` +
      (t0 ? `. Closest: ${t0.wordmark}${t0.owner ? ` (${t0.owner})` : ""}, ${t0.reasons[0].toLowerCase()}` : "") +
      `. ${counts.liveInYourClasses} related live mark${counts.liveInYourClasses === 1 ? "" : "s"} sit in your classes.`;
  } else {
    headline = `Looks clear: no close live federal marks for "${N}"`;
    explanation = `We found no live USPTO marks that closely match this name in your classes (${cls}). Still check state registrations and common-law use before you commit.`;
  }

  const degraded =
    failed > 0 && verdict !== "unknown"
      ? "Some USPTO lookups didn't respond in time, so counts may be incomplete. Re-run in a minute for a full check."
      : verdict === "unknown"
        ? DEGRADED_MESSAGE
        : null;

  return {
    query: name,
    classes,
    verdict,
    headline,
    explanation,
    counts,
    topConflicts,
    topOwners,
    degraded,
    disclaimer: CONFLICT_DISCLAIMER,
    generatedAt: new Date().toISOString(),
  };
}

/** Plain-text rendering for MCP / LLM tools. */
export function conflictSummaryText(s: ConflictSummary): string {
  const label = { high: "HIGH RISK", possible: "POSSIBLE CONFLICT", clear: "LOOKS CLEAR", unknown: "UNAVAILABLE" }[s.verdict];
  const lines = [
    `Trademark check for "${s.query}" (classes ${s.classes.join(", ")}): ${label}`,
    s.headline,
    s.explanation,
    `Counts: ${s.counts.total} matching marks total, ${s.counts.live} live, ${s.counts.liveInYourClasses} live in your classes, ${s.counts.exactLive} exact live.`,
  ];
  if (s.topOwners.length)
    lines.push("Top owners: " + s.topOwners.map((o) => `${o.owner} (${o.liveMarks} live)`).join("; "));
  if (s.topConflicts.length) {
    lines.push("Top conflicts:");
    for (const m of s.topConflicts)
      lines.push(`- ${m.wordmark} [score ${m.score}] ${m.owner ?? "unknown owner"}, classes ${m.classes.join(",") || "?"}, SN ${m.serialNumber}: ${m.reasons.join("; ")}`);
  }
  if (s.degraded) lines.push(`Note: ${s.degraded}`);
  lines.push(s.disclaimer);
  return lines.join("\n");
}
