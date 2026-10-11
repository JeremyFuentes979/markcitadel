import Stripe from "stripe";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { apiKeys, reportPurchases, stripeEvents, users } from "@db/schema";
import { env } from "../lib/env";

/**
 * Plan definitions and Stripe billing.
 *
 * Security model: the browser can only *start* a Checkout Session (created
 * server-side, with our user id in metadata). A plan is granted or removed
 * ONLY by a signature-verified Stripe webhook (see api/routes/stripe.ts).
 * There is no self-serve activation path.
 */

export type PlanId = "free" | "pro";

export interface PlanDef {
  id: PlanId;
  name: string;
  priceMonthly: number; // USD
  requestsPerMinute: number;
  requestsPerMonth: number;
  maxActiveKeys: number;
  features: string[];
}

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free",
    name: "Free",
    priceMonthly: 0,
    requestsPerMinute: 30,
    requestsPerMonth: 1_000,
    maxActiveKeys: 5,
    features: [
      "1,000 API requests / month",
      "30 requests / minute",
      "Up to 5 API keys",
      "Full patent, trademark & image search",
      "MCP connector for AI assistants",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthly: 29,
    requestsPerMinute: 120,
    requestsPerMonth: 25_000,
    maxActiveKeys: 25,
    features: [
      "25,000 API requests / month",
      "120 requests / minute",
      "Up to 25 API keys",
      "Everything in Free",
      "Priority support",
    ],
  },
};

export function planFor(plan: string): PlanDef {
  return PLANS[(plan as PlanId) in PLANS ? (plan as PlanId) : "free"];
}

/** Per-user plan — source of truth is users.plan, written only by the webhook. */
export async function getUserPlan(userId: number): Promise<PlanId> {
  const db = getDb();
  const [u] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId));
  return u?.plan === "pro" ? "pro" : "free";
}

// ─── Stripe client ──────────────────────────────────────────────────────────

let stripeClient: Stripe | null = null;

export function stripe(): Stripe {
  if (!env.stripeSecretKey) throw new Error("Stripe is not configured");
  if (!stripeClient) stripeClient = new Stripe(env.stripeSecretKey);
  return stripeClient;
}

/** Pro subscriptions can be sold (key + Pro price + webhook secret present). */
export function paymentsConfigured(): boolean {
  return !!(env.stripeSecretKey && env.stripePricePro && env.stripeWebhookSecret);
}

/** One-time reports can be sold. */
export function reportsConfigured(): boolean {
  return !!(env.stripeSecretKey && env.stripePriceReport && env.stripeWebhookSecret);
}

export const REPORT_PRICE_USD = 29;

// ─── Checkout / portal (called from tRPC) ──────────────────────────────────

async function getOrCreateCustomer(user: {
  id: number;
  email: string | null;
  name: string | null;
}): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, user.id));
  if (row?.stripeCustomerId) return row.stripeCustomerId;
  const customer = await stripe().customers.create({
    email: user.email ?? undefined,
    name: user.name ?? undefined,
    metadata: { userId: String(user.id) },
  });
  await db
    .update(users)
    .set({ stripeCustomerId: customer.id })
    .where(eq(users.id, user.id));
  return customer.id;
}

/** Create a Pro subscription Checkout Session for a signed-in user. */
export async function createProCheckout(user: {
  id: number;
  email: string | null;
  name: string | null;
}): Promise<string> {
  const customer = await getOrCreateCustomer(user);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: String(user.id),
    line_items: [{ price: env.stripePricePro, quantity: 1 }],
    metadata: { kind: "pro", userId: String(user.id) },
    subscription_data: { metadata: { kind: "pro", userId: String(user.id) } },
    allow_promotion_codes: true,
    success_url: `${env.appUrl}/pricing?checkout=success`,
    cancel_url: `${env.appUrl}/pricing?checkout=cancelled`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

/** Stripe Billing Portal link (cancel, update card, invoices). */
export async function createPortalLink(userId: number): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId));
  if (!row?.stripeCustomerId) throw new Error("No billing account yet");
  const portal = await stripe().billingPortal.sessions.create({
    customer: row.stripeCustomerId,
    return_url: `${env.appUrl}/pricing`,
  });
  return portal.url;
}

