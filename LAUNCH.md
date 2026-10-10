# MarkCitadel — Launch Guide

This copy turns MarkCitadel from a portfolio project into something that can
take real money safely. Original upload is the first git commit; `git diff HEAD~1`
(or `git log -p`) shows every change.

---

## 1. What changed

### Billing (security fix — the big one)
- **Removed** the self-serve upgrade flow (`mku_` tokens the user minted and
  pasted back, with no payment check). The `startUpgrade` / `activate` /
  `adminDowngrade` endpoints and the paste-a-code UI are gone.
- **Pro is now Stripe Checkout (subscription)**, created server-side
  (`billing.checkoutPro`) with `userId` in session + subscription metadata and
  `client_reference_id`. A Stripe Customer is created per user.
- **Signature-verified webhook** at `POST /api/stripe/webhook`
  (`api/routes/stripe.ts`). Verifies the raw body with `STRIPE_WEBHOOK_SECRET`
  before touching the DB. Handles:
  - `checkout.session.completed` (+ `async_payment_succeeded`) → Pro on, or report marked paid
  - `customer.subscription.created/updated/deleted` → syncs status; `active`/`trialing`/`past_due` = Pro, anything else = Free
  - `invoice.payment_failed` → status recorded as `past_due` (grace while Stripe retries; Pro is removed when Stripe marks the sub `unpaid`/`canceled`)
  - `charge.refunded` → report purchase marked refunded
  - Idempotent: processed event ids are stored in `stripe_events`.
- **Plan source of truth is now `users.plan`** (only the webhook writes it) and
  is mirrored onto API keys. Fixed a bug where a Pro user who revoked all keys
  would get new keys on Free.
- **Billing portal** (`billing.portal`): "Manage billing & invoices" on
  /pricing (cancel, change card, invoices). Past-due warning shown.
- Owner panel on /pricing is now read-only (subscribers, report sales,
  attorney leads); Stripe is the source of truth for money.
- **Migration** `db/migrations/0003_stripe_billing.sql`: adds
  `users.plan / stripe_customer_id / stripe_subscription_id / subscription_status / current_period_end`,
  tables `stripe_events`, `report_purchases`, `attorney_leads`, and carries
  existing Pro users over (re-check them against Stripe).
  The old `upgrade_tokens` table is left in place (unused) for history.

### $29 Name Clearance Report (new revenue line)
- The free name check still runs (live TM count, domains, sound-alikes).
- New CTA under the results (`src/components/ReportCTA.tsx`) → one-time
  Stripe Checkout (`mode: payment`, guests allowed, Stripe collects email,
  promo codes enabled). A `report_purchases` row is created as `pending`.
- Paid → `/report/success?session_id=…` polls until the webhook (or a
  server-side Stripe lookup) confirms payment, then offers **Download PDF**
  and **Open to print**. Download: `GET /api/reports/<cs_…>.pdf` — refuses
  unless the purchase is paid.
- Signed-in buyers also see their reports on the **Library** page. Stripe
  sends the receipt email (turn on "Successful payments" receipts). There is
  no transactional email of the PDF yet — see risks.
- The paid report now shows up to 10 conflicting live marks (was 5), a
  "next step: attorney" section, and the full disclaimer.
- The old free PDF route `/api/v1/namecheck/report` now **requires an API
  key** (the old "same-site / cookie" bypass was spoofable and gave the
  product away).
- Report offer added to /pricing.

### Attorney lead capture
- "Talk to a trademark attorney" form under name-check results
  (`src/components/AttorneyLeadForm.tsx`) → `leads.attorney` → `attorney_leads`
  table. It requires a consent box that mentions the referral fee, and has a
  honeypot field against bots. Leads show in the owner panel on /pricing.

### Data resilience (`api/services/uspto.ts`)
- Every USPTO call goes through `usptoFetch`: 12s timeout per attempt,
  3 attempts, exponential backoff + jitter, retries on network errors,
  timeouts, 429 and 5xx, and honors short `Retry-After` values.
- Cache: 6h fresh (was 5 min), 5,000 entries, and **stale-if-error** up to 48h.
  When USPTO is down, cached results come back with a `notice` explaining
  they're cached. Live-mark counts used by name check are cached too.
- Clear degraded-mode message: name check shows an amber banner when USPTO
  trademark search is unreachable. Search errors raise a friendly
  "USPTO is slow or unavailable" message.
- Patents: the official **ODP API key path is preferred** (already was).
  The server now logs a startup warning if `USPTO_ODP_API_KEY` is missing.
  Set it in production.

