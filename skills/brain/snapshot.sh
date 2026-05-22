#!/bin/bash
#
# Zettelkasten Brain Skill — Weekly Snapshot
# 每周自动备份当前 skill 版本，保留最近5档
#

set -e

SKILL_DIR="${SKILL_DIR:-$(cd "$(dirname "$0")" && pwd)}"
ARCHIVE_DIR="$SKILL_DIR/ARCHIVE"
FEEDBACK_DIR="$SKILL_DIR/FEEDBACK"
VERSION_FILE="$SKILL_DIR/VERSION"
MAX_BACKUPS=5

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[SNAPSHOT]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 获取当前周
get_week_id() {
    local year=$(date +%Y)
    local week=$(date +%V)
    echo "v${year}w${week}"
}

# 确保目录存在
mkdir -p "$ARCHIVE_DIR" "$FEEDBACK_DIR"

CURRENT_WEEK=$(get_week_id)
SNAPSHOT_DIR="$ARCHIVE_DIR/$CURRENT_WEEK"

log_info "Starting weekly snapshot: $CURRENT_WEEK"

# 检查是否已存在
if [ -d "$SNAPSHOT_DIR" ]; then
    log_warn "Snapshot $CURRENT_WEEK already exists, overwriting..."
    rm -rf "$SNAPSHOT_DIR"
fi

# 创建快照
mkdir -p "$SNAPSHOT_DIR"
cp "$SKILL_DIR/SKILL.md" "$SNAPSHOT_DIR/"
cp "$SKILL_DIR/PROMPT.md" "$SNAPSHOT_DIR/"
cp "$SKILL_DIR/RULES.md" "$SNAPSHOT_DIR/"
cp "$SKILL_DIR/VERSION" "$SNAPSHOT_DIR/"

# 复制反馈数据（如果有）
if [ -f "$FEEDBACK_DIR/metrics.json" ]; then
    cp "$FEEDBACK_DIR/metrics.json" "$SNAPSHOT_DIR/"
fi

# 记录快照元数据
cat > "$SNAPSHOT_DIR/META.json" << EOF
{
  "week": "$CURRENT_WEEK",
  "timestamp": "$(date -Iseconds)",
  "version": "$(cat "$VERSION_FILE" 2>/dev/null || echo 'unknown')",
  "files": ["SKILL.md", "PROMPT.md", "RULES.md", "VERSION"]
}
EOF

log_ok "Snapshot created: $SNAPSHOT_DIR"

# 清理旧备份
log_info "Checking old backups (max: $MAX_BACKUPS)..."

BACKUP_COUNT=$(ls -1 "$ARCHIVE_DIR" | grep '^v[0-9]\+w[0-9]\+$' | wc -l)
log_info "Found $BACKUP_COUNT backup(s)"

if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
    # 按名称排序，删除最旧的
    TO_DELETE=$(ls -1 "$ARCHIVE_DIR" | grep '^v[0-9]\+w[0-9]\+$' | sort | head -n $((BACKUP_COUNT - MAX_BACKUPS)))
    for old in $TO_DELETE; do
        log_warn "Removing old backup: $old"
        rm -rf "$ARCHIVE_DIR/$old"
    done
fi

# 更新版本文件中的下次进化时间
NEXT_WEEK=$(date -d '+7 days' +%Y-%m-%d)
if [ -f "$VERSION_FILE" ]; then
    sed -i "s/^next_evolution:.*/next_evolution: $NEXT_WEEK/" "$VERSION_FILE"
fi

log_ok "Snapshot complete. Next evolution: $NEXT_WEEK"

# 统计信息
REMAINING=$(ls -1 "$ARCHIVE_DIR" | grep '^v[0-9]\+w[0-9]\+$' | wc -l)
log_info "Total backups: $REMAINING"
