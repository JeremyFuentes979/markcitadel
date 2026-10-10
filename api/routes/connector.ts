import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";
import {
  patentDataSource,
  searchPatents,
  searchTrademarks,
  searchTrademarksByImage,
} from "../services/uspto";
import { buildNameCheckReport } from "../services/report";
import { checkTrademarkConflicts } from "../services/conflicts";
import { authenticateApiKey } from "../services/apikeys";
import type { PatentSort, TrademarkStatus } from "@contracts/types";

/**
 * Public connector API — the whole point of this product.
 * Any website, startup tool, LLC formation flow, or AI agent can call these
 * JSON endpoints directly (CORS is open) or ingest /api/v1/openapi.json.
 *
 * Data endpoints require a free API key (Authorization: Bearer pmk_...).
 * /health and /openapi.json stay keyless.
 */

export const connector = new Hono();

connector.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

/** Require a valid API key; on success sets rate-limit headers. */
async function requireKey(c: Context): Promise<Response | null> {
  const auth = await authenticateApiKey(c.req.header("authorization") ?? null);
  if (!auth.ok) {
    return c.json({ error: auth.error, message: auth.message }, auth.status as 401 | 429);
  }
  c.header("X-RateLimit-Limit", String(auth.rateLimit));
  c.header("X-RateLimit-Remaining", String(auth.rateRemaining));
  c.header("X-RateLimit-Reset", String(auth.rateResetInSec));
  c.header("X-Quota-Used", String(auth.monthlyUsed));
  c.header("X-Quota-Limit", String(auth.monthlyLimit));
  c.header("X-Plan", auth.plan);
  return null;
}

/**
 * Key requirement, except for the site's own frontend — its requests carry
 * the session cookie (credentials: include), which external API callers never
 * have. External tools (curl, AI agents, other sites) always need a key.
 */
async function requireKeyUnlessInternal(c: Context): Promise<Response | null> {
  // Same-origin browser requests from our own SPA (Sec-Fetch-Site is set by
  // the browser and can't be forged by page scripts).
  const secFetchSite = c.req.header("sec-fetch-site") ?? "";
  if (secFetchSite === "same-origin") return null;
  return requireKey(c);
}

