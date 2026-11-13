# লুটপাট বাজার — LootPat Bazar

Bangladesh-first premium e-commerce storefront with a dark, glassy brand system. Built with React 19, TypeScript, Vite and Tailwind CSS v4, delivered as static files through Qoder Sites with one Deno Edge Function for the API.

## Status — Step 10 of 10 (feature complete)

Step 1 delivered the design system, bilingual shell, 3D hero and home sections.

Step 2 delivered the data layer and application-owned authentication:

- PostgreSQL schema in `database/001_init.sql` (`app.*`: roles, permissions, users, sessions, auth limiter, districts, categories, products, images, variants)
- Idempotent seed: 6 roles, 22 permissions, 6 categories, 20 bilingual products, 64 districts across 8 divisions
- PBKDF2-HMAC-SHA256 (600k iterations) password hashing, opaque session tokens stored only as SHA-256 digests, `__Host-` HttpOnly cookie in production
- Server-enforced RBAC (owner / admin / manager / staff / viewer / customer), owner-only team changes and a single-owner database index
- SQL-backed fixed-window rate limits for login, setup and registration; exact-Origin CSRF checks; zod validation on every route
- Public API: catalog categories/products, districts, auth register/login/logout/me, owner team management
- React auth UI: sign in, register, account overview and the staff team/access screen

Step 3 delivered the catalogue experience on live API data:

- `/shop` with server-side search, category/brand/price/rating/stock/variant filters and six sort modes; filter state lives in the URL so every view is shareable
- `/product/:slug` with variant picker (price, stock and SKU update in place), gallery lightbox, district delivery estimate for all 64 districts, related products and recently viewed
- Debounced, typo-tolerant Bangla/English instant search in the header dialog
- Wishlist (`/wishlist`) and a three-product comparison tray, both persisted locally
- Product cards with hover detail, quick add, wishlist heart and compare tick; home page and flash deal now read real prices and stock from the API

Step 4 delivered the cart, one-page checkout and cash-on-delivery ordering:

- `/cart` with variant-aware line items, quantity steppers, free-delivery progress and a district-based delivery estimate
- `/checkout`: phone-first contact form, all 64 districts grouped by division, optional thana/note, COD with the configured limit, coupon preview and a live order summary
- Server-authoritative order creation: prices, discount, shipping and totals are recomputed from the database; stock is reserved with compare-and-swap updates and restored if anything fails; duplicate submits are collapsed by idempotency key
- `/order/:number` confirmation with a private lookup token (also persisted locally), itemised totals, order journey timeline and estimated arrival
- `/track` recovery by order number plus the matching phone, and an order history block on `/account` for signed-in customers
- Coupons `WELCOME10` (10%, min ৳1,000) and `FREESHIP` (min ৳1,500) are seeded; free delivery starts at ৳2,500 and COD is capped at ৳10,000
- Rate limits for checkout per IP and per phone, coupon validation, order lookup and tracking

Step 5 delivered the owner admin panel:

- Shared staff shell at `/admin` with permission-aware navigation; anonymous visitors go to sign-in, non-staff accounts see an access-denied screen, and the audit log is only linked for the owner
- Dashboard with today's orders and revenue, open work, low stock, active products, customer count, a seven-day trend and the newest orders
- `/admin/orders` kanban for pending → confirmed → packed → shipped → delivered with drag and drop, an advance button, a detail sheet (items, totals, address, history), owner-only payment overrides and server-enforced transitions; cancelling restocks reserved units exactly once
- `/admin/products` with debounced search, status filters, stock and variant counts, edit/view/archive actions and archive confirmation
- Four-step product editor (`/admin/products/new`, `/admin/products/:id/edit`): basics, variants, price/media/badge, review — saved drafts cannot be deleted variant-by-variant, so history stays intact
- CSV bulk import (up to 50 rows) from file or paste with a downloadable template, per-row skip reasons mapped back to the original CSV line, and an optional publish switch
- Owner-only audit log at `/admin/audit` recording every product, order, payment and team change with actor, IP, entity and a JSON detail block
- New migration `database/004_admin.sql` adds `app.audit_logs` and the order-status index; the fake dev DB mirrors the same routes

