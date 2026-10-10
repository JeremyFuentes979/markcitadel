import { FileDown, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/providers/trpc";

/** Paid upsell: unlock the full Name Clearance Report for a checked name. */
export function ReportCTA({ name, classes }: { name: string; classes?: number[] }) {
  const info = trpc.billing.reportInfo.useQuery();
  const checkout = trpc.billing.checkoutReport.useMutation({
    onSuccess: (d) => {
      window.location.href = d.url;
    },
    onError: (e) => toast.error(e.message),
  });
  const price = info.data?.priceUsd ?? 29;
  const available = info.data?.available ?? false;

  return (
    <div className="rounded-2xl border-2 border-navy-700 bg-white p-5">
      <div className="flex items-center gap-2 font-semibold text-slate-900">
        <Lock className="w-4 h-4 text-brass-500" />
        Get the full Name Clearance Report for "{name}" — ${price}
      </div>
      <ul className="mt-2 text-sm text-slate-600 list-disc pl-5 space-y-1">
        <li>Risk verdict for your classes, plus up to 10 scored conflicting marks with owners, classes and serial numbers</li>
        <li>Who already owns the word, and why each mark was flagged</li>
        <li>Domain status, sound-alike risks, and a do-it-yourself checklist</li>
        <li>A clean PDF to share with your partner, designer, or attorney</li>
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          className="bg-navy-800 hover:bg-navy-900"
          disabled={!available || checkout.isPending}
          onClick={() => checkout.mutate({ name, classes })}
        >
          <FileDown className="w-4 h-4" />
          {!available
            ? "Reports coming soon"
            : checkout.isPending
              ? "Opening secure checkout…"
              : `Unlock report — $${price}`}
        </Button>
        <span className="text-xs text-slate-500">
          One-time payment via Stripe. No subscription. Not legal advice.
        </span>
      </div>
    </div>
  );
}
