import { Layout } from "@/components/Layout";
import { Landmark } from "lucide-react";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="text-sm leading-6 text-slate-600 space-y-2">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-navy-800 flex items-center justify-center text-brass-300">
            <Landmark className="w-5 h-5" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900">
            Terms of Service
          </h1>
        </div>
        <p className="text-sm text-slate-500 mb-10">
          Last updated: October 9, 2026
        </p>

        <div className="space-y-8">
          <Section title="1. The service">
            <p>
              MarkCitadel ("the service") is a search website and JSON
              API for United States patents and trademarks. It lets people,
              websites, and AI agents search U.S. patent and trademark records
              through a simple interface or programmatic endpoints.
            </p>
            <p>
              By using the website or the API (including with an API key), you
              agree to these terms.
            </p>
          </Section>

          <Section title="2. Data sources and USPTO attribution">
            <p>
              All patent and trademark data comes from the United States Patent
              and Trademark Office (USPTO). Depending on the query, results are
              retrieved from one or more of these USPTO systems:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                USPTO Open Data Portal (api.uspto.gov) — the official,
                API-key-backed developer API for patent application data
              </li>
              <li>
                USPTO Patent Public Search (ppubs.uspto.gov) — the USPTO's
                public patent search system
              </li>
              <li>
                USPTO Trademark Search (tmsearch.uspto.gov) and Trademark
                Status &amp; Document Retrieval (tsdr.uspto.gov) — the USPTO's
                public trademark systems
              </li>
            </ul>
            <p>
              Patent and trademark records are works of the United States
              government and are generally in the public domain.{" "}
              <strong>
                This service is not affiliated with, sponsored by, or endorsed
                by the USPTO or any other government agency.
              </strong>
            </p>
            <p>
              Data may be delayed, incomplete, or contain errors, and search
              counts can differ from a manual check on uspto.gov because of
              indexing, family grouping, and timing differences. Before relying
              on any result, verify it directly with the USPTO record (every
              result links to the official source).
            </p>
          </Section>

          <Section title="3. Not legal advice">
            <p>
              <strong>
                MarkCitadel is an information service, not a law firm, and
                nothing on this site, in the API, or in any report is legal
                advice.
              </strong>{" "}
              Search results, name checks, and Name Clearance Reports are
              automated, preliminary screenings built from public USPTO and
              domain-registration data, which can be incomplete, delayed, or
              temporarily unavailable. They do not cover state registrations,
              common-law (unregistered) use, or foreign rights comprehensively,
              and they do not assess likelihood of confusion, registrability,
              or infringement for your goods or services. Using the service or
              buying a report does not create an attorney-client relationship.
              Consult a licensed trademark attorney before adopting, filing,
              or enforcing a mark. MarkCitadel is not affiliated with or
              endorsed by the USPTO.
            </p>
          </Section>

          <Section title="4. Accounts, API keys, and acceptable use">
            <p>
              Some features require signing in, and API access requires a free
              API key. When you use an API key you agree to:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Keep your key secret; you are responsible for its use</li>
              <li>
                Stay within your plan's rate limits and monthly quota (free
                tier: 30 requests/minute, 1,000 requests/month)
              </li>
              <li>
                Not attempt to bypass limits, scrape the service in bulk, or
                resell raw access to the API as your own competing service
              </li>
              <li>
                If you redistribute or display data obtained through the API,
                attribute it to the USPTO as the data source
              </li>
              <li>
                Not use the service for anything unlawful, deceptive, or
                harmful
              </li>
            </ul>
            <p>
              We may suspend or revoke keys that violate these terms or that
              generate abusive traffic. Because upstream data comes from USPTO
              systems, we also limit request rates to stay within their
              published usage policies.
            </p>
          </Section>

          <Section title="5. Paid plans, reports, and billing">
            <p>
              The Free plan is free forever. Paid plans (such as Pro) are
              billed monthly, and Name Clearance Reports are a one-time
              purchase, both through Stripe, our payment processor — we never
              see or store your card details. A report reflects the data
              available when it is generated. By paying you agree to:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Paid plans renew automatically each month until cancelled
              </li>
              <li>
                You can cancel anytime from "Manage billing" on the Pricing
                page (Stripe customer portal); access continues until the end
                of the current billing period. If a renewal payment fails, Pro
                access may be removed once Stripe's retry period ends
              </li>
              <li>
                Payments are non-refundable except where required by law;
                if we make a billing error we will make it right
              </li>
              <li>
                Plan limits (requests per minute, monthly quota, number of
                keys) are enforced automatically and described on the Pricing
                page
              </li>
            </ul>
          </Section>

          <Section title="6. Attorney referrals">
            <p>
              If you request an introduction to a trademark attorney, we share
              the details you submit with an independent attorney or law firm
              who may contact you. We may receive a referral or marketing fee
              from that partner. Attorneys are independent of MarkCitadel; we
              do not supervise or guarantee their services, and any
              engagement is solely between you and the attorney.
            </p>
          </Section>

          <Section title="7. Availability and changes">
            <p>
              The service depends on USPTO systems that we do not control. We
              aim for high availability but do not guarantee uninterrupted
              service, and features, limits, and these terms may change over
              time. Material changes will be reflected on this page with an
              updated date.
            </p>
          </Section>

          <Section title="8. Disclaimers and limitation of liability">
            <p>
              The service is provided "as is" and "as available", without
              warranties of any kind, express or implied, including accuracy,
              completeness, merchantability, or fitness for a particular
              purpose. To the maximum extent permitted by law, MarkCitadel
              Connector and its operators are not liable for any indirect,
              incidental, consequential, or punitive damages — including lost
              profits, lost filings, or missed deadlines — arising from use of
              the service or its data.
            </p>
          </Section>

          <Section title="9. Contact">
            <p>
              Questions about these terms or the API can be sent through the
              feedback channels listed on the Developers page.
            </p>
          </Section>
        </div>
      </div>
    </Layout>
  );
}
