import type {
  PatentResult,
  PatentSearchResponse,
  PatentSort,
  TrademarkResult,
  TrademarkSearchResponse,
  TrademarkStatus,
} from "@contracts/types";
import { env } from "../lib/env";

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

// ─── Small TTL cache to be polite to USPTO and fast for repeat queries ──────

const cache = new Map<string, { data: unknown; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data as T;
  if (hit) cache.delete(key);
  return null;
}

function store(key: string, data: unknown) {
  if (cache.size > 500) cache.clear();
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

// ─── Patent search (ppubs.uspto.gov) ────────────────────────────────────────

const PPUBS = "https://ppubs.uspto.gov/api";

interface PatentSession {
  token: string;
  caseId: number;
  createdAt: number;
}

let patentSession: PatentSession | null = null;

async function getPatentSession(force = false): Promise<PatentSession> {
  if (
    !force &&
    patentSession &&
    Date.now() - patentSession.createdAt < 20 * 60 * 1000
  ) {
    return patentSession;
  }
  const res = await fetch(`${PPUBS}/users/me/session`, {
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
  const res = await fetch(`${PPUBS}/${path}`, {
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
  const res = await fetch(`${ODP}/patent/applications/search`, {
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

export async function searchPatents(opts: {
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
  const hit = cached<PatentSearchResponse>(cacheKey);
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
      store(cacheKey, out);
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
  store(cacheKey, out);
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

export async function searchTrademarks(opts: {
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
  const hit = cached<TrademarkSearchResponse>(cacheKey);
  if (hit) return hit;

  const esQuery = buildTrademarkQueryString(query, status);
  const res = await fetch(TMSEARCH, {
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
  store(cacheKey, out);
  return out;
}

export async function getTrademarkTotal(
  query: string,
  status: TrademarkStatus = "all",
): Promise<number> {
  const esQuery = buildTrademarkQueryString(query.trim(), status);
  const res = await fetch(TMSEARCH, {
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
export async function getLiveTrademarkCount(name: string): Promise<number> {
  const esc = escapeQueryString(name.trim());
  if (!esc) return 0;
  const res = await fetch(TMSEARCH, {
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

  const res = await fetch(TM_IMAGE_SEARCH, { method: "POST", body: form });
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
      const enrichRes = await fetch(TMSEARCH, {
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
