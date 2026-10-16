#!/bin/bash

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
[ -z "${WEBHARE_DATAROOT:-}" ] && { echo "WEBHARE_DATAROOT not set - use wh exec to launch this script"; exit 1; }

CONFIGFILE="${WEBHARE_DATAROOT}config/nginx/nginx.conf"
while [ ! -f "$CONFIGFILE" ]; do
  echo "Nginx configuration file not found: $CONFIGFILE"
  sleep 1
done

exec nginx -c "$CONFIGFILE"
