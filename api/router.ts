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
import { authRouter } from "./auth-router";
import {
  createApiKey,
  listKeysForUser,
  revokeKey,
} from "./services/apikeys";
import {
  activatePlan,
  createUpgradeToken,
  downgradeUser,
  getUserPlan,
  listUpgradeActivity,
  paymentLink,
  paymentsConfigured,
  planFor,
  PLANS,
} from "./services/plans";
import { env } from "./lib/env";
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

  /**
   * Start an upgrade: mints a one-time token the user pastes into Stripe
   * Checkout's client_reference_id field, then back here after paying.
   */
  startUpgrade: authedQuery.mutation(async ({ ctx }) => {
    const link = paymentLink();
    if (!link) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Payments are not configured yet.",
      });
    }
    const token = await createUpgradeToken(ctx.user.id);
    return { token, paymentLink: link };
  }),

  /** Activate Pro with the token after Stripe payment. */
  activate: authedQuery
    .input(z.object({ token: z.string().min(10).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const ok = await activatePlan(ctx.user.id, input.token);
      if (!ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That upgrade code is invalid or has already been used. Check the code and try again — it must be one generated from your account.",
        });
      }
      return { ok: true, plan: "pro" as const };
    }),

  /** Whether the caller is the site owner (for showing the admin panel). */
  isOwner: authedQuery.query(
    ({ ctx }) => !!env.ownerUnionId && ctx.user.unionId === env.ownerUnionId,
  ),

  /** Owner-only: upgrade activity to reconcile against Stripe payment emails. */
  adminActivity: authedQuery.query(({ ctx }) => {
    if (!env.ownerUnionId || ctx.user.unionId !== env.ownerUnionId) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return listUpgradeActivity();
  }),

  /** Owner-only: downgrade a user (e.g. no matching Stripe payment). */
  adminDowngrade: authedQuery
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (!env.ownerUnionId || ctx.user.unionId !== env.ownerUnionId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await downgradeUser(input.userId);
      return { ok: true };
    }),
});

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  search: searchRouter,
  library: libraryRouter,
  apiKeys: apiKeysRouter,
  billing: billingRouter,
  analytics: createRouter({
    /** Owner-only: first-party site traffic stats. */
    stats: authedQuery.query(async ({ ctx }) => {
      if (!env.ownerUnionId || ctx.user.unionId !== env.ownerUnionId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getSiteStats(30);
    }),
  }),
});

export type AppRouter = typeof appRouter;