### Legal
- Strong "Not legal advice / no attorney-client relationship / preliminary
  screening / not affiliated with USPTO" disclaimer on the PDF (banner on
  page 1 plus a full paragraph at the end), on the name-check page, and on
  the success page.
- Terms: section 3 rewritten (Not legal advice), section 5 covers one-time
  reports and the new cancel/past-due behavior, and there's a new
  section 6, "Attorney referrals", with the referral-fee disclosure.
  Date updated.

### Official trademark data alternatives (for hardening)
The trademark search uses `tmsearch.uspto.gov`'s internal endpoint, the same
one the USPTO website uses, which isn't an official API. Official options:
- **TSDR API** (tsdr.uspto.gov, key from developer.uspto.gov / ODP): official
  per-serial/registration status and documents. Good for enriching and
  verifying hits, but it's a lookup, not a search.
- **USPTO Trademark bulk data** (ODP "Bulk Data" / former bdss.uspto.gov):
  daily XML case files plus the annual full backfile. Load them into Postgres
  or Meilisearch/OpenSearch and you get your own search index with no
  dependence on tmsearch. This is the real long-term fix (about 1 to 2 weeks of work).
- **USPTO Open Data Portal** (data.uspto.gov): official keyed APIs. Patents are
  already supported. Watch it for trademark search endpoints.
- Commercial feeds (e.g. Corsearch, Clarivate CompuMark, Markify API) if
  volume justifies it.

---

## 2. Environment variables

| Var | Purpose |
|---|---|
| `DATABASE_URL` | MySQL connection string |
| `APP_ID`, `APP_SECRET` | App id + JWT signing secret |
| `KIMI_AUTH_URL`, `KIMI_OPEN_URL`, `VITE_KIMI_AUTH_URL`, `VITE_APP_ID` | Current login (Kimi OAuth); see risks |
| `OWNER_UNION_ID` | Your user, for owner panels |
| `APP_URL` | Public URL, e.g. `https://markcitadel.com` (used for Stripe redirects) |
| `USPTO_ODP_API_KEY` | Official USPTO ODP key (strongly recommended) |
| `STRIPE_SECRET_KEY` | `sk_test_…` first, then `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` of the webhook endpoint |
| `STRIPE_PRICE_PRO` | `price_…` recurring $29/month |
| `STRIPE_PRICE_REPORT` | `price_…` one-time $29 |

Removed: `STRIPE_PAYMENT_LINK`. Buttons show "Coming soon" until the Stripe vars are set.

---

## 3. Stripe setup (do this in Test mode first)

1. **Products → Add product** "MarkCitadel Pro", recurring **$29 / month**.
   Copy the price id → `STRIPE_PRICE_PRO`.
2. **Add product** "Name Clearance Report", **one-time $29**. Copy the price id
   → `STRIPE_PRICE_REPORT`.
3. **Developers → API keys** → secret key → `STRIPE_SECRET_KEY`.
4. **Developers → Webhooks → Add endpoint**:
   `https://<your-domain>/api/stripe/webhook`. Events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed`,
   `charge.refunded`. Copy the signing secret → `STRIPE_WEBHOOK_SECRET`.
5. **Settings → Billing → Customer portal**: enable it, and allow cancel,
   update payment method, and invoice history. Set the return URL to
   `https://<domain>/pricing`.
6. **Settings → Subscriptions and emails**: turn on Smart Retries, email
   receipts for successful payments, and failed-payment emails. Set "after
   all retries fail" → *cancel subscription* (that triggers the downgrade).
7. Local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
   (use the `whsec_` it prints), then buy with card `4242 4242 4242 4242`.
   Confirm: Pro activates, the portal cancel downgrades you, and the report downloads.
8. Run the DB migration (`npm run db:migrate`, or `db:push` on a fresh DB;
   note that the original 0000–0002 `.sql` files were not in the upload, only
   their snapshots, so on a brand-new database use `npm run db:push` against
   `db/schema.ts`).
9. Switch to Live mode: recreate the products/prices/webhook in live mode and
   swap all four Stripe vars.
10. If anyone paid under the old token flow, cancel/refund or migrate them
    by hand in Stripe. The migration keeps them on Pro, but there's no
    Stripe subscription behind it.

---

## 4. Hosting

The server is a **long-running Node process** (Hono via `@hono/node-server`,
`npm start` → `dist/boot.js`). It also keeps in-memory state that a
serverless platform would lose or split between instances: the USPTO cache,
the ppubs session, and the per-minute API rate limiter. It loads `pdfkit`
from `node_modules` at runtime and needs **MySQL** (Drizzle `mysql2`, MySQL
dialect).

