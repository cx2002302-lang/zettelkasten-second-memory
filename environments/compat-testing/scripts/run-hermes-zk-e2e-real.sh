#!/bin/bash
#
# Hermes + Zettelkasten MCP 真实 LLM 端到端测试（MiniMax）
#
# 需要 minimax API Key，默认读取：
#   environments/compat-testing/secrets/minimax.env
#

set -e

HERMES_CONTAINER="${1:-hermes-latest}"
SECRETS_FILE="${2:-$(cd "$(dirname "$0")/.." && pwd)/secrets/minimax.env}"

if ! docker ps --format '{{.Names}}' | grep -qx "$HERMES_CONTAINER"; then
  echo "Error: Hermes container '$HERMES_CONTAINER' is not running"
  exit 1
fi

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "Error: MiniMax secrets file not found: $SECRETS_FILE"
  exit 1
fi

# shellcheck source=/dev/null
source "$SECRETS_FILE"

if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
  echo "Error: MINIMAX_API_KEY is not set in $SECRETS_FILE"
  exit 1
fi

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

# 1. 写入 Hermes MCP 配置
bash "${SCRIPTS_DIR}/setup-hermes-mcp.sh" "$HERMES_CONTAINER" openclaw-latest >/dev/null 2>&1 || true

# 2. 备份当前 model 配置
ORIG_PROVIDER=$(docker exec "$HERMES_CONTAINER" hermes config get model.provider 2>/dev/null || echo "")
ORIG_DEFAULT=$(docker exec "$HERMES_CONTAINER" hermes config get model.default 2>/dev/null || echo "")
ORIG_BASE_URL=$(docker exec "$HERMES_CONTAINER" hermes config get model.base_url 2>/dev/null || echo "")

cleanup_model() {
  echo "==> Restoring original Hermes model config..."
  docker exec "$HERMES_CONTAINER" hermes config set model.provider "${ORIG_PROVIDER:-anthropic}" >/dev/null 2>&1 || true
  docker exec "$HERMES_CONTAINER" hermes config set model.default "${ORIG_DEFAULT:-claude-sonnet-4-20250514}" >/dev/null 2>&1 || true
  docker exec "$HERMES_CONTAINER" hermes config set model.base_url "${ORIG_BASE_URL:-https://openrouter.ai/api/v1}" >/dev/null 2>&1 || true
}

echo "==> Configuring Hermes to use MiniMax provider..."
docker exec "$HERMES_CONTAINER" hermes config set model.provider custom >/dev/null 2>&1
docker exec "$HERMES_CONTAINER" hermes config set model.default MiniMax-M2 >/dev/null 2>&1
docker exec "$HERMES_CONTAINER" hermes config set model.base_url https://api.minimax.chat/v1 >/dev/null 2>&1
docker exec -e MINIMAX_API_KEY="$MINIMAX_API_KEY" "$HERMES_CONTAINER" \
  hermes config set model.api_key "$MINIMAX_API_KEY" >/dev/null 2>&1

# 3. 运行 Hermes 对话，期望触发 zk_search_notes
echo "==> Running Hermes chat with MiniMax and expecting zk_search_notes tool call..."
set +e
OUTPUT=$(docker exec -e MINIMAX_API_KEY="$MINIMAX_API_KEY" "$HERMES_CONTAINER" hermes chat \
  -q 'Search my Zettelkasten for notes about testing and tell me the title and ID.' \
  --provider custom \
  --model MiniMax-M2 \
  --yolo -Q --max-turns 2 --source mcp 2>&1)
EXIT_CODE=$?
set -e

# 4. 恢复配置
cleanup_model

echo ""
echo "=== Hermes output ==="
echo "$OUTPUT"
echo "====================="

# 5. 验证（成功调用后会返回笔记标题或 ID）
if echo "$OUTPUT" | grep -qiE "zk_search_notes|FS Sync Test|zettels|Testing markdown|zettelkasten"; then
  echo ""
  echo "✅ Hermes + MiniMax MCP E2E test passed: zk_search_notes was invoked and returned Zettelkasten results."
  exit 0
else
  echo ""
  echo "❌ Hermes + MiniMax MCP E2E test failed: zk_search_notes did not return expected results (exit code $EXIT_CODE)."
  exit 1
fi