/** Create a one-time $29 Name Clearance Report Checkout Session. */
export async function createReportCheckout(opts: {
  name: string;
  classes?: number[];
  user?: { id: number; email: string | null; name: string | null };
}): Promise<string> {
  const name = opts.name.trim().slice(0, 100);
  const classes = (opts.classes ?? []).filter((n) => n >= 1 && n <= 45).slice(0, 12).join(",");
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [{ price: env.stripePriceReport, quantity: 1 }],
    metadata: {
      kind: "report",
      name,
      classes,
      userId: opts.user ? String(opts.user.id) : "",
    },
    payment_intent_data: {
      description: `MarkCitadel Name Clearance Report — ${name}`,
      metadata: { kind: "report", name },
    },
    allow_promotion_codes: true,
    success_url: `${env.appUrl}/report/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.appUrl}/namecheck?name=${encodeURIComponent(name)}`,
  };
  if (opts.user) {
    params.customer = await getOrCreateCustomer(opts.user);
    params.client_reference_id = String(opts.user.id);
  } else {
    params.customer_creation = "always"; // guest — Stripe collects the email
  }
  const session = await stripe().checkout.sessions.create(params);
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  await getDb()
    .insert(reportPurchases)
    .values({
      userId: opts.user?.id ?? null,
      name,
      classes: classes || null,
      email: opts.user?.email ?? null,
      stripeSessionId: session.id,
      status: "pending",
    });
  return session.url;
}

/**
 * Look up a report purchase by Checkout Session id (the success URL carries
 * it; it is unguessable and acts as the download credential). If the
 * webhook hasn't landed yet we confirm payment directly with Stripe.
 */
export async function getPaidReport(
  sessionId: string,
): Promise<{ name: string; email: string | null; classes?: number[] } | null> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return null;
  const db = getDb();
  const [row] = await db
    .select()
    .from(reportPurchases)
    .where(eq(reportPurchases.stripeSessionId, sessionId));
  if (!row) return null;
  const classes = row.classes ? row.classes.split(",").map(Number).filter((n) => n >= 1 && n <= 45) : undefined;
  if (row.status === "paid") return { name: row.name, email: row.email, classes };
  if (row.status !== "pending" || !env.stripeSecretKey) return null;
  const s = await stripe().checkout.sessions.retrieve(sessionId);
  if (s.payment_status !== "paid") return null;
  await markReportPaid(s);
  return { name: row.name, email: s.customer_details?.email ?? row.email, classes };
}

/** Reports tied to a signed-in account. */
export async function listMyReports(userId: number) {
  return getDb()
    .select({
      id: reportPurchases.id,
      name: reportPurchases.name,
      stripeSessionId: reportPurchases.stripeSessionId,
      paidAt: reportPurchases.paidAt,
    })
    .from(reportPurchases)
    .where(
      and(eq(reportPurchases.userId, userId), eq(reportPurchases.status, "paid")),
    )
    .orderBy(desc(reportPurchases.paidAt))
    .limit(50);
}

// ─── Webhook-driven state changes ──────────────────────────────────────────

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);
// past_due = grace period while Stripe retries the card (Smart Retries).
// When retries are exhausted Stripe moves the sub to unpaid/canceled and
// customer.subscription.updated/deleted downgrades the user.

/** Set a user's plan and mirror it onto their API keys (limits read keys). */
async function setUserPlan(userId: number, plan: PlanId) {
  const db = getDb();
  await db.update(users).set({ plan }).where(eq(users.id, userId));
  await db.update(apiKeys).set({ plan }).where(eq(apiKeys.userId, userId));
}

