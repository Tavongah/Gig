# Deploy DUTS to Render (step-by-step)

**Full pre-launch checklist:** [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)

Most Render failures happen because **GitHub is out of date** or **env vars were not set** after the first Blueprint deploy.

---

## Before you deploy (required)

### 1. Push latest code to GitHub

Render builds from GitHub, not your laptop. Commit and push everything, especially:

- `apps/api/prisma/migrations/` (all migration folders)
- `apps/api/src/modules/payments/`
- `render.yaml`
- `apps/api/Dockerfile`

```bash
cd Gig
git add .
git commit -m "Prepare DUTS for Render deploy"
git push origin main
```

Use your actual branch name if not `main`.

### 2. Delete old failed Blueprint (optional but recommended)

If a previous deploy failed halfway:

1. [Render Dashboard](https://dashboard.render.com/)
2. Delete broken `gigflow-api`, `gigflow-admin`, `gigflow-db`, `gigflow-redis` services
3. Start fresh with Blueprint below

---

## Deploy with Blueprint

1. **New → Blueprint**
2. Connect repo: `Tavongah/Gig`
3. **Root directory:** leave as repo root (where `render.yaml` lives)
4. Click **Apply**

Wait until all four resources are created (API, Redis, Postgres, Admin).

---

## Set environment variables (critical)

After Blueprint creates services, open each service and set:

### `gigflow-api` → Environment

| Variable | Value |
|----------|--------|
| `API_PUBLIC_URL` | `https://gigflow-api.onrender.com` (your real API URL) |
| `MOBILE_PUBLIC_URL` | Your Expo web URL or `http://localhost:8081` for testing |
| `CORS_ORIGINS` | `https://gigflow-admin.onrender.com,http://localhost:8081,http://localhost:19006` |

Add Stripe test keys if you want payments:

| Variable | Value |
|----------|--------|
| `STRIPE_SECRET_KEY` | `sk_test_...` |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (after creating webhook) |

`DATABASE_URL`, `REDIS_URL`, and `JWT_SECRET` are auto-wired by Blueprint.

Click **Save Changes** → API will redeploy.

### `gigflow-admin` → Environment

| Variable | Value |
|----------|--------|
| `VITE_API_URL` | `https://gigflow-api.onrender.com/v1` |

**Important:** `VITE_API_URL` is baked in at **build time**. After setting it, click **Manual Deploy → Clear build cache & deploy**.

---

## Verify deploy

### API health

```text
GET https://gigflow-api.onrender.com/health
```

Expected: `{ "ok": true, ... }`

### Readiness (DB + Redis)

```text
GET https://gigflow-api.onrender.com/ready
```

Expected: `{ "ready": true, "checks": { "database": "up", "redis": "up" } }`

If `/ready` is 503:

- Check **Logs** on `gigflow-api` for `Redis connection failed` or `Migration failed`
- Confirm `gigflow-db` and `gigflow-redis` show **Available**

### Admin

Open `https://gigflow-admin.onrender.com`  
Login: `info@duts.tech` with the password from `ADMIN_SEED_PASSWORD` (seeded on first deploy)

### Mobile (testers)

Point the app at hosted API:

```bash
cd apps/mobile
set EXPO_PUBLIC_API_URL=https://gigflow-api.onrender.com/v1
npx expo start --web
```

Or add your Expo web URL to `CORS_ORIGINS` on the API.

---

## After first successful deploy

1. On `gigflow-api`, set `RUN_SEED` = `false` (stops re-seeding on every restart)
2. Save and redeploy once

---

## Common failures

| Symptom | Fix |
|---------|-----|
| Build fails on Docker | Check API logs; ensure `package-lock.json` is committed |
| `Migration failed` | Push all files under `apps/api/prisma/migrations/` |
| `Redis connection failed` | Wait for `gigflow-redis` to be live; redeploy API |
| Admin shows blank / login fails | Set `VITE_API_URL`, then **clear cache & redeploy** admin |
| CORS error in browser | Add your frontend URL to `CORS_ORIGINS` on API |
| API sleeps / slow first load | Free tier — normal; first request wakes it (~30–60s) |
| Stripe redirect fails | Set `API_PUBLIC_URL` and `MOBILE_PUBLIC_URL` on API |

---

## Stripe webhook (optional for payments)

1. Stripe Dashboard → Developers → Webhooks
2. Endpoint: `https://gigflow-api.onrender.com/v1/payments/webhook`
3. Events: `checkout.session.completed`, `payment_intent.amount_capturable_updated`, `payment_intent.payment_failed`
4. Copy signing secret → `STRIPE_WEBHOOK_SECRET` on API

---

## Quick checklist

- [ ] Code pushed to GitHub (including migrations)
- [ ] Blueprint applied
- [ ] `VITE_API_URL` set on admin + admin redeployed with cache clear
- [ ] `CORS_ORIGINS` set on API
- [ ] `/health` and `/ready` return OK
- [ ] `RUN_SEED=false` after first success
