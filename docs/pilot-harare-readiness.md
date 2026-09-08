# Stage 3.6 — Harare pilot readiness (feature freeze)

Feature-frozen DUTS Delivery MVP. This document covers physical-device smoke prep and closed-pilot configuration only. No WhatsApp, EcoCash, merchants, or auto-dispatch.

## 1. Environment separation

| Lane | `APP_ENV` | `NODE_ENV` | Database | Stripe |
|------|-----------|------------|----------|--------|
| Development | `development` | `development` | `duts_gig_dev` (or other Gig-owned) | optional / test |
| Test | `test` | `test` | Gig-owned test DB | optional |
| Pilot | `pilot` | usually `production` | Gig-owned pilot DB | **required** `sk_test_` / `pk_test_` |
| Staging | `staging` | usually `production` | Gig-owned staging DB | **required** test keys |
| Production | `production` | `production` | Gig-owned production DB | live or intentional |

**Hard rule:** Gig/DUTS Delivery must **never** use `duts_whitelabel`. API startup calls `assertGigOwnedDatabase()` and refuses to boot if `DATABASE_URL` contains `duts_whitelabel`.

Other safeguards:

- `APP_ENV=pilot|staging` → Stripe keys required at boot (`assertStripeConfiguredForProduction`)
- Dev payment bypass (`authorize-without-stripe` / publish-without-payment) **always blocked** in pilot/staging
- Mobile “Continue without payment (dev only)” only when `EXPO_PUBLIC_APP_ENV` is not pilot/staging/production **and** API host is localhost
- `DELIVERY_ENABLED=false` disables delivery quote/create without affecting unrelated LOCAL_HELP flows

See root `.env.example` and `deploy/digitalocean/.env.production.example`.

---

## 2. Physical device build / install

### A. Expo Go / USB (LAN) — fastest smoke

1. Start API bound to all interfaces (default `0.0.0.0:4000`).
2. Find your PC LAN IP (e.g. `192.168.1.20`).
3. In `apps/mobile/.env` (or shell):

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:4000/v1
EXPO_PUBLIC_APP_ENV=development
```

4. Ensure phone and PC are on the same Wi‑Fi. Allow firewall port 4000 if needed.
5. From repo root:

```bash
npm run build --workspace=@gigflow/shared
cd apps/mobile
npx expo start
```

6. Scan QR with Expo Go (Android) or Camera (iOS). Or:

```bash
npx expo start --android
npx expo start --ios
```

**iOS:** Expo Go works if the project is compatible; TestFlight/EAS builds use the `pilot` profile below when you need a store-like binary.

### B. Internal APK / iOS (EAS pilot profile)

Does **not** auto-deploy to production stores.

```bash
cd apps/mobile
npm run eas:login
npm run eas:build:android:pilot
# optional when Apple credentials are ready:
npm run eas:build:ios:pilot
```

Pilot profile sets `EXPO_PUBLIC_APP_ENV=pilot` and points at `https://api.duts.tech/v1` (override in `eas.json` if your pilot API host differs).

Before install: confirm the **API** host uses `APP_ENV=pilot`, Gig-owned DB, and Stripe **test** keys.

---

## 3. Location permissions

| Platform | Copy |
|----------|------|
| iOS `NSLocationWhenInUseUsageDescription` | Pickup/drop-off, nearby work, courier arrival confirmation |
| Android via `expo-location` plugin | Same intent |

Handled client-side (`apps/mobile/src/lib/location.ts`):

- granted → coordinates returned
- denied → retry prompt copy
- denied permanently → Settings path copy
- GPS disabled → enable location services
- timeout → move outdoors / retry
- poor accuracy (>~150m) → clearer sky / retry

Courier arrival / PIN steps surface these messages via `friendlyLocationError`.

---

## 4. Maps / navigation

`openExternalNavigation` opens Apple Maps (iOS) or Google Maps directions (Android). Used for pickup and drop-off navigation on `DeliveryJobScreen`. No embedded turn-by-turn.

---

## 5. Stripe TEST mode checklist (physical device)

1. API `.env`: `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_PUBLISHABLE_KEY=pk_test_…`, `STRIPE_WEBHOOK_SECRET=…`
2. Local webhook (dev LAN): `stripe listen --forward-to http://localhost:4000/v1/payments/webhook`
3. Customer completes payment on phone → Stripe Checkout / existing authorization path
4. Confirm gig moves to paid/matching (not “paid” via bypass)
5. After delivery complete → capture path runs as today

**Pilot fail-closed:** missing Stripe in `APP_ENV=pilot` → API will not start. Bypass endpoints return `DEV_PAYMENT_DISABLED`.

Test card (Stripe docs): `4242 4242 4242 4242`, any future expiry, any CVC.

---

## 6. Pilot configuration (do not treat as final pricing)

### PlatformSetting row `id=default` (DB)

| Knob | Default | Notes |
|------|---------|-------|
| `deliveryMaxDistanceKm` | 10 | Max delivery radius |
| `deliveryBaseFeeCents` | 200 | Base fee |
| `deliveryPricePerKmCents` | 50 | Per km |
| `deliveryMinimumFeeCents` | 200 | Floor |

Shared code defaults mirror these in `packages/shared/src/delivery.ts` (`DEFAULT_DELIVERY_*`).

### Environment

| Knob | Env | Default |
|------|-----|---------|
| Delivery product on/off | `DELIVERY_ENABLED` | on (set `false` to pause) |
| Auto-approve after delivery PIN | `DELIVERY_AUTO_APPROVE_SECONDS` | 60 |
| PIN max attempts | `DELIVERY_PIN_MAX_ATTEMPTS` | 5 |
| PIN lock minutes | `DELIVERY_PIN_LOCK_MINUTES` | 15 |

