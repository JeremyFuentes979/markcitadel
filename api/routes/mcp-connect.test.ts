import { createHash, randomBytes } from "crypto";
import { describe, expect, it } from "vitest";
import { app } from "../app";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();
import {
  decodeClient,
  isAllowedRedirectUri,
  issueCode,
  redeemCode,
  redirectUriMatches,
  registerClient,
} from "../lib/oauth";

const ORIGIN = "https://markcitadel.com";
const rpc = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });

describe("MCP transport", () => {
  for (const path of ["/api/mcp", "/mcp"]) {
    it(`initialize negotiates the protocol version at ${path}`, async () => {
      const r = await rpc(path, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      });
      expect(r.status).toBe(200);
      const j = await json(r);
      expect(j.result.protocolVersion).toBe("2025-03-26");
      expect(j.result.serverInfo.name).toBe("markcitadel");
    });
  }

  it("falls back to its own version for unknown client versions", async () => {
    const r = await rpc("/api/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect((await json(r)).result.protocolVersion).toBe("2025-06-18");
  });

  it("lists read-only tools including search and fetch", async () => {
    const r = await rpc("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = (await json(r)).result.tools;
    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["check_trademark", "search", "fetch"]));
    for (const t of tools) expect(t.annotations.readOnlyHint).toBe(true);
  });

  it("acknowledges notifications with 202", async () => {
    const r = await rpc("/api/mcp", { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(r.status).toBe(202);
  });

  it("answers an SSE GET with 405 and a browser GET with JSON", async () => {
    const sse = await app.request(`${ORIGIN}/api/mcp`, { headers: { Accept: "text/event-stream" } });
    expect(sse.status).toBe(405);
    const html = await app.request(`${ORIGIN}/api/mcp`);
    expect(html.status).toBe(200);
  });

  it("tools/call without a key → 401 with OAuth discovery hint", async () => {
    const r = await rpc("/mcp", {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "search", arguments: { query: "citadel" } },
    });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it("CORS preflight allows the MCP headers", async () => {
    const r = await app.request(`${ORIGIN}/api/mcp`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://claude.ai",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization,mcp-protocol-version",
      },
    });
    expect(r.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("mcp-protocol-version");
  });
});

describe("OAuth discovery", () => {
  it("serves protected-resource metadata for both MCP paths", async () => {
    for (const [p, res] of [
      ["/.well-known/oauth-protected-resource", "/api/mcp"],
      ["/.well-known/oauth-protected-resource/api/mcp", "/api/mcp"],
      ["/.well-known/oauth-protected-resource/mcp", "/mcp"],
    ]) {
      const j = await json(await app.request(`${ORIGIN}${p}`));
      expect(j.resource).toBe(`${ORIGIN}${res}`);
      expect(j.authorization_servers).toEqual([ORIGIN]);
    }
  });

  it("serves authorization-server metadata with PKCE + DCR", async () => {
    const j = await json(await app.request(`${ORIGIN}/.well-known/oauth-authorization-server`));
    expect(j.issuer).toBe(ORIGIN);
    expect(j.code_challenge_methods_supported).toEqual(["S256"]);
    expect(j.registration_endpoint).toBe(`${ORIGIN}/api/oauth/register`);
    expect(j.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`);
  });

  it("answers openid-configuration with JSON 404, not HTML", async () => {
    const r = await app.request(`${ORIGIN}/.well-known/openid-configuration`);
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toContain("application/json");
  });

  it("does not add CORS to non-connector routes", async () => {
    const r = await app.request(`${ORIGIN}/api/nope`, { headers: { Origin: "https://evil.example" } });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("OAuth flow pieces", () => {
  it("registers clients and validates redirect URIs", async () => {
    const r = await app.request(`${ORIGIN}/api/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }),
    });
    expect(r.status).toBe(201);
    const j = await json(r);
    expect(decodeClient(j.client_id)?.n).toBe("Claude");
    expect(decodeClient(j.client_id + "x")).toBeNull();

    const bad = await app.request(`${ORIGIN}/api/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["javascript:alert(1)"] }),
    });
    expect(bad.status).toBe(400);
  });

  it("accepts https, loopback and native schemes only", () => {
    expect(isAllowedRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:33418/callback")).toBe(true);
    expect(isAllowedRedirectUri("cursor://anysphere.cursor-retrieval/oauth/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://evil.example/cb")).toBe(false);
    expect(isAllowedRedirectUri("data:text/html,hi")).toBe(false);
  });

  it("allows any loopback port but exact match otherwise", () => {
    const reg = registerClient({ redirect_uris: ["http://localhost:1234/cb", "https://a.example/cb"] });
    if (!reg.ok) throw new Error(reg.error);
    expect(redirectUriMatches(reg.client, "http://localhost:9999/cb")).toBe(true);
    expect(redirectUriMatches(reg.client, "https://a.example/cb2")).toBe(false);
  });

  it("redeems a code only with the right verifier, client and redirect", () => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const reg = registerClient({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
    if (!reg.ok) throw new Error(reg.error);
    const code = issueCode({ u: 7, c: reg.clientId, r: "https://claude.ai/api/mcp/auth_callback", p: challenge });
    const ok = { clientId: reg.clientId, redirectUri: "https://claude.ai/api/mcp/auth_callback", codeVerifier: verifier };
    expect(redeemCode(code, ok)).toEqual({ ok: true, userId: 7 });
    expect(redeemCode(code, { ...ok, codeVerifier: randomBytes(32).toString("base64url") }).ok).toBe(false);
    expect(redeemCode(code, { ...ok, redirectUri: "https://evil.example/cb" }).ok).toBe(false);
    expect(redeemCode(code, { ...ok, clientId: "mcc_other" }).ok).toBe(false);
    expect(redeemCode(code.replace(/.$/, "A"), ok).ok).toBe(false);
  });

  it("consent API rejects unknown clients and missing PKCE", async () => {
    const r = await app.request(`${ORIGIN}/api/oauth/client?client_id=mcc_bogus&redirect_uri=https://x.example`);
    expect(r.status).toBe(400);
    const reg = registerClient({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
    if (!reg.ok) throw new Error(reg.error);
    const q = new URLSearchParams({ client_id: reg.clientId, redirect_uri: "https://claude.ai/api/mcp/auth_callback", response_type: "code" });
    expect((await app.request(`${ORIGIN}/api/oauth/client?${q}`)).status).toBe(400);
    q.set("code_challenge", "abc");
    q.set("code_challenge_method", "S256");
    const good = await app.request(`${ORIGIN}/api/oauth/client?${q}`);
    expect(await json(good)).toMatchObject({ ok: true, clientName: "AI assistant", redirectHost: "claude.ai" });
  });

  it("token endpoint rejects bad grants without touching the DB", async () => {
    const r = await app.request(`${ORIGIN}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe("unsupported_grant_type");
  });
});
