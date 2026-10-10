import { Hono } from "hono";
import { env } from "../lib/env";
import { handleStripeEvent, stripe } from "../services/plans";

/**
 * Stripe webhook endpoint: POST /api/stripe/webhook
 *
 * Every event is verified against STRIPE_WEBHOOK_SECRET using the raw
 * request body before anything touches the database. Unsigned or forged
 * requests get 400 and change nothing.
 */
export const stripeWebhook = new Hono();

stripeWebhook.post("/webhook", async (c) => {
  if (!env.stripeSecretKey || !env.stripeWebhookSecret) {
    return c.json({ error: "Stripe not configured" }, 503);
  }
  const signature = c.req.header("stripe-signature");
  if (!signature) return c.json({ error: "Missing signature" }, 400);
  const raw = await c.req.text(); // must be the exact raw body
  let event;
  try {
    event = await stripe().webhooks.constructEventAsync(
      raw,
      signature,
      env.stripeWebhookSecret,
    );
  } catch (e) {
    console.warn("[stripe] signature verification failed:", e instanceof Error ? e.message : e);
    return c.json({ error: "Invalid signature" }, 400);
  }
  try {
    await handleStripeEvent(event);
  } catch (e) {
    console.error(`[stripe] handling ${event.type} ${event.id} failed:`, e);
    return c.json({ error: "Handler failed" }, 500); // Stripe will retry
  }
  return c.json({ received: true });
});
