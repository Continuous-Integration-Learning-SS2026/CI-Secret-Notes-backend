#!/usr/bin/env bash
# Blue/Green cutover: point the nginx load balancer at the given color and
# reload it with zero downtime.
# Usage: ./deploy/switch-blue-green.sh blue|green
set -euo pipefail

COLOR="${1:-}"
if [[ "$COLOR" != "blue" && "$COLOR" != "green" ]]; then
  echo "Usage: $0 blue|green" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_DIR="$SCRIPT_DIR/nginx"

echo "Switching active color to: $COLOR"
ln -sfn "upstream-${COLOR}.conf" "$NGINX_DIR/active-upstream.conf"

docker compose -f "$SCRIPT_DIR/../docker-compose.prod.yml" exec lb nginx -t
docker compose -f "$SCRIPT_DIR/../docker-compose.prod.yml" exec lb nginx -s reload

echo "Now serving: $COLOR"