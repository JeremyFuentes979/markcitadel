import { useState } from "react";
import { Scale } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/providers/trpc";

/** Optional "talk to a trademark attorney" lead capture (stored in DB). */
export function AttorneyLeadForm({ businessName }: { businessName: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [f, setF] = useState({
    name: "",
    email: "",
    phone: "",
    state: "",
    message: "",
    website: "",
    consent: false,
  });
  const submit = trpc.leads.attorney.useMutation({
    onSuccess: () => setSent(true),
    onError: (e) => toast.error(e.message),
  });

  if (sent) {
    return (
      <div className="rounded-2xl border bg-emerald-50 border-emerald-200 p-5 text-sm text-emerald-900">
        Thanks. We'll connect you with a licensed trademark attorney about "
        {businessName}", usually within one business day.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="flex items-center gap-2 font-semibold text-slate-900">
        <Scale className="w-4 h-4 text-navy-600" />
        Want a professional opinion? Talk to a trademark attorney
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Free, no-obligation introduction to an independent licensed attorney
        who can run a full clearance search and file for you.
      </p>
      {!open ? (
        <Button variant="outline" className="mt-3" onClick={() => setOpen(true)}>
          Request an introduction
        </Button>
      ) : (
        <form
          className="mt-4 grid sm:grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!f.consent) {
              toast.error("Please agree to be contacted.");
              return;
            }
            submit.mutate({
              name: f.name,
              email: f.email,
              phone: f.phone || undefined,
              state: f.state || undefined,
              message: f.message || undefined,
              businessName,
              consent: true,
              website: f.website || undefined,
            });
          }}
        >
          <Input required placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input required type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Input placeholder="Phone (optional)" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <Input placeholder="State (e.g. TX)" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} />
          <Textarea
            className="sm:col-span-2"
            placeholder="What do you sell, and where? (optional)"
            value={f.message}
            onChange={(e) => setF({ ...f, message: e.target.value })}
          />
          {/* honeypot */}
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            className="hidden"
            value={f.website}
            onChange={(e) => setF({ ...f, website: e.target.value })}
          />
          <label className="sm:col-span-2 flex items-start gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={f.consent}
              onChange={(e) => setF({ ...f, consent: e.target.checked })}
            />
            I agree that MarkCitadel may share these details with an
            independent trademark attorney who may contact me. MarkCitadel may
            receive a referral fee. This does not create an attorney-client
            relationship.
          </label>
          <Button
            type="submit"
            className="sm:col-span-2 bg-navy-700 hover:bg-navy-800"
            disabled={submit.isPending}
          >
            {submit.isPending ? "Sending…" : "Send request"}
          </Button>
        </form>
      )}
    </div>
  );
}
