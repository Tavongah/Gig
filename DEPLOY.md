# GigFlow Deployment Guide

This guide gets GigFlow from local development to a hosted MVP you can operate immediately.

## Architecture at launch

| Component | Technology | Host |
|-----------|------------|------|
| API + WebSockets | Node.js, Express, Prisma, Socket.IO | Railway / Render / Docker |
| Database | PostgreSQL 16 | Managed Postgres (Render/Railway) |
| Cache / realtime scale-out | Redis 7 | Managed Redis |
| Admin dashboard | React + Vite static site | Render static / Vercel / Netlify |
| Mobile app | Expo (React Native) | Expo Go (dev) → EAS Build (stores) |

## Prerequisites

- Node.js 20+
- Docker Desktop (optional, for local full stack)
- Accounts on [Render](https://render.com) or [Railway](https://railway.app)
- Expo account for mobile builds

---

## 1. Local production smoke test

```bash
cd Gig
cp .env.example .env
# Edit .env — set JWT_SECRET (min 24 chars)

npm ci
npm run db:up          # Postgres + Redis via Docker
npm run db:migrate     # Create schema
npm run db:seed        # Categories + admin user

npm run build:api
npm run start:api      # API on :4000
```

In separate terminals:

```bash
npm run dev --workspace @gigflow/admin   # Admin on :5173
npm run dev --workspace @gigflow/mobile  # Expo dev server
```

**Verify:**
- `GET http://localhost:4000/health` → `{ ok: true, checks: { database: "up", redis: "up" } }`
- Admin login: `admin@gigflow.local` via dashboard sign-in
- Mobile: create client + worker accounts, post gig, accept as worker

### Full Docker stack (API included)

```bash
docker compose up --build
```

API runs at `http://localhost:4000` with auto-migrate + seed (`RUN_SEED=true`).

---

## 2. Deploy API to Render

1. Push the `Gig` folder to GitHub.
2. Create a **PostgreSQL** database on Render.
3. Create a **Redis** instance (Render Key Value or Upstash).
4. Create a **Web Service**:
   - **Build command:** `npm ci && npm run build:api`
   - **Start command:** `cd apps/api && sh scripts/start.sh`
   - **Health check path:** `/health`

**Required environment variables:**

| Variable | Example |
|----------|---------|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `DATABASE_URL` | From Render Postgres |
| `REDIS_URL` | From Redis provider |
| `JWT_SECRET` | 32+ char random string |
| `CORS_ORIGINS` | `https://your-admin.onrender.com,https://your-expo.dev` |
| `TRUST_PROXY` | `true` |
| `RUN_SEED` | `true` (first deploy only) |

After first successful deploy, set `RUN_SEED=false`.

**Note:** Render's `render.yaml` in the repo is a starter blueprint — adjust service names and plans.

---

## 3. Deploy API to Railway

1. Connect GitHub repo to Railway.
2. Add **PostgreSQL** and **Redis** plugins.
3. Railway reads `railway.json` and builds from `apps/api/Dockerfile`.
4. Set the same env vars as Render (Railway auto-injects `DATABASE_URL` / `REDIS_URL`).

---

## 4. Deploy Admin Dashboard

Build locally or via CI:

```bash
VITE_API_URL=https://your-api.onrender.com/v1 npm run build --workspace @gigflow/admin
```

Deploy `apps/admin/dist` to any static host.

**Render static site:**
- Build: `npm ci && npm run build --workspace @gigflow/admin`
- Publish directory: `apps/admin/dist`
- Env: `VITE_API_URL=https://your-api.onrender.com/v1`

Sign in with `admin@gigflow.local` (seeded) or promote a user to `ADMIN` in the database.

---

## 5. Mobile app (Expo)

Update `apps/mobile/eas.json` production env:

```json
"EXPO_PUBLIC_API_URL": "https://your-api.onrender.com/v1"
```

For local device testing against hosted API:

```bash
cd apps/mobile
EXPO_PUBLIC_API_URL=https://your-api.onrender.com/v1 npx expo start
```

**Production builds:**

```bash
npm install -g eas-cli
eas login
eas build --profile production --platform all
```

Add your API domain to `CORS_ORIGINS` on the backend.

---

## 6. Environment variable reference

See `.env.example` at the monorepo root. Per-app overrides:

| App | Variable | Purpose |
|-----|----------|---------|
| API | `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` | Required |
| API | `CORS_ORIGINS` | Comma-separated allowed origins |
| API | `STRIPE_SECRET_KEY` | Phase 2 payments |
| Admin | `VITE_API_URL` | API base URL |
| Mobile | `EXPO_PUBLIC_API_URL` | API base URL |

---

## 7. Production checklist

### Done in this MVP
- [x] Health + readiness endpoints (`/health`, `/ready`)
- [x] Redis-backed rate limiting
- [x] Configurable CORS
- [x] Prisma migrations + deploy script
- [x] Docker image for API
- [x] Worker onboarding + category matching
- [x] Accept gig + status lifecycle (MATCHED → COMPLETED)
- [x] Real-time gig offers via Socket.IO
- [x] Admin login + commission settings
- [x] Chat message persistence

### Phase 2 (before taking live payments)
- [ ] Stripe Connect onboarding + payment intents
- [ ] Firebase Auth (replace dev JWT sessions)
- [ ] Firebase Cloud Messaging push notifications
- [ ] Google Maps integration + geo matching
- [ ] S3/Cloudinary photo uploads
- [ ] Reviews API + mobile UI
- [ ] CI/CD with automated tests

---

## 8. Operating the marketplace

**Day 1 workflow:**
1. Seed categories (automatic on first deploy).
2. Workers sign up → complete profile → select service categories → go available.
3. Clients post gigs → workers receive offers → accept → complete lifecycle.
4. Admin monitors `/admin/overview` and adjusts commission.

**Promote a user to admin manually:**

```sql
UPDATE "User" SET roles = ARRAY['ADMIN','CLIENT']::"UserRole"[] WHERE email = 'you@company.com';
```

---

## 9. Troubleshooting

| Issue | Fix |
|-------|-----|
| `/health` returns 503 | Check `DATABASE_URL` and `REDIS_URL` |
| Workers see no gigs | Complete worker onboarding + select categories |
| Socket offers not received | Tap "Go available" after onboarding |
| Admin 403 | User must have `ADMIN` role |
| CORS errors | Add frontend origin to `CORS_ORIGINS` |
| Migration failed on deploy | Run `npx prisma migrate deploy` manually once |

---

## Support

For architecture details see `README.md`. For schema reference see `apps/api/prisma/schema.prisma`.