async function userIdFor(
  customerId: string | null,
  metadataUserId?: string | null,
): Promise<number | null> {
  if (metadataUserId && /^\d+$/.test(metadataUserId)) return Number(metadataUserId);
  if (!customerId) return null;
  const [u] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.stripeCustomerId, customerId));
  return u ? Number(u.id) : null;
}

function idOf(x: string | { id: string } | null | undefined): string | null {
  if (!x) return null;
  return typeof x === "string" ? x : x.id;
}

export async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = idOf(sub.customer);
  const userId = await userIdFor(customerId, sub.metadata?.userId);
  if (!userId) {
    console.warn(`[stripe] subscription ${sub.id}: no matching user`);
    return;
  }
  const periodEnd = sub.items?.data?.[0]?.current_period_end;
  await getDb()
    .update(users)
    .set({
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    })
    .where(eq(users.id, userId));
  await setUserPlan(userId, ACTIVE_STATUSES.has(sub.status) ? "pro" : "free");
}

async function markReportPaid(s: Stripe.Checkout.Session) {
  await getDb()
    .update(reportPurchases)
    .set({
      status: "paid",
      paidAt: new Date(),
      email: s.customer_details?.email ?? undefined,
      stripePaymentIntentId: idOf(s.payment_intent) ?? undefined,
      amountCents: s.amount_total ?? undefined,
    })
    .where(eq(reportPurchases.stripeSessionId, s.id));
}

/** Dispatch a verified Stripe event. Idempotent per event id. */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  const db = getDb();
  const [seen] = await db
    .select({ id: stripeEvents.id })
    .from(stripeEvents)
    .where(eq(stripeEvents.id, event.id));
  if (seen) return;

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode === "subscription" && s.subscription) {
        const sub = await stripe().subscriptions.retrieve(idOf(s.subscription)!);
        if (!sub.metadata?.userId && s.metadata?.userId) {
          sub.metadata = { ...sub.metadata, userId: s.metadata.userId };
        }
        await syncSubscription(sub);
      } else if (s.mode === "payment" && s.metadata?.kind === "report") {
        if (s.payment_status === "paid") await markReportPaid(s);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      const userId = await userIdFor(idOf(inv.customer));
      if (userId) {
        // Record it; access is kept during Stripe's retry window and removed
        // when the subscription moves to unpaid/canceled (event above).
        await db
          .update(users)
          .set({ subscriptionStatus: "past_due" })
          .where(eq(users.id, userId));
      }
      break;
    }
    case "charge.refunded": {
      const ch = event.data.object as Stripe.Charge;
      const pi = idOf(ch.payment_intent);
      if (pi && ch.refunded) {
        await db
          .update(reportPurchases)
          .set({ status: "refunded" })
          .where(eq(reportPurchases.stripePaymentIntentId, pi));
      }
      break;
    }
    default:
      break;
  }
  await db
    .insert(stripeEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing({ target: stripeEvents.id });
}

// ─── Owner billing view (read-only; Stripe is the source of truth) ─────────

export async function listBillingActivity(limit = 100) {
  const db = getDb();
  const subs = await db
    .select({
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      plan: users.plan,
      status: users.subscriptionStatus,
      currentPeriodEnd: users.currentPeriodEnd,
    })
    .from(users)
    .where(eq(users.plan, "pro"))
    .limit(limit);
  const reports = await db
    .select({
      id: reportPurchases.id,
      name: reportPurchases.name,
      email: reportPurchases.email,
      status: reportPurchases.status,
      paidAt: reportPurchases.paidAt,
      createdAt: reportPurchases.createdAt,
    })
    .from(reportPurchases)
    .orderBy(desc(reportPurchases.createdAt))
    .limit(limit);
  return {
    subscribers: subs.map((s) => ({ ...s, userId: Number(s.userId) })),
    reports: reports.map((r) => ({ ...r, id: Number(r.id) })),
  };
}
