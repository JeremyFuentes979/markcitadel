import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Migrations: use the Supabase *session* pooler (port 5432) or direct URL.
const connectionString =
  process.env.DATABASE_URL_MIGRATIONS ?? process.env.DATABASE_URL ?? "";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: connectionString },
});
