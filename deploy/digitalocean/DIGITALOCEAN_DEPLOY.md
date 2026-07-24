# GigFlow on DigitalOcean — Production Deployment Guide

Launch architecture for **Connecticut MVP** with a path to **nationwide scale**. Target: **under $50/month** at launch on a single Droplet.

---

## Architecture overview

```txt
                    Internet
                        │
                   [ Cloudflare DNS ]  (optional, recommended)
                        │
              ┌─────────▼─────────┐
              │  Ubuntu 24.04 LTS │
              │  UFW + Fail2Ban   │
              │  Docker Compose   │
              └─────────┬─────────┘
        ┌───────────────┼───────────────┐
        │               │               │
   ┌────▼────┐    ┌─────▼─────┐   ┌─────▼─────┐
   │  Nginx  │    │    API    │   │  (admin   │
   │  :443   │───▶│  :4000    │   │  static)  │
   └─────────┘    └─────┬─────┘   └───────────┘
                        │
              ┌─────────┴─────────┐
              │                   │
        ┌─────▼─────┐       ┌─────▼─────┐
        │ Postgres  │       │   Redis   │
        │    16     │       │     7     │
        └───────────┘       └───────────┘

   Uploads ──▶ DigitalOcean Spaces (S3-compatible, private + signed URLs)
   Payments ──▶ Stripe Connect webhooks → api.gigflow.com/v1/payments/webhook
   Push (FCM) ─▶ Firebase (configure when enabling notifications)
```

| Component | Launch | Scale path |
|-----------|--------|------------|
| Compute | 1× Droplet 4GB ($24/mo) | Multiple Droplets + load balancer |
| Database | Postgres in Docker | Managed Postgres + read replicas |
| Cache | Redis in Docker | Managed Redis / Redis Cluster |
| Files | DO Spaces ($5/mo) | CDN in front of Spaces |
| Admin | Nginx static | Same or separate CDN |
| Mobile | Expo/EAS (not on Droplet) | Point `EXPO_PUBLIC_API_URL` at API domain |

---

## Recommended launch cost (Connecticut)

| Resource | Spec | ~Monthly |
|----------|------|----------|
| Droplet | 4 GB / 2 vCPU, NYC3 | $24 |
| Spaces | 250 GB incl. | $5 |
| Droplet backup | Optional | $4.80 |
| Domain | External registrar | ~$1 |
| **Total** | | **~$35–45** |

See [COST_OPTIMIZATION.md](./COST_OPTIMIZATION.md) for tuning.

---

## Prerequisites

- Domain (e.g. `gigflow.com`)
- DigitalOcean account
- GitHub repo access
- Stripe account (test mode first)
- Firebase project (auth; FCM when ready)
- SSH key pair

---

## 1. Create infrastructure

### Droplet

1. DigitalOcean → **Create Droplet**
2. **Ubuntu 24.04 LTS**, NYC3 (close to Connecticut)
3. **4 GB RAM / 2 vCPU** (minimum recommended)
4. SSH key only (disable password auth)
5. Enable **backups** (recommended)

### Spaces

1. Create Space: `gigflow-uploads` in **nyc3**
2. Enable **CDN** (optional, set `SPACES_CDN_URL`)
3. Create **Spaces access keys** → save for `.env.production`

### DNS

Droplet IP: `68.183.125.70` (replace if your Droplet IP changes).

| Type | Host / Name | Value | TTL | Notes |
|------|-------------|-------|-----|-------|
| A | `@` (apex / root) | `68.183.125.70` | 300 | Required for `https://duts.tech` |
| A | `www` | `68.183.125.70` | 300 | Canonical marketing site |
| A | `api` | `68.183.125.70` | 300 | API |
| A | `admin` | `68.183.125.70` | 300 | Admin |
| A | `app` | `68.183.125.70` | 300 | Web app |

If you use **Cloudflare** DNS: set Proxy status to **DNS only** (grey cloud) for these A records while issuing/renewing Let's Encrypt certificates. You can enable proxy later if desired.

