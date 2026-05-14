#!/bin/bash
#
# Zettelkasten 开发部署脚本
# 从开发目录部署到 OpenClaw 插件目录
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLUGIN_DIR="${PLUGIN_DIR:-$HOME/.openclaw/zettelkasten-plugin}"
CONFIG_FILE="$HOME/.openclaw/openclaw.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[DEPLOY]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERR]${NC} $1"; }

echo "========================================"
echo "Zettelkasten Dev Deploy"
echo "Source : $PROJECT_DIR"
echo "Target : $PLUGIN_DIR"
echo "========================================"

# 1. 检查源文件
if [ ! -d "$PROJECT_DIR/src" ]; then
    log_error "Source not found: $PROJECT_DIR/src"
    exit 1
fi

# 2. 复制源码
log_info "[1/5] Copying source..."
mkdir -p "$PLUGIN_DIR"
rsync -av --exclude='node_modules' --exclude='__tests__' \
    "$PROJECT_DIR/src/" "$PLUGIN_DIR/" >/dev/null 2>&1 || \
cp -r "$PROJECT_DIR/src/"* "$PLUGIN_DIR/"
log_ok "Source copied"

# 3. 安装依赖
log_info "[2/5] Installing dependencies..."
if [ ! -f "$PLUGIN_DIR/package.json" ]; then
    cat > "$PLUGIN_DIR/package.json" << 'EOF'
{
  "name": "openclaw-zettelkasten-plugin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@sinclair/typebox": "0.34.49"
  }
}
EOF
fi

cd "$PLUGIN_DIR"
npm install --omit=dev --no-audit --no-fund 2>/dev/null || true
log_ok "Dependencies installed"

# 4. 验证 plugin.json
log_info "[3/5] Verifying plugin manifest..."
PLUGIN_JSON="$PLUGIN_DIR/plugin/openclaw.plugin.json"
if [ -f "$PLUGIN_JSON" ]; then
    if grep -q '"onCommands"' "$PLUGIN_JSON"; then
        log_warn "Fixing activation from onCommands to onStartup..."
        sed -i 's/"onCommands": *\["zk"\]/"onStartup": true/' "$PLUGIN_JSON"
        log_ok "Activation fixed"
    fi
    if grep -q '"onStartup": *true' "$PLUGIN_JSON"; then
        log_ok "Plugin manifest OK (onStartup)"
    fi
else
    log_error "Plugin manifest not found!"
    exit 1
fi

# 5. 注册插件
log_info "[4/5] Registering plugin..."
if command -v openclaw >/dev/null 2>&1; then
    PLUGIN_ENTRY="$(cd "$PLUGIN_DIR/plugin" && pwd)"
    
    # 注册路径
    openclaw config set plugins.load.paths "[\"$PLUGIN_ENTRY\"]" 2>/dev/null || true
    
    # 启用插件
    openclaw config set plugins.entries.zettelkasten '{"enabled":true}' 2>/dev/null || true
    
    # BUG-001 修复: 清理 alsoAllow 中的无效条目（Skill ID 不应放入 alsoAllow）
    log_info "Checking tools.alsoAllow..."
    python3 -c "
import json, os, sys
cfg_path = os.path.expanduser('~/.openclaw/openclaw.json')
try:
    with open(cfg_path, 'r') as f:
        cfg = json.load(f)
    if 'tools' in cfg and 'alsoAllow' in cfg.get('tools', {}):
        original = cfg['tools']['alsoAllow']
        # 只保留 zk_ 前缀的工具名，移除 Skill ID（如 zettelkasten-brain, open-upsp 等）
        cleaned = [x for x in original if x.startswith('zk_')]
        removed = [x for x in original if not x.startswith('zk_')]
        if removed:
            cfg['tools']['alsoAllow'] = cleaned
            with open(cfg_path, 'w') as f:
                json.dump(cfg, f, indent=2, ensure_ascii=False)
                f.write('\n')
            print(f'Removed invalid alsoAllow entries: {removed}')
        else:
            print('alsoAllow is clean')
    else:
        print('alsoAllow not configured')
except Exception as e:
    print(f'Skip: {e}')
" 2>/dev/null || log_warn "Could not verify alsoAllow"
    
    log_ok "Plugin registered"
else
    log_warn "openclaw CLI not found, manual registration required"
    echo "Add to ~/.openclaw/openclaw.json:"
    echo "  plugins.load.paths: [\"$PLUGIN_DIR/plugin\"]"
fi

# 6. 验证
log_info "[5/5] Verifying..."
REQUIRED=(
    "plugin/index.ts"
    "plugin/openclaw.plugin.json"
    "storage/db-schema.ts"
    "service/note-service.ts"
)
ALL_OK=true
for f in "${REQUIRED[@]}"; do
    if [ ! -f "$PLUGIN_DIR/$f" ]; then
        log_error "Missing: $f"
        ALL_OK=false
    fi
done

if [ "$ALL_OK" = true ]; then
    log_ok "All files verified"
fi

echo ""
echo "========================================"
log_ok "Deploy complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Restart Gateway:"
echo "     openclaw gateway restart"
echo ""
echo "  2. Initialize:"
echo "     openclaw zk init"
echo ""
echo "  3. Health check:"
echo "     openclaw zk doctor"
echo ""
echo "  4. Test:"
echo "     openclaw zk status"
echo ""