Step 6 delivered online payments, courier booking and SMS notifications:

- Pluggable payment providers (bKash, Nagad, SSLCommerz) with `PAYMENTS_MODE=sandbox` by default; a gateway is sellable only when its owner-only database flag is on and (in live mode) its credentials exist
- `/pay/:number` sandbox checkout completes a provider event signed with `WEBHOOK_SECRET` and settles it through the same `settleEvent` path as a real webhook — idempotent on `(provider, event_id)`, with amounts read from the persisted order total
- Webhooks are rejected without an Origin header only for `/api/payments/webhook/:provider`; signatures cover `<unix seconds>.<raw body>` and expire after five minutes; forged/stale signatures and amount mismatches leave the order unpaid
- `/order/:number` can start (or resume) a payment session with the private lookup token and shows a paid banner or failure state; `/admin/orders` adds a courier panel
- Courier adapters for Pathao, RedX and Steadfast plus always-available manual booking; assignment is allowed only from confirmed/packed/shipped, writes tracking, moves the order to shipped with an audit entry and an `order.shipped` SMS
- `/admin/settings` lets staff edit store identity, delivery charges, free-delivery threshold and the COD limit; payment gateway switches are owner-only and never expose secrets, which stay in environment variables
- SMS is best-effort and log-only by default (`app.sms_log`); a generic HTTP provider is used when `SMS_PROVIDER_URL` is configured
- New migration `database/005_payments_courier_sms.sql` adds payment sessions, webhook events, the SMS log and courier columns

Step 7 delivered live support chat with an FAQ-grounded assistant:

- Floating support bubble on every storefront page (hidden inside `/admin`): start form with an optional order number, quick FAQ suggestions, WhatsApp and phone shortcuts and a live office-hours chip
- The assistant answers delivery, payment, COD, return, cancellation, coupon and warranty questions from the database FAQ plus current store settings; it never invents prices
- Order-status answers require both the order number and the phone used at checkout (constant-time compare), and the reply omits the customer's name and address so a guessed number cannot leak another customer's data
- Handoff moves the conversation to the staff queue with a 15-minute first-response SLA; the assistant stays silent while a human owns the chat, and WhatsApp/call links stay available
- Conversations are addressed by an opaque token (stored only as a SHA-256 digest); the browser keeps it locally, and resolved conversations reject new customer messages
- `/admin/support` inbox with status filters and counts, customer/order search, SLA badges, the full thread, linked order snapshot, staff assignment, canned replies, new canned replies and closing; every reply, assignment, close and canned-reply creation writes an audit entry
- `support.read` / `support.write` permissions: viewers can read the inbox, staff write, and customers reach only the token-scoped routes; chat start, send, handoff and staff reply are rate-limited
- New migration `database/006_support.sql` adds support conversations, messages, canned replies and FAQ entries

Step 8 delivered marketing, reviews and customer segments:

- Photo reviews on `/product/:slug` with a live summary, star breakdown, verified-buyer badge, helpful votes and store replies; a review needs a delivered order containing that product, one review per order line, and photos are magic-byte checked, EXIF-stripped and capped at 300 KB
- Spin-the-wheel welcome discount (`/` home) that pays once per visitor, claims the visitor before minting anything, and stores the prize as a normal coupon
- Loyalty points on delivered orders, review rewards, birthday coupon and a customer account card with balance, value, ledger and a points-to-coupon redeem dialog
- Flash sales drive the home deal card and the checkout price: the server applies the sale price, so a client-sent price is rejected outright
- Back-in-stock alerts from the out-of-stock product block, plus an SMS reminder request from the cart with explicit consent
- One-click marketing unsubscribe link in the footer that writes a suppression row and opts the account out
- `/admin/reviews` moderation (approve/reject/reply, counts) and `/admin/customers` (VIP/inactive/new segments derived from orders, lifetime value, order history, notes, block/unblock — a blocked phone cannot check out)
- `/admin/marketing` with coupons (percent/fixed/free delivery, limits, expiry), flash sales, spin-wheel configuration, SMS/email campaigns with audience counts and cart-reminder history, and home banners
- Marketing writes require `marketing.write` / `customers.write` / `reviews.write`; viewers are read-only on the server, and every mutation is audited
- New migration `database/007_marketing.sql` adds reviews, votes, flash sales, spin prizes, the loyalty ledger, customer notes/blocks, stock alerts, campaigns, cart reminders and suppressions

