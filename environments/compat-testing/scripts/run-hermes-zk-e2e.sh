#!/bin/bash
#
# Hermes + Zettelkasten MCP 端到端测试
#
# 使用一个容器内的 mock LLM 服务器强制 Hermes 调用 zk_search_notes，
# 无需外部 API Key。
#

set -e

HERMES_CONTAINER="${1:-hermes-latest}"
MOCK_PORT="${2:-9876}"

if ! docker ps --format '{{.Names}}' | grep -qx "$HERMES_CONTAINER"; then
  echo "Error: Hermes container '$HERMES_CONTAINER' is not running"
  exit 1
fi

COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

# 1. 写入 Hermes MCP 配置
bash "${SCRIPTS_DIR}/setup-hermes-mcp.sh" "$HERMES_CONTAINER" openclaw-latest >/dev/null 2>&1 || true

# 2. 把 mock LLM 服务器复制进容器并启动
docker cp "${SCRIPTS_DIR}/mock-llm-server.py" "$HERMES_CONTAINER:/tmp/mock-llm-server.py"

echo "==> Starting mock LLM server in $HERMES_CONTAINER on port $MOCK_PORT..."
docker exec "$HERMES_CONTAINER" sh -c 'pkill -f "[m]ock-llm-server.py" || true'
docker exec -d "$HERMES_CONTAINER" python3 /tmp/mock-llm-server.py "$MOCK_PORT"
sleep 2

if ! docker exec "$HERMES_CONTAINER" sh -c "timeout 2 bash -c '</dev/tcp/localhost/$MOCK_PORT'" >/dev/null 2>&1; then
  echo "Error: mock LLM server failed to start"
  exit 1
fi

# 3. 备份当前 model 配置，并切换到 mock provider
ORIG_PROVIDER=$(docker exec "$HERMES_CONTAINER" hermes config get model.provider 2>/dev/null || echo "")
ORIG_DEFAULT=$(docker exec "$HERMES_CONTAINER" hermes config get model.default 2>/dev/null || echo "")
ORIG_BASE_URL=$(docker exec "$HERMES_CONTAINER" hermes config get model.base_url 2>/dev/null || echo "")

cleanup_model() {
  echo "==> Restoring original Hermes model config..."
  docker exec "$HERMES_CONTAINER" hermes config set model.provider "${ORIG_PROVIDER:-anthropic}" >/dev/null 2>&1 || true
  docker exec "$HERMES_CONTAINER" hermes config set model.default "${ORIG_DEFAULT:-claude-sonnet-4-20250514}" >/dev/null 2>&1 || true
  docker exec "$HERMES_CONTAINER" hermes config set model.base_url "${ORIG_BASE_URL:-https://openrouter.ai/api/v1}" >/dev/null 2>&1 || true
}

docker exec "$HERMES_CONTAINER" hermes config set model.provider custom >/dev/null 2>&1
docker exec "$HERMES_CONTAINER" hermes config set model.default mock-model >/dev/null 2>&1
docker exec "$HERMES_CONTAINER" hermes config set model.base_url "http://localhost:${MOCK_PORT}/v1" >/dev/null 2>&1
docker exec "$HERMES_CONTAINER" hermes config set model.api_key sk-mock >/dev/null 2>&1

# 4. 运行 Hermes 对话，期望触发 zk_search_notes
echo "==> Running Hermes chat and expecting zk_search_notes tool call..."
set +e
OUTPUT=$(docker exec "$HERMES_CONTAINER" hermes chat \
  -q 'Search my Zettelkasten for notes about testing.' \
  --provider custom \
  --model mock-model \
  --yolo -Q --max-turns 3 --source tool 2>&1)
EXIT_CODE=$?
set -e

# 5. 停止 mock 服务器并恢复配置
docker exec "$HERMES_CONTAINER" sh -c 'pkill -f "[m]ock-llm-server.py" || true'
cleanup_model

echo ""
echo "=== Hermes output ==="
echo "$OUTPUT"
echo "====================="

# 6. 验证
if echo "$OUTPUT" | grep -qi "zk_search_notes\|Zettelkasten search"; then
  echo ""
  echo "✅ Hermes MCP E2E test passed: zk_search_notes was invoked."
  exit 0
else
  echo ""
  echo "❌ Hermes MCP E2E test failed: zk_search_notes was not invoked (exit code $EXIT_CODE)."
  exit 1
fi
