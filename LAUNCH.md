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
- **Database fields** (now in the Postgres baseline): adds
  `users.plan / stripe_customer_id / stripe_subscription_id / subscription_status / current_period_end`,
  tables `stripe_events`, `report_purchases`, `attorney_leads`, and carries
  existing Pro users over (re-check them against Stripe).

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

## 2. Platform: Supabase + Netlify (second change set)

- **Database:** Supabase Postgres via Drizzle (`drizzle-orm/postgres-js`,
  `prepare: false` for the transaction pooler, one connection per function
  instance). The schema was converted from MySQL: `pgTable`, native enums,
  `bigserial` ids, `timestamptz`, `jsonb`. Upserts now use `onConflictDoUpdate`
  and `onConflictDoNothing`.
  - Fresh baseline migration: `db/migrations/0000_baseline.sql`.
  - Paste-ready SQL: **`supabase/schema.sql`**. It turns on RLS for all 12
    tables with no policies and revokes Data API grants from `anon` and
    `authenticated`, so the browser can't reach any table directly.
  - The old `upgrade_tokens` table was dropped.
- **Auth:** Kimi OAuth is removed completely. Login is now Supabase Auth
  (Google, or an email magic link) on `/login`.
  - The browser sends the Supabase access token as `Authorization: Bearer` on
    every tRPC call. The API verifies it with `jose`, using the project's
    JWKS by default or `SUPABASE_JWT_SECRET` if you set it (older HS256
    projects).
  - On each verified request the API upserts a `users` row keyed by the
    Supabase user id (`auth_id`) and email.
  - Owner/admin is whoever signs in with **`OWNER_EMAIL`**.
- **Hosting:** Netlify. The SPA is served from `dist/public`, and the whole
  API is one Netlify Function, `netlify/functions/api.mts`. That function
  passes the Web Request straight to the existing Hono app (`api/app.ts`),
  so the body stays raw and Stripe signature checks work.
  - It's routed by `config.path = "/api/*"`, plus a `netlify.toml` rewrite
    and the SPA fallback.
- **Serverless-safe state:**
  - USPTO cache → `api_cache` table (6h fresh, 48h stale-if-error, plus a
    small per-instance memo).
  - Per-minute API limits → `rate_limits` table (atomic fixed-window upsert).
  - The ppubs patent session is shared through the cache.
  - Pageviews are now a `/api/pv` beacon, because the CDN serves the HTML.
- **USPTO timeouts on Netlify:** one 8s budget per call with at most 2
  attempts, to stay under the ~10s function limit. A long-running Node
  server still gets 12s × 3.
- A long-running Node server still works (`npm run build && npm start`) if
  you ever leave Netlify.

## 2b. Trademark conflict summary ("is this name taken?")

Searching "citadel" used to return roughly 1,000 pages of raw results. Now
the answer comes first.

- **Server:** `api/services/conflicts.ts`. For each name it runs 5 USPTO
  queries **in parallel**:
  1. Live marks matching an exact phrase, a contains-wildcard, a fuzzy
     match (~1 edit for names of 6+ letters), sound-alike spellings, and the
     individual words of multi-word names (up to 250 marks).
  2. For compound names of 8+ letters, the 5+ letter pieces (so MARKCITADEL
     finds CITADEL), up to 100 marks.
  3. A count of all statuses.
  4. A count of live marks in your classes.
  5. A count of exact live matches.

  All queries go through the Postgres cache (`api_cache`) and serve stale
  results if USPTO is down. Each call stays inside the 8s Netlify budget;
  real runs took 0.3 to 0.8s uncached.
- **Scoring (0–100)** for each live mark is wording similarity × status ×
  class overlap, plus an owner boost:
  - Wording similarity: exact; sound-alike (double metaphone plus an edit
    ratio); contains as a word; near spelling (Levenshtein, stricter for
    short names); your name contains the mark; shares a word.
  - Status: registered counts more than pending.
  - Class overlap with "What's your business?" (default 9, 35, 42, 45).
  - Owner strength: an owner with 5+ live marks for the word adds 10.
    Owners with 15+ are treated as possibly famous, so the class penalty
    mostly drops away.
- **Verdict:** High risk (top score ≥75), Possible conflict (≥40), Looks
  clear, or Unavailable. The response includes counts (total, live, live in
  your classes, exact live), the top 10 flagged marks (at most 2 per owner)
  with reasons, and the top owners. Every response carries a "not legal
  advice" note.
