#!/bin/bash
#
# 向指定 OpenClaw 容器部署 Zettelkasten 插件并注入 Skill 配置
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=../../../scripts/lib/compat.sh
source "$SCRIPT_DIR/../../../scripts/lib/compat.sh"

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

OC_VERSION=$(docker exec "$CONTAINER" openclaw --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
echo "==> Detected OpenClaw version: $OC_VERSION"

echo "==> Deploying Zettelkasten plugin to $CONTAINER..."
docker exec "$CONTAINER" bash /opt/zettelkasten-source/scripts/deploy.sh

echo "==> Ensuring tools.alsoAllow is compatible..."
TOOL_POLICY=$(tool_policy_for_version "$OC_VERSION")
docker exec "$CONTAINER" openclaw config set tools.alsoAllow "[\"$TOOL_POLICY\"]" 2>/dev/null || true

echo "==> Ensuring agents.defaults.skills contains zettelkasten-brain..."
docker exec "$CONTAINER" openclaw config set agents.defaults.skills '["zettelkasten-brain"]' 2>/dev/null || true

echo "==> Ensuring default agent model uses MiniMax (if MINIMAX_API_KEY present)..."
if docker exec "$CONTAINER" env | grep -q "MINIMAX_API_KEY"; then
  # OpenClaw >= 2026.6.x 内置 minimax provider 走 anthropic-messages，与 sk-cp- 类 CN key 不兼容
  # 因此为其配置 OpenAI-compatible 自定义 provider
  if version_ge "$OC_VERSION" "2026.6.0"; then
    echo "   Detected OpenClaw $OC_VERSION, configuring minimax-openai compatible provider..."
    docker exec "$CONTAINER" node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('/home/node/.openclaw/openclaw.json', 'utf8'));
cfg.models = {
  mode: 'merge',
  providers: {
    'minimax-openai': {
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey: '\${MINIMAX_API_KEY}',
      api: 'openai-completions',
      contextWindow: 1000000,
      contextTokens: 800000,
      maxTokens: 32000,
      models: [{
        id: 'MiniMax-M3',
        name: 'MiniMax-M3',
        reasoning: false,
        input: ['text'],
        contextWindow: 1000000,
        contextTokens: 800000,
        maxTokens: 32000
      }]
    }
  }
};
if (!cfg.agents) cfg.agents = {};
if (!cfg.agents.defaults) cfg.agents.defaults = {};
if (!cfg.agents.defaults.model) cfg.agents.defaults.model = {};
cfg.agents.defaults.model.primary = 'minimax-openai/MiniMax-M3';
fs.writeFileSync('/home/node/.openclaw/openclaw.json', JSON.stringify(cfg, null, 2));
"
  else
    docker exec "$CONTAINER" openclaw config set agents.defaults.model.primary minimax/MiniMax-M3 2>/dev/null || true
  fi
fi

echo "==> Configuring gateway for agent CLI tests on 2026.4.x..."
if [[ "$OC_VERSION" =~ ^2026\.4\. ]]; then
  # 2026.4.x embedded agent --local 会挂起，改用 gateway 模式
  # 需要 bind=loopback 使 agent CLI 能连上 gateway，并禁用 bonjour 防止容器内 mDNS 崩溃导致 gateway 重启
  docker exec "$CONTAINER" openclaw config set gateway.bind loopback 2>/dev/null || true
  docker exec "$CONTAINER" node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('/home/node/.openclaw/openclaw.json', 'utf8'));
if (!cfg.plugins) cfg.plugins = {};
if (!cfg.plugins.entries) cfg.plugins.entries = {};
cfg.plugins.entries.bonjour = { enabled: false };
fs.writeFileSync('/home/node/.openclaw/openclaw.json', JSON.stringify(cfg, null, 2));
"
fi

echo "==> Setting up zettelkasten-brain skill prompt (best-effort)..."
if supports_system_prompt_override_for_version "$OC_VERSION"; then
  docker exec "$CONTAINER" bash /opt/zettelkasten-source/scripts/setup-skill-prompt.sh 2>/dev/null || echo "   (skill prompt setup failed or not applicable)"
else
  echo "   OpenClaw $OC_VERSION does not support systemPromptOverride; skipping skill prompt setup"
fi

# setup-skill-prompt.sh 会把 alsoAllow 重置为 zettelkasten，需要按版本重新应用
TOOL_POLICY=$(tool_policy_for_version "$OC_VERSION")
echo "==> Re-applying tool policy ($TOOL_POLICY)..."
docker exec "$CONTAINER" openclaw config set tools.alsoAllow "[\"$TOOL_POLICY\"]" 2>/dev/null || true

echo "==> Restarting container to apply config changes..."
docker restart "$CONTAINER"
sleep 10

echo "==> Initializing Zettelkasten schema and notes directory..."
docker exec "$CONTAINER" openclaw zk init

echo "==> Verifying health..."
docker exec "$CONTAINER" openclaw zk doctor

echo "==> Building Zettelkasten MCP bridge on host..."
cd "${COMPOSE_DIR}/../.." && npm run build:bridge && cd -

echo "==> Refreshing OpenClaw plugin registry to pick up manifest changes..."
docker exec "$CONTAINER" openclaw plugins registry --refresh 2>/dev/null || true

echo "==> Starting Zettelkasten MCP bridge for Hermes integration..."
docker exec -d \
  -e ZETTELKASTEN_DB_PATH=/home/node/.openclaw/zettelkasten/zettelkasten.db \
  -e ZETTELKASTEN_NOTES_DIR=/home/node/.openclaw/zettelkasten/notes \
  -e ZETTELKASTEN_MCP_PORT=9090 \
  "$CONTAINER" \
  node /opt/zettelkasten-source/dist/mcp/http-bridge.js
sleep 2

# 简单探测 bridge 是否监听
if docker exec "$CONTAINER" sh -c 'nc -z localhost 9090' >/dev/null 2>&1 || docker exec "$CONTAINER" sh -c 'timeout 2 bash -c "</dev/tcp/localhost/9090"' >/dev/null 2>&1; then
  echo "   MCP bridge is listening on port 9090"
else
  echo "   Warning: MCP bridge may not be ready yet (check /home/node/.openclaw/zk-mcp-bridge.log)"
fi

echo "==> Done: $CONTAINER"
