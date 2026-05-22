#!/bin/bash
#
# Zettelkasten Brain Skill — Evolution Manager
# 管理 skill 版本：查看、回滚、手动进化
#

set -e

SKILL_DIR="${SKILL_DIR:-$(cd "$(dirname "$0")" && pwd)}"
ARCHIVE_DIR="$SKILL_DIR/ARCHIVE"
VERSION_FILE="$SKILL_DIR/VERSION"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[EVOLVE]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_version() { echo -e "${CYAN}$1${NC}"; }

# 显示用法
usage() {
    echo "Zettelkasten Brain Skill — Evolution Manager"
    echo ""
    echo "Usage:"
    echo "  $0 list              列出所有存档版本"
    echo "  $0 current           显示当前版本"
    echo "  $0 rollback <ver>   回滚到指定版本"
    echo "  $0 evolve            手动触发进化（创建快照）"
    echo "  $0 diff <ver1> [<ver2>] 对比两个版本"
    echo "  $0 metrics           显示进化指标"
    echo ""
    echo "Examples:"
    echo "  $0 list"
    echo "  $0 rollback v2026w19"
    echo "  $0 diff current v2026w19"
}

# 列出所有版本
cmd_list() {
    echo "========================================"
    echo "Zettelkasten Brain — Version Archive"
    echo "========================================"
    echo ""

    # 当前版本
    echo -e "${GREEN}[ACTIVE]${NC} Current"
    if [ -f "$VERSION_FILE" ]; then
        cat "$VERSION_FILE" | sed 's/^/  /'
    else
        echo "  (no version file)"
    fi
    echo ""

    # 存档版本
    if [ ! -d "$ARCHIVE_DIR" ] || [ -z "$(ls -A "$ARCHIVE_DIR" 2>/dev/null)" ]; then
        log_warn "No archived versions found"
        return
    fi

    echo "Archived Versions (newest first):"
    echo "----------------------------------------"

    for ver in $(ls -1 "$ARCHIVE_DIR" | grep '^v[0-9]\+w[0-9]\+$' | sort -r); do
        local meta="$ARCHIVE_DIR/$ver/META.json"
        local size=$(du -sh "$ARCHIVE_DIR/$ver" 2>/dev/null | cut -f1)

        if [ -f "$meta" ]; then
            local ts=$(grep '"timestamp"' "$meta" | cut -d'"' -f4 | cut -dT -f1)
            echo -e "  ${CYAN}$ver${NC}  $ts  ($size)"
        else
            echo -e "  ${CYAN}$ver${NC}  (no metadata)  ($size)"
        fi
    done
    echo ""
    log_info "Max backups: 5 (oldest auto-removed)"
}

# 显示当前版本
cmd_current() {
    echo "========================================"
    echo "Current Version"
    echo "========================================"
    echo ""

    if [ -f "$VERSION_FILE" ]; then
        cat "$VERSION_FILE"
    else
        log_error "No VERSION file found"
        exit 1
    fi

    echo ""
    echo "Files:"
    for f in SKILL.md PROMPT.md RULES.md VERSION; do
        if [ -f "$SKILL_DIR/$f" ]; then
            local size=$(wc -l < "$SKILL_DIR/$f" | tr -d ' ')
            echo "  $f ($size lines)"
        fi
    done
}