- **API:** `GET /api/v1/trademarks/check?q=NAME&classes=9,35,42,45` (also
  in `/openapi.json`); tRPC `search.trademarkCheck`; MCP tool
  `check_trademark`.
- **UI:**
  - Trademark search now defaults to **Live only**. A class picker and the
    verdict card (counts, who owns the word, top conflicts) sit at the top.
    The raw list is collapsed under "Show all N results".
  - Name check shows the verdict card with the top 5. The paid report
    (verdict, owners, all 10 scored marks with reasons) uses the classes
    the buyer picked, stored in the new `report_purchases.classes` column.
- **DB change:** `db/migrations/0001_report_classes.sql`. A fresh
  `supabase/schema.sql` already includes it. For an existing database, run
  the `ALTER TABLE` at the bottom of that file.
- **Tuning:** thresholds live at the top of the verdict logic in
  `conflicts.ts`. These are heuristics, not legal standards. Review a sample
  of real checks with a partner attorney before marketing the verdicts
  heavily.

## 3. Environment variables

Set these in Netlify (**Site configuration → Environment variables**). For
local dev, put them in `.env` (template: `.env.example`).

| Var | Where it comes from |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → API keys → `anon` / publishable key |
| `SUPABASE_URL` | Same as `VITE_SUPABASE_URL` (server uses it for JWKS) |
| `SUPABASE_JWT_SECRET` | Optional. Only for legacy HS256 projects (API → JWT Settings). Leave empty to use JWKS |
| `DATABASE_URL` | Supabase → **Connect** → *Transaction pooler* URI (port **6543**), password filled in |
| `DATABASE_URL_MIGRATIONS` | Optional, only for `drizzle-kit`: *Session pooler* URI (port 5432) |
| `APP_URL` | `https://markcitadel.com` (or the `*.netlify.app` URL at first) |
| `OWNER_EMAIL` | Your login email (admin plus owner panels) |
| `USPTO_ODP_API_KEY` | data.uspto.gov/apikey |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` of the Netlify webhook endpoint (step 4.4) |
| `STRIPE_PRICE_PRO` | `price_…` recurring $29/month |
| `STRIPE_PRICE_REPORT` | `price_…` one-time $29 |

`VITE_*` vars are baked into the front end at build time, so redeploy after
changing them. All others are read by the function at runtime.

## 4. Step-by-step setup

### 4.1 Supabase project
1. supabase.com → **New project** (pick the US East region, close to Netlify's
   default functions region). Save the database password.
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
   You should see 12 tables under Table Editor, each with RLS "enabled".
   Use this file *or* `npm run db:migrate`, not both.
3. **Connect** (top bar) → copy the **Transaction pooler** string →
   `DATABASE_URL` (replace `[YOUR-PASSWORD]`).
4. **Project Settings → API** → copy the Project URL and the anon key.

### 4.2 Supabase Auth
1. **Authentication → Sign In / Providers → Email:** enabled. Turn on
   "Confirm email". Magic links work with no password.
2. **Authentication → URL Configuration**:
   - Site URL: `https://markcitadel.com` (or your `*.netlify.app` URL)
   - Redirect URLs: `https://markcitadel.com/login*`,
     `https://*.netlify.app/login*` (deploy previews),
     `http://localhost:3000/login*`
3. **Google:**
   - In Google Cloud Console → APIs & Services → Credentials, create an
     OAuth client ID of type *Web application*. Authorized redirect URI:
     `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Set up the OAuth consent screen with the app name, the
     markcitadel.com domain and a privacy policy URL.
   - Paste the client ID and secret into Supabase → Providers → **Google** →
     Enable.
4. **Authentication → Emails → SMTP:** Supabase's built-in mailer is
   rate-limited (a few emails per hour), so plug in Resend, Postmark or SES
   before launch. Optionally customize the magic-link template.

### 4.3 Netlify site
1. Push the repo to GitHub, then Netlify → **Add new site → Import from Git**.
   `netlify.toml` already sets the build command `npm run build:web`, publish
   dir `dist/public`, the functions dir and Node 20.
2. Add every env var from section 3 (scopes: Builds + Functions; use
   different Stripe keys for deploy previews if you like).
3. Deploy. Check `https://<site>/api/v1/health` → `{"ok":true,…}`, then
   sign in with Google and with a magic link. Signing in as `OWNER_EMAIL`
   shows the owner panel on /pricing.
