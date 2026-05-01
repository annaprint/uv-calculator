#!/bin/bash
# Update an installed /opt/uv-calc deployment.
# Run as root (or via sudo). Pulls latest main, installs prod deps,
# applies pending migrations, and restarts the service.
set -euo pipefail

APP_DIR=/opt/uv-calc
APP_USER=uvcalc

if [[ $EUID -ne 0 ]]; then
  echo "update.sh must run as root" >&2
  exit 1
fi

cd "$APP_DIR"

sudo -u "$APP_USER" git pull --ff-only
sudo -u "$APP_USER" npm ci --omit=dev
sudo -u "$APP_USER" -E node migrate.js

systemctl restart uv-calc.service
systemctl status --no-pager uv-calc.service
echo "Update complete."
