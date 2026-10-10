import { useSearchParams } from "react-router";
import {
  BadgeDollarSign,
  FileCheck2,
  FileText,
  Lightbulb,
  Scale,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Layout } from "@/components/Layout";

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-navy-700 underline hover:text-navy-900"
    >
      {children}
    </a>
  );
}

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white p-6">
      <div className="flex items-center gap-2.5 font-semibold text-slate-900">
        <Icon className="w-5 h-5 text-navy-600" />
        {title}
      </div>
      <div className="mt-3 text-sm leading-6 text-slate-600 space-y-2.5">
        {children}
      </div>
    </div>
  );
}

function TrademarkGuide() {
  return (
    <div className="space-y-5">
      <Card icon={ShieldCheck} title="1. Confirm your name is really clear">
        <p>
          You just searched — good. Two more checks before spending money:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>Look at the live marks, not just exact matches.</strong>{" "}
            Registration is refused for names that are <em>confusingly
            similar</em> — same sound, spelling, or meaning in a related
            industry. "Litehouse" can block "Lighthouse".
          </li>
          <li>
            <strong>Check outside the USPTO too:</strong> Google the name,
            check domain availability, and search state business registries.
            Someone using the name without registering can still have
            "common-law" rights.
          </li>
        </ul>
      </Card>

      <Card icon={FileText} title="2. File at Trademark Center (the official USPTO system)">
        <p>
          Everything is filed online at{" "}
          <Ext href="https://trademarkcenter.uspto.gov/">trademarkcenter.uspto.gov</Ext>.
          You'll need a free USPTO.gov account with identity verification.
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>Choose your basis:</strong> <em>Use in commerce</em> if
            you're already selling under the name; <em>Intent to use</em> if
            you haven't launched yet (it reserves your place — you'll prove
            use later).
          </li>
          <li>
            <strong>Pick your class(es):</strong> goods/services are grouped
            into 45 classes. Software is often class 9 + 42; clothing is 25.
            Use the{" "}
            <Ext href="https://idm-tmng.uspto.gov/id-master-list-public.html">
              Trademark ID Manual
            </Ext>{" "}
            to pick pre-approved descriptions — it saves real money (below).
          </li>
          <li>
            <strong>Word mark vs. logo:</strong> a plain-text "standard
            character" mark protects the name itself in any font or style —
            usually the first filing. Logos are a separate application.
          </li>
        </ul>
      </Card>

      <Card icon={BadgeDollarSign} title="3. What it costs (2026 USPTO fees)">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>$350 per class</strong> — base application using ID Manual
            descriptions
          </li>
          <li>
            <strong>+$200 per class</strong> if you write your own free-form
            description instead of the ID Manual
          </li>
          <li>
            <strong>+$100 per class</strong> if the application is incomplete
          </li>
          <li>
            Intent-to-use filings: <strong>$150 per class</strong> later for
            the Statement of Use (+$125 per extension if you need more time)
          </li>
          <li>
            After registration: maintenance filings between years 5–6 (~$325
            per class) and every 10 years
          </li>
        </ul>
        <p className="text-slate-500">
          USPTO fees are <strong>non-refundable</strong>, even if refused —
          one reason the search step matters. Typical DIY total for a
          one-class name: <strong>$350–$550</strong>. With a filing service or
          attorney: roughly $600–$1,500.
        </p>
      </Card>

      <Card icon={Scale} title="4. What happens next, and when to hire help">
        <p>
          After filing, an examining attorney reviews your application in
          roughly <strong>6–9 months</strong>. If all goes well: publication
          for opposition, then registration. Straightforward cases run about
          12–18 months end to end.
        </p>
        <p>
          <strong>DIY is reasonable</strong> when your search is clean, the
          name is distinctive (invented or arbitrary), and the goods are
          simple. <strong>Get a trademark attorney</strong> if you receive an
          Office Action (a refusal — common and often fixable), if your search
          showed close live marks, or if the name is descriptive of what you
          sell. The USPTO also runs{" "}
          <Ext href="https://www.uspto.gov/learning-and-resources/ip-policy/public-information-about-practitioners/law-school-clinic-1">
            free law-school clinics
          </Ext>{" "}
          for qualifying small businesses.
        </p>
        <p className="text-slate-500">
          Tip: after you file, use MarkCitadel's <strong>Watch</strong> feature
          on your own name to catch anyone filing something similar later.
        </p>
      </Card>
    </div>
  );
}