Step 9 delivered audit logging, backups, two-step verification, team controls and privacy:

- TOTP two-step verification (RFC 6238, SHA-1, 6 digits, 30-second step, ±1 window) with base32 secrets, 10 single-use recovery codes stored only as SHA-256 digests, and a status endpoint; owner and admin roles must enrol before any permissioned admin API responds
- Two-step sign-in: password returns a five-minute challenge token (no session cookie), `/api/auth/login/2fa` accepts an app code or recovery code, caps failures at five and is rate-limited per challenge and per IP; recovery codes are consumed exactly once
- `/admin/security` for every staff member: 2FA setup with secret + otpauth link and recovery codes, recovery-code regeneration, self-disable (blocked for required roles), password change that revokes every other session, owner-only JSON backups, the admin IP allowlist and audit-log export
- Owner-only team controls at `/admin/team` now include password reset and 2FA reset for other staff, with a 2FA on/off badge per member; both actions are audited
- `/admin/audit` gained action and keyword filters, a filtered/total count and JSON export of the filtered view; new audit actions cover sign-in, 2FA success/failure, password changes, team resets, backups, settings, account deletion and customer exports
- Anonymous tracking and delivery still work without an account, but customers can download all of their data (`/api/account/data-export`) and delete their account (`/api/account/delete`, password + literal `DELETE`); deletion anonymises name/phone/email, suspends the account and keeps order records for accounting
- Owner-only customer data export by phone for support requests, and an optional `/admin` IP allowlist (exact IPs and CIDR) enforced on every admin route while storefront and health routes stay open
- A public `/privacy` page explains what is collected, payments and card data, cookies, sharing, retention, rights and security; it is linked from the footer, sign-in and the account privacy panel
- New migration `database/008_security.sql` adds TOTP secrets, recovery codes, login challenges, backups and the security settings row

Step 10 delivered performance, accessibility and the release guide:

- Route-level code splitting: every page is its own lazy chunk behind one `Suspense` boundary, so the home screen ships only the shell and home sections. The entry bundle dropped from 1.09 MB to 226 kB (61 kB gzip) and the three.js hero stays in a separate 983 kB chunk that loads after first paint
- React and motion sit in long-lived `react-vendor` / `motion-vendor` chunks so app edits do not invalidate them
- Accessibility pass: `aria-current="page"` on the active main-nav item, focus moved to `#main` on every client-side route change, visible focus rings, a skip link, labelled icon-only buttons, `aria-pressed` on toggles and dialogs that always carry a title
- Reduced motion is honoured everywhere — Lenis smooth scrolling, reveals and the hero fall back to instant transitions
- Store identity is read from one place: the footer, support widget and privacy page read `/api/checkout/config`, so `/admin/settings` edits update all three
- `Logo` now loads a real brand file from `public/logo.png` or `public/logo.svg` and falls back to the built-in gradient mark when neither exists
- Product media spec is stated in the admin hint and enforced visually by the square card frame: 1:1 WebP, 1200×1200 plus a 450×450 thumbnail, product centred on a dark or transparent background, so new listings match the seeded catalogue
- Deployment guide, shop-detail review table and post-launch checklist below

## Shop details to review before publishing

Everything below is seed content. Edit it in `/admin/settings` (owner or `settings.write`) on a running site — the footer, support widget, privacy page and checkout read the API, so changes appear on reload. The seed file `functions/seed-data/store.mjs` only matters for a fresh database; keep it in sync if you want a reset to reproduce the same identity.

