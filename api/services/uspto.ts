import type {
  PatentResult,
  PatentSearchResponse,
  PatentSort,
  TrademarkResult,
  TrademarkSearchResponse,
  TrademarkStatus,
} from "@contracts/types";
import { env } from "../lib/env";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { apiCache } from "@db/schema";

/**
 * Server-side client for USPTO public search systems.
 *
 * Patents:    USPTO Open Data Portal (api.uspto.gov) — the official, keyed
 *             API — when USPTO_ODP_API_KEY is configured. Otherwise falls
 *             back to USPTO Patent Public Search (ppubs.uspto.gov), the
 *             anonymous session the public website itself uses.
 * Trademarks: USPTO Trademark Search API (tmsearch.uspto.gov)
 *             Public Elasticsearch-backed endpoint, no auth required.
 *             (USPTO offers no official real-time trademark search API;
 *             the official alternatives are TSDR per-serial lookups and
 *             daily bulk case-file downloads.)
 */

// ─── Resilience: cache, timeouts, retries, degraded mode ────────────────────

/**
 * USPTO data changes at most daily (trademark index refreshes nightly), so a
 * 6-hour fresh window is safe. Entries are kept up to 48h and served as
 * "stale" with a notice if USPTO is down (stale-if-error).
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const STALE_MAX_MS = 48 * 60 * 60 * 1000;

// Cache lives in Postgres (api_cache) so it survives serverless cold starts
// and is shared by every function instance. A tiny per-instance memo avoids
// repeat DB reads within one warm instance. Cache failures never break search.
const memo = new Map<string, { data: unknown; storedAt: number }>();

async function readCache(key: string): Promise<{ data: unknown; storedAt: number } | null> {
  const m = memo.get(key);
  if (m) return m;
  if (!env.databaseUrl) return null; // no DB configured (local scripts/tests)
  try {
    const [row] = await getDb()
      .select()
      .from(apiCache)
      .where(and(eq(apiCache.key, key), gt(apiCache.staleUntil, new Date())));
    if (!row) return null;
    const hit = { data: row.value, storedAt: row.storedAt.getTime() };
    if (memo.size > 200) memo.clear();
    memo.set(key, hit);
    return hit;
  } catch (e) {
    console.warn("[cache] read failed:", (e instanceof Error ? e.message : String(e)).slice(0, 160));
    return null;
  }
}

async function cached<T>(key: string): Promise<T | null> {
  const hit = await readCache(key);
  if (hit && Date.now() - hit.storedAt < CACHE_TTL_MS) return hit.data as T;
  return null;
}

async function staleCached<T>(key: string): Promise<{ data: T; ageMs: number } | null> {
  const hit = await readCache(key);
  if (!hit) return null;
  const ageMs = Date.now() - hit.storedAt;
  if (ageMs > STALE_MAX_MS) return null;
  return { data: hit.data as T, ageMs };
}

async function store(key: string, data: unknown, ttlMs = CACHE_TTL_MS): Promise<void> {
  const now = Date.now();
  memo.set(key, { data, storedAt: now });
  if (!env.databaseUrl) return;
  try {
    const row = {
      key: key.slice(0, 600),
      value: data,
      storedAt: new Date(now),
      expiresAt: new Date(now + ttlMs),
      staleUntil: new Date(now + Math.max(ttlMs, STALE_MAX_MS)),
    };
    await getDb()
      .insert(apiCache)
      .values(row)
      .onConflictDoUpdate({
        target: apiCache.key,
        set: {
          value: row.value,
          storedAt: row.storedAt,
          expiresAt: row.expiresAt,
          staleUntil: row.staleUntil,
        },
      });
    if (Math.random() < 0.01) {
      void getDb()
        .delete(apiCache)
        .where(lt(apiCache.staleUntil, new Date()))
        .catch(() => {});
    }
  } catch (e) {
    console.warn("[cache] write failed:", (e instanceof Error ? e.message : String(e)).slice(0, 160));
  }
}

/** User-facing message when a USPTO system is down. */
export const DEGRADED_MESSAGE =
  "USPTO's search systems are slow or unavailable right now. Please try again in a few minutes.";

export class UsptoUnavailableError extends Error {
  constructor(detail: string) {
    super(`${DEGRADED_MESSAGE} (${detail})`);
    this.name = "UsptoUnavailableError";
  }
}

// Netlify synchronous functions time out at ~10s, so in serverless we give
// each USPTO call one 8s budget (2 attempts max, sharing that budget).
// On a long-running server we allow 12s per attempt and 3 attempts.
const REQUEST_TIMEOUT_MS = env.isServerless ? 8_000 : 12_000;
const MAX_ATTEMPTS = env.isServerless ? 2 : 3;
const TOTAL_BUDGET_MS = env.isServerless ? 8_000 : 40_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch() with a per-attempt timeout and retries with exponential backoff +
 * jitter on network errors, timeouts, 429 and 5xx. 4xx (other than 429) is
 * returned to the caller immediately. Bodies must be re-sendable (strings /
 * FormData), which all callers here use.
 */
