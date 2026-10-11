import { app } from "./app";
import { env } from "./lib/env";

/**
 * Local entry point.
 * - `npm run dev`: Vite's @hono/vite-dev-server imports this default export.
 * - `npm start`: optional long-running Node server (serves dist/public too).
 * Production on Netlify uses netlify/functions/api.mts instead.
 */
export default app;

if (env.isProduction && !env.isServerless && process.env.START_NODE_SERVER !== "0") {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);
  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
