#!/bin/bash
#
# 在 Hermes 测试容器中写入 MCP 配置，使其能连接 OpenClaw 容器里的 Zettelkasten MCP bridge
#

set -e

CONTAINER="${1:-hermes-latest}"
OPENCLAW_HOST="${2:-openclaw-latest}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Error: container '$CONTAINER' is not running"
  exit 1
fi

COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Configuring Hermes MCP server in $CONTAINER..."

# Hermes Docker 镜像将配置放在 /opt/data/config.yaml
CONFIG_FILE="/opt/data/config.yaml"

# 使用 Python 将 mcp_servers 合并到现有 Hermes 配置中
docker exec -i "$CONTAINER" python3 - "$CONFIG_FILE" "$OPENCLAW_HOST" <<'PY'
import sys, yaml, os
config_file = sys.argv[1]
openclaw_host = sys.argv[2]

with open(config_file, 'r') as f:
    cfg = yaml.safe_load(f) or {}

if 'mcp_servers' not in cfg:
    cfg['mcp_servers'] = {}

cfg['mcp_servers']['zettelkasten'] = {
    'type': 'http',
    'url': f'http://{openclaw_host}:9090/mcp',
    'enabled': True,
}

with open(config_file, 'w') as f:
    yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True)

print(f'Updated {config_file}')
PY

echo "==> Hermes MCP config updated in $CONFIG_FILE"
echo "==> You can now run: docker exec -it $CONTAINER hermes mcp test zettelkasten"
