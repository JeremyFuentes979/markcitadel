import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;

/**
 * Supabase Postgres via the connection pooler (Supavisor).
 * prepare:false is required for the transaction pooler (port 6543).
 * max:1 keeps each serverless invocation to a single connection.
 */
export function getDb() {
  if (!instance) {
    const client = postgres(env.databaseUrl, {
      prepare: false,
      max: env.isServerless ? 1 : 10,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: env.databaseUrl.includes("localhost") ? false : "require",
    });
    instance = drizzle(client, { schema: fullSchema });
  }
  return instance;
}
