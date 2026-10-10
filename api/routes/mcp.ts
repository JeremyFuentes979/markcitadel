import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  searchPatents,
  searchTrademarks,
  searchTrademarksByImage,
} from "../services/uspto";
import { authenticateApiKey } from "../services/apikeys";
import { checkTrademarkConflicts, conflictSummaryText } from "../services/conflicts";
import type {
  PatentSort,
  TrademarkResult,
  TrademarkStatus,
} from "@contracts/types";

/**
 * Model Context Protocol (MCP) server — stateless Streamable HTTP transport.
 *
 * This single endpoint is what turns MarkCitadel into a native connector for
 * AI assistants:
 *   - Anthropic Claude: Customize → Connectors → Add custom connector → paste
 *     https://<your-domain>/api/mcp
 *   - OpenAI ChatGPT deep research / Responses API: MCP servers with `search`
 *     and `fetch` tools (both implemented here)
 *   - Any other MCP-capable agent framework
 *
 * No authentication: the server only exposes public USPTO data.
 */

export const mcp = new Hono();

mcp.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST"],
    allowHeaders: ["Content-Type", "Mcp-Session-Id", "Authorization"],
  }),
);

const PROTOCOL_VERSION = "2025-06-18";

const TOOLS = [
  {
    name: "check_trademark",
    description:
      "Answer 'is this business/brand name taken?' with a verdict (HIGH RISK / POSSIBLE CONFLICT / LOOKS CLEAR), " +
      "counts (total, live, live in the user's classes), the top flagged live USPTO marks with reasons " +
      "(exact, sound-alike, contains, similar spelling; class overlap; strong owners), and the top owners of the word. " +
      "Prefer this over search_trademarks when the user wants to know if they can use a name. Not legal advice.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Business or brand name to check" },
        classes: {
          type: "array",
          items: { type: "integer", minimum: 1, maximum: 45 },
          description:
            "Nice classes for the user's goods/services, e.g. [35, 37] for home services; default [9, 35, 42, 45] (software/online)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "search_patents",
    description:
      "Search U.S. patents and published patent applications (live USPTO data). " +
      "Use for prior-art checks, novelty questions, or finding patents by topic, " +
      "applicant, or inventor. Supports field codes: .ti. title, .ab. abstract, " +
      ".as. applicant/assignee, .in. inventor — e.g. 'autonomous.ti. AND tesla.as.'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text or USPTO fielded query" },
        sort: {
          type: "string",
          enum: ["relevance", "newest", "oldest"],
          default: "relevance",
        },
        per_page: { type: "integer", default: 10, maximum: 25 },
      },
      required: ["query"],
    },
  },
  {
    name: "search_trademarks",
    description:
      "Search U.S. federal trademark applications and registrations (live USPTO data). " +
      "Use to check whether a brand, business, or product name is already taken, " +
      "find who owns a mark, or look up a serial/registration number.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Brand name, owner name, or 6-8 digit serial/registration number. " +
            "Fielded syntax: wordmark:, ownerName:, attorney:.",
        },
        status: {
          type: "string",
          enum: ["all", "live", "dead"],
          default: "all",
          description: "Use 'live' to see only marks still in force.",
        },
        per_page: { type: "integer", default: 10, maximum: 25 },
      },
      required: ["query"],
    },
  },
  // ── ChatGPT deep-research compatible tools ──────────────────────────────
  {
    name: "search",
    description:
      "Search U.S. patents and trademarks together. Returns a JSON object with a " +
      "results array; each result has id, title, and url. Pass an id to the fetch " +
      "tool to get the full record.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch",
    description:
      "Fetch the full record for an id returned by the search tool " +
      "(ids look like 'tm:78155656' or 'pat:US-20260255336-A1'). Returns a JSON " +
      "object with id, title, text, url, and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Result id from the search tool" },
      },
      required: ["id"],
    },
  },
];

// ─── Tool implementations ───────────────────────────────────────────────────

function textResult(text: string) {
  return { content: [{ type: "text", text }] };
}

