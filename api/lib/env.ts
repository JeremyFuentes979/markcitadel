import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    console.error(`[env] Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

export const env = {
  isProduction:
    process.env.NODE_ENV === "production" || process.env.CONTEXT === "production",
  /** Running inside a Netlify Function (or other serverless runtime). */
  isServerless: !!(
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY_FUNCTIONS
  ),
  /** Supabase Postgres pooler URL (transaction mode, port 6543). */
  databaseUrl: required("DATABASE_URL"),
  /** Supabase project URL, e.g. https://abcd.supabase.co (used for JWKS). */
  supabaseUrl: (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, ""),
  /** Legacy HS256 JWT secret. If empty, tokens are verified via the project's JWKS. */
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? "",
  /** Email of the site owner; gets the admin role + owner panels. */
  ownerEmail: (process.env.OWNER_EMAIL ?? "").trim().toLowerCase(),
  /** Official USPTO Open Data Portal key — when set, patents are served via the official API. */
  usptoOdpApiKey: process.env.USPTO_ODP_API_KEY ?? "",
  /** Public base URL of the site, used for Stripe success/cancel/portal return URLs. */
  appUrl: (process.env.APP_URL ?? process.env.URL ?? "http://localhost:3000").replace(/\/$/, ""),
  /** Stripe secret key (sk_live_... / sk_test_...). Empty = payments disabled. */
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  /** Signing secret of the Stripe webhook endpoint (whsec_...). */
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  /** Recurring monthly Price id for the Pro plan (price_...). */
  stripePricePro: process.env.STRIPE_PRICE_PRO ?? "",
  /** One-time Price id for the $29 Name Clearance Report (price_...). */
  stripePriceReport: process.env.STRIPE_PRICE_REPORT ?? "",
};