function clampInt(v: string | undefined, def: number, min: number, max: number) {
  const n = parseInt(v ?? "", 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

connector.get("/health", (c) =>
  c.json({
    ok: true,
    service: "markcitadel",
    dataSources: {
      patents: patentDataSource(),
      trademarks: "uspto-trademark-search",
      trademarkImages: "uspto-trademark-image-search",
    },
    terms: "/terms",
    ts: Date.now(),
  }),
);

connector.get("/patents/search", async (c) => {
  const denied = await requireKey(c);
  if (denied) return denied;
  const q = (c.req.query("q") ?? "").trim();
  if (!q) {
    return c.json(
      {
        error: "MISSING_QUERY",
        message: "Provide a search term with the q parameter.",
      },
      400,
    );
  }
  const sort = (c.req.query("sort") ?? "newest") as PatentSort;
  if (!["relevance", "newest", "oldest"].includes(sort)) {
    return c.json(
      { error: "BAD_PARAM", message: "sort must be relevance|newest|oldest" },
      400,
    );
  }
  try {
    const data = await searchPatents({
      query: q,
      page: clampInt(c.req.query("page"), 1, 1, 40),
      perPage: clampInt(c.req.query("per_page"), 25, 1, 50),
      sort,
    });
    return c.json(data);
  } catch (e) {
    return c.json(
      {
        error: "UPSTREAM_ERROR",
        message: e instanceof Error ? e.message : "USPTO search failed",
      },
      502,
    );
  }
});

/**
 * Conflict summary: verdict (high / possible / clear), counts, top flagged
 * live marks with reasons, and top owners, for a name + optional classes.
 */
connector.get("/trademarks/check", async (c) => {
  const denied = await requireKeyUnlessInternal(c);
  if (denied) return denied;
  const q = (c.req.query("q") ?? c.req.query("name") ?? "").trim();
  if (q.length < 2 || q.length > 100) {
    return c.json({ error: "BAD_PARAM", message: "Provide q (2-100 characters)." }, 400);
  }
  const classes = (c.req.query("classes") ?? "")
    .split(",")
    .map((x) => parseInt(x, 10))
    .filter((n) => n >= 1 && n <= 45)
    .slice(0, 12);
  try {
    return c.json(await checkTrademarkConflicts(q, classes.length ? classes : undefined));
  } catch (e) {
    return c.json(
      { error: "UPSTREAM_ERROR", message: e instanceof Error ? e.message : "Check failed" },
      502,
    );
  }
});

connector.get("/trademarks/search", async (c) => {
  const denied = await requireKey(c);
  if (denied) return denied;
  const q = (c.req.query("q") ?? "").trim();
  if (!q) {
    return c.json(
      {
        error: "MISSING_QUERY",
        message: "Provide a search term with the q parameter.",
      },
      400,
    );
  }
  const status = (c.req.query("status") ?? "all") as TrademarkStatus;
  if (!["all", "live", "dead"].includes(status)) {
    return c.json(
      { error: "BAD_PARAM", message: "status must be all|live|dead" },
      400,
    );
  }
  try {
    const data = await searchTrademarks({
      query: q,
      status,
      page: clampInt(c.req.query("page"), 1, 1, 400),
      perPage: clampInt(c.req.query("per_page"), 25, 1, 50),
    });
    return c.json(data);
  } catch (e) {
    return c.json(
      {
        error: "UPSTREAM_ERROR",
        message: e instanceof Error ? e.message : "USPTO search failed",
      },
      502,
    );
  }
});

/**
 * Name Clearance Report — PDF download for API-key holders (metered against
 * their plan). Website visitors buy the report via Stripe Checkout and
 * download it from /api/reports/:sessionId.pdf instead.
 */
connector.get("/namecheck/report", async (c) => {
  const denied = await requireKey(c);
  if (denied) return denied;
  const name = (c.req.query("name") ?? "").trim();
  if (name.length < 2 || name.length > 60) {
    return c.json(
      {
        error: "BAD_PARAM",
        message: "Provide a name between 2 and 60 characters.",
      },
      400,
    );
  }
  try {
    const pdf = await buildNameCheckReport(name);
    const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    c.header("Content-Type", "application/pdf");
    c.header(
      "Content-Disposition",
      `attachment; filename="markcitadel-namecheck-${safe}.pdf"`,
    );
    return c.body(new Uint8Array(pdf));
  } catch (e) {
    return c.json(
      {
        error: "UPSTREAM_ERROR",
        message: e instanceof Error ? e.message : "Report generation failed",
      },
      502,
    );
  }
});

connector.post("/trademarks/image-search", async (c) => {
  const denied = await requireKeyUnlessInternal(c);
  if (denied) return denied;
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json(
      {
        error: "BAD_REQUEST",
        message:
          "Send multipart/form-data with an image (file), image_url, or text.",
      },
      400,
    );
  }
  const file = form.get("file");
  const imageUrl = (form.get("image_url") as string | null) ?? null;
  const text = (form.get("text") as string | null)?.trim() || undefined;
  const hasFile = file instanceof File && file.size > 0;
  if (!hasFile && !imageUrl && !text) {
    return c.json(
      {
        error: "MISSING_QUERY",
        message: "Attach an image (file), an image_url, or a text value.",
      },
      400,
    );
  }
  if (hasFile && file.size > 5 * 1024 * 1024) {
    return c.json(
      { error: "FILE_TOO_LARGE", message: "Images must be under 5 MB." },
      400,
    );
  }
  const status = ((form.get("status") as string | null) ?? "all") as
    | "all"
    | "live"
    | "dead";
  if (!["all", "live", "dead"].includes(status)) {
    return c.json(
      { error: "BAD_PARAM", message: "status must be all|live|dead" },
      400,
    );
  }
  const classes = String(form.get("classes") ?? "")
    .split(",")
    .map((s) => parseInt(s, 10))
    .filter((n) => !Number.isNaN(n) && n >= 1 && n <= 45);
  const perPage = clampInt(form.get("per_page") as string, 24, 1, 48);
  const page = clampInt(form.get("page") as string, 1, 1, 100);
  try {
    const data = await searchTrademarksByImage({
      image: hasFile ? file : undefined,
      imageUrl: imageUrl ?? undefined,
      text,
      status,
      classes: classes.length ? classes : undefined,
      page,
      perPage,
    });
    return c.json({
      type: "trademark-image-search",
      query: text ?? null,
      page,
      perPage,
      ...data,
      source: "USPTO Trademark Image Search",
    });
  } catch (e) {
    return c.json(
      {
        error: "UPSTREAM_ERROR",
        message: e instanceof Error ? e.message : "USPTO image search failed",
      },
      502,
    );
  }
});

connector.get("/openapi.json", (c) => {
  const spec = {
    openapi: "3.0.3",
    servers: [{ url: new URL(c.req.url).origin }],
    info: {
      title: "MarkCitadel API",
      version: "1.0.0",
      description:
        "JSON API for searching U.S. patents and trademarks. " +
        "Designed to be consumed by AI agents, startup/LLC formation tools, and any website. " +
        "Data source: United States Patent and Trademark Office (USPTO) — patents via the official " +
        "USPTO Open Data Portal API when configured, otherwise USPTO Patent Public Search; trademarks " +
        "via USPTO Trademark Search. This service is not affiliated with or endorsed by the USPTO. " +
        "Use of this API is subject to the Terms of Service (/terms). " +
        "Authentication: API key (Authorization: Bearer pmk_...) — create a free key on the Developers page. " +
        "Plans: Free (30 requests/minute, 1,000/month) and Pro ($29/month: 120 requests/minute, 25,000/month) — see /pricing. " +
        "Rate info and plan are returned in X-RateLimit-*, X-Quota-* and X-Plan response headers.",
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/v1/patents/search": {
        get: {
          operationId: "searchPatents",
          summary: "Search U.S. patent applications and granted patents",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string" },
              description:
                "Search text. Supports USPTO field codes, e.g. 'drone.ti.' (title), 'tesla.as.' (applicant), '\"solar cell\".ab.' (abstract phrase).",
            },
            {
              name: "page",
              in: "query",
              schema: { type: "integer", default: 1 },
            },
            {
              name: "per_page",
              in: "query",
              schema: { type: "integer", default: 25, maximum: 50 },
            },
            {
              name: "sort",
              in: "query",
              schema: {
                type: "string",
                enum: ["relevance", "newest", "oldest"],
                default: "newest",
              },
            },
          ],
          responses: {
            "200": { description: "Normalized patent search results" },
            "400": { description: "Missing or invalid parameter" },
            "401": { description: "Missing or invalid API key" },
            "429": { description: "Rate limit or monthly quota exceeded" },
            "502": { description: "USPTO upstream error" },
          },
        },
      },
      "/api/v1/trademarks/check": {
        get: {
          operationId: "checkTrademark",
          summary:
            "Is this name taken? Verdict (high / possible / clear) with counts, the top flagged live marks and reasons, and the top owners",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" }, description: "Business or brand name" },
            {
              name: "classes",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Comma-separated Nice classes for your goods/services (default 9,35,42,45)",
            },
          ],
          responses: { "200": { description: "Conflict summary (not legal advice)" } },
        },
      },
      "/api/v1/trademarks/search": {
        get: {
          operationId: "searchTrademarks",
          summary: "Search U.S. federal trademark applications and registrations",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string" },
              description:
                "Mark text, owner name, or 6-8 digit serial/registration number. Fielded syntax supported: wordmark:, ownerName:, attorney:.",
            },
            {
              name: "status",
              in: "query",
              schema: {
                type: "string",
                enum: ["all", "live", "dead"],
                default: "all",
              },
            },
            {
              name: "page",
              in: "query",
              schema: { type: "integer", default: 1 },
            },
            {
              name: "per_page",
              in: "query",
              schema: { type: "integer", default: 25, maximum: 50 },
            },
          ],
          responses: {
            "200": { description: "Normalized trademark search results" },
            "400": { description: "Missing or invalid parameter" },
            "401": { description: "Missing or invalid API key" },
            "429": { description: "Rate limit or monthly quota exceeded" },
            "502": { description: "USPTO upstream error" },
          },
        },
      },
      "/api/v1/trademarks/image-search": {
        post: {
          operationId: "searchTrademarksByImage",
          summary:
            "Find visually similar trademarks by image, text, or both (hybrid). " +
            "Supports status and international-class filters.",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    file: {
                      type: "string",
                      format: "binary",
                      description: "Logo or design image (max 5 MB)",
                    },
                    image_url: {
                      type: "string",
                      description: "Public URL of an image (alternative to file)",
                    },
                    text: {
                      type: "string",
                      description:
                        "Optional keyword to combine with the image (hybrid search)",
                    },
                    status: {
                      type: "string",
                      enum: ["all", "live", "dead"],
                      default: "all",
                    },
                    classes: {
                      type: "string",
                      description:
                        "Comma-separated Nice classes, e.g. '9,25,35'",
                    },
                    page: { type: "integer", default: 1 },
                    per_page: {
                      type: "integer",
                      default: 24,
                      maximum: 48,
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Visually similar marks enriched with full USPTO records: images, live/dead status, owner, filing dates, classes — plus total, liveCount and deadCount",
            },
            "400": { description: "Missing or invalid input" },
            "502": { description: "USPTO upstream error" },
          },
        },
      },
      "/api/v1/health": {
        get: {
          operationId: "healthCheck",
          summary: "Service health check",
          responses: { "200": { description: "Service is up" } },
        },
      },
      "/api/v1/namecheck/report": {
        get: {
          operationId: "getNameCheckReport",
          summary:
            "Download a Name Clearance Report (PDF) for a brand name: live USPTO trademark conflicts, exact-match domain availability, phonetic sound-alikes, and a guided manual-check checklist.",
          parameters: [
            {
              name: "name",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "The brand/business name to check (2-60 chars).",
            },
          ],
          responses: {
            "200": {
              description: "PDF report",
              content: { "application/pdf": {} },
            },
            "400": { description: "Missing or invalid name" },
            "401": { description: "Missing or invalid API key" },
          },
        },
      },
    },
  };
  return c.json(spec);
});
