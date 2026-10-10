import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { authedQuery, createRouter, publicQuery } from "./middleware";
import {
  getLiveTrademarkCount,
  phoneticVariants,
  searchPatents,
  searchTrademarks,
} from "./services/uspto";
import { checkDomains } from "./services/domains";
import {
  checkWatchesForUser,
  listAlerts,
  markAllAlertsRead,
  unreadAlertCount,
} from "./services/alerts";
import { getDb } from "./queries/connection";
import { savedSearches, watches } from "@db/schema";
import { isOwner } from "./queries/users";
import {
  createApiKey,
  listKeysForUser,
  revokeKey,
} from "./services/apikeys";
import {
  createPortalLink,
  createProCheckout,
  createReportCheckout,
  getPaidReport,
  getUserPlan,
  listBillingActivity,
  listMyReports,
  paymentsConfigured,
  planFor,
  PLANS,
  REPORT_PRICE_USD,
  reportsConfigured,
} from "./services/plans";
import { attorneyLeads, users } from "@db/schema";
import { getSiteStats } from "./services/analytics";

const searchRouter = createRouter({
  patents: publicQuery
    .input(
      z.object({
        query: z.string().min(1).max(500),
        page: z.number().int().min(1).default(1),
        perPage: z.number().int().min(1).max(50).default(25),
        sort: z.enum(["relevance", "newest", "oldest"]).default("newest"),
      }),
    )
    .query(({ input }) => searchPatents(input)),

  trademarks: publicQuery
    .input(
      z.object({
        query: z.string().min(1).max(500),
        status: z.enum(["all", "live", "dead"]).default("all"),
        page: z.number().int().min(1).default(1),
        perPage: z.number().int().min(1).max(50).default(25),
      }),
    )
    .query(({ input }) => searchTrademarks(input)),

  /**
   * Name-clearance bundle: live trademark count + exact domain availability +
   * sound-alike variants — the three checks we can answer with live data.
   */
  nameCheck: publicQuery
    .input(z.object({ name: z.string().min(2).max(60) }))
    .query(async ({ input }) => {
      const name = input.name.trim();
      const [liveMarks, domains] = await Promise.all([
        getLiveTrademarkCount(name).catch(() => -1),
        checkDomains(name).catch(() => []),
      ]);
      return {
        name,
        liveMarks,
        domains,
        soundAlikes: phoneticVariants(name),
        degraded:
          liveMarks < 0
            ? "USPTO's trademark search isn't responding right now, so the trademark count is missing. Domain and sound-alike checks still ran — try again in a few minutes."
            : null,
      };
    }),
});

const searchInput = z.object({
  label: z.string().min(1).max(255),
  type: z.enum(["patents", "trademarks"]),
  query: z.string().min(1).max(500),
  option: z.string().max(20).default("all"),
});

