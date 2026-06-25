#!/bin/bash
#
# 使用原始 docker run 启动单个 OpenClaw / Hermes 容器
# 绕过 docker-compose v1 与新 Docker 的兼容性问题
#

set -e

CONTAINER="${1:-}"
if [ -z "$CONTAINER" ]; then
  echo "Usage: $0 <container_name>"
  echo "Examples:"
  echo "  $0 openclaw-2026-4-23"
  echo "  $0 openclaw-2026-4-24"
  echo "  $0 openclaw-latest"
  echo "  $0 hermes-latest"
  exit 1
fi

COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$COMPOSE_DIR"

# 确保所有测试容器在同一个自定义网络，便于按容器名互相访问
NETWORK_NAME="compat-testing"
if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  docker network create "$NETWORK_NAME"
fi

# 加载 .env
if [ -f .env ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' .env | xargs)
fi

# 加载本目录 secrets/ 下的敏感配置
for secret in secrets/*.env; do
  if [ -f "$secret" ]; then
    # shellcheck disable=SC2046
    export $(grep -v '^#' "$secret" | xargs)
  fi
done

# 加载项目仓库外部的敏感配置，防止发布时泄露 API Key
EXTERNAL_SECRETS="${COMPOSE_DIR}/../../../zettelkasten-secrets"
if [ -d "$EXTERNAL_SECRETS" ]; then
  for secret in "$EXTERNAL_SECRETS"/*.env; do
    if [ -f "$secret" ]; then
      # shellcheck disable=SC2046
      export $(grep -v '^#' "$secret" | xargs)
    fi
  done
fi

# 项目源码在容器内的只读挂载点
SOURCE_MOUNT="/opt/zettelkasten-source"

init_volume() {
  local data_vol="$1"
  docker volume inspect "$data_vol" >/dev/null 2>&1 || docker volume create "$data_vol"
  docker run --rm \
    -v "${data_vol}:/data" \
    busybox sh -c 'mkdir -p /data && chown -R 1000:1000 /data'
}

seed_config() {
  local data_vol="$1"
  local cfg="$2"
  if [ -f "$cfg" ]; then
    docker run --rm \
      -v "${data_vol}:/data" \
      -v "${cfg}:/tmp/cfg.json:ro" \
      busybox sh -c 'cp /tmp/cfg.json /data/openclaw.json && chown 1000:1000 /data/openclaw.json && chmod 600 /data/openclaw.json'
  fi
}

start_openclaw() {
  local version="$1"
  local name="$2"
  local port="$3"
  local mcp_port="$4"
  local data_vol="compat-testing_oc-${version//./-}-data"

  docker rm -f "openclaw-${name}" 2>/dev/null || true
  init_volume "$data_vol"
  seed_config "$data_vol" "${COMPOSE_DIR}/config/openclaw-container.json"

  docker run -d \
    --name "openclaw-${name}" \
    --user node \
    --network "$NETWORK_NAME" \
    --restart unless-stopped \
    -p "${port}:18789" \
    -p "${mcp_port}:9090" \
    -e OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
    -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
    -e MINIMAX_API_KEY="${MINIMAX_API_KEY:-}" \
    -e OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
    -v "${data_vol}:/home/node/.openclaw" \
    -v "${COMPOSE_DIR}/../..:${SOURCE_MOUNT}:ro" \
    -v "${COMPOSE_DIR}/../../skills/brain:/home/node/.openclaw/skills/zettelkasten-brain:ro" \
    "ghcr.io/openclaw/openclaw:${version}" \
    node openclaw.mjs gateway --bind lan --allow-unconfigured
}

start_openclaw_latest() {
  local name="openclaw-latest"
  local port="18892"
  local mcp_port="19092"
  local data_vol="compat-testing_oc-latest-data"

  docker rm -f "$name" 2>/dev/null || true
  init_volume "$data_vol"
  # latest 版本（>= 2026.6.x）不再接受 agents.defaults.systemPromptOverride，
  # 且非 loopback 绑定需要显式 token。因此不预置旧版配置，留空由
  # --allow-unconfigured 启动，后续通过 CLI 注入插件配置。

  docker run -d \
    --name "$name" \
    --user node \
    --network "$NETWORK_NAME" \
    --restart unless-stopped \
    -p "${port}:18789" \
    -p "${mcp_port}:9090" \
    -e OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
    -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
    -e MINIMAX_API_KEY="${MINIMAX_API_KEY:-}" \
    -e OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
    -e OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-testtoken-compat}" \
    -v "${data_vol}:/home/node/.openclaw" \
    -v "${COMPOSE_DIR}/../..:${SOURCE_MOUNT}:ro" \
    -v "${COMPOSE_DIR}/../../skills/brain:/home/node/.openclaw/skills/zettelkasten-brain:ro" \
    "ghcr.io/openclaw/openclaw:latest" \
    node openclaw.mjs gateway --bind auto --allow-unconfigured
}

case "$CONTAINER" in
  openclaw-2026-4-23)
    start_openclaw "2026.4.23" "2026-4-23" "18890" "19090"
    ;;
  openclaw-2026-4-24)
    start_openclaw "2026.4.24" "2026-4-24" "18891" "19091"
    ;;
  openclaw-latest)
    start_openclaw_latest
    ;;
  hermes-latest)
    docker rm -f hermes-latest 2>/dev/null || true
    # Hermes 默认 hermes 命令是交互式 TUI，无终端会自动退出。
    # 测试环境用 sleep infinity 保持容器存活，便于后续 exec 探测版本。
    docker run -d \
      --name hermes-latest \
      --network "$NETWORK_NAME" \
      --restart unless-stopped \
      -p "8652:8642" \
      -p "9129:9119" \
      -e OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
      -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
      -e HERMES_LOG_LEVEL="${HERMES_LOG_LEVEL:-info}" \
      -v hermes-latest-data:/root/.hermes \
      nousresearch/hermes-agent:latest \
      sleep infinity
    ;;
  *)
    echo "Unknown container: $CONTAINER"
    exit 1
    ;;
esac

echo "==> Started $CONTAINER"
