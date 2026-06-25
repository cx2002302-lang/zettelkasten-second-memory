#!/bin/bash
#
# 设置 zettelkasten-brain Skill 的 systemPromptOverride
# 读取项目 skills/brain/PROMPT.md 并替换动态占位符
#

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_DIR="${PROJECT_DIR}/skills/brain"
VERSION_FILE="${SKILL_DIR}/VERSION"
PROMPT_FILE="${SKILL_DIR}/PROMPT.md"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "Error: PROMPT.md not found at $PROMPT_FILE" >&2
  exit 1
fi

# 从 VERSION 文件解析参数
VERSION=$(grep '^version:' "$VERSION_FILE" | awk -F': ' '{print $2}' | tr -d ' ')
STAGE=$(grep '^stage:' "$VERSION_FILE" | awk -F': ' '{print $2}' | tr -d ' ')
NEXT_EVOLUTION=$(grep '^next_evolution:' "$VERSION_FILE" | awk -F': ' '{print $2}' | tr -d ' ')
SENSITIVITY=$(grep '^  sensitivity:' "$VERSION_FILE" | awk -F': ' '{print $2}' | tr -d ' ')
SEARCH_DEPTH=$(grep '^  search_depth:' "$VERSION_FILE" | awk -F': ' '{print $2}' | tr -d ' ')
LINK_THRESHOLD=$(grep '^  link_threshold:' "$VERSION_FILE" | awk -F': ' '{print $2}' | tr -d ' ')
TAG_LIMIT=$(grep '^  tag_limit:' "$VERSION_FILE" | awk -F': ' '{print $2}' | tr -d ' ')
AUTO_ARCHIVE=$(grep '^  auto_archive:' "$VERSION_FILE" | awk -F': ' '{print $2}' | tr -d ' ')

# 读取并替换占位符
PROMPT=$(cat "$PROMPT_FILE" | sed \
  -e "s/{{VERSION}}/${VERSION}/g" \
  -e "s/{{DATE}}/$(date -u +%Y-%m-%d)/g" \
  -e "s/{{STAGE}}/${STAGE}/g" \
  -e "s/{{NEXT_EVOLUTION}}/${NEXT_EVOLUTION}/g" \
  -e "s/{{SENSITIVITY}}/${SENSITIVITY}/g" \
  -e "s/{{SEARCH_DEPTH}}/${SEARCH_DEPTH}/g" \
  -e "s/{{LINK_THRESHOLD}}/${LINK_THRESHOLD}/g" \
  -e "s/{{TAG_LIMIT}}/${TAG_LIMIT}/g" \
  -e "s/{{AUTO_ARCHIVE}}/${AUTO_ARCHIVE}/g")

# 检测 OpenClaw 版本，配置正确的工具策略
OC_VERSION=$(openclaw --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "")
if echo "$OC_VERSION" | grep -qE '^2026\.(6|7|8|9|[0-9]{2})\.'; then
  # 2026.6.x+ 工具策略：插件工具通过 contracts.tools 声明，allowlist 可用 group:plugins 或插件 ID
  openclaw config set tools.alsoAllow '["group:plugins"]' 2>/dev/null || true
else
  openclaw config set tools.alsoAllow '["zettelkasten"]' 2>/dev/null || true
fi

# 写入 systemPromptOverride（2026.6.x+ 已移除该字段，忽略失败）
if openclaw config set agents.defaults.systemPromptOverride "$PROMPT" 2>/dev/null; then
  echo "✅ zettelkasten-brain systemPromptOverride set (version: ${VERSION})"
else
  echo "⚠️ agents.defaults.systemPromptOverride not supported on OpenClaw ${OC_VERSION}; skipped"
fi

echo "   Next: openclaw gateway restart"