**Recommendation: Railway** (or Render or Fly.io). Run one Node service with
`npm run build` then `npm start`, add a Railway **MySQL** plugin, and set
`DATABASE_URL` from it. About $5 to $20/month at launch. Point
markcitadel.com (Cloudflare) at it with a CNAME.

Vercel isn't a good fit as-is: the in-memory limiter and cache break across
serverless instances, PDF generation plus USPTO retries can hit function
time limits, and Vercel has no MySQL (you'd need PlanetScale or another
external MySQL, or a port to Postgres/Neon). Move only if you shift the
cache and rate limits to Redis/Upstash.

**Blocker before self-hosting:** login is "Sign in with Kimi" OAuth, tied to
the Kimi platform app (`APP_ID`, `KIMI_AUTH_URL`). Off that platform you need
your own auth: Auth.js, Clerk, Lucia, or simple email magic links. The user
table keys on `unionId`, so map the new provider's id into it. The DB on the
Kimi platform is also platform-managed, so export your data before moving.

---

## 5. Go-to-market (small business owners naming companies)

**Positioning:** "Check your business name before you print the truck wrap."
It's free to check and $29 for the report you hand your partner or attorney.
Lead with the report and the attorney intro, not the API.

1. **SEO pages: "Is [name] trademarked?"**
   - Generate static or ISR pages like `/is/[name]-trademarked` for popular
     and long-tail names (common home-service names, "[city] plumbing",
     trending startup words). Each shows the live count, a domain check, and
     the CTA. Pull candidate names from Google Search Console queries and
     from USPTO's newest filings.
   - Write pillar articles: "How to check if a business name is
     trademarked," "LLC name vs trademark (Texas)," "Can I use a name if the
     LLC is registered but not trademarked?" Make them state-specific, one
     per state, starting with TX.
   - Add `FAQPage` schema, internal links into /namecheck, and fast pages.
2. **Partnerships**
   - **LLC formation and registered-agent services** (Northwest, ZenBusiness
     affiliates, local CPAs and formation attorneys): embed the name check
     via the API or MCP, or rev-share the $29 report (for example 30%).
   - **Trademark attorneys and filing firms:** sell the leads from
     `attorney_leads` per lead ($50 to $150) or on a flat monthly fee.
     Check the state bar rules on lawyer referral fees first. Many states
     restrict a lawyer paying for a referral, so the safest structure is a
     flat advertising or marketing fee rather than a per-matter cut.
   - Domain registrars, logo designers, and print shops (cross-promo).
3. **TruDan clients (fastest first revenue)**
   - Offer a "brand name check" as a line item in every new-site or
     rebrand proposal for home-service clients. Bundle the report at cost,
     or include it in a "Launch Kit."
   - Put a co-branded "Check your business name" widget on TruDan's site
     and blog.
4. **Channels:** local Facebook small-business groups, Nextdoor business
   pages, SBA/SCORE workshops, and r/smallbusiness and r/Entrepreneur
   (answer naming questions helpfully). A $5/day Google Ads test on
   "is [x] trademarked" and "trademark search" keywords tells you the
   report's conversion rate.
5. **Later:** a $10–15/month trademark-watch plan (the Watch/Alerts code
   already exists) and an annual Pro.

**Metric to watch:** name checks → report checkout rate (aim for 2–5%) and
leads per 100 checks.

---

## 6. Remaining risks

- **Auth is platform-bound** (Kimi OAuth). You have to swap it to self-host.
- **Trademark data isn't from an official API** (tmsearch internal
  endpoint). Retries and stale cache soften outages, but a USPTO change can
  break search. Long-term fix: index the bulk data yourself (see above).
- **Report delivery:** the PDF is regenerated live on each download (data
  can change, and if USPTO is down a download can show "data unavailable").
  There's no "email me my report" yet (Stripe sends only the receipt), and
  the download link is a bearer link. Next step: store the PDF in S3/R2 at
  purchase time and email it with Resend/Postmark.
- **Legal:** the Terms and disclaimers were written by an AI, not a lawyer.
  Get an attorney review, especially for the referral-fee arrangement (state
  bar rules), privacy for stored leads (add a Privacy Policy), and the
  refund policy.
- **Migrations:** the original `0000–0002` SQL files are missing from the
  upload (only snapshots). `0003` was hand-written, and its drizzle snapshot
  wasn't regenerated. Run `npx drizzle-kit generate` against a dev DB to
  resync before the next schema change.
- **In-memory rate limits and cache** assume a single server instance.
- **Not tested against live Stripe or a live database.** Only typecheck and
  build were verified. Run the Stripe test-mode checklist above before
  going live.
- **Competition:** free USPTO search and Trademarkia exist. The moat is
  distribution (SEO, partners, TruDan) and the bundle (report plus attorney
  intro), not the data.