| Detail | Current value | Change in | Appears on |
| --- | --- | --- | --- |
| Store name (Bangla) | লুটপাট বাজার | `/admin/settings`, seed `functions/seed-data/store.mjs:5` | Header and footer logo, page titles |
| Store name (English) | LootPat Bazar | `/admin/settings`, seed `:6` | Logo subtitle, meta title |
| Hotline / phone | +8801410286822 | `/admin/settings`, seed `:7` | Footer contact, chat widget call + WhatsApp, privacy contact |
| Support email | adittoo2026@gmail.com | `/admin/settings`, seed `:8` | Footer `mailto:`, privacy contact |
| Address (Bangla) | পুরান ঢাকা, বাংলাদেশ-১১০০ | `/admin/settings`, seed `:9` | Footer help column |
| Address (English) | Old Dhaka, Bangladesh 1100 | `/admin/settings`, seed `:10` | English footer |
| Support hours | শনি–বৃহস্পতি, সকাল ১০টা – রাত ৮টা | `src/lib/i18n.tsx` (`footer.hours`, `chat.officeHours`) and the contact FAQ in `functions/seed-data/support.mjs:119` | Footer, chat header, FAQ answer |
| WhatsApp | derived from the phone setting | `/admin/settings` — digits only | Chat widget |
| Trade licence | blank (hidden by request) | `/admin/settings`, seed `:11` | Not displayed anywhere |
| TIN | blank (hidden by request) | `/admin/settings`, seed `:12` | Not displayed anywhere |
| Delivery — Dhaka | ৳80 | `/admin/settings` | Checkout summary, order totals |
| Delivery — outside Dhaka | ৳120 | `/admin/settings` | Checkout summary, order totals |
| Free delivery from | ৳2,500 merchandise value | `/admin/settings` | Cart progress bar, checkout |
| Cash-on-delivery limit | ৳10,000 | `/admin/settings` | Checkout payment step |
| Payment methods | COD on; bKash/Nagad Send Money (manual) on; bKash/Nagad gateways on (sandbox); SSLCommerz off | `/admin/settings` (gateway switches are owner-only) | Checkout, footer badges |
| bKash / Nagad number | 01410286822 | `/admin/settings` → bKash/Nagad number, seed `:26` | Footer contact column |
| Demo notice | removed — real details are live | `src/lib/i18n.tsx` | — |

Use a mobile number in international form (`+8801410286822`); the WhatsApp link is built from its digits. The support hours are copy, not a setting, so tell me the real opening hours and I will update all three places together.

### Manual bKash/Nagad (admin-confirmed)

Checkout offers **bKash/Nagad (Send Money)**: the customer sends the exact total to the wallet number from `/admin/settings` → *bKash/Nagad number* (seed `store.payment_number`), keeps the order number as the reference, and the order stays `unpaid`. The owner opens the order sheet in `/admin/orders`, checks the transfer, then sets payment status to `paid`; the change is audited. This path needs no gateway credentials.

The bKash/Nagad **gateway** buttons stay in sandbox until `PAYMENTS_MODE=live` and merchant credentials exist, and checkout shows a notice that no money is charged there. To switch, set `PAYMENTS_MODE=live` plus `BKASH_*` / `NAGAD_*` secrets and deploy migration `009_manual_payments.sql`.

## Logo and product media

**Logo.** The shop logo is `public/logo.svg` — the gradient bag tile from `lootpat-bazar-logo-3d.svg`, cropped to a transparent square so it stays crisp at the 36 px header size. `src/components/common/Logo.tsx` tries `logo.png`, then `logo.svg`, then falls back to the built-in gradient mark, so replacing the file is enough — no code change. The bilingual wordmark next to it is rendered as HTML text. `public/favicon.svg` uses the same mark (referenced from `index.html:18`).

**Product images.** New listings are entered in the product editor (`/admin/products/new`) as a site path or HTTPS URL. To match the seeded catalogue:

- 1:1 square WebP, 1200×1200 for the full image and 450×450 for the thumbnail (the card uses a 450w/900w `srcSet`)
- Product centred, roughly 10–12% empty space on every side, so the square crop and hover zoom never cut the object
- Dark (`#0B0B10`) or transparent background with soft rim light and a subtle floor shadow — that is what gives the catalogue its 3D-futuristic look; a bright white studio shot will look pasted on
- Keep the file under ~300 KB; the card and product gallery both request the 450w version first

The seeded images live in `public/products/` as matching `-450.webp` / `-900.webp` pairs, and `npm run assets:webp` converts new source art.

## Develop

Use a Node version accepted by `package.json` (`^22.13.0 || >=24.0.0`).

```sh
npm ci
npm run dev
```

