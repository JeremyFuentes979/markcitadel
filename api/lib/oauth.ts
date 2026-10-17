import { createHash, createHmac, timingSafeEqual } from "crypto";
import { env } from "./env";

/**
 * Minimal, stateless OAuth 2.1 authorization server for the MCP connector.
 *
 * Why: ChatGPT connectors and most Claude.ai custom connectors can't send a
 * static `Authorization: Bearer pmk_…` header — they only speak OAuth (or no
 * auth). This lets those clients sign the user in with their normal
 * MarkCitadel (Supabase) account and receive a regular pmk_ API key as the
 * access token, so the API-key requirement, plan limits and metering are
 * unchanged and the user can revoke it on the Developers page.
 *
 * Nothing new is stored: client ids (Dynamic Client Registration) and
 * authorization codes are HMAC-signed, short JSON blobs. Codes expire after
 * 5 minutes and are bound to the client's PKCE verifier (S256 only).
 */

const CODE_TTL_SEC = 5 * 60;
export const CLIENT_ID_PREFIX = "mcc_";

function signingKey(): Buffer {
  const explicit = process.env.OAUTH_SIGNING_SECRET ?? "";
  if (explicit) return createHash("sha256").update(explicit).digest();
  // Fallback: derive a key from a server-only secret that is already set, so
  // the feature works without a new env var. Set OAUTH_SIGNING_SECRET to
  // decouple it (rotating it invalidates registered clients + pending codes).
  const base = env.databaseUrl || env.stripeWebhookSecret;
  if (!base) {
    if (env.isProduction) throw new Error("OAuth signing secret is not configured");
    return createHash("sha256").update("markcitadel-dev-only-oauth-key").digest();
  }
  return createHash("sha256").update(`markcitadel-oauth-v1:${base}`).digest();
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function sign(kind: string, payload: object): string {
  const body = b64url(JSON.stringify(payload));
  const mac = createHmac("sha256", signingKey()).update(`${kind}.${body}`).digest();
  return `${body}.${b64url(mac)}`;
}

function verify<T>(kind: string, token: string): T | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", signingKey()).update(`${kind}.${body}`).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

// ─── Clients (RFC 7591 Dynamic Client Registration, stateless) ─────────────

export interface OAuthClient {
  /** redirect URIs */
  r: string[];
  /** client name (display only) */
  n: string;
  /** issued at (unix sec) */
  t: number;
}

/** Allowed redirect URIs: https, http loopback, or a native-app custom scheme. */
export function isAllowedRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:")
    return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  // Native apps (e.g. cursor://…). Block schemes that can run code or read files.
  const blocked = ["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "ftp:", "ws:", "wss:"];
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !blocked.includes(u.protocol);
}

export function registerClient(input: {
  redirect_uris?: unknown;
  client_name?: unknown;
}): { ok: true; clientId: string; client: OAuthClient } | { ok: false; error: string } {
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris : [];
  if (uris.length === 0 || uris.length > 10)
    return { ok: false, error: "redirect_uris must list 1-10 URIs" };
  for (const u of uris) {
    if (typeof u !== "string" || u.length > 500 || !isAllowedRedirectUri(u))
      return { ok: false, error: `redirect_uri not allowed: ${String(u).slice(0, 100)}` };
  }
  const name =
    typeof input.client_name === "string" && input.client_name.trim()
      ? input.client_name.trim().slice(0, 80)
      : "AI assistant";
  const client: OAuthClient = { r: uris as string[], n: name, t: Math.floor(Date.now() / 1000) };
  return { ok: true, clientId: CLIENT_ID_PREFIX + sign("cid", client), client };
}

export function decodeClient(clientId: string | null | undefined): OAuthClient | null {
  if (!clientId?.startsWith(CLIENT_ID_PREFIX)) return null;
  const c = verify<OAuthClient>("cid", clientId.slice(CLIENT_ID_PREFIX.length));
  return c && Array.isArray(c.r) && typeof c.n === "string" ? c : null;
}

/**
 * Exact-match redirect URI check, with the RFC 8252 §7.3 allowance that a
 * loopback redirect may use any port.
 */
export function redirectUriMatches(client: OAuthClient, uri: string): boolean {
  if (client.r.includes(uri)) return true;
  try {
    const u = new URL(uri);
    if (u.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return false;
    return client.r.some((r) => {
      const ru = new URL(r);
      return ru.protocol === u.protocol && ru.hostname === u.hostname && ru.pathname === u.pathname;
    });
  } catch {
    return false;
  }
}

// ─── Authorization codes ────────────────────────────────────────────────────

interface CodePayload {
  /** user id */
  u: number;
  /** client id */
  c: string;
  /** redirect uri */
  r: string;
  /** PKCE S256 challenge */
  p: string;
  /** resource (RFC 8707), optional */
  s?: string;
  /** expires at (unix sec) */
  e: number;
}

export function issueCode(p: Omit<CodePayload, "e">): string {
  return sign("code", { ...p, e: Math.floor(Date.now() / 1000) + CODE_TTL_SEC });
}

export function redeemCode(
  code: string,
  opts: { clientId: string; redirectUri: string; codeVerifier: string },
): { ok: true; userId: number } | { ok: false; error: string } {
  const p = verify<CodePayload>("code", code);
  if (!p) return { ok: false, error: "invalid code" };
  if (p.e < Math.floor(Date.now() / 1000)) return { ok: false, error: "code expired" };
  if (p.c !== opts.clientId) return { ok: false, error: "client_id mismatch" };
  if (p.r !== opts.redirectUri) return { ok: false, error: "redirect_uri mismatch" };
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(opts.codeVerifier))
    return { ok: false, error: "invalid code_verifier" };
  const challenge = createHash("sha256").update(opts.codeVerifier).digest("base64url");
  if (challenge !== p.p) return { ok: false, error: "PKCE verification failed" };
  return { ok: true, userId: p.u };
}

// ─── Discovery metadata ─────────────────────────────────────────────────────

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
    service_documentation: `${origin}/developers`,
  };
}

export function protectedResourceMetadata(origin: string, resourcePath: string) {
  return {
    resource: `${origin}${resourcePath}`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
    resource_name: "MarkCitadel (USPTO trademark & patent search)",
    resource_documentation: `${origin}/developers`,
  };
}

/** Public origin of the request (Netlify passes the real host in the URL). */
export function requestOrigin(req: Request): string {
  return new URL(req.url).origin;
}
