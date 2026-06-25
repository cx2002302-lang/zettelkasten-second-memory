#!/bin/bash
#
# 使用 OpenClaw agent CLI 对 Zettelkasten 项目内容进行测试
# 依赖：容器已启动并已挂载项目源码到 /opt/zettelkasten-source
#
# Usage:
#   bash scripts/run-agent-project-test.sh <container> [prompt]
#
# Example:
#   bash scripts/run-agent-project-test.sh openclaw-2026-4-24
#   bash scripts/run-agent-project-test.sh openclaw-latest "review"

set -e

CONTAINER="${1:-openclaw-2026-4-24}"
MODE="${2:-health}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Error: container '$CONTAINER' is not running"
  exit 1
fi

# 检查容器内是否有 MINIMAX_API_KEY
if ! docker exec "$CONTAINER" env | grep -q "MINIMAX_API_KEY"; then
  echo "Warning: MINIMAX_API_KEY not found in container env"
fi

REPORT_DIR="reports/agent-tests"
mkdir -p "$REPORT_DIR"
REPORT_FILE="$REPORT_DIR/${CONTAINER}-$(date +%Y%m%d-%H%M%S).md"

case "$MODE" in
  health|status)
    PROMPT="忽略 BOOTSTRAP.md 和身份引导流程，直接执行任务。你是 Zettelkasten 项目的测试代理。请完成以下任务并给出结构化报告：
1. 阅读 /opt/zettelkasten-source/AGENTS.md，确认项目关键约束。
2. 阅读 /opt/zettelkasten-source/src/plugin/openclaw.plugin.json，确认插件入口与激活方式。
3. 调用 zk_knowledge_audit 检查当前知识库健康度。
4. 调用 zk_glow_ranking 查看笔记发光度分布（limit 10）。
5. 给出结论：项目配置是否符合 AGENTS.md 规范，知识库是否有异常。"
    ;;
  review)
    PROMPT="忽略 BOOTSTRAP.md 和身份引导流程，直接执行任务。你是 Zettelkasten 项目的代码审查代理。请完成以下任务：
1. 阅读 /opt/zettelkasten-source/src/plugin/lifecycle.ts 和 /opt/zettelkasten-source/src/service/note-service.ts 的关键部分。
2. 调用 zk_search_notes 搜索 'docker' 或 'compat' 相关笔记（limit 5）。
3. 给出一份简短的代码健康度评估：是否有明显错误、是否遵循项目规范、是否有改进建议。"
    ;;
  *)
    PROMPT="$MODE"
    ;;
esac

echo "==> Running agent test on $CONTAINER (mode: $MODE)"
echo "==> Report will be saved to $REPORT_FILE"

{
  echo "# Agent Project Test Report"
  echo ""
  echo "- Container: $CONTAINER"
  echo "- Mode: $MODE"
  echo "- Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo ""
  echo "## Prompt"
  echo ""
  echo "\`\`\`"
  echo "$PROMPT"
  echo "\`\`\`"
  echo ""
  echo "## Agent Output"
  echo ""
  echo "\`\`\`"
} > "$REPORT_FILE"

# 根据 OpenClaw 版本选择运行模式
# - 2026.4.x embedded agent --local 会挂起，改用 gateway 模式
# - 2026.6.x+ --local 可用
OC_VERSION=$(docker exec "$CONTAINER" openclaw --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
if echo "$OC_VERSION" | grep -qE '^2026\.(6|7|8|9|[0-9]{2})\.'; then
  AGENT_MODE="local"
  THINKING_LEVEL="${AGENT_THINKING:-off}"
else
  AGENT_MODE="gateway"
  THINKING_LEVEL="${AGENT_THINKING:-medium}"
fi

echo "==> OpenClaw $OC_VERSION detected, using $AGENT_MODE agent mode, thinking=$THINKING_LEVEL"

# 运行 agent，超时 5 分钟
if [ "$AGENT_MODE" = "local" ]; then
  docker exec "$CONTAINER" timeout 300 openclaw agent \
    --local \
    --agent main \
    --thinking "$THINKING_LEVEL" \
    --message "$PROMPT" \
    --verbose on \
    2>&1 | tee -a "$REPORT_FILE" || true
else
  docker exec "$CONTAINER" timeout 300 openclaw agent \
    --agent main \
    --thinking "$THINKING_LEVEL" \
    --message "$PROMPT" \
    --verbose on \
    2>&1 | tee -a "$REPORT_FILE" || true
fi

{
  echo ""
  echo "\`\`\`"
  echo ""
  echo "## Test Status"
  echo ""
} >> "$REPORT_FILE"

# 判断 agent 是否真正完成：
# - 2026.6.x --local 会输出 "[agent] run ... ended with stopReason="
# - 2026.4.x gateway/embedded 会输出 "[agent/embedded] embedded run done: ... aborted=false"
#   以及 "reason=run_completed"，但没有 stopReason 行
if (grep -qE '\[agent\] run .* ended with stopReason=' "$REPORT_FILE" || \
    grep -qE '\[agent/embedded\] embedded run done: .* aborted=false' "$REPORT_FILE" || \
    grep -q '报告完毕' "$REPORT_FILE") && [ "$(wc -c < "$REPORT_FILE")" -gt 5120 ]; then
  echo "✅ Agent run completed successfully (mode: $AGENT_MODE)" >> "$REPORT_FILE"
  echo ""
  echo "==> ✅ Done. Report saved to $REPORT_FILE"
else
  echo "❌ Agent run did not complete (mode: $AGENT_MODE, likely hung at codex catalog fallback or API error)" >> "$REPORT_FILE"
  echo ""
  echo "==> ❌ Warning: Agent run did not complete. Report saved to $REPORT_FILE"
fi