Use the loopback URL printed by Vite. The frontend proxies `/functions/v1/app` to the local API server, so start both in separate terminals:

```sh
npm run dev:api   # Node dev server on http://127.0.0.1:8000 with an in-memory DB
npm run dev       # Vite on http://127.0.0.1:5173
```

The dev API applies the baseline seed automatically and creates demo staff accounts:

| Role | Email | Password |
| --- | --- | --- |
| Owner | `owner@lootpat.test` | `LootPat#2026` |
| Admin | `admin@lootpat.test` | `LootPat#2026` |
| Viewer | `viewer@lootpat.test` | `LootPat#2026` |

Registration (`/register`) creates customer accounts; staff accounts are added from `/admin/team` by the owner.

```sh
npm run build          # tsc --noEmit + static build into dist/
npm run preview
npm run test:api       # seed + auth/RBAC + catalog + checkout/order + admin + payment/courier + support + marketing + security tests against the in-memory DB
```

`npm run check:function` type-checks the Deno entry with `deno check`. The platform SDK at `functions/_qoder/backend.mjs` only exists once Qoder Sites creates the backend, so locally either run it after a deploy preparation or copy `functions/` to a temp directory with a three-function stub of that module and check there. `npm run dev:api` does not need Deno: it runs the same `functions/app.mjs` router on Node with an in-memory database.

## API routes

All routes are served under `/functions/v1/app`.