# 回滚到指定版本
cmd_rollback() {
    local target="$1"

    if [ -z "$target" ]; then
        log_error "Missing version. Usage: $0 rollback <version>"
        exit 1
    fi

    local target_dir="$ARCHIVE_DIR/$target"

    if [ ! -d "$target_dir" ]; then
        log_error "Version '$target' not found in archive"
        echo "Available versions:"
        ls -1 "$ARCHIVE_DIR" | grep '^v[0-9]\+w[0-9]\+$' | sort -r | sed 's/^/  /'
        exit 1
    fi

    echo "========================================"
    echo "Rollback to $target"
    echo "========================================"
    echo ""

    # 先备份当前版本
    local backup_week=$(date +%Y-%m-%d-%H%M%S)
    local backup_dir="$ARCHIVE_DIR/rollback-$backup_week"
    log_info "Creating safety backup: rollback-$backup_week"
    mkdir -p "$backup_dir"
    cp "$SKILL_DIR"/*.md "$SKILL_DIR/VERSION" "$backup_dir/" 2>/dev/null || true

    # 执行回滚
    log_warn "This will overwrite current skill files!"
    read -p "Continue? [y/N] " confirm

    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        log_info "Rollback cancelled"
        exit 0
    fi

    cp "$target_dir/SKILL.md" "$SKILL_DIR/"
    cp "$target_dir/PROMPT.md" "$SKILL_DIR/"
    cp "$target_dir/RULES.md" "$SKILL_DIR/"
    cp "$target_dir/VERSION" "$SKILL_DIR/"

    # 更新版本标记
    echo "rolled_back_from: $target" >> "$SKILL_DIR/VERSION"
    echo "rolled_back_at: $(date -Iseconds)" >> "$SKILL_DIR/VERSION"

    log_ok "Rollback complete! Current skill is now at $target"
    log_info "Safety backup: $backup_dir"
    log_warn "Restart OpenClaw Gateway to apply changes"
}

# 手动触发进化
cmd_evolve() {
    log_info "Triggering manual evolution..."
    bash "$SKILL_DIR/snapshot.sh"
    log_ok "Evolution snapshot created"
    log_info "You can now modify SKILL.md, PROMPT.md, or RULES.md"
    log_info "Next weekly snapshot will include your changes"
}

# 对比版本
cmd_diff() {
    local ver1="$1"
    local ver2="$2"

    if [ -z "$ver1" ]; then
        log_error "Usage: $0 diff <ver1> [<ver2>]"
        echo "Use 'current' for active version"
        exit 1
    fi

    # 解析路径
    local dir1 dir2
    if [ "$ver1" = "current" ]; then
        dir1="$SKILL_DIR"
    else
        dir1="$ARCHIVE_DIR/$ver1"
    fi

    if [ -z "$ver2" ] || [ "$ver2" = "current" ]; then
        dir2="$SKILL_DIR"
        ver2="current"
    else
        dir2="$ARCHIVE_DIR/$ver2"
    fi

    if [ ! -d "$dir1" ]; then
        log_error "Version '$ver1' not found"
        exit 1
    fi
    if [ ! -d "$dir2" ]; then
        log_error "Version '$ver2' not found"
        exit 1
    fi

    echo "========================================"
    echo "Diff: $ver1 → $ver2"
    echo "========================================"
    echo ""

    for f in SKILL.md PROMPT.md RULES.md; do
        local f1="$dir1/$f"
        local f2="$dir2/$f"

        if [ ! -f "$f1" ] && [ ! -f "$f2" ]; then
            continue
        fi

        echo -e "${YELLOW}--- $f ---${NC}"
        if command -v diff >/dev/null; then
            diff -u "$f1" "$f2" 2>/dev/null || true
        else
            echo "(diff command not available)"
        fi
        echo ""
    done
}

# 显示指标
cmd_metrics() {
    echo "========================================"
    echo "Evolution Metrics"
    echo "========================================"
    echo ""

    local metrics="$SKILL_DIR/FEEDBACK/metrics.json"

    if [ -f "$metrics" ]; then
        cat "$metrics" | python3 -m json.tool 2>/dev/null || cat "$metrics"
    else
        log_warn "No metrics data yet"
        echo ""
        echo "Metrics will be collected after first week of usage."
        echo "Current archive status:"
        local count=$(ls -1 "$ARCHIVE_DIR" 2>/dev/null | grep '^v[0-9]\+w[0-9]\+$' | wc -l)
        echo "  Archived versions: $count"
        echo "  Max retention: 5"
    fi
}

# 主入口
case "${1:-}" in
    list)
        cmd_list
        ;;
    current)
        cmd_current
        ;;
    rollback)
        cmd_rollback "$2"
        ;;
    evolve)
        cmd_evolve
        ;;
    diff)
        cmd_diff "$2" "$3"
        ;;
    metrics)
        cmd_metrics
        ;;
    *)
        usage
        exit 1
        ;;
esac