function fmtTm(t: TrademarkResult) {
  return [
    `**${t.wordmark}** — ${t.alive ? "🟢 Live" : "⚪ Dead"}${t.status ? ` (${t.status})` : ""}`,
    `Owner: ${t.owner ?? "unknown"} | Serial: ${t.serialNumber}${t.registrationNumber ? ` | Reg: ${t.registrationNumber}` : ""}${t.filingDate ? ` | Filed: ${t.filingDate}` : ""}`,
    t.goodsAndServices[0] ? `Goods/Services: ${t.goodsAndServices[0].slice(0, 300)}` : null,
    `Official record: ${t.url}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  if (name === "check_trademark") {
    const q = String(args.name ?? args.query ?? "").trim();
    if (q.length < 2) return { isError: true, ...textResult("name is required") };
    const classes = Array.isArray(args.classes)
      ? args.classes.map(Number).filter((n) => n >= 1 && n <= 45)
      : undefined;
    const summary = await checkTrademarkConflicts(q, classes);
    return textResult(conflictSummaryText(summary));
  }

  if (name === "search_patents") {
    const query = String(args.query ?? "").trim();
    if (!query) return { isError: true, ...textResult("query is required") };
    const data = await searchPatents({
      query,
      page: 1,
      perPage: Math.min(25, Number(args.per_page) || 10),
      sort: (args.sort as PatentSort) || "relevance",
    });
    const lines = data.results.map(
      (p) =>
        `**${p.title}**\n${p.documentId} — ${p.kind === "grant" ? "Granted patent" : "Application"} | ` +
        `${p.applicants.join(", ") || p.inventors || "unknown applicant"}${p.datePublished ? ` | Published: ${p.datePublished}` : ""}\n${p.url}`,
    );
    return textResult(
      `Found ${data.total.toLocaleString()} U.S. patent documents matching "${query}" (USPTO live data). Top ${data.results.length}:\n\n${lines.join("\n\n")}`,
    );
  }

  if (name === "search_trademarks") {
    const query = String(args.query ?? "").trim();
    if (!query) return { isError: true, ...textResult("query is required") };
    const data = await searchTrademarks({
      query,
      status: (args.status as TrademarkStatus) || "all",
      page: 1,
      perPage: Math.min(25, Number(args.per_page) || 10),
    });
    return textResult(
      `Found ${data.total.toLocaleString()} U.S. trademarks matching "${query}" (USPTO live data). Top ${data.results.length}:\n\n${data.results.map(fmtTm).join("\n\n")}`,
    );
  }

  if (name === "search") {
    const query = String(args.query ?? "").trim();
    if (!query) return { isError: true, ...textResult("query is required") };
    const [tms, pats] = await Promise.allSettled([
      searchTrademarks({ query, status: "all", page: 1, perPage: 8 }),
      searchPatents({ query, page: 1, perPage: 8, sort: "relevance" }),
    ]);
    const results = [
      ...(tms.status === "fulfilled"
        ? tms.value.results.map((t) => ({
            id: `tm:${t.serialNumber}`,
            title: `${t.wordmark} (trademark — ${t.alive ? "live" : "dead"}${t.owner ? `, ${t.owner}` : ""})`,
            url: t.url,
          }))
        : []),
      ...(pats.status === "fulfilled"
        ? pats.value.results.map((p) => ({
            id: `pat:${p.id}`,
            title: `${p.title} (${p.documentId})`,
            url: p.url,
          }))
        : []),
    ];
    return textResult(JSON.stringify({ results }));
  }

  if (name === "fetch") {
    const id = String(args.id ?? "");
    if (id.startsWith("tm:")) {
      const serial = id.slice(3);
      const data = await searchTrademarks({
        query: serial,
        status: "all",
        page: 1,
        perPage: 1,
      });
      const t = data.results.find((r) => r.serialNumber === serial);
      if (!t) return { isError: true, ...textResult(`Trademark ${serial} not found`) };
      return textResult(
        JSON.stringify({
          id,
          title: t.wordmark,
          url: t.url,
          text: fmtTm(t) + "\n" + t.goodsAndServices.join("\n"),
          metadata: {
            serialNumber: t.serialNumber,
            registrationNumber: t.registrationNumber,
            alive: t.alive,
            status: t.status,
            owner: t.owner,
            filingDate: t.filingDate,
            registrationDate: t.registrationDate,
            classes: t.internationalClasses,
          },
        }),
      );
    }
    if (id.startsWith("pat:")) {
      const guid = id.slice(4);
      const pn = guid.split("-")[1] ?? guid;
      const data = await searchPatents({
        query: `${pn}.pn.`,
        page: 1,
        perPage: 5,
        sort: "relevance",
      });
      const p = data.results.find((r) => r.id === guid) ?? data.results[0];
      if (!p) return { isError: true, ...textResult(`Patent ${guid} not found`) };
      return textResult(
        JSON.stringify({
          id: `pat:${p.id}`,
          title: p.title,
          url: p.url,
          text:
            `${p.title}\n${p.documentId} (${p.kind})\n` +
            `Applicants: ${p.applicants.join("; ")}\nInventors: ${p.inventors ?? "n/a"}\n` +
            `Published: ${p.datePublished ?? "n/a"} | Filed: ${p.filingDate ?? "n/a"}\n` +
            `IPC: ${p.ipc ?? "n/a"} | CPC: ${p.cpc ?? "n/a"}`,
          metadata: {
            documentId: p.documentId,
            kind: p.kind,
            applicants: p.applicants,
            inventors: p.inventors,
            datePublished: p.datePublished,
            filingDate: p.filingDate,
          },
        }),
      );
    }
    return { isError: true, ...textResult(`Unrecognized id "${id}"`) };
  }

  return { isError: true, ...textResult(`Unknown tool "${name}"`) };
}

// ─── JSON-RPC plumbing ──────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleMessage(msg: JsonRpcRequest) {
  const id = msg.id ?? null;
  switch (msg.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "markcitadel", version: "1.0.0" },
          instructions:
            "Search live USPTO data. Use search_trademarks to check if a brand or " +
            "business name is taken, search_patents for prior art and patent lookups. " +
            "search + fetch provide a unified interface across both.",
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call": {
      const params = msg.params ?? {};
      const toolName = String(params.name ?? "");
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await callTool(toolName, toolArgs);
        return { jsonrpc: "2.0", id, result };
      } catch (e) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: `Tool failed: ${e instanceof Error ? e.message : "unknown error"}`,
              },
            ],
          },
        };
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

mcp.get("/", (c) =>
  c.json(
    {
      name: "markcitadel",
      protocol: "mcp",
      transport: "streamable-http (stateless)",
      usage: "POST JSON-RPC 2.0 messages here",
    },
    200,
  ),
);

mcp.post("/", async (c) => {
  let body: JsonRpcRequest | JsonRpcRequest[];
  try {
    body = await c.req.json();
  } catch {
    return c.json(rpcError(null, -32700, "Parse error"), 400);
  }

  // Notifications only (no ids) → acknowledge with 202
  const messages = Array.isArray(body) ? body : [body];
  const isAllNotifications = messages.every((m) => m.id === undefined);
  if (isAllNotifications) {
    return c.body(null, 202);
  }

  // Data-bearing tool calls require an API key; handshake/discovery stay open
  const needsKey = messages.some((m) => m.method === "tools/call");
  if (needsKey) {
    const auth = await authenticateApiKey(
      c.req.header("authorization") ?? null,
    );
    if (!auth.ok) {
      return c.json(
        {
          jsonrpc: "2.0",
          id: messages[0]?.id ?? null,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: `API key required: ${auth.message}`,
              },
            ],
          },
        },
        auth.status as 401 | 429,
      );
    }
  }

  if (Array.isArray(body)) {
    const responses = await Promise.all(body.map(handleMessage));
    return c.json(responses);
  }
  const response = await handleMessage(body);
  return c.json(response);
});
