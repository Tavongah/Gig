#!/usr/bin/env bash
# First-time Ubuntu 24.04 LTS hardening + Docker install for DUTS.
# Run as root: curl -fsSL ... | bash   OR   sudo bash server-bootstrap.sh
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR="${APP_DIR:-/opt/gigflow}"
SWAP_SIZE_GB="${SWAP_SIZE_GB:-2}"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades \
  git htop jq logrotate apt-transport-https software-properties-common

# Swap (helps 4GB droplets during Docker builds)
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l "${SWAP_SIZE_GB}G" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Docker CE
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Deploy user
if ! id "$DEPLOY_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"

mkdir -p "$APP_DIR/deploy/digitalocean/backups"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

# UFW
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Fail2Ban — SSH
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
EOF
systemctl enable fail2ban
systemctl restart fail2ban

# Unattended security updates
dpkg-reconfigure -plow unattended-upgrades

# Logrotate for Docker json logs (supplement compose max-size)
cat > /etc/logrotate.d/gigflow-docker <<'EOF'
/var/lib/docker/containers/*/*.log {
  rotate 7
  daily
  compress
  missingok
  delaycompress
  copytruncate
}
EOF

# Optional: Netdata monitoring (lightweight, free)
if [[ "${INSTALL_NETDATA:-1}" == "1" ]]; then
  curl -fsSL https://get.netdata.cloud/kickstart.sh | bash -s -- --non-interactive --stable-channel || true
fi

# Daily Postgres backup cron (runs as deploy user after repo clone)
cat > /etc/cron.d/gigflow-backup <<EOF
15 3 * * * $DEPLOY_USER $APP_DIR/deploy/digitalocean/scripts/backup-postgres.sh >> /var/log/gigflow-backup.log 2>&1
EOF

echo ""
echo "Bootstrap complete."
echo "Next:"
echo "  1. Clone repo to $APP_DIR as $DEPLOY_USER"
echo "  2. Copy deploy/digitalocean/.env.production.example -> $APP_DIR/.env.production"
echo "  3. Configure DNS A records for API_DOMAIN and ADMIN_DOMAIN"
echo "  4. Run issue-ssl-certs.sh then deploy.sh"