const libraryRouter = createRouter({
  // ── Saved searches ────────────────────────────────────────────────────────
  listSaved: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db
      .select()
      .from(savedSearches)
      .where(eq(savedSearches.userId, ctx.user.id))
      .orderBy(desc(savedSearches.createdAt));
  }),

  saveSearch: authedQuery
    .input(searchInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db
        .select()
        .from(savedSearches)
        .where(eq(savedSearches.userId, ctx.user.id));
      if (existing.length >= 50) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You can save at most 50 searches.",
        });
      }
      await db.insert(savedSearches).values({ ...input, userId: ctx.user.id });
      return { ok: true };
    }),

  deleteSaved: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .delete(savedSearches)
        .where(
          and(
            eq(savedSearches.id, input.id),
            eq(savedSearches.userId, ctx.user.id),
          ),
        );
      return { ok: true };
    }),

  // ── Watches ───────────────────────────────────────────────────────────────
  listWatches: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db
      .select()
      .from(watches)
      .where(eq(watches.userId, ctx.user.id))
      .orderBy(desc(watches.createdAt));
  }),

  addWatch: authedQuery
    .input(searchInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db
        .select()
        .from(watches)
        .where(eq(watches.userId, ctx.user.id));
      if (existing.length >= 20) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You can watch at most 20 searches.",
        });
      }
      if (
        existing.some(
          (w) =>
            w.query.toLowerCase() === input.query.toLowerCase() &&
            w.type === input.type &&
            w.option === input.option,
        )
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You are already watching this search.",
        });
      }
      await db.insert(watches).values({ ...input, userId: ctx.user.id });
      // Baseline the count immediately so the first check has something to compare
      await checkWatchesForUser(ctx.user.id, true);
      return { ok: true };
    }),

  removeWatch: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .delete(watches)
        .where(and(eq(watches.id, input.id), eq(watches.userId, ctx.user.id)));
      return { ok: true };
    }),

  toggleWatch: authedQuery
    .input(z.object({ id: z.number(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .update(watches)
        .set({ active: input.active })
        .where(and(eq(watches.id, input.id), eq(watches.userId, ctx.user.id)));
      return { ok: true };
    }),

  // ── Alerts ────────────────────────────────────────────────────────────────
  checkWatches: authedQuery
    .input(z.object({ force: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) =>
      checkWatchesForUser(ctx.user.id, input.force),
    ),

  listAlerts: authedQuery.query(({ ctx }) => listAlerts(ctx.user.id)),

  unreadCount: authedQuery.query(({ ctx }) => unreadAlertCount(ctx.user.id)),

  markAlertsRead: authedQuery.mutation(async ({ ctx }) => {
    await markAllAlertsRead(ctx.user.id);
    return { ok: true };
  }),
});

const apiKeysRouter = createRouter({
  list: authedQuery.query(({ ctx }) => listKeysForUser(ctx.user.id)),

  create: authedQuery
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { key, rawKey } = await createApiKey(ctx.user.id, input.name);
        // rawKey is returned once and never stored — show it now or never
        return {
          id: Number(key.id),
          name: key.name,
          prefix: key.prefix,
          rawKey,
        };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not create key",
        });
      }
    }),

  revoke: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await revokeKey(ctx.user.id, input.id);
      return { ok: true };
    }),
});

