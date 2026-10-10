import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { connector } from "./routes/connector";
import { mcp } from "./routes/mcp";
import { env } from "./lib/env";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.get(Paths.oauthCallback, createOAuthCallbackHandler());
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.route("/api/v1", connector);
app.route("/api/mcp", mcp);
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

/**
 * First-party pageview analytics. Registered after /api/* so API traffic is
 * never recorded; the notFound handler returns for any request that produced
 * a response, so only real SPA page loads (fall through to serveStatic and
 * index.html) are counted. Recording is fire-and-forget.
 */
if (env.isProduction) {
  app.use("*", async (c, next) => {
    await next();
    const accept = c.req.header("accept") ?? "";
    if (c.req.method === "GET" && accept.includes("text/html")) {
      const { recordPageview, clientIp } = await import(
        "./services/analytics"
      );
      const url = new URL(c.req.url);
      void recordPageview({
        path: url.pathname === "" ? "/" : url.pathname,
        ip: clientIp(c),
        ua: c.req.header("user-agent") ?? "",
        referrer: c.req.header("referer"),
      });
    }
  });
}

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
