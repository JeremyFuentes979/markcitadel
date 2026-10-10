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
  /** Stripe payment link for the Pro plan (https://buy.stripe.com/...). Empty = payments not yet configured. */
  stripePaymentLink: process.env.STRIPE_PAYMENT_LINK ?? "",
};
