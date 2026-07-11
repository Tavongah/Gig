# Disaster Recovery

## RPO / RTO targets (launch)

| Metric | Target |
|--------|--------|
| RPO (max data loss) | 24 hours (daily backups) |
| RTO (time to restore) | 2–4 hours |

Improve RPO to 1 hour with managed DB PITR when revenue justifies cost.

## Backup locations

1. **Local:** `/opt/gigflow/deploy/digitalocean/backups/` (14-day retention)
2. **Off-site:** DigitalOcean Spaces `backups/postgres/` (when awscli + keys configured)

## Scenarios

### API container crash

```bash
docker compose --env-file /opt/gigflow/.env.production \
  -f /opt/gigflow/deploy/digitalocean/docker-compose.prod.yml restart api
```

Compose `restart: unless-stopped` handles most cases.

### Full Droplet loss

1. Create new Droplet (same region)
2. Run `server-bootstrap.sh`
3. Clone repo, restore `.env.production` from secure vault
4. Restore latest backup: `restore-postgres.sh`
5. Run `issue-ssl-certs.sh` if IP changed (DNS update first)
6. Run `deploy.sh`

### Database corruption

1. Stop API: `docker compose ... stop api`
2. Restore from latest good backup
3. Start API; verify `/ready`

### Stripe / Firebase compromise

1. Rotate keys in provider dashboards
2. Update `.env.production`
3. Redeploy API
4. Invalidate active JWTs by rotating `JWT_SECRET` (forces re-login)

### SSL expiry

```bash
docker compose --profile certbot up -d certbot
docker compose exec certbot certbot renew --dry-run
docker compose restart nginx
```

## Contacts & runbook

Document in your internal wiki:

- DigitalOcean support
- Stripe dashboard emergency
- Domain registrar access
- Who can SSH to production

## Testing DR

Quarterly:

- [ ] Restore backup to staging Droplet
- [ ] Verify admin login and one payment flow
- [ ] Document time taken (RTO)