**Canonical marketing URL:** `https://www.duts.tech`  
**Apex behavior:** `https://duts.tech` → **301** → `https://www.duts.tech`

Marketing site: Astro static. App stays at `https://app.duts.tech`. CTAs on the marketing site open the existing app—app logic is not modified.

### Launch marketing site (`www` + apex redirect)

1. **DNS** — add both the apex `@` and `www` A records (see table above). Wait until both resolve:

   ```bash
   nslookup duts.tech
   nslookup www.duts.tech
   ```

2. **Server env** — in `/opt/gigflow/.env.production`:

   ```env
   ROOT_DOMAIN=duts.tech
   MARKETING_DOMAIN=www.duts.tech
   PUBLIC_SITE_URL=https://www.duts.tech
   PUBLIC_APP_URL=https://app.duts.tech
   ```

3. **SSL** — expand the cert so it includes both `www` and the apex:

   ```bash
   bash /opt/gigflow/deploy/digitalocean/scripts/fix-marketing-ssl.sh
   ```

   Or expand manually:

   ```bash
   bash /opt/gigflow/deploy/digitalocean/scripts/expand-ssl-app-domain.sh
   ```

4. **Deploy** — rebuilds nginx with the Astro marketing build + apex→www redirect:

   ```bash
   bash /opt/gigflow/deploy/digitalocean/scripts/deploy-marketing.sh
   ```

5. **Verify**:

   ```bash
   curl -fsS https://www.duts.tech/health
   curl -I https://duts.tech          # expect: HTTP/1.1 301 … Location: https://www.duts.tech/
   curl -fsSL https://duts.tech/ | head
   ```

Local preview: `npm run dev:marketing` → http://localhost:4321

---

## Domain cutover to duts.tech

Production hosts use **duts.tech** (not gigflow.ink):

| Host | Role |
|------|------|
| `www.duts.tech` | Marketing (canonical) |
| `duts.tech` | 301 redirect → `www.duts.tech` |
| `app.duts.tech` | App |
| `api.duts.tech` | API |
| `admin.duts.tech` | Admin |

Internal names (`@gigflow/*` packages, Docker project `gigflow`, Prisma DB names) are unchanged.

### Cutover checklist (new root domain)

This is a **new certificate** (`--cert-name api.duts.tech`), not an expand of the old `api.gigflow.ink` cert.

1. **DNS** — point all five A records at `68.183.125.70` (DNS only / grey cloud if Cloudflare). Confirm:

   ```bash
   nslookup api.duts.tech
   nslookup www.duts.tech
   nslookup duts.tech
   ```

2. **Pull + env** — on the Droplet:

   ```bash
   cd /opt/gigflow
   git pull origin main
   nano .env.production   # copy domain block from deploy/digitalocean/.env.production.example
   ```

   Set at least: `API_DOMAIN`, `ADMIN_DOMAIN`, `APP_DOMAIN`, `MARKETING_DOMAIN`, `ROOT_DOMAIN`,
   `PUBLIC_*`, `EXPO_PUBLIC_API_URL`, `API_PUBLIC_URL`, `MOBILE_PUBLIC_URL`, `CORS_ORIGINS`,
   `EMAIL_FROM`, `LETSENCRYPT_EMAIL`.

3. **SSL + nginx + deploy**:

   ```bash
   bash deploy/digitalocean/scripts/issue-ssl-certs.sh
   bash deploy/digitalocean/scripts/deploy.sh
   bash deploy/digitalocean/scripts/deploy-marketing.sh
   docker compose --env-file .env.production -f deploy/digitalocean/docker-compose.prod.yml --profile certbot up -d certbot
   ```

4. **External services** (same day as cutover):
   - Firebase → Authorized domains: add `app.duts.tech`, `www.duts.tech`
   - Stripe → webhook URL `https://api.duts.tech/...` + return URLs under `app.duts.tech`
   - Resend → verify sending domain `duts.tech`; set `EMAIL_FROM=noreply@duts.tech`

