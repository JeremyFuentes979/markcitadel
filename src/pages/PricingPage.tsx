import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { Check, CreditCard, FileText, Zap } from "lucide-react";
import { toast } from "sonner";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";

export default function PricingPage() {
  const { isAuthenticated } = useAuth();
  const plans = trpc.billing.plans.useQuery();
  const myPlan = trpc.billing.myPlan.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const utils = trpc.useUtils();

  const [params] = useSearchParams();
  const checkoutState = params.get("checkout");
  const billing = trpc.billing.status.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const reportInfo = trpc.billing.reportInfo.useQuery();

  useEffect(() => {
    if (checkoutState === "success") {
      toast.success(
        "Payment received — Pro activates as soon as Stripe confirms it (usually a few seconds).",
      );
      // the webhook may land a moment after redirect; refresh a few times
      const t = [1500, 4000, 9000].map((ms) =>
        setTimeout(() => {
          utils.billing.myPlan.invalidate();
          utils.billing.status.invalidate();
          utils.apiKeys.list.invalidate();
        }, ms),
      );
      return () => t.forEach(clearTimeout);
    }
    if (checkoutState === "cancelled") toast("Checkout cancelled — no charge was made.");
  }, [checkoutState, utils]);

  const checkoutPro = trpc.billing.checkoutPro.useMutation({
    onSuccess: (d) => {
      window.location.href = d.url;
    },
    onError: (e) => toast.error(e.message),
  });
  const portal = trpc.billing.portal.useMutation({
    onSuccess: (d) => {
      window.location.href = d.url;
    },
    onError: (e) => toast.error(e.message),
  });

  const isPro = myPlan.data?.plan === "pro";

  // Owner-only read-only billing panel (Stripe is the source of truth)
  const isOwner = trpc.billing.isOwner.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const activity = trpc.billing.adminActivity.useQuery(undefined, {
    enabled: !!isOwner.data,
    retry: false,
  });
  const leads = trpc.billing.adminLeads.useQuery(undefined, {
    enabled: !!isOwner.data,
    retry: false,
  });

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 py-14">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-navy-700 bg-navy-100 rounded-full px-3 py-1 mb-4">
            <Zap className="w-3.5 h-3.5" /> API plans
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
            Simple pricing for the connector API
          </h1>
          <p className="mt-3 text-slate-600 max-w-xl mx-auto">
            The website is free for everyone. Plans apply to the developer API
            — the endpoints AI agents, domain tools, and startup sites call.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-6">
          {(plans.data?.plans ?? []).map((p) => {
            const current = myPlan.data?.plan === p.id;
            const isPaid = p.priceMonthly > 0;
            return (
              <div
                key={p.id}
                className={`rounded-2xl border p-6 bg-white flex flex-col ${
                  isPaid
                    ? "border-navy-600 shadow-lg shadow-navy-100 relative"
                    : "border-slate-200"
                }`}
              >
                {isPaid && (
                  <span className="absolute -top-3 left-6 bg-navy-800 text-brass-300 text-xs font-semibold px-3 py-1 rounded-full">
                    Most popular
                  </span>
                )}
                <div className="flex items-baseline justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {p.name}
                  </h2>
                  <div className="text-right">
                    <span className="text-3xl font-bold text-slate-900">
                      ${p.priceMonthly}
                    </span>
                    <span className="text-sm text-slate-500">/mo</span>
                  </div>
                </div>
                <ul className="mt-5 space-y-2.5 text-sm text-slate-600 flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-navy-600 mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-6">
                  {!isPaid ? (
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled
                    >
                      {current ? "Your current plan" : "Free forever"}
                    </Button>
                  ) : current ? (
                    <Button className="w-full" disabled>
                      Your current plan
                    </Button>
                  ) : !isAuthenticated ? (
                    <Button asChild className="w-full bg-navy-700 hover:bg-navy-800">
                      <Link to="/login">Sign in to upgrade</Link>
                    </Button>
                  ) : isPro ? (
                    <Button className="w-full" disabled>
                      You're on Pro
                    </Button>
                  ) : (
                    <Button
                      className="w-full bg-navy-700 hover:bg-navy-800"
                      disabled={checkoutPro.isPending || !plans.data?.paymentsConfigured}
                      onClick={() => checkoutPro.mutate()}
                    >
                      {!plans.data?.paymentsConfigured
                        ? "Coming soon"
                        : checkoutPro.isPending
                          ? "Opening secure checkout…"
                          : `Upgrade to ${p.name}`}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Manage subscription */}
        {isAuthenticated && billing.data?.canManage && (
          <div className="mt-6 rounded-2xl border bg-white p-6 flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-52">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-navy-600" /> Billing
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Plan: <strong>{billing.data.plan === "pro" ? "Pro" : "Free"}</strong>
                {billing.data.subscriptionStatus &&
                  ` · subscription ${billing.data.subscriptionStatus.replace("_", " ")}`}
                {billing.data.currentPeriodEnd &&
                  ` · renews/ends ${new Date(billing.data.currentPeriodEnd).toLocaleDateString()}`}
              </p>
              {billing.data.subscriptionStatus === "past_due" && (
                <p className="mt-1 text-sm text-red-600">
                  Your last payment failed. Update your card to keep Pro.
                </p>
              )}
            </div>
            <Button
              variant="outline"
              disabled={portal.isPending}
              onClick={() => portal.mutate()}
            >
              {portal.isPending ? "Opening…" : "Manage billing & invoices"}
            </Button>
          </div>
        )}

        {/* One-time report offer */}
        <div className="mt-10 rounded-2xl border border-brass-400 bg-amber-50 p-6 flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-60">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-navy-600" />
              Naming a business? Name Clearance Report — $
              {reportInfo.data?.priceUsd ?? 29} one-time
            </h3>
            <p className="mt-1.5 text-sm text-slate-600">
              No subscription. Run the free name check, then unlock the full
              PDF report: the top live conflicting trademarks with owners and
              serial numbers, domain status, sound-alike risks, and a
              checklist to hand to your attorney or partner.
            </p>
          </div>
          <Button asChild className="bg-navy-700 hover:bg-navy-800">
            <Link to="/namecheck">Check a name free →</Link>
          </Button>
        </div>

        {isOwner.data && (
          <div className="mt-10 rounded-2xl border border-slate-300 bg-white p-6">
            <h3 className="font-semibold text-slate-900">
              Billing overview{" "}
              <span className="text-xs font-normal text-slate-500">
                (only you can see this — plans are set automatically by
                verified Stripe webhooks)
              </span>
            </h3>
            <div className="mt-4 grid sm:grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-slate-500 text-xs">Pro subscribers</div>
                <div className="text-2xl font-bold">
                  {activity.data?.subscribers.length ?? 0}
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-xs">Paid reports</div>
                <div className="text-2xl font-bold">
                  {activity.data?.reports.filter((r) => r.status === "paid").length ?? 0}
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-xs">Attorney leads</div>
                <div className="text-2xl font-bold">{leads.data?.length ?? 0}</div>
              </div>
            </div>
            <div className="mt-4 divide-y text-sm">
              {activity.data?.reports.slice(0, 20).map((r) => (
                <div key={r.id} className="py-2 flex gap-3 flex-wrap">
                  <span className="flex-1 font-medium">{r.name}</span>
                  <span className="text-slate-500">{r.email ?? "—"}</span>
                  <span className="text-xs text-slate-500">{r.status}</span>
                </div>
              ))}
              {leads.data?.slice(0, 20).map((l) => (
                <div key={`l${l.id}`} className="py-2 flex gap-3 flex-wrap">
                  <span className="flex-1 font-medium">
                    Lead: {l.businessName}
                  </span>
                  <span className="text-slate-500">
                    {l.name} · {l.email} {l.phone ? `· ${l.phone}` : ""}
                  </span>
                  <span className="text-xs text-slate-500">{l.state ?? ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="mt-8 text-center text-sm text-slate-500">
          Questions about billing or higher volumes?{" "}
          <Link to="/terms" className="underline hover:text-slate-700">
            Terms of Service
          </Link>{" "}
          — cancel anytime from "Manage billing".
        </p>
      </div>
    </Layout>
  );
}
