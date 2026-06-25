#!/bin/bash
#
# 测试 Hermes 是否能通过 MCP 连接到 Zettelkasten bridge
#

set -e

OPENCLAW_CONTAINER="${1:-openclaw-latest}"
HERMES_CONTAINER="${2:-hermes-latest}"

if ! docker ps --format '{{.Names}}' | grep -qx "$HERMES_CONTAINER"; then
  echo "Error: Hermes container '$HERMES_CONTAINER' is not running"
  exit 1
fi

COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# 先写入 Hermes MCP 配置
bash "${COMPOSE_DIR}/scripts/setup-hermes-mcp.sh" "$HERMES_CONTAINER" "$OPENCLAW_CONTAINER"

echo "==> Testing Hermes MCP connection to zettelkasten..."
docker exec "$HERMES_CONTAINER" hermes mcp test zettelkasten

echo "==> Listing configured MCP servers..."
docker exec "$HERMES_CONTAINER" hermes mcp list

echo "==> ✅ Hermes MCP test complete"
