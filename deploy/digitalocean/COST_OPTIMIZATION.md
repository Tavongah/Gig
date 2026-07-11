# Cost Optimization — GigFlow on DigitalOcean

Target: **< $50/month** at Connecticut launch.

## Launch tier (~$35–45/mo)

| Choice | Savings |
|--------|---------|
| Single 4GB Droplet (all services) vs managed DB + app | ~$15/mo vs Managed Postgres $15 + Droplet $12 |
| Self-hosted Postgres/Redis in Docker | Good until ~50 concurrent workers online |
| Spaces vs storing files on Droplet disk | Prevents disk upgrades; $5/mo flat tier |
| Skip Load Balancer until second API node | $12/mo saved |

## When to spend more

| Signal | Upgrade |
|--------|---------|
| RAM > 85% sustained | 4GB → 8GB Droplet ($48/mo) |
| Postgres CPU high | Managed Postgres $15+ |
| API CPU high | Second Droplet + LB |
| Cold starts N/A (always-on Droplet) | Already solved vs Render free tier |

## Operational savings

- Enable Droplet backups ($4.80) — cheaper than rebuilding from scratch
- Use Cloudflare free tier for DNS + basic DDoS (optional)
- Compress logs (`json-file` max-size in compose) — avoid disk fill
- `BACKUP_RETENTION_DAYS=14` — adjust for compliance vs storage
- Netdata free vs paid APM until scale requires Datadog

## Connecticut → nationwide

- Start NYC3; add SF/LA Droplets + geo DNS when latency metrics justify (~$24 each)
- CDN on Spaces for image delivery (included CDN endpoint)
- Read replica when reporting/admin queries slow primary

## Avoid

- Kubernetes at launch (ops cost >> benefit below ~100k MAU)
- Over-provisioned Droplet (8GB+) before metrics show need
- Committing secrets or running without backups to save $5