async function usptoFetch(
  url: string,
  init: RequestInit = {},
  attempts = MAX_ATTEMPTS,
): Promise<Response> {
  let lastErr = "unknown error";
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      const backoff = 300 * 2 ** (i - 1) + Math.floor(Math.random() * 200);
      if (Date.now() + backoff + 1000 > deadline) break; // no time for another try
      await sleep(backoff);
    }
    const timeLeft = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now());
    if (timeLeft < 1000) break;
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeLeft),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = `HTTP ${res.status}`;
        const retryAfter = Number(res.headers.get("retry-after"));
        if (retryAfter > 0 && retryAfter <= 3 && i < attempts - 1 && Date.now() + retryAfter * 1000 + 1000 < deadline) {
          await sleep(retryAfter * 1000);
        }
        if (i === attempts - 1) return res;
        continue;
      }
      return res;
    } catch (e) {
      lastErr =
        e instanceof Error
          ? e.name === "TimeoutError" || e.name === "AbortError"
            ? `timed out`
            : e.message
          : String(e);
    }
  }
  throw new UsptoUnavailableError(lastErr);
}

function staleNotice(ageMs: number): string {
  const hrs = Math.max(1, Math.round(ageMs / 3_600_000));
  return `USPTO is currently unreachable, so these are cached results from about ${hrs} hour${hrs === 1 ? "" : "s"} ago. Re-run later for live data.`;
}

// ─── Patent search (ppubs.uspto.gov) ────────────────────────────────────────

const PPUBS = "https://ppubs.uspto.gov/api";

interface PatentSession {
  token: string;
  caseId: number;
  createdAt: number;
}

let patentSession: PatentSession | null = null;
const PPUBS_SESSION_KEY = "ppubs:session";

async function getPatentSession(force = false): Promise<PatentSession> {
  if (!force && !patentSession) {
    // reuse a session another function instance already opened
    patentSession = await cached<PatentSession>(PPUBS_SESSION_KEY);
  }
  if (
    !force &&
    patentSession &&
    Date.now() - patentSession.createdAt < 20 * 60 * 1000
  ) {
    return patentSession;
  }
  const res = await usptoFetch(`${PPUBS}/users/me/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "-1",
  });
  if (!res.ok) throw new Error(`USPTO patent session failed (${res.status})`);
  const token = res.headers.get("x-access-token");
  const data = (await res.json()) as { userCase?: { caseId?: number } };
  if (!token || !data.userCase?.caseId) {
    throw new Error("USPTO patent session returned no token");
  }
  patentSession = { token, caseId: data.userCase.caseId, createdAt: Date.now() };
  await store(PPUBS_SESSION_KEY, patentSession, 20 * 60 * 1000);
  return patentSession;
}

const SORT_MAP: Record<PatentSort, string> = {
  relevance: "score desc",
  newest: "date_publ desc",
  oldest: "date_publ asc",
};

function isoDate(v: unknown): string | null {
  if (typeof v === "string" && v) return v.slice(0, 10);
  if (Array.isArray(v) && typeof v[0] === "string" && v[0])
    return v[0].slice(0, 10);
  return null;
}

/** USPTO injects <span term=... class=highlightN> into hit fields — strip it. */
function stripMarkup(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

function normalizePatent(raw: Record<string, unknown>): PatentResult {
  const guid = String(raw.guid ?? "");
  const type = String(raw.type ?? "");
  const kind: PatentResult["kind"] =
    type === "USPAT" ? "grant" : type === "US-PGPUB" ? "application" : "other";
  return {
    id: guid,
    documentId: stripMarkup(String(raw.documentId ?? guid.replaceAll("-", " "))),
    title: stripMarkup(String(raw.inventionTitle ?? "Untitled")),
    type,
    kind,
    publicationNumber: String(raw.publicationReferenceDocumentNumber ?? ""),
    datePublished: isoDate(raw.datePublished),
    filingDate: isoDate(raw.applicationFilingDate),
    applicants: Array.isArray(raw.applicantName)
      ? (raw.applicantName as string[]).map((a) => stripMarkup(String(a)))
      : raw.applicantName
        ? [stripMarkup(String(raw.applicantName))]
        : [],
    inventors: raw.inventorsShort
      ? stripMarkup(String(raw.inventorsShort))
      : null,
    ipc: raw.ipcCodeFlattened ? String(raw.ipcCodeFlattened) : null,
    cpc: raw.cpcInventiveFlattened ? String(raw.cpcInventiveFlattened) : null,
    applicationNumber: raw.applicationNumber
      ? String(raw.applicationNumber)
      : null,
    url: `https://patents.google.com/patent/${guid.replaceAll("-", "")}`,
  };
}

interface PpubsSearchResponse {
  numFound?: number;
  patents?: Record<string, unknown>[];
  error?: { message?: string } | string | null;
}

function buildPatentQueryBody(
  query: string,
  caseId: number,
): Record<string, unknown> {
  return {
    anchorDocIds: null,
    querySource: "brs",
    caseId,
    hl_snippets: "2",
    op: "OR",
    q: query,
    queryName: query,
    highlights: "1",
    qt: "brs",
    spellCheck: false,
    viewName: "tile",
    plurals: true,
    britishEquivalents: true,
    databaseFilters: [
      { databaseName: "US-PGPUB", countryCodes: [] },
      { databaseName: "USPAT", countryCodes: [] },
      { databaseName: "USOCR", countryCodes: [] },
    ],
    searchType: 1,
    ignorePersist: true,
    userEnteredQuery: query,
  };
}