| Method | Route | Access |
| --- | --- | --- |
| POST | `/api/setup` | `x-setup-token` header; idempotent seed + first owner |
| POST | `/api/auth/register` | public, rate-limited |
| POST | `/api/auth/login` | public, rate-limited; staff with 2FA get `{ twoFactorRequired, challengeToken }` instead of a session |
| POST | `/api/auth/login/2fa` | challenge token; app code or recovery code, rate-limited per challenge and per IP |
| POST | `/api/auth/logout` / `/api/auth/logout-all` | session |
| GET | `/api/auth/me` | session |
| GET | `/api/auth/2fa/status` | session |
| POST | `/api/auth/2fa/setup` | session (`password`); returns the base32 secret and otpauth link |
| POST | `/api/auth/2fa/enable` \| `/api/auth/2fa/recovery` | session (`password`, `code`); returns 10 new recovery codes |
| POST | `/api/auth/2fa/disable` | session (`password`, `code`); refused for owner/admin |
| POST | `/api/auth/password` | session (`currentPassword`, `newPassword`); revokes every other session |
| GET | `/api/catalog/categories` | public |
| GET | `/api/catalog/products` | public (`q`, `category`, `brand`, `minPrice`, `maxPrice`, `rating`, `inStock`, `option`, `sort`, `featured`, `limit`) |
| GET | `/api/catalog/products/:slug` | public |
| GET | `/api/locations/districts` | public |
| GET | `/api/checkout/config` | public store identity, delivery charges, COD limit and enabled payment methods |
| POST | `/api/coupons/validate` | public, rate-limited (`code`, `subtotalPaisa`) |
| POST | `/api/orders` | public guest or session; validated totals, stock reservation, idempotent |
| POST | `/api/orders/track` | public, rate-limited (`orderNumber`, `phone`) |
| GET | `/api/orders/:orderNumber` | lookup token, matching session owner, or 404 |
| POST | `/api/payments/session` | order lookup token (`orderNumber`, `lookupToken`, `provider`); rate-limited |
| GET | `/api/payments/session/:id` | sandbox session info with the session token |
| POST | `/api/payments/session/:id/complete` | sandbox only; signs a local provider event |
| POST | `/api/payments/verify` | order lookup token; provider reference re-check |
| POST | `/api/payments/webhook/:provider` | signed gateway webhook (no Origin header check) |
| GET | `/api/account/orders` | session |
| GET | `/api/account/profile` / `PATCH` | session (`name`, `birthDate`) |
| GET | `/api/account/data-export` | session; downloads every record tied to the account |
| POST | `/api/account/delete` | session (`password`, `confirm: "DELETE"`); anonymises the account, keeps order records |
| GET | `/api/catalog/products/:slug/reviews` | public approved reviews, summary and breakdown |
| POST | `/api/reviews` | public, rate-limited; needs the delivered order number and its phone |
| POST | `/api/reviews/:id/helpful` | public, rate-limited (`voterKey`); one vote per voter |
| GET | `/api/marketing/flash-sale` | public live sale with server-computed prices |
| GET | `/api/marketing/banners` | public active banners |
| GET | `/api/marketing/spin` / `POST` | public spin config / one play per `visitorKey` |
| POST | `/api/marketing/back-in-stock` | public, rate-limited (`productId`, `phone`) |
| POST | `/api/marketing/unsubscribe` | public, rate-limited (`contact`) |
| POST | `/api/marketing/cart-reminder` | public, rate-limited; requires `consent: true` |
| GET | `/api/marketing/loyalty` / `POST /redeem` | customer session; redeem in steps of 100 points |
| POST | `/api/support/start` | public, rate-limited (`message` plus optional `name`, `phone`, `orderNumber`); returns the conversation token |
| POST | `/api/support/session` | conversation token; returns the thread |
| POST | `/api/support/messages` | conversation token, rate-limited; the assistant replies while the chat is bot-owned |
| POST | `/api/support/handoff` | conversation token, rate-limited; queues the chat for staff (idempotent) |
| GET | `/api/support/faq` | public localized FAQ list (`locale`) |
| GET | `/api/admin/support` | `support.read` (`status`, `q`); conversations, counts, staff and canned replies |
| GET | `/api/admin/support/:id` | `support.read`; thread, linked order and SLA |
| POST | `/api/admin/support/:id/reply` | `support.write`; body or canned reply, records first response |
| POST | `/api/admin/support/:id/assign` | `support.write`; active staff only |
| POST | `/api/admin/support/:id/close` | `support.write`; idempotent, appends a system message |
| GET | `/api/admin/support/canned` | `support.read` |
| POST | `/api/admin/support/canned` | `support.write` |
| GET | `/api/admin/settings` | `settings.read` |
| PATCH | `/api/admin/settings` | `settings.write`; payment flags additionally require owner (`payments.manage`) |
| GET | `/api/admin/team` | `team.read` |
| POST | `/api/admin/team` | owner (`team.write`) |
| PATCH | `/api/admin/team/:id` | owner; role/status change revokes that user's sessions |
| POST | `/api/admin/team/:id/revoke-sessions` | owner |
| POST | `/api/admin/team/:id/password` | owner; resets a staff password and revokes their sessions |
| POST | `/api/admin/team/:id/2fa-reset` | owner; clears the factor so the member must enrol again |
| GET | `/api/admin/dashboard` | `orders.read` |
| GET | `/api/admin/orders` | `orders.read` (`status`, `q`) |
| GET | `/api/admin/orders/:orderNumber` | `orders.read` |
| PATCH | `/api/admin/orders/:orderNumber/status` | `orders.write`; transitions and cancellation restock are server-checked |
| PATCH | `/api/admin/orders/:orderNumber/payment` | owner (`payments.manage`) |
| PATCH | `/api/admin/orders/:orderNumber/courier` | `orders.write`; manual or configured adapter, requires confirmed/packed/shipped |
| GET | `/api/admin/products` | `products.read` (`q`, `status`) |
| GET | `/api/admin/products/:id` | `products.read` |
| POST | `/api/admin/products` | `products.write` |
| PATCH | `/api/admin/products/:id` | `products.write`; variants update by id and new ones get unique auto SKUs |
| POST | `/api/admin/products/:id/archive` | owner (`data.delete`) |
| POST | `/api/admin/products/import` | `products.write`; max 50 rows with per-row skip reasons |
| GET | `/api/admin/customers` | `customers.read` (`q`, `segment`) |
| GET | `/api/admin/customers/:phone` | `customers.read`; profile, orders and notes |
| PATCH | `/api/admin/customers/:phone` | `customers.write`; note, block, unblock |
| GET | `/api/admin/reviews` \| PATCH `/:id` | `reviews.read` / `reviews.write`; status and reply |
| GET | `/api/admin/coupons` \| POST | `marketing.read` / `marketing.write` |
| PATCH | `/api/admin/coupons/:id` | `marketing.write` |
| GET | `/api/admin/flash-sales` \| POST | `marketing.read` / `marketing.write` |
| PATCH | `/api/admin/flash-sales/:id` | `marketing.write` |
| GET | `/api/admin/spin` \| PATCH | `marketing.read` / `marketing.write` |
| GET | `/api/admin/campaigns` \| POST | `marketing.read` / `marketing.write`; SMS is sent, email is recorded |
| GET | `/api/admin/banners` \| POST | `marketing.read` / `marketing.write` |
| PATCH | `/api/admin/banners/:id` | `marketing.write`; on/off |
| GET | `/api/admin/audit` | owner (`audit.read`; `limit`, `action` prefix, `q`, `from`, `to`) |
| GET | `/api/admin/audit/export` | owner (`data.export`); same filters, JSON attachment |
| GET | `/api/admin/backups` \| POST | owner (`data.export`); list / create a JSON snapshot |
| GET | `/api/admin/backups/:id` | owner; downloads the stored backup file |
| GET | `/api/admin/customers/:phone/export` | owner (`data.export`); customer record, orders and notes as JSON |

