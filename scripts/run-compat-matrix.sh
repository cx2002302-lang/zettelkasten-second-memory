#!/bin/bash
#
# Zettelkasten 兼容性矩阵测试（本地）
#
# 一键运行：
#   - 宿主机单元测试
#   - MCP bridge 构建
#   - 每个运行中的 OpenClaw 容器：部署插件、doctor、agent 工具可见性
#   - 每个运行中的 Hermes 容器：MCP 连通性、mock LLM E2E
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# shellcheck source=lib/compat.sh
source "$SCRIPT_DIR/lib/compat.sh"

PASS=0
FAIL=0
RESULTS=""

record() {
  local status="$1"
  local name="$2"
  if [[ "$status" -eq 0 ]]; then
    PASS=$((PASS + 1))
    echo "✅ $name"
    RESULTS="${RESULTS}✅ $name\n"
  else
    FAIL=$((FAIL + 1))
    echo "❌ $name"
    RESULTS="${RESULTS}❌ $name\n"
  fi
}

# 1. 宿主机测试
echo "==> [Host] Running unit tests..."
cd "$PROJECT_DIR"
if npm test >/tmp/zk-npm-test.log 2>&1; then
  record 0 "npm test"
else
  tail -30 /tmp/zk-npm-test.log
  record 1 "npm test"
fi

echo "==> [Host] Building MCP bridge..."
if npm run build:bridge >/tmp/zk-build-bridge.log 2>&1; then
  record 0 "npm run build:bridge"
else
  tail -20 /tmp/zk-build-bridge.log
  record 1 "npm run build:bridge"
fi

# 2. OpenClaw 容器测试
OPENCLAW_CONTAINERS=$(docker ps --format '{{.Names}}' | grep -E '^openclaw' || true)
if [[ -z "$OPENCLAW_CONTAINERS" ]]; then
  echo "⚠️  No OpenClaw containers found, skipping container tests"
fi

for CONTAINER in $OPENCLAW_CONTAINERS; do
  echo ""
  echo "==> [OpenClaw] Testing $CONTAINER..."
  OC_VERSION=$(docker exec "$CONTAINER" openclaw --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
  echo "    Version: $OC_VERSION"

  if bash "$PROJECT_DIR/environments/compat-testing/scripts/deploy-zk-to-container.sh" "$CONTAINER" >/tmp/zk-deploy-$CONTAINER.log 2>&1; then
    record 0 "deploy to $CONTAINER"
  else
    tail -20 /tmp/zk-deploy-$CONTAINER.log
    record 1 "deploy to $CONTAINER"
    continue
  fi

  if docker exec "$CONTAINER" openclaw zk doctor >/tmp/zk-doctor-$CONTAINER.log 2>&1; then
    record 0 "zk doctor on $CONTAINER"
  else
    tail -20 /tmp/zk-doctor-$CONTAINER.log
    record 1 "zk doctor on $CONTAINER"
  fi

  # agent 工具可见性：检查系统提示词中是否包含 zk_ 工具
  timeout 30 docker exec "$CONTAINER" openclaw agent --local --to +1234567890 \
    --message '搜索 Zettelkasten 里关于 testing 的笔记' \
    --verbose on --json --timeout 15 >/tmp/zk-agent-$CONTAINER.log 2>&1 || true
  if grep -q "zk_" /tmp/zk-agent-$CONTAINER.log; then
    record 0 "agent sees zk tools on $CONTAINER"
  else
    record 1 "agent sees zk tools on $CONTAINER"
  fi
done

# 3. Hermes 容器测试
HERMES_CONTAINERS=$(docker ps --format '{{.Names}}' | grep -E '^hermes' || true)
if [[ -z "$HERMES_CONTAINERS" ]]; then
  echo "⚠️  No Hermes containers found, skipping Hermes tests"
fi

for CONTAINER in $HERMES_CONTAINERS; do
  echo ""
  echo "==> [Hermes] Testing $CONTAINER..."

  if docker exec "$CONTAINER" hermes mcp test zettelkasten >/tmp/zk-mcp-$CONTAINER.log 2>&1; then
    record 0 "Hermes MCP test on $CONTAINER"
  else
    tail -20 /tmp/zk-mcp-$CONTAINER.log
    record 1 "Hermes MCP test on $CONTAINER"
  fi

  if bash "$PROJECT_DIR/environments/compat-testing/scripts/run-hermes-zk-e2e.sh" "$CONTAINER" >/tmp/zk-hermes-$CONTAINER.log 2>&1; then
    record 0 "Hermes mock E2E on $CONTAINER"
  else
    tail -20 /tmp/zk-hermes-$CONTAINER.log
    record 1 "Hermes mock E2E on $CONTAINER"
  fi
done

# 4. 汇总
echo ""
echo "========================================"
echo "Compatibility Matrix Summary"
echo "========================================"
printf "%b" "$RESULTS"
echo "----------------------------------------"
echo "Passed: $PASS"
echo "Failed: $FAIL"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
