#!/bin/bash
#
# Zettelkasten 发布脚本
# 从开发目录整理必要文件到 zettelkasten-github 发布目录
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
log_info "[1/6] 准备发布目录..."
if [ ! -d "$RELEASE_DIR" ]; then
    mkdir -p "$RELEASE_DIR"
    log_info "创建发布目录"
else
    # 保留 .git，清理其它所有内容
    find "$RELEASE_DIR" -mindepth 1 -maxdepth 1 -not -name '.git' -exec rm -rf {} +
    log_info "清理发布目录旧内容"
fi

# 3. 复制源码
log_info "[2/6] 复制源码..."
mkdir -p "$RELEASE_DIR/src"
cp -r "$DEV_DIR/src/"* "$RELEASE_DIR/src/"
# src/skills/brain 与根目录 skills/brain 重复，且包含旧版本/运行时数据，发布时排除
rm -rf "$RELEASE_DIR/src/skills"

# 4. 复制文档和配置
log_info "[3/6] 复制文档和配置..."
cp "$DEV_DIR/README.md" "$RELEASE_DIR/"
cp "$DEV_DIR/README.zh.md" "$RELEASE_DIR/" 2>/dev/null || true
cp "$DEV_DIR/LICENSE" "$RELEASE_DIR/"
cp "$DEV_DIR/CHANGELOG.md" "$RELEASE_DIR/"
cp "$DEV_DIR/CONTRIBUTING.md" "$RELEASE_DIR/" 2>/dev/null || true
cp "$DEV_DIR/DEVELOPMENT.md" "$RELEASE_DIR/" 2>/dev/null || true
cp "$DEV_DIR/package.json" "$RELEASE_DIR/"
cp "$DEV_DIR/AGENTS.md" "$RELEASE_DIR/"

mkdir -p "$RELEASE_DIR/docs"
cp "$DEV_DIR/docs/TESTING_GUIDE.md" "$RELEASE_DIR/docs/" 2>/dev/null || true
cp "$DEV_DIR/docs/COMPATIBILITY.md" "$RELEASE_DIR/docs/" 2>/dev/null || true
if [ -d "$DEV_DIR/docs/assets" ]; then
    mkdir -p "$RELEASE_DIR/docs/assets"
    cp "$DEV_DIR/docs/assets/"* "$RELEASE_DIR/docs/assets/" 2>/dev/null || true
fi

# 4.1 清理发布文档中的内部信息
log_info "[3.1/6] 清理文档中的内部信息..."

# AGENTS.md：移除 Hermes 测试环境命令块（发布包不含这些脚本）
if [ -f "$RELEASE_DIR/AGENTS.md" ]; then
  sed -i '/^# Hermes Agent 接入（测试环境）$/,/^```$/d' "$RELEASE_DIR/AGENTS.md"
fi

# COMPATIBILITY.md：泛化内部路径与容器名，移除 MiniMax 真实 LLM 测试
sed -i \
  -e 's|hermes-latest|<hermes-container>|g' \
  -e 's|openclaw-latest|<openclaw-container>|g' \
  -e 's|/home/myxia/.openclaw/project/zettelkasten-secrets/minimax.env|<minimax-env-file>|g' \
  -e 's|environments/compat-testing/scripts/|<test-env>/scripts/|g' \
  "$RELEASE_DIR/docs/COMPATIBILITY.md" 2>/dev/null || true

# 用 Python 精确删除 MiniMax E2E 命令块
python3 - "$RELEASE_DIR/docs/COMPATIBILITY.md" <<'PY'
import sys
path = sys.argv[1]
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()
out = []
skip = False
for line in lines:
    if line.startswith('# 4. Hermes + MiniMax'):
        skip = True
        continue
    if skip and '<minimax-env-file>' in line:
        skip = False
        continue
    if not skip:
        out.append(line)
with open(path, 'w', encoding='utf-8') as f:
    f.writelines(out)
PY

# 5. 复制脚本
log_info "[4/6] 复制脚本..."
mkdir -p "$RELEASE_DIR/scripts"
cp "$DEV_DIR/scripts/deploy.sh" "$RELEASE_DIR/scripts/"
cp "$DEV_DIR/scripts/setup-skill-prompt.sh" "$RELEASE_DIR/scripts/"
cp -r "$DEV_DIR/scripts/lib" "$RELEASE_DIR/scripts/"
chmod +x "$RELEASE_DIR/scripts/deploy.sh"
chmod +x "$RELEASE_DIR/scripts/setup-skill-prompt.sh"
chmod +x "$RELEASE_DIR/scripts/lib/"*.sh

# 6. 复制 Skill
log_info "[5/6] 复制 Skill..."
if [ -d "$DEV_DIR/skills/brain" ]; then
    mkdir -p "$RELEASE_DIR/skills"
    cp -r "$DEV_DIR/skills/brain" "$RELEASE_DIR/skills/"
fi

# 7. 复制 CI workflow
log_info "[6/6] 复制 CI workflow..."
if [ -f "$DEV_DIR/.github/workflows/ci.yml" ]; then
    mkdir -p "$RELEASE_DIR/.github/workflows"
    cp "$DEV_DIR/.github/workflows/ci.yml" "$RELEASE_DIR/.github/workflows/"
fi

# 8. 写入 .gitignore
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

# Internal release directories
releases/
zettelkasten-release/
zettelkasten-github/
.audit-reports/
EOF

# 9. 敏感信息检查（阻止发布）
log_info "[7/6] 敏感信息检查..."
VIOLATIONS=""

# 检查 MiniMax API Key 模式
grep -rIinE 'sk-[a-zA-Z0-9]{20,}' "$RELEASE_DIR" --exclude-dir=.git --exclude-dir=node_modules || true
if grep -rIinE 'minimax.*api.*key|MINIMAX_API_KEY' "$RELEASE_DIR" --exclude-dir=.git --exclude-dir=node_modules >/dev/null 2>&1; then
    VIOLATIONS="${VIOLATIONS}\n- 发现 MiniMax API Key 或相关字符串"
fi

# 检查内部调试目录/文件引用
if grep -rIinE 'zettelkasten-secrets|compat-testing/secrets|/opt/openclaw-zettelkasten|openclaw-latest|hermes-latest' "$RELEASE_DIR" --exclude-dir=.git --exclude-dir=node_modules >/dev/null 2>&1; then
    VIOLATIONS="${VIOLATIONS}\n- 发现内部容器名/路径引用"
fi

# 检查 .env 文件
if find "$RELEASE_DIR" -name '*.env' -not -path '*/.git/*' | grep -q .; then
    VIOLATIONS="${VIOLATIONS}\n- 发现 .env 文件"
fi

if [ -n "$VIOLATIONS" ]; then
    echo ""
    log_error "发布前检查失败，发现以下敏感信息/内部引用："
    printf "%b\n" "$VIOLATIONS"
    echo ""
    log_error "请先清理后再发布"
    exit 1
fi

log_ok "敏感信息检查通过"

# 10. 验证
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
echo "  git status"
echo "  git add ."
echo "  git commit -m '发布: xxx'"
echo "  git push origin main"
echo ""
