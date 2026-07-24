# DUTS Launch Checklist

Use this before deploy (few days out) and again before taking real payments.

---

## Day 1 — Deploy infrastructure

### Code & GitHub
- [ ] Commit and push all changes (migrations, API, mobile, admin)
- [ ] Confirm CI passes on GitHub (`typecheck`, `build:api`, admin build)

### Render (see `RENDER_DEPLOY.md`)
- [ ] Apply Blueprint or create: **API**, **Postgres**, **Redis**, **Admin**
- [ ] Set on **gigflow-api**:
  - `API_PUBLIC_URL` = `https://YOUR-API.onrender.com`
  - `CORS_ORIGINS` = admin URL + Expo web URL + `http://localhost:8081` (for local testing)
  - `MOBILE_PUBLIC_URL` = your Expo web or app URL
  - `LOG_VERIFICATION_TO_CONSOLE=true` (beta only, until email/SMS provider is wired)
- [ ] Set on **gigflow-admin**:
  - `VITE_API_URL` = `https://YOUR-API.onrender.com/v1`
  - **Manual deploy → Clear build cache** after setting env
- [ ] Verify:
  - `GET https://YOUR-API.onrender.com/health` → `{ ok: true }`
  - `GET https://YOUR-API.onrender.com/ready` → database + redis up
- [ ] After first deploy succeeds: set `RUN_SEED=false` on API and redeploy once

### Mobile / Admin URLs
- [ ] Update `apps/mobile/eas.json` → `EXPO_PUBLIC_API_URL`
- [ ] Update `apps/mobile/.env` (local) with production API if testing against hosted backend
- [ ] Add production API domain to Firebase authorized domains (`FIREBASE_SETUP.md`)

---

## Day 2 — Auth & payments (staging with Stripe **test** keys)

### Firebase (required for Google/Apple sign-in)
- [ ] Copy `apps/mobile/firebase.config.example.json` → `firebase.config.json` and set `projectId`
- [ ] Add a **Web app** in Firebase Console (required for Expo web)
- [ ] Run: `npm run firebase:config`
- [ ] API service account: `npm run setup:firebase -- path/to/serviceAccount.json`
- [ ] Test: sign in with Google on web + create client account

### Stripe (required before customers can pay)
- [ ] API: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` (test mode OK first)
- [ ] Local webhook: `npm run stripe:listen` → copy `whsec_...` to `STRIPE_WEBHOOK_SECRET` (see `STRIPE_WEBHOOK.md`)
- [ ] Create webhook in Stripe Dashboard → `https://gigflow-api.onrender.com/v1/payments/webhook`
- [ ] API: `STRIPE_WEBHOOK_SECRET` from webhook
- [ ] Test full flow:
  1. Request Gig → workers match → Choose worker
  2. Confirm & Secure Payment (test card `4242…`)
  3. Worker completes → Customer approves → payment captured

### Worker payouts
- [ ] Worker completes Stripe Connect onboarding (`WorkerStripeConnectScreen`)
- [ ] Test Connect with Stripe test mode

### Production safety (already implemented in code)
- [x] Dev payment bypass **blocked in production** (`authorize-without-stripe`, publish without payment)
- [x] API logs `[production-readiness]` warnings on startup if Stripe/Firebase/CORS missing
- [ ] **Do not set** `ALLOW_DEV_PAYMENT_BYPASS` or `ALLOW_DEV_SESSION` in production

---

## Day 3 — End-to-end smoke test (hosted)

Run on **production API** with **test** Stripe keys first:

| Role | Steps |
|------|--------|
| **Customer** | Request Gig → pick Fixed Price service → choose worker → pay → track → approve completion |
| **Worker** | Go online → express interest → get selected → GPS arrive/start → finish gig |
| **Admin** | Login → overview shows active gigs → approve workers → check commission |

Check API logs for `[production-readiness]` — should show no blockers once env is set.

---

## Before real money (live launch)

- [ ] Switch Stripe keys to **live** mode
- [ ] Update webhook to live endpoint + new `STRIPE_WEBHOOK_SECRET`
- [ ] Apple Sign-In: Apple Developer production setup (`FIREBASE_SETUP.md`)
- [ ] Terms of Service + Privacy Policy linked in app
- [ ] Support email / contact for disputes
- [ ] Upgrade Render plan if cold starts are unacceptable (free tier sleeps)
- [ ] EAS production build: `eas build --profile production --platform all`
- [ ] App Store / Play Store submission (or ship Expo web for beta)

---

## Seeded demo accounts (local / after `db:seed`)

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Admin | admin@gigflow.local | `ADMIN_SEED_PASSWORD` in `apps/api/.env` | Rotate before public launch |
| Client | client@gigflow.local | Demo123! | Verified, ready to post gigs |
| Worker | worker@gigflow.local | Demo123! | Approved worker with categories |

---

## Environment quick reference

| Variable | Where | Required for launch |
|----------|--------|---------------------|
| `DATABASE_URL` | API | Yes (auto on Render) |
| `REDIS_URL` | API | Yes (auto on Render) |
| `JWT_SECRET` | API | Yes (auto on Render) |
| `CORS_ORIGINS` | API | Yes — explicit origins, not `*` |
| `STRIPE_SECRET_KEY` | API | Yes for payments |
| `STRIPE_PUBLISHABLE_KEY` | API | Yes for payments |
| `STRIPE_WEBHOOK_SECRET` | API | Yes for payment confirmation |
| `ADMIN_SEED_PASSWORD` | API | Yes for seeding admin (min 12 chars) |
| `FIREBASE_*` | API + mobile | Yes for social login |
| `VITE_API_URL` | Admin build | Yes |
| `EXPO_PUBLIC_API_URL` | Mobile build | Yes |

---

## Known MVP limits (OK for beta, plan post-launch)

- Photo upload: web-only, no S3 yet
- Push notifications: in-app/socket only (no FCM/APNs)
- Hourly pricing: hidden on Request form (backend still supports it)

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| CORS error in browser | Add origin to `CORS_ORIGINS` on API |
| "Payment bypass disabled" | Set Stripe keys on API — dev bypass is off in production |
| Admin shows 0 open gigs | Fixed — counts all active marketplace gigs |
| `/ready` 503 | Check Postgres + Redis services on Render |
| Mobile can't reach API | `EXPO_PUBLIC_API_URL` must include `/v1` |

---

## Deploy commands (local verify before push)

```bash
npm ci
npm run build:api
npm run typecheck
npm run test:auth --workspace @gigflow/api   # optional auth smoke
```

After push, Render auto-deploys from GitHub.
