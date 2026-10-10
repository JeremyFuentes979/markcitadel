import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  int,
  boolean,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Note: FK columns referencing a serial() PK must use:
//   bigint("columnName", { mode: "number", unsigned: true }).notNull()

// ─── MarkCitadel tables ──────────────────────────────────────────────────────

/** A search the user saved for one-click re-running. */
export const savedSearches = mysqlTable("saved_searches", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  label: varchar("label", { length: 255 }).notNull(),
  type: mysqlEnum("type", ["patents", "trademarks"]).notNull(),
  query: varchar("query", { length: 500 }).notNull(),
  // trademark status filter or patent sort, depending on type
  option: varchar("option", { length: 20 }).default("all").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** A watched search — we track the result count and alert on changes. */
export const watches = mysqlTable("watches", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  label: varchar("label", { length: 255 }).notNull(),
  type: mysqlEnum("type", ["patents", "trademarks"]).notNull(),
  query: varchar("query", { length: 500 }).notNull(),
  option: varchar("option", { length: 20 }).default("all").notNull(),
  active: boolean("active").default(true).notNull(),
  lastTotal: int("last_total"),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Alert events generated when a watched search's result count changes. */
export const alertEvents = mysqlTable("alert_events", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  watchId: bigint("watch_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => watches.id),
  message: text("message").notNull(),
  previousTotal: int("previous_total").notNull(),
  newTotal: int("new_total").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SavedSearch = typeof savedSearches.$inferSelect;
export type Watch = typeof watches.$inferSelect;
export type AlertEvent = typeof alertEvents.$inferSelect;

// ─── API keys & metering ────────────────────────────────────────────────────

/** API keys for the public connector endpoints. Raw keys are never stored. */
export const apiKeys = mysqlTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  name: varchar("name", { length: 100 }).notNull(),
  prefix: varchar("prefix", { length: 12 }).notNull(), // "pmk_" + first chars, for display
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(), // sha256 hex
  plan: mysqlEnum("plan", ["free", "pro"]).default("free").notNull(),
  active: boolean("active").default(true).notNull(),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Monthly usage rollup per API key. */
export const apiUsage = mysqlTable(
  "api_usage",
  {
    id: serial("id").primaryKey(),
    apiKeyId: bigint("api_key_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => apiKeys.id),
    month: varchar("month", { length: 7 }).notNull(), // "2026-08"
    requests: int("requests").default(0).notNull(),
  },
  (t) => [uniqueIndex("api_usage_key_month").on(t.apiKeyId, t.month)],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type ApiUsage = typeof apiUsage.$inferSelect;

// ─── Billing ────────────────────────────────────────────────────────────────

/**
 * One-time tokens minted when a user clicks "Upgrade". The user pastes the
 * token into Stripe Checkout's client_reference_id field; after payment they
 * enter the same token on the site to activate Pro on their account.
 * (On self-hosted infra with Stripe webhooks this flow upgrades to fully
 * automatic activation.)
 */
export const upgradeTokens = mysqlTable("upgrade_tokens", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(), // sha256 hex
  plan: mysqlEnum("plan", ["pro"]).default("pro").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type UpgradeToken = typeof upgradeTokens.$inferSelect;

// ─── Site analytics ─────────────────────────────────────────────────────────

/**
 * Lightweight first-party pageview tracking. Privacy-friendly by design:
 * no cookies, no cross-site tracking, and the IP is stored only as a
 * truncated sha256 hash (enough to count unique visitors, not to identify).
 */
export const pageviews = mysqlTable("pageviews", {
  id: serial("id").primaryKey(),
  day: varchar("day", { length: 10 }).notNull(), // "2026-09-08" (UTC)
  path: varchar("path", { length: 255 }).notNull(),
  visitorHash: varchar("visitor_hash", { length: 24 }).notNull(),
  referrer: varchar("referrer", { length: 255 }),
  isBot: boolean("is_bot").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Pageview = typeof pageviews.$inferSelect;
