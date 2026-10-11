import {
  pgTable,
  pgEnum,
  bigint,
  bigserial,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uuid,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * Postgres (Supabase) schema. All tables live in `public` with RLS enabled
 * and NO policies: the browser never talks to these tables directly (it
 * talks to our API), and the API connects with the database role that
 * bypasses RLS. See supabase/schema.sql.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true });
const fk = (name: string) => bigint(name, { mode: "number" });

// ─── Enums ──────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum("user_role", ["user", "admin"]);
export const planEnum = pgEnum("plan", ["free", "pro"]);
export const searchTypeEnum = pgEnum("search_type", ["patents", "trademarks"]);
export const reportStatusEnum = pgEnum("report_status", [
  "pending",
  "paid",
  "refunded",
]);
export const leadStatusEnum = pgEnum("lead_status", [
  "new",
  "referred",
  "closed",
]);

// ─── Users (mirror of Supabase auth.users, keyed by its uuid) ────────────────

export const users = pgTable("users", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  /** Supabase auth user id (auth.users.id). */
  authId: uuid("auth_id").notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: roleEnum("role").default("user").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
  updatedAt: ts("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: ts("last_sign_in_at").defaultNow().notNull(),
  // ── Billing (set only by the verified Stripe webhook) ──
  plan: planEnum("plan").default("free").notNull(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 64 }).unique(),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 64 }),
  /** Mirrors Stripe's subscription.status (active, trialing, past_due, canceled, unpaid, ...). */
  subscriptionStatus: varchar("subscription_status", { length: 32 }),
  currentPeriodEnd: ts("current_period_end"),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── MarkCitadel tables ──────────────────────────────────────────────────────

/** A search the user saved for one-click re-running. */
export const savedSearches = pgTable("saved_searches", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: fk("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 255 }).notNull(),
  type: searchTypeEnum("type").notNull(),
  query: varchar("query", { length: 500 }).notNull(),
  // trademark status filter or patent sort, depending on type
  option: varchar("option", { length: 20 }).default("all").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});

/** A watched search — we track the result count and alert on changes. */
export const watches = pgTable("watches", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: fk("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 255 }).notNull(),
  type: searchTypeEnum("type").notNull(),
  query: varchar("query", { length: 500 }).notNull(),
  option: varchar("option", { length: 20 }).default("all").notNull(),
  active: boolean("active").default(true).notNull(),
  lastTotal: integer("last_total"),
  lastCheckedAt: ts("last_checked_at"),
  createdAt: ts("created_at").defaultNow().notNull(),
});

/** Alert events generated when a watched search's result count changes. */
export const alertEvents = pgTable("alert_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: fk("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  watchId: fk("watch_id")
    .notNull()
    .references(() => watches.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  previousTotal: integer("previous_total").notNull(),
  newTotal: integer("new_total").notNull(),
  readAt: ts("read_at"),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export type SavedSearch = typeof savedSearches.$inferSelect;
export type Watch = typeof watches.$inferSelect;
export type AlertEvent = typeof alertEvents.$inferSelect;

// ─── API keys & metering ────────────────────────────────────────────────────

/** API keys for the public connector endpoints. Raw keys are never stored. */
export const apiKeys = pgTable("api_keys", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: fk("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  prefix: varchar("prefix", { length: 12 }).notNull(), // "pmk_" + first chars, for display
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(), // sha256 hex
  plan: planEnum("plan").default("free").notNull(),
  active: boolean("active").default(true).notNull(),
  lastUsedAt: ts("last_used_at"),
  createdAt: ts("created_at").defaultNow().notNull(),
});

/** Monthly usage rollup per API key. */
export const apiUsage = pgTable(
  "api_usage",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    apiKeyId: fk("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    month: varchar("month", { length: 7 }).notNull(), // "2026-08"
    requests: integer("requests").default(0).notNull(),
  },
  (t) => [uniqueIndex("api_usage_key_month").on(t.apiKeyId, t.month)],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type ApiUsage = typeof apiUsage.$inferSelect;

/**
 * Fixed-window rate-limit counters (shared across serverless invocations).
 * key = "<bucket>:<id>", windowStart = start of the window.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: varchar("key", { length: 200 }).notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").default(0).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index("rate_limits_window_idx").on(t.windowStart),
  ],
);

/** Shared response cache for USPTO lookups (fresh until expiresAt, stale until staleUntil). */
export const apiCache = pgTable(
  "api_cache",
  {
    key: varchar("key", { length: 600 }).primaryKey(),
    value: jsonb("value").notNull(),
    storedAt: ts("stored_at").defaultNow().notNull(),
    expiresAt: ts("expires_at").notNull(),
    staleUntil: ts("stale_until").notNull(),
  },
  (t) => [index("api_cache_stale_idx").on(t.staleUntil)],
);

// ─── Billing ────────────────────────────────────────────────────────────────

/** Processed Stripe webhook events (idempotency: Stripe may redeliver). */
export const stripeEvents = pgTable("stripe_events", {
  id: varchar("id", { length: 255 }).primaryKey(), // evt_...
  type: varchar("type", { length: 100 }).notNull(),
  processedAt: ts("processed_at").defaultNow().notNull(),
});

/**
 * One-time Name Clearance Report purchases ($29). Created "pending" when the
 * Checkout Session is created; flipped to "paid" only by the verified webhook
 * (or a server-side Stripe lookup).
 */
export const reportPurchases = pgTable("report_purchases", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: fk("user_id").references(() => users.id, { onDelete: "set null" }),
  name: varchar("name", { length: 100 }).notNull(),
  /** Nice classes the buyer picked, e.g. "9,35,42,45" (empty = defaults). */
  classes: varchar("classes", { length: 100 }),
  email: varchar("email", { length: 320 }),
  stripeSessionId: varchar("stripe_session_id", { length: 255 })
    .notNull()
    .unique(),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
  amountCents: integer("amount_cents"),
  status: reportStatusEnum("status").default("pending").notNull(),
  paidAt: ts("paid_at"),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export type ReportPurchase = typeof reportPurchases.$inferSelect;

/** "Talk to a trademark attorney" leads, for future referral partners. */
export const attorneyLeads = pgTable("attorney_leads", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: fk("user_id").references(() => users.id, { onDelete: "set null" }),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 40 }),
  businessName: varchar("business_name", { length: 255 }).notNull(),
  state: varchar("state", { length: 40 }),
  message: text("message"),
  consent: boolean("consent").default(false).notNull(),
  status: leadStatusEnum("status").default("new").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export type AttorneyLead = typeof attorneyLeads.$inferSelect;

// ─── Site analytics ─────────────────────────────────────────────────────────

/** Privacy-friendly first-party pageviews (IP stored only as truncated hash). */
export const pageviews = pgTable(
  "pageviews",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    day: varchar("day", { length: 10 }).notNull(), // "2026-09-08" (UTC)
    path: varchar("path", { length: 255 }).notNull(),
    visitorHash: varchar("visitor_hash", { length: 24 }).notNull(),
    referrer: varchar("referrer", { length: 255 }),
    isBot: boolean("is_bot").default(false).notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [index("pageviews_day_idx").on(t.day)],
);

export type Pageview = typeof pageviews.$inferSelect;
