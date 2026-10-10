import { useState } from "react";
import { Link } from "react-router";
import { Check, Copy, Landmark, Zap } from "lucide-react";
import { toast } from "sonner";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  const [token, setToken] = useState<string | null>(null);
  const [payLink, setPayLink] = useState<string | null>(null);
  const [activateCode, setActivateCode] = useState("");

  const startUpgrade = trpc.billing.startUpgrade.useMutation({
    onSuccess: (d) => {
      setToken(d.token);
      setPayLink(d.paymentLink);
    },
    onError: (e) => toast.error(e.message),
  });
  const activate = trpc.billing.activate.useMutation({
    onSuccess: () => {
      toast.success("Pro activated — your keys now have Pro limits.");
      setActivateCode("");
      setToken(null);
      utils.billing.myPlan.invalidate();
      utils.apiKeys.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const isPro = myPlan.data?.plan === "pro";

  // Owner-only billing reconciliation panel
  const isOwner = trpc.billing.isOwner.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const activity = trpc.billing.adminActivity.useQuery(undefined, {
    enabled: !!isOwner.data,
    retry: false,
  });
  const downgrade = trpc.billing.adminDowngrade.useMutation({
    onSuccess: () => {
      toast.success("User downgraded to Free");
      utils.billing.adminActivity.invalidate();
    },
    onError: (e) => toast.error(e.message),
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
                      disabled={startUpgrade.isPending}
                      onClick={() => startUpgrade.mutate()}
                    >
                      {startUpgrade.isPending ? "Preparing…" : `Upgrade to ${p.name}`}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Upgrade flow: shown after clicking Upgrade */}
        {token && payLink && (
          <div className="mt-8 rounded-2xl border border-brass-400 bg-amber-50 p-6">
            <h3 className="font-semibold text-slate-900">
              Finish your upgrade — 3 quick steps
            </h3>
            <ol className="mt-3 text-sm text-slate-700 space-y-3 list-decimal pl-5">
              <li>
                <span className="font-medium">Copy your upgrade code</span> —
                it proves your payment belongs to your account:
                <div className="mt-1.5 flex gap-2 max-w-md">
                  <Input readOnly value={token} className="font-mono text-xs bg-white" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(token);
                      toast.success("Code copied");
                    }}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </li>
              <li>
                <span className="font-medium">Pay on Stripe.</span>{" "}
                <a
                  href={payLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-navy-700 underline font-medium"
                >
                  Open the secure checkout
                </a>{" "}
                and complete payment — nothing extra to fill in there.
              </li>
              <li>
                <span className="font-medium">Come back here</span> and paste
                your code into the activation box below. Pro turns on
                instantly.
              </li>
            </ol>
          </div>
        )}

        {/* Activate after paying */}
        {isAuthenticated && !isPro && (
          <div className="mt-6 rounded-2xl border bg-white p-6">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <Landmark className="w-4 h-4 text-navy-600" />
              Already paid? Activate Pro
            </h3>
            <p className="mt-1.5 text-sm text-slate-600">
              Paste the upgrade code you got when you clicked Upgrade.
              Activation is instant and applies to all your API keys.
            </p>
            <div className="mt-3 flex gap-2 max-w-md">
              <Input
                placeholder="mku_…"
                value={activateCode}
                onChange={(e) => setActivateCode(e.target.value)}
                className="font-mono text-xs"
              />
              <Button
                className="bg-navy-700 hover:bg-navy-800"
                disabled={activate.isPending || activateCode.trim().length < 10}
                onClick={() => activate.mutate({ token: activateCode.trim() })}
              >
                {activate.isPending ? "Activating…" : "Activate"}
              </Button>
            </div>
          </div>
        )}

        {isOwner.data && (
          <div className="mt-10 rounded-2xl border border-slate-300 bg-white p-6">
            <h3 className="font-semibold text-slate-900">
              Billing activity{" "}
              <span className="text-xs font-normal text-slate-500">
                (only you can see this)
              </span>
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Cross-check "activated" rows against Stripe payment emails. If an
              activation has no matching payment, downgrade the user.
            </p>
            <div className="mt-4 divide-y text-sm">
              {(activity.data?.length ?? 0) === 0 && (
                <div className="py-4 text-slate-500">
                  No upgrade activity yet.
                </div>
              )}
              {activity.data?.map((a) => (
                <div
                  key={a.id}
                  className="py-3 flex items-center gap-3 flex-wrap"
                >
                  <div className="flex-1 min-w-40">
                    <div className="font-medium text-slate-900 truncate">
                      {a.userName ?? "Unnamed user"}{" "}
                      <span className="text-slate-400 font-normal">
                        {a.userEmail ?? `#${a.userId}`}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      code issued {new Date(a.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {a.usedAt ? (
                    <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">
                      Activated {new Date(a.usedAt).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-500">
                      Awaiting payment
                    </span>
                  )}
                  {a.usedAt && (
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `Downgrade ${a.userName ?? a.userEmail ?? `user #${a.userId}`} to Free?`,
                          )
                        )
                          downgrade.mutate({ userId: a.userId });
                      }}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Downgrade
                    </button>
                  )}
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
          — cancel anytime from your Stripe receipt email.
        </p>
      </div>
    </Layout>
  );
}
