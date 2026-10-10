import { Link, useSearchParams } from "react-router";
import { CircleCheck, FileDown, LoaderCircle, Printer } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/providers/trpc";

export default function ReportSuccessPage() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id") ?? "";
  const status = trpc.billing.reportStatus.useQuery(
    { sessionId },
    {
      enabled: sessionId.length >= 10,
      // webhook may arrive a moment after the redirect
      refetchInterval: (q) => (q.state.data?.paid ? false : 2500),
      retry: false,
    },
  );
  const d = status.data;

  return (
    <Layout>
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        {!d?.paid ? (
          <>
            <LoaderCircle className="w-8 h-8 mx-auto animate-spin text-navy-600" />
            <h1 className="mt-4 text-2xl font-bold text-slate-900">
              Confirming your payment…
            </h1>
            <p className="mt-2 text-slate-600">
              This usually takes a few seconds. Keep this page open.
            </p>
          </>
        ) : (
          <>
            <CircleCheck className="w-10 h-10 mx-auto text-emerald-600" />
            <h1 className="mt-4 text-2xl font-bold text-slate-900">
              Your report for "{d.name}" is ready
            </h1>
            <p className="mt-2 text-slate-600">
              Bookmark this page. This link is your download key
              {d.email ? `, and Stripe emailed your receipt to ${d.email}` : ""}.
              If you were signed in, the report is also saved to your account
              on the Library page.
            </p>
            <div className="mt-6 flex justify-center gap-3 flex-wrap">
              <Button asChild className="bg-navy-800 hover:bg-navy-900">
                <a href={d.downloadUrl}>
                  <FileDown className="w-4 h-4" /> Download PDF
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={`${d.downloadUrl}?inline=1`} target="_blank" rel="noreferrer">
                  <Printer className="w-4 h-4" /> Open to print
                </a>
              </Button>
            </div>
            <p className="mt-8 text-xs text-slate-500">
              This report is an automated preliminary screening and is not
              legal advice. <Link to="/terms" className="underline">Terms</Link>
            </p>
          </>
        )}
      </div>
    </Layout>
  );
}
