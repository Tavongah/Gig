# Security Checklist — DUTS Production

## Authentication & authorization

- [x] JWT with minimum 24-char secret (enforce 32+ in production)
- [x] Password hashing (bcrypt via API)
- [x] Role-based access (client / worker / admin)
- [ ] Firebase Admin for social token verification (set `FIREBASE_*`)
- [ ] Email/phone verification (SendGrid/Twilio or disable `LOG_VERIFICATION_TO_CONSOLE`)

## HTTP security

- [x] Helmet middleware
- [x] CORS whitelist via `CORS_ORIGINS`
- [x] Nginx security headers (X-Frame-Options, nosniff, HSTS)
- [x] Rate limiting (Nginx + Express + Redis)
- [x] Request validation (Zod / shared schemas)
- [x] SQL injection protection (Prisma parameterized queries)
- [ ] CSRF: not required for bearer-JWT mobile API; review if adding cookie sessions

## Payments

- [x] Stripe webhook signature verification
- [x] Dev payment bypass blocked in production
- [ ] Live Stripe keys + live webhook before real money
- [ ] Stripe Connect onboarding for workers

## Data

- [x] UUID primary keys
- [ ] Uploads in Spaces only (never local disk) — wire mobile to signed URL API
- [ ] Encrypt Postgres at rest (DO Droplet/disk level)
- [ ] PII retention policy documented

## Infrastructure

- [x] UFW firewall
- [x] Fail2Ban SSH
- [x] TLS everywhere (Let's Encrypt)
- [x] Secrets in environment variables only
- [ ] GitHub environment protection on production deploy
- [ ] 2FA on DigitalOcean, Stripe, Firebase, GitHub

## Monitoring & audit

- [x] Structured HTTP logging (pino)
- [ ] Sentry (`SENTRY_DSN`) for error tracking
- [x] Audit log model in database
- [ ] Alert on `/ready` failures and disk > 80%
