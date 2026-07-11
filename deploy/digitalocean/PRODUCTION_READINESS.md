# Production Readiness Checklist

Complete before accepting real customer payments in Connecticut.

## Infrastructure

- [ ] Droplet 4GB+ in NYC3 (or nearest to users)
- [ ] DNS A records for `api` and `admin` subdomains
- [ ] SSL certificates issued and auto-renewal running
- [ ] `deploy.sh` succeeds; `/health` and `/ready` return OK
- [ ] Daily Postgres backups verified (test restore on staging)
- [ ] `RUN_SEED=false` after initial seed

## Application config

- [ ] `.env.production` complete (see `.env.production.example`)
- [ ] `CORS_ORIGINS` includes admin + mobile web origins
- [ ] `API_PUBLIC_URL` matches public API URL
- [ ] Admin loads and login works (`admin@gigflow.local`)

## Stripe

- [ ] Test mode end-to-end payment flow passes
- [ ] Webhook receives events at `/v1/payments/webhook`
- [ ] Switch to live keys when ready for real money
- [ ] Worker Connect onboarding tested

## Firebase

- [ ] Service account on API
- [ ] Authorized domains include production URLs
- [ ] Google sign-in tested on web
- [ ] FCM configured when push notifications ship

## Spaces

- [ ] Bucket created, keys in env
- [ ] Signed upload/download tested (`apps/api/src/lib/spaces.ts`)
- [ ] Mobile/web wired to upload flow (post-MVP)

## Mobile

- [ ] `EXPO_PUBLIC_API_URL=https://api.YOURDOMAIN.com/v1`
- [ ] EAS production profile updated
- [ ] TestFlight / internal testing build

## Legal & ops

- [ ] Terms of Service and Privacy Policy linked in app
- [ ] Support contact email configured
- [ ] On-call / incident runbook (see DISASTER_RECOVERY.md)

## Performance smoke test

- [ ] Post gig → match workers → pay → complete → approve
- [ ] Worker online + Socket.IO realtime events
- [ ] Admin dashboard shows active gigs

## Sign-off

| Role | Name | Date |
|------|------|------|
| Engineering | | |
| Security review | | |
| Business | | |
