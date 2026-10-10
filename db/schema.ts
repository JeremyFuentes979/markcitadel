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
  // ── Billing (set only by the verified Stripe webhook) ──
  plan: mysqlEnum("plan", ["free", "pro"]).default("free").notNull(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 64 }).unique(),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 64 }),
  /** Mirrors Stripe's subscription.status (active, trialing, past_due, canceled, unpaid, ...). */
  subscriptionStatus: varchar("subscription_status", { length: 32 }),
  currentPeriodEnd: timestamp("current_period_end"),
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

/** Processed Stripe webhook events (idempotency: Stripe may redeliver). */
export const stripeEvents = mysqlTable("stripe_events", {
  id: varchar("id", { length: 255 }).primaryKey(), // evt_...
  type: varchar("type", { length: 100 }).notNull(),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

/**
 * One-time Name Clearance Report purchases ($29). A row is created when the
 * Checkout Session is created (status "pending") and flipped to "paid" only
 * by the signature-verified webhook (or a server-side Stripe lookup).
 * Buyers may be signed in (userId) or guests (email from Checkout).
 */
export const reportPurchases = mysqlTable("report_purchases", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).references(
    () => users.id,
  ),
  name: varchar("name", { length: 100 }).notNull(), // the business name checked
  email: varchar("email", { length: 320 }),
  stripeSessionId: varchar("stripe_session_id", { length: 255 })
    .notNull()
    .unique(),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
  amountCents: int("amount_cents"),
  status: mysqlEnum("status", ["pending", "paid", "refunded"])
    .default("pending")
    .notNull(),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ReportPurchase = typeof reportPurchases.$inferSelect;

/** "Talk to a trademark attorney" leads, for future referral partners. */
export const attorneyLeads = mysqlTable("attorney_leads", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).references(
    () => users.id,
  ),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 40 }),
  businessName: varchar("business_name", { length: 255 }).notNull(),
  state: varchar("state", { length: 40 }),
  message: text("message"),
  consent: boolean("consent").default(false).notNull(),
  status: mysqlEnum("status", ["new", "referred", "closed"])
    .default("new")
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AttorneyLead = typeof attorneyLeads.$inferSelect;

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
