#!/bin/bash
# One-time installer for /opt/uv-calc on a fresh Ubuntu 24.04 VDS.
# Run as root after `git clone <repo> /opt/uv-calc` and creating /opt/uv-calc/.env.
set -euo pipefail

APP_USER=uvcalc
APP_DIR=/opt/uv-calc

if [[ $EUID -ne 0 ]]; then
  echo "install.sh must run as root" >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "$APP_DIR/.env is missing — copy .env.example and fill it in first." >&2
  exit 1
fi

# 1. Service user
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/uvcalc --shell /bin/bash "$APP_USER"
fi

# 2. Data directories the systemd unit may write to
mkdir -p "$APP_DIR/data/backups" "$APP_DIR/data/pdfs" "$APP_DIR/data/uploads"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"
chown "$APP_USER:$APP_USER" "$APP_DIR/.env"

# 3. Production deps
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci --omit=dev

# 4. systemd units
install -m 0644 scripts/deploy/uv-calc.service        /etc/systemd/system/
install -m 0644 scripts/deploy/uv-calc-backup.service /etc/systemd/system/
install -m 0644 scripts/deploy/uv-calc-backup.timer   /etc/systemd/system/
systemctl daemon-reload

# 5. nginx — http-scope limit zone + vhost (TLS will be added by certbot)
install -m 0644 scripts/deploy/limit_zones.conf /etc/nginx/conf.d/uv-calc-limits.conf
install -m 0644 scripts/deploy/nginx.conf /etc/nginx/sites-available/calc.citi-print.ru
ln -sf /etc/nginx/sites-available/calc.citi-print.ru /etc/nginx/sites-enabled/calc.citi-print.ru
nginx -t
systemctl reload nginx

cat <<'NEXT'

Install complete. Next steps (run manually):

  # 1. Issue Let's Encrypt cert (also rewrites the vhost to use it):
  sudo certbot --nginx -d calc.citi-print.ru

  # 2. Bootstrap the first admin (reads ADMIN_EMAIL / ADMIN_PASS from .env):
  sudo -u uvcalc -E node /opt/uv-calc/seed.js

  # 3. Enable + start app and nightly backup timer:
  sudo systemctl enable --now uv-calc.service uv-calc-backup.timer

  # 4. Check status:
  systemctl status uv-calc.service
  systemctl list-timers uv-calc-backup.timer

NEXT
