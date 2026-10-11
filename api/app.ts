import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { connector } from "./routes/connector";
import { mcp } from "./routes/mcp";
import { stripeWebhook } from "./routes/stripe";
import { reports } from "./routes/reports";
import { clientIp, recordPageview } from "./services/analytics";

/**
 * The whole API as one runtime-agnostic Hono app (Web Request → Response).
 * Mounted by:
 *  - netlify/functions/api.mts (production on Netlify)
 *  - api/boot.ts (local dev via Vite, or a long-running Node server)
 */
export const app = new Hono();

// Image search uploads are the largest bodies; Netlify caps sync payloads at 6 MB.
app.use("/api/*", bodyLimit({ maxSize: 6 * 1024 * 1024 }));

app.use("/api/trpc/*", async (c) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  }),
);
app.route("/api/v1", connector);
app.route("/api/mcp", mcp);
app.route("/api/stripe", stripeWebhook);
app.route("/api/reports", reports);

/** First-party pageview beacon (the SPA is served by the CDN, not by us). */
app.post("/api/pv", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { path?: string; ref?: string };
  const path = typeof body.path === "string" ? body.path.slice(0, 255) : "/";
  await recordPageview({
    path: path || "/",
    ip: clientIp(c),
    ua: c.req.header("user-agent") ?? "",
    referrer: typeof body.ref === "string" ? body.ref : undefined,
  });
  return c.body(null, 204);
});

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;