Errors return `{ "error": "<code>" }`; login, setup, checkout and tracking failures are rate-limited with `Retry-After`. Order creation never trusts client totals and rejects unavailable payment methods (`payment_method_unavailable`) until they are enabled.

## Project structure

```
src/
  components/     layout, hero, home sections, product cards, compare tray, cart, search, auth shell, support chat widget, marketing widgets (reviews, spin wheel, banner, stock alert, cart reminder), common primitives
  pages/          home sections, shop, product, cart, checkout, order, pay, track, wishlist, login, register, account, privacy, 404 — every page is a lazy route chunk
  pages/admin/    staff shell, dashboard, order kanban, product manager, product wizard, settings, team, security, audit, support inbox, reviews, customers and marketing pages
  lib/            i18n, theme, catalog, cart, checkout/orders, wishlist, compare, locations, router, auth, admin, support, marketing, API client
  hooks/          countdown hook
  globals.css     design tokens + Tailwind theme mapping
database/
  001_init.sql    reviewed migration for the app schema
  002_catalog.sql variants, search indexes and catalogue columns
  003_orders.sql  settings, coupons, orders, order items, status history, payments, redemptions
  004_admin.sql   audit log table and the order-status index
  005_payments_courier_sms.sql payment sessions, webhook events, SMS log and courier columns
  006_support.sql support conversations, messages, canned replies and FAQ entries
  007_marketing.sql reviews, flash sales, spin prizes, loyalty, customers, campaigns and alerts
  008_security.sql TOTP secrets, recovery codes, login challenges, backups and security settings
  009_manual_payments.sql adds the manual bKash/Nagad "wallet" payment method to orders
functions/
  index.ts        Deno entry (createSiteContext + app router)
  app.mjs         routes, auth, RBAC, catalog, order and admin handlers
  admin.mjs       dashboard, kanban transitions, product CRUD/import/archive and audit queries
  admin-marketing.mjs coupons, flash sales, spin config, campaigns, review moderation, customers and banners
  marketing.mjs   reviews, flash pricing helpers, spin, loyalty, stock alerts, unsubscribe and cart reminders
  audit.mjs       best-effort audit append used by every admin mutation
  checkout.mjs    settings-driven totals, coupons, flash prices, stock reservation, order lookup
  payments.mjs    payment sessions, sandbox completion, signed webhooks and settlement
  payment-providers.mjs gateway config, availability and HMAC verification
  courier.mjs     manual and Pathao/RedX/Steadfast courier booking
  sms.mjs         best-effort SMS with the log-only default provider
  settings.mjs    owner-editable store settings and environment status
  assistant.mjs   FAQ-grounded bilingual support assistant and order-status answers
  support.mjs     token-scoped customer chat and the staff support inbox
  validate.mjs    zod schemas for every route input
  limiter.mjs     fixed-window SQL rate limits
  seed.mjs        idempotent baseline seed
  seed-data/      roles, permissions, catalogue, districts, store settings, coupons, marketing seeds
  vendor/zod/     self-contained zod for the packaged Function
dev/
  function-node.mjs   local API server with an in-memory database
  test/               seed, auth/RBAC, catalog, order, admin, payment/courier, support and marketing integration tests
```

