# Server Hardening Guide (DigitalOcean)

Apply after `server-bootstrap.sh`. Review quarterly.

## SSH

- [ ] Key-based auth only (`PasswordAuthentication no` in `/etc/ssh/sshd_config`)
- [ ] Disable root SSH login (`PermitRootLogin prohibit-password` or `no`)
- [ ] Optional: change SSH port (update UFW accordingly)
- [ ] Deploy user in `docker` group only — not sudo unless needed

## Firewall (UFW)

```bash
sudo ufw status verbose
# Expected: 22, 80, 443 allowed; default deny incoming
```

- [ ] Do not expose Postgres (5432) or Redis (6379) publicly
- [ ] Restrict Netdata port 19999 to your IP or disable public access

## Fail2Ban

- [ ] `systemctl status fail2ban` active
- [ ] Review `/var/log/fail2ban.log` after incidents

## System updates

- [ ] `unattended-upgrades` enabled
- [ ] Monthly: `sudo apt update && sudo apt upgrade`

## Docker

- [ ] Pin image tags in compose (postgres:16-alpine, redis:7-alpine)
- [ ] No secrets in images or git
- [ ] `.env.production` mode `600`, owned by `deploy`
- [ ] Regular `docker system prune` (careful with volumes)

## Application

- [ ] `TRUST_PROXY=true` behind Nginx
- [ ] Explicit `CORS_ORIGINS` (never `*` in production)
- [ ] Strong `JWT_SECRET` (32+ random chars)
- [ ] Rotate `ADMIN_SEED_PASSWORD` before public launch
- [ ] Never set `ALLOW_DEV_PAYMENT_BYPASS` or `ALLOW_DEV_SESSION`

## TLS

- [ ] TLS 1.2+ only (see `deploy/nginx/snippets/ssl-params.conf`)
- [ ] HSTS enabled
- [ ] Certbot renewal container running

## Spaces

- [ ] Bucket private; access via signed URLs only
- [ ] Separate access keys per environment
- [ ] Lifecycle rules for old verification docs (future)

## Incident response

1. Block IP in UFW if attack detected
2. Rotate JWT + Stripe webhook secret if compromise suspected
3. Restore DB from backup (see DISASTER_RECOVERY.md)
4. Review API auth logs
