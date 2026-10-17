import type { Config, Context } from "@netlify/functions";
import { app } from "../../api/app";

/**
 * Single Netlify Function wrapping the whole Hono API.
 * Netlify Functions v2 receive a standard Web Request, so Hono's fetch
 * handler runs unchanged and the request body stream arrives untouched —
 * required for Stripe webhook signature verification.
 */
export default async (req: Request, _context: Context) => {
  // If reached through the netlify.toml rewrite (/.netlify/functions/api/*),
  // restore the public /api/* path the Hono routes expect.
  const url = new URL(req.url);
  const prefix = "/.netlify/functions/api";
  if (url.pathname.startsWith(prefix)) {
    url.pathname = "/api" + url.pathname.slice(prefix.length);
    req = new Request(url, req);
  }
  return app.fetch(req);
};

export const config: Config = {
  path: [
    "/api/*",
    // MCP connector: short alias + OAuth discovery documents (otherwise the
    // SPA fallback would answer these with index.html).
    "/mcp",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/*",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/*",
    "/.well-known/openid-configuration",
    "/.well-known/openid-configuration/*",
  ],
};