## Configuration

Customer-facing copy lives in `src/lib/i18n.tsx`. Prices, stock, variants, headlines, delivery charges and the COD limit come from the API and database settings instead of fixtures. Runtime secrets are never bundled into the frontend.

Set these as Qoder Sites Function environment values (see `.env.example`):

- `APP_ORIGIN` — exact public origin used for cookie and CSRF checks
- `SETUP_TOKEN` — one-time token for `POST /api/setup` (also seeds the districts/products)
- `DATABASE_URL`, `SESSION_SECRET` — platform-provided when the backend is enabled
- `PAYMENTS_MODE` — `sandbox` (default) or `live`; sandbox needs no gateway credentials
- `WEBHOOK_SECRET` — HMAC secret for payment webhooks (`BKASH_WEBHOOK_SECRET`, `NAGAD_WEBHOOK_SECRET`, `SSLCOMMERZ_WEBHOOK_SECRET` can override it)
- `BKASH_*`, `NAGAD_*`, `SSLCOMMERZ_*` — live gateway credentials; only their presence is reported to the admin UI
- `PATHAO_*`, `REDX_*`, `STEADFAST_*` — optional courier API URL and key per adapter
- `SMS_PROVIDER_URL`, `SMS_API_KEY`, `SMS_SENDER_ID` — optional SMS HTTP provider; without them messages are logged to `app.sms_log`

Payment gateway on/off flags are stored in the database and toggled only by the owner at `/admin/settings`. Do not add real credentials to the repository.

## Deploy

The site is static files plus one Deno Edge Function on a managed Postgres backend, so a release has five steps.

1. **Environment.** Add the values from `.env.example` as Qoder Sites Function secrets: `APP_ORIGIN` (the exact public HTTPS origin, e.g. `https://lootpatbazar.qoder.site`), `SETUP_TOKEN`, `SESSION_SECRET`, `WEBHOOK_SECRET`. Payment, courier and SMS credentials are optional; without them those integrations simply report as unconfigured. Nothing from this file is ever bundled into `dist/`.
2. **Database.** Apply `database/001_init.sql` through `009_manual_payments.sql` in order with the Sites migration tool. DDL is idempotent and confined to the `app` schema.
3. **Build.** `npm run build` runs `tsc --noEmit` and then writes `dist/`. Use `dist` as the site's `webDirectory`; `functions/index.ts` is the Function entry.
4. **Publish.** Prepare and publish the site. Every API call is same-origin under `/functions/v1/app`, which is why `APP_ORIGIN` must match the published origin exactly or cookies and CSRF checks fail.
5. **First run.** Call setup once with the token; it seeds the catalogue, settings, coupons and FAQ and creates the single owner account.

```sh
curl -X POST "https://<your-domain>/functions/v1/app/api/setup" \
  -H "content-type: application/json" \
  -H "x-setup-token: $SETUP_TOKEN" \
  -d '{"owner":{"name":"Owner","email":"owner@example.com","password":"<12+ characters>"}}'
```

Rotate `SETUP_TOKEN` once setup succeeds. The first admin sign-in forces TOTP enrolment before any permissioned route responds — save the ten recovery codes somewhere offline.

### Post-launch checklist

- [x] `/admin/settings`: real name, hotline, email, address and delivery charges (see the review table above)
- [x] Logo at `public/logo.svg`, favicon at `public/favicon.svg`
- [x] Demo notice removed — contact details are real
- [ ] Place one COD order end-to-end and advance it through the kanban
- [ ] Track that order from `/track` with its number and phone
- [ ] Sandbox payment on `/pay/:number`, then, only when ready, set `PAYMENTS_MODE=live`, add gateway secrets and let the owner flip the gateway flags
- [ ] Create and download an owner backup from `/admin/security`
- [ ] Optional: `/admin` IP allowlist for staff
- [ ] `npm run test:api` against the deployed API base, plus one 2FA and one recovery-code sign-in

A failed publish leaves the previous release live; nothing is destroyed. Database backups are JSON snapshots in `app.backups`, downloadable from `/admin/security`.

