-- MarkCitadel — Supabase schema (Postgres)
-- Paste into Supabase Dashboard → SQL Editor → Run. Run ONCE on a new project. Use either this file OR `npm run db:migrate`, not both.
-- Generated from db/schema.ts (drizzle-kit) + RLS hardening below.

CREATE TYPE "public"."lead_status" AS ENUM('new', 'referred', 'closed');
CREATE TYPE "public"."plan" AS ENUM('free', 'pro');
CREATE TYPE "public"."report_status" AS ENUM('pending', 'paid', 'refunded');
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');
CREATE TYPE "public"."search_type" AS ENUM('patents', 'trademarks');
CREATE TABLE "alert_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"watch_id" bigint NOT NULL,
	"message" text NOT NULL,
	"previous_total" integer NOT NULL,
	"new_total" integer NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "api_cache" (
	"key" varchar(600) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"stored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"stale_until" timestamp with time zone NOT NULL
);

CREATE TABLE "api_keys" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"name" varchar(100) NOT NULL,
	"prefix" varchar(12) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);

CREATE TABLE "api_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"api_key_id" bigint NOT NULL,
	"month" varchar(7) NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "attorney_leads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint,
	"name" varchar(255) NOT NULL,
	"email" varchar(320) NOT NULL,
	"phone" varchar(40),
	"business_name" varchar(255) NOT NULL,
	"state" varchar(40),
	"message" text,
	"consent" boolean DEFAULT false NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "pageviews" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"day" varchar(10) NOT NULL,
	"path" varchar(255) NOT NULL,
	"visitor_hash" varchar(24) NOT NULL,
	"referrer" varchar(255),
	"is_bot" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "rate_limits" (
	"key" varchar(200) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);

CREATE TABLE "report_purchases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint,
	"name" varchar(100) NOT NULL,
	"email" varchar(320),
	"stripe_session_id" varchar(255) NOT NULL,
	"stripe_payment_intent_id" varchar(255),
	"amount_cents" integer,
	"status" "report_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_purchases_stripe_session_id_unique" UNIQUE("stripe_session_id")
);

CREATE TABLE "saved_searches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"label" varchar(255) NOT NULL,
	"type" "search_type" NOT NULL,
	"query" varchar(500) NOT NULL,
	"option" varchar(20) DEFAULT 'all' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "stripe_events" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"type" varchar(100) NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"auth_id" uuid NOT NULL,
	"name" varchar(255),
	"email" varchar(320),
	"avatar" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sign_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"stripe_customer_id" varchar(64),
	"stripe_subscription_id" varchar(64),
	"subscription_status" varchar(32),
	"current_period_end" timestamp with time zone,
	CONSTRAINT "users_auth_id_unique" UNIQUE("auth_id"),
	CONSTRAINT "users_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);

CREATE TABLE "watches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"label" varchar(255) NOT NULL,
	"type" "search_type" NOT NULL,
	"query" varchar(500) NOT NULL,
	"option" varchar(20) DEFAULT 'all' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_total" integer,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_watch_id_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."watches"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "attorney_leads" ADD CONSTRAINT "attorney_leads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "report_purchases" ADD CONSTRAINT "report_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "watches" ADD CONSTRAINT "watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "api_cache_stale_idx" ON "api_cache" USING btree ("stale_until");
CREATE UNIQUE INDEX "api_usage_key_month" ON "api_usage" USING btree ("api_key_id","month");
CREATE INDEX "pageviews_day_idx" ON "pageviews" USING btree ("day");
CREATE INDEX "rate_limits_window_idx" ON "rate_limits" USING btree ("window_start");

-- ─── Row Level Security ───────────────────────────────────────────────────
-- RLS is ON with NO policies: the anon/authenticated roles used by the
-- Supabase REST/Data API can read or write nothing. Our API connects with the
-- table-owner `postgres` role via the pooler, which bypasses RLS.
ALTER TABLE public."alert_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."api_cache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."api_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."attorney_leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."pageviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."rate_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."report_purchases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."saved_searches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."stripe_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."watches" ENABLE ROW LEVEL SECURITY;

-- Belt and braces: no Data API grants on these tables.
REVOKE ALL ON TABLE public."alert_events" FROM anon, authenticated;
REVOKE ALL ON TABLE public."api_cache" FROM anon, authenticated;
REVOKE ALL ON TABLE public."api_keys" FROM anon, authenticated;
REVOKE ALL ON TABLE public."api_usage" FROM anon, authenticated;
REVOKE ALL ON TABLE public."attorney_leads" FROM anon, authenticated;
REVOKE ALL ON TABLE public."pageviews" FROM anon, authenticated;
REVOKE ALL ON TABLE public."rate_limits" FROM anon, authenticated;
REVOKE ALL ON TABLE public."report_purchases" FROM anon, authenticated;
REVOKE ALL ON TABLE public."saved_searches" FROM anon, authenticated;
REVOKE ALL ON TABLE public."stripe_events" FROM anon, authenticated;
REVOKE ALL ON TABLE public."users" FROM anon, authenticated;
REVOKE ALL ON TABLE public."watches" FROM anon, authenticated;