function PatentGuide() {
  return (
    <div className="space-y-5">
      <Card icon={Lightbulb} title="1. First: decide if it's worth patenting">
        <p>Your search just answered the biggest question — does it already exist? Before going further:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            Patents require the invention to be <strong>new, useful, and
            non-obvious</strong>. If you found a granted patent or publication
            describing the same thing, that's usually the end of the road.
          </li>
          <li>
            <strong>America is first-to-file:</strong> if you're still
            developing it, don't publicly disclose (sell, demo, publish)
            before filing at least a provisional — public disclosure can
            forfeit your rights, especially abroad.
          </li>
        </ul>
      </Card>

      <Card icon={FileCheck2} title="2. Start with a provisional application (the affordable first step)">
        <p>
          A <strong>provisional patent application</strong> is the standard
          first move: it locks in your filing date and gives you{" "}
          <strong>12 months of "patent pending"</strong> to refine, test the
          market, or raise money — without starting formal examination.
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            USPTO fee: <strong>$65</strong> (micro entity) ·{" "}
            <strong>$130</strong> (small) · <strong>$325</strong> (large)
          </li>
          <li>
            Filed online at{" "}
            <Ext href="https://patentcenter.uspto.gov/">patentcenter.uspto.gov</Ext>{" "}
            — most independent inventors qualify as micro entities (80% off)
          </li>
          <li>
            It must still describe the invention completely — a thin
            provisional protects only what it actually discloses
          </li>
          <li>
            Within 12 months you must file the full (non-provisional)
            application or the provisional expires
          </li>
        </ul>
      </Card>

      <Card icon={BadgeDollarSign} title="3. What the full patent costs (honest numbers)">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>USPTO fees</strong> for a utility application (filing +
            search + exam): about <strong>$400 micro / $800 small / $2,000
            large</strong>, plus an issue fee (~$300–1,200) if granted
          </li>
          <li>
            <strong>Patent attorney/agent</strong> to draft the application:
            typically <strong>$2,000–$5,000+</strong> for a provisional,
            <strong> $5,000–$15,000</strong> for a full utility application,
            plus responses to examiner rejections (most applications get at
            least one)
          </li>
          <li>
            <strong>Design patents</strong> (protect how a product looks):
            much cheaper — roughly $2,500–3,500 all-in with an attorney
          </li>
        </ul>
        <p className="text-slate-500">
          Realistic total for a granted utility patent over its life:
          $15,000–20,000 with a boutique attorney. This is why the search you
          just did is worth doing before paying anyone.
        </p>
      </Card>

      <Card icon={Scale} title="4. When you genuinely need a professional">
        <p>
          Unlike trademarks, drafting patent <em>claims</em> — the legal
          boundaries of your protection — is specialized work. Self-filing a
          provisional to hold your date is common; self-filing the full
          application rarely ends well for anything with commercial value.
        </p>
        <p>
          Free and low-cost options: the USPTO's{" "}
          <Ext href="https://www.uspto.gov/patents/getting-started/legal-services/pro-bono">
            Patent Pro Bono Program
          </Ext>{" "}
          and{" "}
          <Ext href="https://www.uspto.gov/learning-and-resources/ip-policy/public-information-about-practitioners/law-school-clinic-1">
            law school clinics
          </Ext>{" "}
          connect qualifying inventors with volunteer patent attorneys. Verify
          any attorney or agent in the{" "}
          <Ext href="https://oedci.uspto.gov/OEDCI/">
            USPTO practitioner directory
          </Ext>{" "}
          — only registered practitioners may represent you before the USPTO.
        </p>
      </Card>
    </div>
  );
}

export default function RegisterHelpPage() {
  const [params] = useSearchParams();
  const topic = params.get("topic") === "patent" ? "patent" : "trademark";
  const isTm = topic === "trademark";

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-navy-700 bg-navy-100 rounded-full px-3 py-1 mb-4">
          <ShieldCheck className="w-3.5 h-3.5" /> Registration guide
        </div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
          {isTm
            ? "Found your name? Here's how to register it."
            : "Confirmed it's novel? Here's how to protect it."}
        </h1>
        <p className="mt-3 text-slate-600">
          {isTm
            ? "Trademark registration is very doable yourself if you're careful. Here's the official path, the real 2026 fees, and when professional help is worth it."
            : "Patenting is more involved than trademarking — but there's an affordable first step. Here's the realistic path and what things actually cost in 2026."}
        </p>

        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex gap-2.5 text-sm text-amber-800">
          <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            This is general information, not legal advice. Fees change — always
            confirm on the{" "}
            <Ext href="https://www.uspto.gov/learning-and-resources/fees-and-payment/uspto-fee-schedule">
              official USPTO fee schedule
            </Ext>{" "}
            before filing.
          </span>
        </div>

        <div className="mt-8">{isTm ? <TrademarkGuide /> : <PatentGuide />}</div>

        <p className="mt-8 text-sm text-slate-500">
          Not what you're registering? See the{" "}
          <a
            href={isTm ? "/register-help?topic=patent" : "/register-help"}
            className="text-navy-700 underline hover:text-navy-900"
          >
            {isTm ? "patent guide" : "trademark guide"}
          </a>{" "}
          instead.
        </p>
      </div>
    </Layout>
  );
}