5. **Verify**:

   ```bash
   curl -fsS https://api.duts.tech/health
   curl -fsS https://www.duts.tech/health
   curl -I https://duts.tech    # 301 → https://www.duts.tech/
   ```

Optional: keep `gigflow.ink` DNS for a while with redirects, or drop it once traffic moves.

---

## 2. Server bootstrap

SSH as root:

```bash
curl -fsSL https://raw.githubusercontent.com/Tavongah/Gig/main/deploy/digitalocean/scripts/server-bootstrap.sh | bash
```

Or clone first and run locally:

```bash
git clone https://github.com/Tavongah/Gig.git /opt/gigflow
bash /opt/gigflow/deploy/digitalocean/scripts/server-bootstrap.sh
```

Installs: Docker, UFW (22/80/443), Fail2Ban, swap, log rotation, Netdata, backup cron.

---

## 3. Configure environment

As `deploy` user:

```bash
cp /opt/gigflow/deploy/digitalocean/.env.production.example /opt/gigflow/.env.production
chmod 600 /opt/gigflow/.env.production
nano /opt/gigflow/.env.production
```

**Required before first deploy:**

- `API_DOMAIN`, `ADMIN_DOMAIN`, `APP_DOMAIN`, `LETSENCRYPT_EMAIL`
- `VITE_API_URL=https://api.YOURDOMAIN.com/v1`
- `EXPO_PUBLIC_API_URL` + Firebase `EXPO_PUBLIC_FIREBASE_*` (baked into web app at image build)
- `POSTGRES_PASSWORD`, `JWT_SECRET`, `ADMIN_SEED_PASSWORD`
- `API_PUBLIC_URL`, `CORS_ORIGINS` (must include `https://APP_DOMAIN`), `MOBILE_PUBLIC_URL=https://APP_DOMAIN`
- Stripe test/live keys
- Firebase service account vars (for social login)

Set `RUN_SEED=true` for first deploy only, then `false`.

---

## 4. SSL certificates

After DNS propagates:

```bash
chmod +x /opt/gigflow/deploy/digitalocean/scripts/*.sh
/opt/gigflow/deploy/digitalocean/scripts/issue-ssl-certs.sh
```

Enable auto-renewal:

```bash
docker compose --env-file /opt/gigflow/.env.production \
  -f /opt/gigflow/deploy/digitalocean/docker-compose.prod.yml \
  --profile certbot up -d certbot
```

---

## 5. Deploy stack

```bash
/opt/gigflow/deploy/digitalocean/scripts/deploy.sh
```

Verify:

```bash
curl https://api.YOURDOMAIN.com/health
curl https://api.YOURDOMAIN.com/ready
```

Admin: `https://admin.YOURDOMAIN.com` → `admin@gigflow.local`  
Customer/worker web app: `https://app.YOURDOMAIN.com`

### Adding the web app to an existing Droplet

1. DNS: create `A` record `app` → Droplet IP  
2. In `/opt/gigflow/.env.production` set:
   - `APP_DOMAIN=app.duts.tech`
   - `MOBILE_PUBLIC_URL=https://app.duts.tech`
   - `CORS_ORIGINS=...include https://app.duts.tech...`
   - `EXPO_PUBLIC_API_URL` + Firebase public keys (same as EAS)
3. Expand TLS: `bash deploy/digitalocean/scripts/expand-ssl-app-domain.sh`  
4. Redeploy: `./deploy/digitalocean/scripts/deploy.sh` (rebuilds Nginx with Expo web export)  
5. Firebase Console → Authentication → Settings → Authorized domains → add `app.duts.tech`

---

## 6. Stripe webhook

Stripe Dashboard → Webhooks:

```txt
https://api.YOURDOMAIN.com/v1/payments/webhook
```

