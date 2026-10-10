import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  kimiAuthUrl: required("KIMI_AUTH_URL"),
  kimiOpenUrl: required("KIMI_OPEN_URL"),
  ownerUnionId: process.env.OWNER_UNION_ID ?? "",
  /** Official USPTO Open Data Portal key — when set, patents are served via the official API. */
  usptoOdpApiKey: process.env.USPTO_ODP_API_KEY ?? "",
  /** Public base URL of the site, used for Stripe success/cancel/portal return URLs. */
  appUrl: (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  /** Stripe secret key (sk_live_... / sk_test_...). Empty = payments disabled. */
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  /** Signing secret of the Stripe webhook endpoint (whsec_...). */
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  /** Recurring monthly Price id for the Pro plan (price_...). */
  stripePricePro: process.env.STRIPE_PRICE_PRO ?? "",
  /** One-time Price id for the $29 Name Clearance Report (price_...). */
  stripePriceReport: process.env.STRIPE_PRICE_REPORT ?? "",
};