async function ppubsFetch(
  path: string,
  body: unknown,
  sess: PatentSession,
): Promise<Response> {
  const res = await usptoFetch(`${PPUBS}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-token": sess.token,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    const err = new Error("session expired") as Error & { code: string };
    err.code = "SESSION_EXPIRED";
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `USPTO patent search failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  return res;
}

async function runPatentSearch(
  query: string,
  start: number,
  perPage: number,
  sort: PatentSort,
  sess: PatentSession,
): Promise<{ total: number; patents: Record<string, unknown>[] }> {
  const queryBody = buildPatentQueryBody(query, sess.caseId);
  const searchBody = {
    start,
    pageCount: perPage,
    sort: SORT_MAP[sort],
    docFamilyFiltering: "familyIdFiltering",
    searchType: 1,
    familyIdEnglishOnly: true,
    familyIdFirstPreferred: "US-PGPUB",
    familyIdSecondPreferred: "USPAT",
    familyIdThirdPreferred: "FPRS",
    showDocPerFamilyPref: "showEnglish",
    queryId: 0,
    tagDocSearch: false,
    query: queryBody,
  };
  const [countRes, searchRes] = await Promise.all([
    ppubsFetch("searches/counts", queryBody, sess),
    ppubsFetch("searches/searchWithBeFamily", searchBody, sess),
  ]);
  const countData = (await countRes.json()) as { numResults?: number };
  const searchData = (await searchRes.json()) as PpubsSearchResponse;
  if (searchData.error) {
    const msg =
      typeof searchData.error === "string"
        ? searchData.error
        : searchData.error.message;
    throw new Error(msg || "USPTO rejected the query syntax");
  }
  return {
    total: countData.numResults ?? searchData.numFound ?? 0,
    patents: searchData.patents ?? [],
  };
}

// ─── Official patent search: USPTO Open Data Portal (api.uspto.gov) ────────
//
// This is the sanctioned, API-key-backed channel. When USPTO_ODP_API_KEY is
// set it is preferred for all plain-text queries; Patent Public Search
// remains as (a) the fallback when no key is configured, (b) the fallback
// when ODP errors, and (c) the engine for power-user BRS fielded syntax
// (e.g. "drone.ti.") which the ODP search grammar does not support.

const ODP = "https://api.uspto.gov/api/v1";

/** ppubs BRS field codes like drone.ti. or "solar cell".ab. */
function looksLikeBrsQuery(q: string): boolean {
  return /\.\s*(ti|ttl|ab|abst|cl|clm|spec|as|aanm|asnm|asst|asrc|in|invt|ic|icl|ipc|cpc|pd|isd|di)\s*\./i.test(
    q,
  );
}

function escapeOdpString(s: string): string {
  return s.replace(/[+\-=&|!(){}[\]^"~?:\\/]/g, "\\$&");
}

/**
 * Plain text → ODP query-string (OpenSearch grammar) scoped to the fields
 * users actually mean: title, applicant, inventor.
 *
 * The ODP does NOT relevance-rank OR queries (results come back in ingestion
 * order), so plain OR-of-tokens returns noise. Instead we use tiered AND
 * semantics: exact phrase, then all-words-in-title (exact and prefix), then
 * all-words in applicant/inventor — tight, predictable result sets.
 * ODP-native fielded queries (applicationMetaData.*) pass through untouched.
 */
export function buildOdpPatentQuery(raw: string): string {
  const q = raw.trim();
  if (q.includes("applicationMetaData.") || q.startsWith("applicationNumberText:")) {
    return q;
  }
  const tokens = escapeOdpString(q)
    .replace(/\\"/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const T = "applicationMetaData.inventionTitle";
  const A = "applicationMetaData.applicantBag.applicantNameText";
  const I = "applicationMetaData.inventorBag.inventorNameText";
  const parts: string[] = [];
  if (tokens.length > 1) {
    const phrase = tokens.join(" ").replace(/\\/g, "");
    const all = tokens.join(" AND ");
    const allPrefix = tokens.map((t) => `${t}*`).join(" AND ");
    parts.push(`${T}:"${phrase}"`);
    parts.push(`${T}:(${all})`);
    parts.push(`${T}:(${allPrefix})`);
    parts.push(`${A}:(${all})`);
    parts.push(`${I}:(${all})`);
  } else {
    const t = tokens[0];
    parts.push(`${T}:(${t} OR ${t}*)`);
    parts.push(`${A}:(${t} OR ${t}*)`);
    parts.push(`${I}:(${t} OR ${t}*)`);
  }
  return `(${parts.join(" OR ")})`;
}

const ODP_SORT: Record<PatentSort, { field: string; order: string } | null> = {
  // ODP doesn't relevance-rank; newest-first is the deterministic proxy.
  relevance: { field: "applicationMetaData.filingDate", order: "desc" },
  newest: { field: "applicationMetaData.filingDate", order: "desc" },
  oldest: { field: "applicationMetaData.filingDate", order: "asc" },
};

const ODP_FIELDS = [
  "applicationNumberText",
  "applicationMetaData.inventionTitle",
  "applicationMetaData.filingDate",
  "applicationMetaData.grantDate",
  "applicationMetaData.patentNumber",
  "applicationMetaData.earliestPublicationNumber",
  "applicationMetaData.earliestPublicationDate",
  "applicationMetaData.applicationStatusDescriptionText",
  "applicationMetaData.firstApplicantName",
  "applicationMetaData.firstInventorName",
  "applicationMetaData.applicantBag",
  "applicationMetaData.inventorBag",
  "applicationMetaData.cpcClassificationBag",
];

interface OdpNameBagEntry {
  applicantNameText?: string;
  inventorNameText?: string;
}

interface OdpMeta {
  inventionTitle?: string;
  filingDate?: string;
  grantDate?: string;
  patentNumber?: string;
  earliestPublicationNumber?: string;
  earliestPublicationDate?: string;
  applicationStatusDescriptionText?: string;
  firstApplicantName?: string;
  firstInventorName?: string;
  applicantBag?: OdpNameBagEntry[];
  inventorBag?: OdpNameBagEntry[];
  cpcClassificationBag?: string[];
}

interface OdpRecord {
  applicationNumberText?: string;
  applicationMetaData?: OdpMeta;
}

function bagNames(bag: OdpNameBagEntry[] | undefined, key: keyof OdpNameBagEntry): string[] {
  return (bag ?? [])
    .map((e) => e[key])
    .filter((v): v is string => typeof v === "string" && !!v);
}

/**
 * Some ODP records contaminate inventorBag with non-inventor parties
 * (patent numbers, law firms, applicants, "X Inc. (3rd Pty Req.)").
 * Keep only entries that look like people.
 */
function cleanInventorNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((n) => {
    const name = n.trim();
    if (!name || seen.has(name)) return false;
    if (/^\d[\d\s,]*$/.test(name)) return false; // stray patent/app numbers
    if (/\([^)]*\)\s*$/.test(name)) return false; // "(TC)", "(3rd Pty Req.)"
    if (
      /(LLC|LLP|INC\.?|CORP\.?|CORPORATION|P\.A\.|P\.C\.|LTD|GMBH|S\.A\.|COMPANY|REPRESENTED)/i.test(
        name,
      )
    )
      return false; // organizations, not inventors
    seen.add(name);
    return true;
  });
}

/** "US20220205601A1" → "20220205601"; "11578847" → "11578847" (kind code dropped). */
function parseUsNumber(v: unknown): string {
  if (!v) return "";
  const m = String(v).trim().toUpperCase().replace(/^US\s?/, "").match(/^(\d+)/);
  return m ? m[1] : "";
}

function normalizeOdpPatent(rec: OdpRecord): PatentResult {
  const meta = rec.applicationMetaData ?? {};
  const appNo = rec.applicationNumberText ? String(rec.applicationNumberText) : null;
  const patentNo = parseUsNumber(meta.patentNumber);
  const pubNo = parseUsNumber(meta.earliestPublicationNumber);
  const isGrant = !!patentNo;
  const number = isGrant ? patentNo : pubNo;
  const id = number ? `US-${number}` : `US-APP-${appNo ?? "unknown"}`;
  const applicants = bagNames(meta.applicantBag, "applicantNameText");
  if (applicants.length === 0 && meta.firstApplicantName) applicants.push(meta.firstApplicantName);
  const inventors =
    cleanInventorNames(bagNames(meta.inventorBag, "inventorNameText")).join(
      "; ",
    ) ||
    meta.firstInventorName ||
    null;
  return {
    id,
    documentId: number ? `US ${number}` : appNo ? `US ${appNo}` : id,
    title: meta.inventionTitle || "Untitled",
    type: isGrant ? "USPAT" : "US-PGPUB",
    kind: isGrant ? "grant" : "application",
    publicationNumber: number,
    datePublished: isoDate(meta.grantDate ?? meta.earliestPublicationDate),
    filingDate: isoDate(meta.filingDate),
    applicants,
    inventors,
    ipc: null,
    cpc: meta.cpcClassificationBag?.length
      ? meta.cpcClassificationBag
          .map((c) => String(c).replace(/\s+/g, " ").trim())
          .join("; ")
      : null,
    applicationNumber: appNo,
    url: number
      ? `https://patents.google.com/patent/US${number}`
      : `https://ppubs.uspto.gov/pubwebapp/external.html?q=${appNo ?? ""}`,
  };
}

async function searchPatentsOdp(
  query: string,
  start: number,
  perPage: number,
  sort: PatentSort,
): Promise<{ total: number; results: PatentResult[] }> {
  const sortSpec = ODP_SORT[sort];
  const res = await usptoFetch(`${ODP}/patent/applications/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": env.usptoOdpApiKey,
    },
    body: JSON.stringify({
      q: buildOdpPatentQuery(query),
      pagination: { offset: start, limit: perPage },
      ...(sortSpec ? { sort: [sortSpec] } : {}),
      fields: ODP_FIELDS,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `USPTO Open Data Portal search failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as {
    count?: number;
    patentFileWrapperDataBag?: OdpRecord[];
  };
  return {
    total: data.count ?? 0,
    results: (data.patentFileWrapperDataBag ?? []).map(normalizeOdpPatent),
  };
}

/** Which channel is configured to serve patent searches right now. */
export function patentDataSource(): "uspto-open-data-portal" | "uspto-patent-public-search" {
  return env.usptoOdpApiKey ? "uspto-open-data-portal" : "uspto-patent-public-search";
}

/** Prefer the official ODP API when a key is set; plain-text queries only. */
function preferOdp(query: string): boolean {
  return !!env.usptoOdpApiKey && !looksLikeBrsQuery(query);
}

async function searchPatentsLive(opts: {
  query: string;
  page?: number;
  perPage?: number;
  sort?: PatentSort;
}): Promise<PatentSearchResponse> {
  const query = opts.query.trim();
  if (!query) throw new Error("Query is required");
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(50, Math.max(1, opts.perPage ?? 25));
  const sort = opts.sort ?? "newest";
  const start = (page - 1) * perPage;
  if (start >= 1000)
    throw new Error("Paging beyond 1000 results is not supported");

  const cacheKey = `pat:${query}|${page}|${perPage}|${sort}`;
  const hit = await cached<PatentSearchResponse>(cacheKey);
  if (hit) return hit;

  // Official channel first
  if (preferOdp(query)) {
    try {
      const data = await searchPatentsOdp(query, start, perPage, sort);
      const out: PatentSearchResponse = {
        type: "patents",
        query,
        page,
        perPage,
        total: data.total,
        totalPages: Math.max(1, Math.ceil(Math.min(data.total, 1000) / perPage)),
        results: data.results,
        source: "USPTO Open Data Portal",
      };
      await store(cacheKey, out);
      return out;
    } catch (e) {
      console.warn(
        "USPTO Open Data Portal search failed, falling back to Patent Public Search:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  let sess = await getPatentSession();
  let data: { total: number; patents: Record<string, unknown>[] };
  try {
    data = await runPatentSearch(query, start, perPage, sort, sess);
  } catch (e) {
    if ((e as { code?: string }).code === "SESSION_EXPIRED") {
      sess = await getPatentSession(true);
      data = await runPatentSearch(query, start, perPage, sort, sess);
    } else {
      throw e;
    }
  }

  const out: PatentSearchResponse = {
    type: "patents",
    query,
    page,
    perPage,
    total: data.total,
    totalPages: Math.max(1, Math.ceil(Math.min(data.total, 1000) / perPage)),
    results: data.patents.map(normalizePatent),
    source: "USPTO Patent Public Search",
  };
  await store(cacheKey, out);
  return out;
}

export async function getPatentTotal(query: string): Promise<number> {
  if (preferOdp(query)) {
    try {
      const data = await searchPatentsOdp(query.trim(), 0, 1, "relevance");
      return data.total;
    } catch (e) {
      console.warn(
        "USPTO Open Data Portal count failed, falling back to Patent Public Search:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  let sess = await getPatentSession();
  const run = async (s: PatentSession) => {
    const res = await ppubsFetch(
      "searches/counts",
      buildPatentQueryBody(query.trim(), s.caseId),
      s,
    );
    return ((await res.json()) as { numResults?: number }).numResults ?? 0;
  };
  try {
    return await run(sess);
  } catch (e) {
    if ((e as { code?: string }).code === "SESSION_EXPIRED") {
      sess = await getPatentSession(true);
      return run(sess);
    }
    throw e;
  }
}

// ─── Trademark search (tmsearch.uspto.gov) ──────────────────────────────────

const TMSEARCH = "https://tmsearch.uspto.gov/prod-stage-v1-0-0/tmsearch";

function escapeQueryString(s: string): string {
  return s.replace(/[+\-=&|!(){}[\]^"~?:\\/]/g, "\\$&");
}

/**
 * Build the Elasticsearch query_string for the USPTO trademark index.
 * Plain text searches wordmark + owner with tiered relevance: exact phrase
 * first, then marks containing ALL words, then marks/owners containing ANY
 * word (with prefix matching). 6-8 digit numbers search serial / registration
 * numbers; fielded syntax (wordmark:..., ownerName:...) passes through.
 */
export function buildTrademarkQueryString(
  raw: string,
  status: TrademarkStatus,
): string {
  const q = raw.trim();
  let es: string;
  if (/^\d{6,8}$/.test(q)) {
    es = `(id:"${q}" OR registrationId:"${q}")`;
  } else if (/^(wordmark|ownerName|attorney|id|registrationId):/i.test(q)) {
    es = q; // power-user / AI fielded syntax passes through
  } else {
    const esc = escapeQueryString(q);
    const tokens = esc.split(/\s+/).filter(Boolean);
    const anyToken = tokens.flatMap((t) => [t, `${t}*`]).join(" OR ");
    const allTokens = tokens.map((t) => `${t}*`).join(" AND ");
    const parts = [`(wordmark:"${esc}")^6`];
    if (tokens.length > 1) parts.push(`(wordmark:(${allTokens}))^4`);
    parts.push(`wordmark:(${anyToken})`, `ownerName:(${anyToken})`);
    es = `(${parts.join(" OR ")})`;
  }
  if (status === "live") es += " AND alive:true";
  if (status === "dead") es += " AND alive:false";
  return es;
}

interface EsHit {
  id: string;
  source: Record<string, unknown>;
}

interface EsResponse {
  hits?: { totalValue?: number; hits?: EsHit[] };
  error?: string;
}

function asStrArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  if (typeof v === "string" && v) return [v];
  return [];
}

function normalizeTrademark(hit: EsHit): TrademarkResult {
  const s = hit.source;
  const serial = String(s.id ?? hit.id);
  return {
    serialNumber: serial,
    wordmark: String(s.wordmark ?? "(design mark)"),
    status: s.statusDescription ? String(s.statusDescription) : null,
    statusCode: typeof s.statusCode === "number" ? s.statusCode : null,
    alive: s.alive === true,
    registered: s.registered === true,
    registrationNumber: s.registrationId ? String(s.registrationId) : null,
    registrationDate: isoDate(s.registrationDate),
    filingDate: isoDate(s.filedDate),
    publicationDate: isoDate(s.publishForOppositionDate),
    abandonmentDate: isoDate(s.abandonDate),
    owner: asStrArray(s.ownerName)[0] ?? null,
    ownerEntity: s.ownerEntity ? String(s.ownerEntity) : null,
    ownerAddress: s.ownerStateCountryAddress
      ? String(s.ownerStateCountryAddress)
      : null,
    goodsAndServices: asStrArray(s.goodsAndServices),
    internationalClasses: asStrArray(s.internationalClass),
    markType: asStrArray(s.markType),
    designPhrases: asStrArray(s.designCodeDescription),
    markDescription: asStrArray(s.markDescription),
    attorney: s.attorney ? String(s.attorney) : null,
    drawingCode: s.drawingCode != null ? String(s.drawingCode) : null,
    disclaimer: s.disclaimer ? String(s.disclaimer) : null,
    url: `https://tsdr.uspto.gov/#caseNumber=${serial}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch`,
  };
}

async function searchTrademarksLive(opts: {
  query: string;
  status?: TrademarkStatus;
  page?: number;
  perPage?: number;
}): Promise<TrademarkSearchResponse> {
  const query = opts.query.trim();
  if (!query) throw new Error("Query is required");
  const status: TrademarkStatus = opts.status ?? "all";
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(50, Math.max(1, opts.perPage ?? 25));

  const cacheKey = `tm:${query}|${status}|${page}|${perPage}`;
  const hit = await cached<TrademarkSearchResponse>(cacheKey);
  if (hit) return hit;

  const esQuery = buildTrademarkQueryString(query, status);
  const res = await usptoFetch(TMSEARCH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: { query_string: { query: esQuery } },
      from: (page - 1) * perPage,
      size: perPage,
      track_total_hits: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `USPTO trademark search failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as EsResponse;
  if (data.error) throw new Error(String(data.error));

  const total = data.hits?.totalValue ?? 0;
  const out: TrademarkSearchResponse = {
    type: "trademarks",
    query,
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    results: (data.hits?.hits ?? []).map(normalizeTrademark),
    source: "USPTO Trademark Search",
  };
  await store(cacheKey, out);
  return out;
}

export async function getTrademarkTotal(
  query: string,
  status: TrademarkStatus = "all",
): Promise<number> {
  const esQuery = buildTrademarkQueryString(query.trim(), status);
  const res = await usptoFetch(TMSEARCH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: { query_string: { query: esQuery } },
      size: 0,
      track_total_hits: true,
    }),
  });
  if (!res.ok) throw new Error(`USPTO trademark search failed (${res.status})`);
  const data = (await res.json()) as EsResponse;
  if (data.error) throw new Error(String(data.error));
  return data.hits?.totalValue ?? 0;
}

/** Count of live marks containing the exact name (wordmark prefix match). */
async function getLiveTrademarkCountLive(name: string): Promise<number> {
  const esc = escapeQueryString(name.trim());
  if (!esc) return 0;
  const res = await usptoFetch(TMSEARCH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: {
        query_string: { query: `wordmark:(${esc}*) AND alive:true` },
      },
      size: 0,
      track_total_hits: true,
    }),
  });
  if (!res.ok) throw new Error(`USPTO trademark search failed (${res.status})`);
  const data = (await res.json()) as EsResponse;
  return data.hits?.totalValue ?? 0;
}

// ─── Trademark image search (visual similarity) ─────────────────────────────

const TM_IMAGE_SEARCH =
  "https://tmsearch.uspto.gov/image-search-api-v1-0-0/imagesearch";

/**
 * Phonetic variants of a name for sound-alike trademark checking.
 * Handles the classic confusables: ph/f, k/c, x/z, s/z, doubling, and
 * trailing-s plural. Returns unique variants (excluding the original).
 */
export function phoneticVariants(name: string): string[] {
  const n = name.trim().toLowerCase();
  if (!n) return [];
  const variants = new Set<string>();
  const subs: [RegExp, string][] = [
    [/ph/g, "f"],
    [/f/g, "ph"],
    [/c(?=[eiy])/g, "s"], // c before soft vowels -> s
    [/c/g, "k"],
    [/k/g, "c"],
    [/x/g, "z"],
    [/z/g, "x"],
    [/s/g, "z"],
    [/ck/g, "k"],
    [/qu/g, "kw"],
  ];
  for (const [re, rep] of subs) {
    if (re.test(n)) variants.add(n.replace(re, rep));
  }
  // doubling/undoubling of double letters (lyft vs lift, dropbox vs dropboxx)
  const doubled = n.replace(/(.)\1/g, "$1");
  if (doubled !== n) variants.add(doubled);
  variants.delete(n);
  return [...variants].slice(0, 6);
}

export interface ImageSearchResult {
  serialNumber: string;
  wordmark: string;
  status: string | null;
  statusDetail: string | null;
  alive: boolean;
  registered: boolean;
  registrationNumber: string | null;
  filingDate: string | null;
  owner: string | null;
  classes: number[];
  goodsAndServices: string[];
  thumbnailUrl: string;
  largeImageUrl: string;
  url: string;
}

export interface ImageSearchResponse {
  total: number;
  liveCount: number;
  deadCount: number;
  results: ImageSearchResult[];
}

/** USPTO stringifies arrays oddly, e.g. "['IC 036']" — clean them up. */
function cleanListString(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== "string") return [];
  return v
    .replace(/^\[|\]$/g, "")
    .split(/","|', '|","|","/)
    .map((s) => s.replace(/^["'\s]+|["'\s]+$/g, ""))
    .filter((s) => s && s !== "None");
}

export interface ImageSearchOptions {
  image?: Blob;
  imageUrl?: string;
  text?: string;
  status?: "all" | "live" | "dead";
  classes?: number[];
  page?: number;
  perPage?: number;
}

interface RawImageHit {
  id: string;
  source: Record<string, unknown>;
}

function aliveFromStatusDetail(detail: unknown): boolean {
  const d = String(detail ?? "").toLowerCase();
  return d.startsWith("pending") || d.startsWith("registered");
}

export async function searchTrademarksByImage(
  opts: ImageSearchOptions,
): Promise<ImageSearchResponse> {
  if (!opts.image && !opts.imageUrl && !opts.text?.trim()) {
    throw new Error("Provide an image or text to search.");
  }
  const status = opts.status ?? "all";
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(48, Math.max(1, opts.perPage ?? 24));

  const form = new FormData();
  if (opts.image) form.append("file", opts.image, "upload.png");
  else if (opts.imageUrl) form.append("image_url", opts.imageUrl);
  if (opts.text?.trim()) form.append("text_search", opts.text.trim());
  if (status === "live") form.append("status_detail", "Pending,Registered");
  if (status === "dead") form.append("status_detail", "Abandoned,Cancelled");
  if (opts.classes?.length) form.append("classes", opts.classes.join(","));
  form.append("page", String(page - 1));
  form.append("results_per_page", String(perPage));

  const res = await usptoFetch(TM_IMAGE_SEARCH, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `USPTO image search failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as {
    hits?: { hits?: RawImageHit[]; totalValue?: number };
    aggregations?: { alive?: number };
  };
  const hits = data.hits?.hits ?? [];

  // Enrich similarity hits with full records from the trademark index
  const serials = hits.map((h) => String(h.source.tm_id ?? h.id));
  let fullBySerial = new Map<string, TrademarkResult>();
  if (serials.length > 0) {
    try {
      const enrichRes = await usptoFetch(TMSEARCH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: { terms: { id: serials } },
          size: serials.length,
        }),
      });
      if (enrichRes.ok) {
        const enrichData = (await enrichRes.json()) as EsResponse;
        for (const h of enrichData.hits?.hits ?? []) {
          const t = normalizeTrademark(h);
          fullBySerial.set(t.serialNumber, t);
        }
      }
    } catch {
      // enrichment is best-effort — raw similarity data still works
    }
  }

  const results: ImageSearchResult[] = hits.map((h) => {
    const s = h.source;
    const serial = String(s.tm_id ?? h.id);
    const full = fullBySerial.get(serial);
    const classes = cleanListString(s.classes)
      .map((c) => parseInt(c, 10))
      .filter((n) => !Number.isNaN(n));
    const statusDetail =
      s.status_detail && String(s.status_detail) !== "None"
        ? String(s.status_detail)
        : null;
    return {
      serialNumber: serial,
      wordmark:
        full?.wordmark && full.wordmark !== "(design mark)"
          ? full.wordmark
          : s.wordmark && String(s.wordmark) !== "None"
            ? String(s.wordmark)
            : "(design mark)",
      status: full?.status ?? (s.status ? String(s.status) : null),
      statusDetail,
      alive: full?.alive ?? aliveFromStatusDetail(s.status_detail),
      registered: full?.registered ?? false,
      registrationNumber:
        full?.registrationNumber ??
        (s.regnum && String(s.regnum) !== "None" ? String(s.regnum) : null),
      filingDate: full?.filingDate ?? null,
      owner: full?.owner ?? cleanListString(s.ownerName)[0] ?? null,
      classes: full?.internationalClasses.length
        ? full.internationalClasses
            .map((c) => parseInt(c.replace(/\D/g, ""), 10))
            .filter((n) => !Number.isNaN(n))
        : classes,
      goodsAndServices: full?.goodsAndServices ?? [],
      thumbnailUrl: `https://tmcms-docs.uspto.gov/cases/${serial}/mark/thumbnail.png`,
      largeImageUrl: `https://tmcms-docs.uspto.gov/cases/${serial}/mark/large.png`,
      url: `https://tsdr.uspto.gov/#caseNumber=${serial}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch`,
    };
  });

  const total = data.hits?.totalValue ?? results.length;
  // USPTO returns aggregations.alive as a plain number = live mark count
  const aliveRaw = data.aggregations?.alive;
  const liveCount =
    typeof aliveRaw === "number" ? aliveRaw : results.filter((r) => r.alive).length;
  return {
    total,
    liveCount,
    deadCount: Math.max(0, total - liveCount),
    results,
  };
}

// ─── Public entry points with stale-if-error degraded mode ──────────────────

function withStale<A extends { query: string }, R extends { notice?: string }>(
  keyFn: (a: A) => string,
  live: (a: A) => Promise<R>,
): (a: A) => Promise<R> {
  return async (a: A) => {
    try {
      return await live(a);
    } catch (e) {
      const stale = await staleCached<R>(keyFn(a));
      if (stale) {
        console.warn("[uspto] serving stale cache:", e instanceof Error ? e.message : e);
        return { ...stale.data, notice: staleNotice(stale.ageMs) };
      }
      throw e;
    }
  };
}

export const searchPatents = withStale(
  (o: { query: string; page?: number; perPage?: number; sort?: PatentSort }) =>
    `pat:${o.query.trim()}|${Math.max(1, o.page ?? 1)}|${Math.min(50, Math.max(1, o.perPage ?? 25))}|${o.sort ?? "newest"}`,
  searchPatentsLive,
);

export const searchTrademarks = withStale(
  (o: { query: string; status?: TrademarkStatus; page?: number; perPage?: number }) =>
    `tm:${o.query.trim()}|${o.status ?? "all"}|${Math.max(1, o.page ?? 1)}|${Math.min(50, Math.max(1, o.perPage ?? 25))}`,
  searchTrademarksLive,
);

/** Count of live marks containing the exact name (cached, stale-if-error). */
export async function getLiveTrademarkCount(name: string): Promise<number> {
  const key = `tmlive:${name.trim().toLowerCase()}`;
  const fresh = await cached<number>(key);
  if (fresh !== null) return fresh;
  try {
    const n = await getLiveTrademarkCountLive(name);
    await store(key, n);
    return n;
  } catch (e) {
    const stale = await staleCached<number>(key);
    if (stale) return stale.data;
    throw e;
  }
}

if (!env.usptoOdpApiKey) {
  console.warn(
    "[uspto] USPTO_ODP_API_KEY is not set — patent search will use the unofficial Patent Public Search session. Get an official key at data.uspto.gov/apikey.",
  );
}

// ─── Raw trademark queries for the conflict-summary layer ───────────────────

export { escapeQueryString as escapeTmQuery };

export interface RawTmHit {
  serialNumber: string;
  wordmark: string;
  owner: string | null;
  classes: number[];
  alive: boolean;
  registered: boolean;
  statusCode: number | null;
  status: string | null;
  registrationNumber: string | null;
  filingDate: string | null;
  url: string;
}

const RAW_FIELDS = [
  "id", "wordmark", "ownerName", "internationalClass", "alive", "registered",
  "statusCode", "statusDescription", "registrationId", "filedDate",
];

/** "IC 009" / "009" / "9" → 9 (Nice classes 1-45 only). */
export function parseNiceClass(s: string): number | null {
  const m = /(\d{1,3})/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 45 ? n : null;
}

/**
 * One trademark-index query returning lean records + total count.
 * Cached in Postgres; serves stale on failure; throws UsptoUnavailableError
 * if USPTO is down and nothing is cached.
 */
export async function tmRawQuery(
  es: string,
  size: number,
): Promise<{ total: number; hits: RawTmHit[] }> {
  const key = `tmraw:${size}:${es}`;
  const fresh = await cached<{ total: number; hits: RawTmHit[] }>(key);
  if (fresh) return fresh;
  try {
    const res = await usptoFetch(TMSEARCH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: { query_string: { query: es } },
        size,
        track_total_hits: true,
        _source: RAW_FIELDS,
      }),
    });
    if (!res.ok) throw new UsptoUnavailableError(`HTTP ${res.status}`);
    const data = (await res.json()) as EsResponse;
    if (data.error) throw new Error(String(data.error));
    const hits: RawTmHit[] = (data.hits?.hits ?? []).map((h) => {
      const s = h.source;
      const serial = String(s.id ?? h.id);
      return {
        serialNumber: serial,
        wordmark: s.wordmark ? String(s.wordmark) : "",
        owner: asStrArray(s.ownerName)[0] ?? null,
        classes: asStrArray(s.internationalClass)
          .map(parseNiceClass)
          .filter((n): n is number => n !== null),
        alive: s.alive === true,
        registered: s.registered === true,
        statusCode: typeof s.statusCode === "number" ? s.statusCode : null,
        status: s.statusDescription ? String(s.statusDescription) : null,
        registrationNumber: s.registrationId ? String(s.registrationId) : null,
        filingDate: isoDate(s.filedDate),
        url: `https://tsdr.uspto.gov/#caseNumber=${serial}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch`,
      };
    });
    const out = { total: data.hits?.totalValue ?? 0, hits };
    await store(key, out);
    return out;
  } catch (e) {
    const stale = await staleCached<{ total: number; hits: RawTmHit[] }>(key);
    if (stale) return stale.data;
    throw e;
  }
}
