import { Hono } from "hono";
import { cors } from "hono/cors";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { apiKeys } from "@db/schema";
import { createApiKey } from "../services/apikeys";
import { userFromRequest } from "../context";
import {
  authorizationServerMetadata,
  decodeClient,
  issueCode,
  protectedResourceMetadata,
  redeemCode,
  redirectUriMatches,
  registerClient,
  requestOrigin,
} from "../lib/oauth";

/**
 * OAuth 2.1 for the MCP connector (see api/lib/oauth.ts).
 *
 *   GET  /.well-known/oauth-protected-resource[/api/mcp|/mcp]  RFC 9728
 *   GET  /.well-known/oauth-authorization-server               RFC 8414
 *   POST /api/oauth/register   Dynamic Client Registration (RFC 7591)
 *   GET  /api/oauth/client     validate params for the consent page
 *   POST /api/oauth/authorize  consent page → code (needs Supabase session)
 *   POST /api/oauth/token      code + PKCE verifier → pmk_ API key
 *
 * The consent page itself is the SPA route /oauth/authorize.
 */

const openCors = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "Mcp-Protocol-Version"],
  maxAge: 86400,
});

// ─── Discovery (mounted at the site root) ──────────────────────────────────

export const wellKnown = new Hono();
wellKnown.use("/.well-known/*", openCors);

const prm = (c: { req: { raw: Request; path: string } }) => {
  const suffix = c.req.path.replace(/^\/\.well-known\/oauth-protected-resource/, "");
  const resource = suffix === "/mcp" ? "/mcp" : "/api/mcp";
  return protectedResourceMetadata(requestOrigin(c.req.raw), resource);
};
wellKnown.get("/.well-known/oauth-protected-resource", (c) => c.json(prm(c)));
wellKnown.get("/.well-known/oauth-protected-resource/*", (c) => c.json(prm(c)));

const asm = (c: { req: { raw: Request } }) => authorizationServerMetadata(requestOrigin(c.req.raw));
wellKnown.get("/.well-known/oauth-authorization-server", (c) => c.json(asm(c)));
wellKnown.get("/.well-known/oauth-authorization-server/*", (c) => c.json(asm(c)));

// Not an OpenID provider: answer with a JSON 404 instead of the SPA's HTML,
// so clients that probe this path fall back cleanly.
wellKnown.all("/.well-known/*", (c) => c.json({ error: "not_found" }, 404));

// ─── OAuth endpoints (/api/oauth/*) ─────────────────────────────────────────

export const oauth = new Hono();
oauth.use("/*", openCors);

const oauthError = (error: string, description: string) => ({
  error,
  error_description: description,
});

async function readParams(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v ?? "")]));
  }
  const text = await req.text();
  return Object.fromEntries(new URLSearchParams(text));
}

oauth.post("/register", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json(oauthError("invalid_client_metadata", "JSON body required"), 400);
  const res = registerClient(body);
  if (!res.ok) return c.json(oauthError("invalid_redirect_uri", res.error), 400);
  return c.json(
    {
      client_id: res.clientId,
      client_id_issued_at: res.client.t,
      client_name: res.client.n,
      redirect_uris: res.client.r,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
});

/** Validate an authorization request; returns what the consent page shows. */
function checkAuthorizeParams(q: Record<string, string | undefined>) {
  const client = decodeClient(q.client_id);
  if (!client) return { ok: false as const, error: "Unknown client_id. Remove and re-add the connector." };
  const redirectUri = q.redirect_uri ?? "";
  if (!redirectUriMatches(client, redirectUri))
    return { ok: false as const, error: "redirect_uri does not match the registered client." };
  if ((q.response_type ?? "code") !== "code")
    return { ok: false as const, error: "Only response_type=code is supported." };
  if (!q.code_challenge || q.code_challenge_method !== "S256")
    return { ok: false as const, error: "PKCE with code_challenge_method=S256 is required." };
  return { ok: true as const, client, redirectUri };
}

oauth.get("/client", (c) => {
  const chk = checkAuthorizeParams(c.req.query());
  if (!chk.ok) return c.json({ ok: false, error: chk.error }, 400);
  return c.json({
    ok: true,
    clientName: chk.client.n,
    redirectHost: (() => {
      const u = new URL(chk.redirectUri);
      return u.host || u.protocol;
    })(),
  });
});

oauth.post("/authorize", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, string | undefined> & {
    approve?: unknown;
  };
  const chk = checkAuthorizeParams(body);
  if (!chk.ok) return c.json({ ok: false, error: chk.error }, 400);

  const target = new URL(chk.redirectUri);
  if (body.state) target.searchParams.set("state", body.state);
  target.searchParams.set("iss", requestOrigin(c.req.raw));

  if (body.approve !== true) {
    target.searchParams.set("error", "access_denied");
    return c.json({ ok: true, redirect: target.toString() });
  }

  const user = await userFromRequest(c.req.raw.headers).catch(() => undefined);
  if (!user) return c.json({ ok: false, error: "Sign in first." }, 401);

  const code = issueCode({
    u: Number(user.id),
    c: body.client_id!,
    r: chk.redirectUri,
    p: body.code_challenge!,
    s: body.resource || undefined,
  });
  target.searchParams.set("code", code);
  return c.json({ ok: true, redirect: target.toString() });
});

oauth.post("/token", async (c) => {
  const p = await readParams(c.req.raw);
  c.header("Cache-Control", "no-store");
  if (p.grant_type !== "authorization_code")
    return c.json(oauthError("unsupported_grant_type", "Only authorization_code is supported."), 400);
  const client = decodeClient(p.client_id);
  if (!client) return c.json(oauthError("invalid_client", "Unknown client_id."), 401);

  const res = redeemCode(p.code ?? "", {
    clientId: p.client_id,
    redirectUri: p.redirect_uri ?? "",
    codeVerifier: p.code_verifier ?? "",
  });
  if (!res.ok) return c.json(oauthError("invalid_grant", res.error), 400);

  // One key per (user, connector name): re-authorizing replaces the old key,
  // so reconnecting never piles up keys against the plan's key cap.
  const keyName = `AI connector: ${client.n}`.slice(0, 100);
  const db = getDb();
  await db
    .update(apiKeys)
    .set({ active: false })
    .where(and(eq(apiKeys.userId, res.userId), eq(apiKeys.name, keyName), eq(apiKeys.active, true)));
  try {
    const { rawKey } = await createApiKey(res.userId, keyName);
    // Non-expiring like any pmk_ key; revoke it on the Developers page.
    return c.json({ access_token: rawKey, token_type: "Bearer", scope: "mcp" });
  } catch (e) {
    return c.json(
      oauthError(
        "invalid_grant",
        e instanceof Error ? `${e.message} Revoke an unused key on the Developers page and try again.` : "Could not issue a key.",
      ),
      400,
    );
  }
});
