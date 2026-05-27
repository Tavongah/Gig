# Render one-click deploy

After this repo is on GitHub:

1. Open [Render Dashboard](https://dashboard.render.com/) → **New** → **Blueprint**
2. Connect GitHub repo `Tavongah/Gig` (root directory: repo root)
3. Render reads `render.yaml` and creates:
   - `gigflow-api` (Docker web service)
   - `gigflow-db` (Postgres)
   - `gigflow-redis` (Redis)
   - `gigflow-admin` (static site)
4. When prompted, set:
   - **CORS_ORIGINS** on API → your admin URL (e.g. `https://gigflow-admin.onrender.com`) plus Expo web if needed
   - **VITE_API_URL** on admin → `https://<your-api-host>/v1`
5. Deploy. First boot runs migrations + seed (`RUN_SEED=true`).
6. After first successful deploy, set **RUN_SEED** to `false` on the API service.

**API URL:** `https://gigflow-api.onrender.com`  
**Health:** `https://gigflow-api.onrender.com/health`  
**Admin login:** `admin@gigflow.local` (seeded)

Update `apps/mobile/eas.json` and `apps/mobile/app.config.ts` with your API URL for mobile demos.
