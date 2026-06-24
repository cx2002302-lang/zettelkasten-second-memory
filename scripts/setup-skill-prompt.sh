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

# 确保 alsoAllow 包含 zettelkasten（不破坏现有配置）
openclaw config set tools.alsoAllow '["zettelkasten"]' 2>/dev/null || true

# 写入 systemPromptOverride
openclaw config set agents.defaults.systemPromptOverride "$PROMPT"

echo "✅ zettelkasten-brain systemPromptOverride set (version: ${VERSION})"
echo "   Next: openclaw gateway restart"