4. **Domain management → Add domain** `markcitadel.com`. In Cloudflare DNS,
   point it at Netlify (CNAME `@` → `<site>.netlify.app`, DNS-only/grey
   cloud), and remove the old redirect rule to kimi.link. Update `APP_URL`
   and the Supabase Site URL to the final domain.

### 4.4 Stripe (test mode first, then live)
1. Products: "MarkCitadel Pro" **$29/month recurring** → `STRIPE_PRICE_PRO`;
   "Name Clearance Report" **$29 one-time** → `STRIPE_PRICE_REPORT`.
2. Developers → API keys → `STRIPE_SECRET_KEY`.
3. Developers → Webhooks → **Add endpoint**:
   **`https://markcitadel.com/api/stripe/webhook`** (or the `*.netlify.app` URL).
   Events: `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed`,
   `charge.refunded`. Copy the signing secret → `STRIPE_WEBHOOK_SECRET`
   → redeploy.
4. Settings → Billing → **Customer portal**: enable cancel, update payment
   method and invoices. Return URL: `https://markcitadel.com/pricing`.
5. Settings → Subscriptions & emails: turn on Smart Retries, successful
   payment receipts and failed-payment emails. "After all retries fail" →
   cancel the subscription.
6. Test with card `4242 4242 4242 4242`:
   - Pro upgrade → the plan flips within seconds.
   - Portal cancel → back to Free.
   - Report purchase → the PDF downloads.
   - The webhook log in Stripe shows 200s.
7. Repeat steps 1–5 in **live** mode and swap the four Stripe env vars.

### 4.5 Local development
`cp .env.example .env`, fill it in (use the same Supabase project or a second
"dev" one), then `npm install && npm run dev` → http://localhost:3000. Test
webhooks with `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
`npx netlify-cli dev` also works if you want to run the real function wrapper.

### 4.6 Existing data
The old Kimi-hosted MySQL can't be exported with the code. Anyone who was
"Pro" under the old token flow has to be re-subscribed through Stripe
Checkout or handled by hand. There are no user accounts to carry over.

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

- **Trademark data isn't from an official API** (tmsearch internal
  endpoint). Retries and the shared stale cache soften outages, but a USPTO
  change can break search. Long-term fix: index the bulk data yourself.
- **Netlify's 10s limit:** a cold start, a DB round-trip and a slow USPTO
  response can add up. Patent fallback (ODP fails, then ppubs) and PDF
  generation are the tightest paths. If you see 502/timeouts, ask Netlify to
  raise the limit (up to 26s on paid plans), or move report generation to a
  Background Function plus storage.
- **The 6 MB request cap** on Netlify functions limits trademark image
  uploads (the old server allowed 50 MB).
- **Report delivery:** the PDF is regenerated on every download, nothing
  emails it (only the Stripe receipt goes out), and the link is a bearer
  link. Next step: store it in Supabase Storage at purchase and email it
  with Resend.
- **Supabase email:** the default SMTP is heavily rate-limited, so set up
  custom SMTP before launch or magic links will fail under load.
- **Legal:** the Terms and disclaimers were written by an AI, not a lawyer.
  Have an attorney review them, especially the referral-fee arrangement
  (state bar rules). A **Privacy Policy** is still missing, and both Google
  OAuth verification and the stored leads require one.
- **Not tested against live Stripe, Supabase or Netlify.**
  - Verified: typecheck, the Vite and server builds, `netlify build
    --offline`, and the bundled function locally (health 200, forged
    webhook 400, signed webhook reaches the handler, pdfkit works inside
    the bundle).
  - Also verified: the schema and every upsert run correctly against an
    embedded Postgres (PGlite).
  - Still to do: run the 4.4 test-mode checklist end to end.
- **Conflict scores are heuristics:**
  - Owner counts come from the sample we fetch (up to 250 live marks), so
    huge words (e.g. "nike", 1,115 live) under-count owners.
  - Design-only marks and translations aren't compared.
  - Sound-alike matching is English-centric.
- **Front-end bundle** is ~860 KB (code-splitting would help mobile load times).
- **Competition:** free USPTO search and Trademarkia exist. The moat is
  distribution and the report-plus-attorney bundle.
