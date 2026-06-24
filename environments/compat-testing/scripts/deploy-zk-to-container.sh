#!/bin/bash
#
# 向指定 OpenClaw 容器部署 Zettelkasten 插件并注入 Skill 配置
#

set -e

CONTAINER="${1:-}"
if [ -z "$CONTAINER" ]; then
  echo "Usage: $0 <container_name>"
  echo "Example: $0 openclaw-2026-4-24"
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Error: container '$CONTAINER' is not running"
  exit 1
fi

echo "==> Deploying Zettelkasten plugin to $CONTAINER..."
docker exec "$CONTAINER" bash /root/.openclaw/zettelkasten-plugin/scripts/deploy.sh

echo "==> Setting up zettelkasten-brain skill prompt..."
docker exec "$CONTAINER" bash /root/.openclaw/zettelkasten-plugin/scripts/setup-skill-prompt.sh

echo "==> Restarting OpenClaw gateway in $CONTAINER..."
docker exec "$CONTAINER" openclaw gateway restart || true

echo "==> Verifying health..."
docker exec "$CONTAINER" openclaw zk doctor

echo "==> Done: $CONTAINER"