const billingRouter = createRouter({
  /** Public plan catalog for the pricing page. */
  plans: publicQuery.query(() => ({
    paymentsConfigured: paymentsConfigured(),
    plans: [PLANS.free, PLANS.pro].map((p) => ({
      id: p.id,
      name: p.name,
      priceMonthly: p.priceMonthly,
      requestsPerMinute: p.requestsPerMinute,
      requestsPerMonth: p.requestsPerMonth,
      maxActiveKeys: p.maxActiveKeys,
      features: p.features,
    })),
  })),

  /** The caller's current plan + whether payment is configured. */
  myPlan: authedQuery.query(async ({ ctx }) => {
    const planId = await getUserPlan(ctx.user.id);
    const def = planFor(planId);
    return {
      plan: def.id,
      name: def.name,
      requestsPerMinute: def.requestsPerMinute,
      requestsPerMonth: def.requestsPerMonth,
      maxActiveKeys: def.maxActiveKeys,
      paymentsConfigured: paymentsConfigured(),
    };
  }),

  /** Pro subscription: create a Stripe Checkout Session server-side. */
  checkoutPro: authedQuery.mutation(async ({ ctx }) => {
    if (!paymentsConfigured()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Payments are not configured yet.",
      });
    }
    if ((await getUserPlan(ctx.user.id)) === "pro") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "You're already on Pro." });
    }
    return { url: await createProCheckout(ctx.user) };
  }),

  /** Stripe Billing Portal (cancel, change card, invoices). */
  portal: authedQuery.mutation(async ({ ctx }) => {
    try {
      return { url: await createPortalLink(ctx.user.id) };
    } catch (e) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: e instanceof Error ? e.message : "Billing portal unavailable",
      });
    }
  }),

  /** Billing status for the account page. */
  status: authedQuery.query(async ({ ctx }) => {
    const [u] = await getDb()
      .select({
        plan: users.plan,
        subscriptionStatus: users.subscriptionStatus,
        currentPeriodEnd: users.currentPeriodEnd,
        hasCustomer: users.stripeCustomerId,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id));
    return {
      plan: u?.plan ?? "free",
      subscriptionStatus: u?.subscriptionStatus ?? null,
      currentPeriodEnd: u?.currentPeriodEnd ?? null,
      canManage: !!u?.hasCustomer,
    };
  }),

  /** One-time $29 Name Clearance Report checkout (guests allowed). */
  reportInfo: publicQuery.query(() => ({
    available: reportsConfigured(),
    priceUsd: REPORT_PRICE_USD,
  })),

  checkoutReport: publicQuery
    .input(z.object({ name: z.string().trim().min(2).max(60) }))
    .mutation(async ({ ctx, input }) => {
      if (!reportsConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Report purchases are not available yet.",
        });
      }
      return {
        url: await createReportCheckout({ name: input.name, user: ctx.user }),
      };
    }),

  /** Confirm a report purchase from the success page. */
  reportStatus: publicQuery
    .input(z.object({ sessionId: z.string().min(10).max(255) }))
    .query(async ({ input }) => {
      const r = await getPaidReport(input.sessionId).catch(() => null);
      return r
        ? {
            paid: true as const,
            name: r.name,
            email: r.email,
            downloadUrl: `/api/reports/${input.sessionId}.pdf`,
          }
        : { paid: false as const };
    }),

  myReports: authedQuery.query(async ({ ctx }) =>
    (await listMyReports(ctx.user.id)).map((r) => ({
      id: Number(r.id),
      name: r.name,
      paidAt: r.paidAt,
      downloadUrl: `/api/reports/${r.stripeSessionId}.pdf`,
    })),
  ),

  /** Whether the caller is the site owner (for showing the admin panel). */
  isOwner: authedQuery.query(
    ({ ctx }) => isOwner(ctx.user),
  ),

  /** Owner-only: read-only view of subscribers and report sales. */
  adminActivity: authedQuery.query(({ ctx }) => {
    if (!isOwner(ctx.user)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return listBillingActivity();
  }),

  /** Owner-only: attorney-referral leads. */
  adminLeads: authedQuery.query(async ({ ctx }) => {
    if (!isOwner(ctx.user)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    const rows = await getDb()
      .select()
      .from(attorneyLeads)
      .orderBy(desc(attorneyLeads.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...r, id: Number(r.id) }));
  }),
});

const leadsRouter = createRouter({
  /** "Talk to a trademark attorney" — stored for referral partners. */
  attorney: publicQuery
    .input(
      z.object({
        name: z.string().trim().min(1).max(255),
        email: z.string().trim().email().max(320),
        phone: z.string().trim().max(40).optional(),
        businessName: z.string().trim().min(1).max(255),
        state: z.string().trim().max(40).optional(),
        message: z.string().trim().max(2000).optional(),
        consent: z.literal(true),
        website: z.string().max(0).optional(), // honeypot — bots fill it
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .insert(attorneyLeads)
        .values({
          userId: ctx.user?.id ?? null,
          name: input.name,
          email: input.email,
          phone: input.phone || null,
          businessName: input.businessName,
          state: input.state || null,
          message: input.message || null,
          consent: input.consent,
        });
      return { ok: true };
    }),
});

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: createRouter({
    /** Current user (null when signed out). Sign-out happens in Supabase on the client. */
    me: publicQuery.query(({ ctx }) => ctx.user ?? null),
  }),
  search: searchRouter,
  library: libraryRouter,
  apiKeys: apiKeysRouter,
  billing: billingRouter,
  leads: leadsRouter,
  analytics: createRouter({
    /** Owner-only: first-party site traffic stats. */
    stats: authedQuery.query(async ({ ctx }) => {
      if (!isOwner(ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getSiteStats(30);
    }),
  }),
});

export type AppRouter = typeof appRouter;