### Launch geography

Phase 1 defaults city/region to **Harare** on delivery stops; radius is enforced by `deliveryMaxDistanceKm`. There is no separate nationwide geo-fence table — control launch scope via radius + ops (who you invite) + `DELIVERY_ENABLED`.

---

## 7. Structured analytics (logs only)

`logDutsFlow` JSON lines (always on in non-production; always on when `APP_ENV=pilot`; production needs `DUTS_FLOW_LOGS=1`):

| Event | Meaning |
|-------|---------|
| `DELIVERY_QUOTE` | Quote generated |
| `DELIVERY_REQUESTED` | Delivery created |
| `COURIER_INTEREST` | Courier expressed interest |
| `COURIER_ASSIGNED` | Customer selected courier / paid |
| `PACKAGE_COLLECTED` | Pickup PIN OK |
| `DELIVERY_VERIFIED` | Drop-off PIN OK |
| `DELIVERY_CANCELLED` | Customer cancelled (pre-pickup) |
| `PAYMENT_FAILED` | Stripe payment failed |
| `GIG_COMPLETED` / `PAYMENT_CAPTURED` | Completion |

Average completion time: derive from timestamps between `PACKAGE_COLLECTED` (or `COURIER_ASSIGNED`) and `GIG_COMPLETED` / `DELIVERY_VERIFIED` in log aggregation — no dashboard in Stage 3.6.

---

## 8. Support path

Active delivery UI: **Help / Support** (call) + post-pickup call/SMS + email (`info@duts.tech` / configured `EXPO_PUBLIC_SUPPORT_*`). Cancellation blocked after package collection; support is the recovery path.

---

## 9. Two-phone human smoke checklist

Demo accounts (seed): `client@gigflow.local` / `worker@gigflow.local` / `Demo123!` (or pilot accounts).

### PHONE A — Customer

| # | Step | Expected status / note |
|---|------|------------------------|
| 1 | Login | Session OK |
| 2 | Send a Package | Delivery request flow |
| 3 | Select pickup | Location resolved |
| 4 | Select destination | Location resolved |
| 5 | Add recipient | Name + phone |
| 6 | Describe package | Category + description |
| 7 | Request quote | Quote shown (distance + fee) |
| 8 | Confirm delivery | PINs screen |
| 9 | Save/share PINs | Share text = PIN only (no gig id) |
| 10 | Select courier | After interest; payment screen |
| 11 | Complete payment | Stripe test success → assigned |
| 12 | Observe statuses | En route → collected → delivering → awaiting confirm |
| 13 | Confirm completion | Completed |
| 14 | Verify history | Appears in My Gigs / activity |

### PHONE B — Courier

| # | Step | Expected |
|---|------|----------|
| 1 | Login | Session OK |
| 2 | Configure delivery eligibility | Courier setup |
| 3 | Choose transport mode | Walk / bike / public |
| 4 | Go Online | Eligible for offers |
| 5 | Receive delivery | Nearby / matching offer |
| 6 | Express interest | Waiting for selection |
| 7 | Become selected | After customer pays |
| 8 | Start pickup trip | Traveling to pickup |
| 9 | Arrive | GPS required |
| 10 | Enter pickup PIN | Package collected |
| 11 | Start drop-off trip | Traveling to drop-off |
| 12 | Arrive | GPS required |
| 13 | Enter delivery PIN | Awaiting customer confirm |
| 14 | Verify completion | After customer confirm / auto-approve |
| 15 | Earnings / history | Visible after complete |

---

## 10. Failure smoke (pilot-critical)

| Check | Expect |
|-------|--------|
| Wrong PIN | Error + attempts remaining; lock after threshold |
| Regenerated PIN | Old PIN fails; new works |
| GPS denied | Friendly Settings / Allow copy; cannot arrive |
| Cancel before pickup | Allowed (policy/fees as configured) |
| Cancel after pickup | Blocked; support path shown |
| App restart mid-delivery | Reopen → same job status |
| Temporary network loss | Retry / recover without corrupt status |
| Courier goes offline | No new offers; active job still actionable |
| Customer reopen | Status + support still available |

---

## 11. Security / debug cleanup (pre-pilot)

- PINs hashed at rest; plaintext only returned once to customer UI — never in server logs
- No Stripe secrets / auth tokens in client UI
- No `authorize-without-stripe` on pilot builds
- No `ALLOW_DEV_PAYMENT_BYPASS` / `ALLOW_DEV_SESSION` on pilot API

---

## 12. Go / no-go — Harare closed pilot

**GO only if all are true:**

1. API boots with Gig-owned DB (not `duts_whitelabel`) and `APP_ENV=pilot`
2. Stripe **test** keys configured; boot fails clearly if missing
3. Dev payment bypass unavailable on API and mobile pilot build
4. Two-phone happy path completes end-to-end once (sections 9)
5. Failure checks in section 10 pass for wrong PIN, cancel-after-pickup, GPS denied
6. Support call/SMS reachable from active delivery UI
7. Flow events visible in API logs for quote → request → assign → collect → deliver
8. `DELIVERY_ENABLED` can disable delivery without redeploying unrelated LOCAL_HELP
9. Pricing knobs live in `PlatformSetting` / env (not ad-hoc hardcoded per screen)
10. Human sign-off that physical phones used (not only simulators)

**NO-GO if any of:** wrong product DB, silent unpaid “paid” orders, pilot using live Stripe unintentionally without explicit decision, missing support path post-pickup, or incomplete two-phone smoke.

**STOP:** Do not auto-deploy to production from this stage.
