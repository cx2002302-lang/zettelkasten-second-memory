#!/bin/bash
#
# Zettelkasten 发布脚本
# 从开发目录整理必要文件到发布目录
#
# 用法:
#   cd /home/myxia/.openclaw/project/zettelkasten
#   bash scripts/publish.sh
#

set -e

# 配置
DEV_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="${DEV_DIR}/zettelkasten-github"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[PUBLISH]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERR]${NC} $1"; }

echo "========================================"
echo "Zettelkasten 发布整理"
echo "开发目录: $DEV_DIR"
echo "发布目录: $RELEASE_DIR"
echo "========================================"

# 1. 检查开发目录
if [ ! -d "$DEV_DIR/src" ]; then
    log_error "开发目录 src/ 不存在: $DEV_DIR"
    exit 1
fi

# 2. 创建/清空发布目录（保留 .git）
log_info "[1/5] 准备发布目录..."
if [ ! -d "$RELEASE_DIR" ]; then
    mkdir -p "$RELEASE_DIR"
    log_info "创建发布目录"
else
    # 保留 .git 和 README 等已有文件，只清理 src/
    rm -rf "$RELEASE_DIR/src"
    rm -f "$RELEASE_DIR/scripts"/*.sh
    rm -f "$RELEASE_DIR/CHANGELOG.md"
    rm -f "$RELEASE_DIR/CONTRIBUTING.md"
    rm -f "$RELEASE_DIR/LICENSE"
    rm -f "$RELEASE_DIR/package.json"
    rm -f "$RELEASE_DIR/README.md"
    rm -f "$RELEASE_DIR/README.zh.md"
    rm -rf "$RELEASE_DIR/docs"
    rm -rf "$RELEASE_DIR/.github"
    log_info "清理发布目录旧内容"
fi

# 3. 复制必要文件
log_info "[2/5] 复制源码..."
mkdir -p "$RELEASE_DIR/src"
cp -r "$DEV_DIR/src/"* "$RELEASE_DIR/src/"

log_info "[3/5] 复制文档和配置..."
cp "$DEV_DIR/README.md" "$RELEASE_DIR/"
cp "$DEV_DIR/README.zh.md" "$RELEASE_DIR/" 2>/dev/null || true
cp "$DEV_DIR/LICENSE" "$RELEASE_DIR/"
cp "$DEV_DIR/CHANGELOG.md" "$RELEASE_DIR/"
cp "$DEV_DIR/CONTRIBUTING.md" "$RELEASE_DIR/"
cp "$DEV_DIR/package.json" "$RELEASE_DIR/"

log_info "[4/5] 复制脚本和工具..."
mkdir -p "$RELEASE_DIR/scripts"
cp "$DEV_DIR/scripts/deploy.sh" "$RELEASE_DIR/scripts/"
chmod +x "$RELEASE_DIR/scripts/deploy.sh"

mkdir -p "$RELEASE_DIR/.github/workflows"
cp "$DEV_DIR/.github/workflows/ci.yml" "$RELEASE_DIR/.github/workflows/" 2>/dev/null || true

mkdir -p "$RELEASE_DIR/docs/assets"
cp "$DEV_DIR/docs/assets/"* "$RELEASE_DIR/docs/assets/" 2>/dev/null || true
cp "$DEV_DIR/docs/README.md" "$RELEASE_DIR/docs/" 2>/dev/null || true

log_info "[5/5] 写入 .gitignore..."
cat > "$RELEASE_DIR/.gitignore" << 'EOF'
# Dependencies
node_modules/
package-lock.json
yarn.lock
pnpm-lock.yaml

# Build outputs
dist/
build/
*.tsbuildinfo

# Test outputs
coverage/
*.log

# Runtime data
*.db
*.db-journal
*.db-wal
*.db-shm
.zettelkasten/

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Archives
*.tar.gz
*.zip

# Temporary
tmp/
temp/
EOF

# 4. 验证
echo ""
echo "========================================"
log_ok "发布整理完成"
echo "========================================"
echo ""
echo "发布目录内容:"
echo "  文件数: $(find "$RELEASE_DIR" -type f -not -path '*/.git/*' | wc -l)"
echo "  代码行数: $(find "$RELEASE_DIR/src" -name '*.ts' -type f -exec cat {} \; | wc -l)"
echo ""
echo "下一步:"
echo "  cd zettelkasten-github"
echo "  git add ."
echo "  git commit -m '发布: xxx'"
echo "  git push origin main"
echo ""