Events: `checkout.session.completed`, `payment_intent.*`, `account.updated`

Set `STRIPE_WEBHOOK_SECRET` in `.env.production` and redeploy.

---

## 7. GitHub Actions CI/CD

Workflow: `.github/workflows/deploy-digitalocean.yml`

**GitHub repository secrets:**

| Secret | Example |
|--------|---------|
| `DO_HOST` | Droplet IP |
| `DO_SSH_USER` | `deploy` |
| `DO_SSH_KEY` | Private SSH key |
| `API_DOMAIN` | `api.gigflow.com` |

**GitHub environment:** `production` (optional approval gate)

On push to `main`: typecheck → build → SSH deploy → smoke test `/health` and `/ready`.

Rollback: `deploy.sh` resets git to previous commit on failure.

---

## 8. Backups

**Automatic:** cron runs `backup-postgres.sh` daily at 03:15 UTC.

**Manual:**

```bash
/opt/gigflow/deploy/digitalocean/scripts/backup-postgres.sh
```

**Restore:**

```bash
/opt/gigflow/deploy/digitalocean/scripts/restore-postgres.sh \
  /opt/gigflow/deploy/digitalocean/backups/gigflow_YYYYMMDD_HHMMSS.sql.gz
```

Off-site: install `awscli` on host; backups upload to Spaces when `SPACES_*` is set.

---

## 9. Monitoring

- **Netdata** (installed by bootstrap): `http://DROPLET_IP:19999` — restrict with UFW or SSH tunnel
- **Docker:** `docker compose ps`, `docker stats`
- **Logs:** `docker compose logs -f api nginx`
- **SSL expiry:** certbot container renews; alert if Netdata/email monitoring configured

---

## 10. Scaling (without rebuild)

| Stage | Action |
|-------|--------|
| 10k users | Upgrade Droplet to 8GB; tune Postgres `shared_buffers` |
| 50k users | Move Postgres to DO Managed Database; add PgBouncer |
| 100k+ users | Second API Droplet + DO Load Balancer; Redis managed |
| National | CDN for admin/mobile assets; Kubernetes when team size justifies |

API is stateless (JWT + Redis). Socket.IO scales with Redis adapter already in codebase.

---

## 11. Troubleshooting

| Symptom | Fix |
|---------|-----|
| 502 from Nginx | `docker compose logs api`; check migrations |
| `/ready` 503 | Wait for Postgres/Redis; `docker compose ps` |
| SSL error | Re-run `issue-ssl-certs.sh`; check DNS |
| CORS errors | Update `CORS_ORIGINS` in `.env.production` |
| Deploy OOM | Enable swap; use 4GB+ Droplet |
| Webhook fails | Verify URL + `STRIPE_WEBHOOK_SECRET` |

---

## Related docs

- [SERVER_HARDENING.md](./SERVER_HARDENING.md)
- [SECURITY_CHECKLIST.md](./SECURITY_CHECKLIST.md)
- [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md)
- [COST_OPTIMIZATION.md](./COST_OPTIMIZATION.md)
- [DISASTER_RECOVERY.md](./DISASTER_RECOVERY.md)
- [../../LAUNCH_CHECKLIST.md](../../LAUNCH_CHECKLIST.md)
- [../../FIREBASE_SETUP.md](../../FIREBASE_SETUP.md)
- [../../STRIPE_WEBHOOK.md](../../STRIPE_WEBHOOK.md)

---

## File reference

| Path | Purpose |
|------|---------|
| `deploy/digitalocean/docker-compose.prod.yml` | Production stack |
| `deploy/nginx/` | Nginx + admin build |
| `deploy/postgres/postgresql.conf` | DB tuning |
| `deploy/redis/redis.conf` | Redis tuning |
| `deploy/digitalocean/scripts/` | Bootstrap, deploy, backup, SSL |
| `apps/api/Dockerfile` | API image |
| `apps/api/src/lib/spaces.ts` | Signed upload URLs for Spaces |
