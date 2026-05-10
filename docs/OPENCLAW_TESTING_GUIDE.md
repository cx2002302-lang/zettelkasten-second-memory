# OpenClaw 2026.4.24 开发测试规范

> **版本约束**: OpenClaw 2026.4.24  
> **适用项目**: zettelkasten-second-memory Phase 3  
> **制定时间**: 2026-05-11

---

## ⚠️ 铁律（每次开发前必读）

1. **OpenClaw 版本**: `2026.4.24`，配置字段必须匹配：
   - `agents.defaults`（不是 `agents.default`）
   - `agents.defaults.systemPromptOverride`（不是 `systemPrompt`）
   - `tools.alsoAllow` 必须包含 `"zettelkasten"`

2. **绝对禁止**: AI 代理直接执行 SQL、bash 脚本或命令行工具修改 Zettelkasten 数据库

3. **正确做法**: 所有对知识库的读写**必须通过 MCP 工具**完成

---

## 🔒 配置备份流程（每次修改前执行）

```bash
# 1. 备份 OpenClaw 主配置
cp ~/.openclaw/openclaw.json \
  ~/.openclaw/openclaw.json.backup.$(date +%Y%m%d_%H%M%S)

# 2. 备份 Zettelkasten 数据库
cp ~/.openclaw/zettelkasten/zettelkasten.db \
  ~/.openclaw/zettelkasten/zettelkasten.db.backup.$(date +%Y%m%d_%H%M%S)

# 3. 备份插件目录（可选）
cp -r ~/.openclaw/zettelkasten-plugin \
  ~/.openclaw/zettelkasten-plugin.backup.$(date +%Y%m%d_%H%M%S)
```

**备份检查清单**:
- [ ] `~/.openclaw/openclaw.json` 已备份
- [ ] `~/.openclaw/zettelkasten/zettelkasten.db` 已备份
- [ ] 备份文件时间戳正确

---

## 🚀 开发-测试-部署流程

### Step 1: 本地开发（GitHub 仓库）

```
zettelkasten-github/
├── src/engine/           ← 新增 Phase 3 引擎
│   ├── glow-calculator.ts
│   └── path-finder.ts
├── src/mcp/              ← 新增 MCP 工具
│   └── phase5-tools.ts   ← 在此注册新工具
└── src/storage/          ← Schema 变更
    └── db-schema.ts
```

### Step 2: 部署到 OpenClaw 测试环境

```bash
# 进入开发目录
cd ~/.openclaw/project/zettelkasten

# 使用 deploy.sh 脚本部署
bash scripts/deploy.sh

# 或手动复制（如果 deploy.sh 有变更）
PLUGIN_DIR="$HOME/.openclaw/zettelkasten-plugin"
rsync -av --exclude='node_modules' --exclude='__tests__' \
  src/ "$PLUGIN_DIR/"
```

**部署后验证**:
```bash
# 1. 检查插件文件是否存在
ls ~/.openclaw/zettelkasten-plugin/plugin/index.ts
ls ~/.openclaw/zettelkasten-plugin/storage/db-schema.ts

# 2. 检查 plugin.json 激活模式
grep -A1 '"activation"' ~/.openclaw/zettelkasten-plugin/plugin/openclaw.plugin.json
# 必须输出: "onStartup": true
```

### Step 3: 重启 Gateway

```bash
openclaw gateway restart
```

**重启后检查**:
```bash
# 1. 检查插件加载状态
openclaw zk status

# 2. 检查 MCP 工具是否注册
openclaw zk doctor
# 应显示 16 OK

# 3. 检查数据库 Schema
openclaw zk init
```

### Step 4: Agent 端到端测试

**测试方式**: 启动 OpenClaw agent，通过对话触发 MCP 工具

```bash
# 启动交互式 agent
openclaw agent

# 或在 VS Code 中使用 OpenClaw 扩展
```

**Wave 1 测试用例**:

#### TC-1: 知识发光度查询
```
用户: 查看我的知识库中哪些笔记最重要
Agent: [调用 zk_glow_ranking]
期望: 返回按 glow_score 排序的笔记列表，包含 evergreen/active/stable/zombie 分类
```

#### TC-2: 僵尸笔记检测
```
用户: 找出我哪些笔记已经过期了
Agent: [调用 zk_find_zombies]
期望: 返回半年无更新且零引用的笔记列表
```

#### TC-3: 路径搜索
```
用户: 笔记 A 和笔记 B 之间有什么关联
Agent: [调用 zk_find_path from=A to=B]
期望: 返回最短路径，含路径解释（如"A 支持 → C 细化 → B"）
```

#### TC-4: 边界测试 — 空路径
```
用户: 找两条完全无关笔记的路径
Agent: [调用 zk_find_path]
期望: 返回 null 或友好提示"未找到关联路径"
```

#### TC-5: 边界测试 — 循环链接
```
用户: 测试循环链接的场景
Agent: [创建 A→B→C→A 的循环链接，再调用 zk_find_path]
期望: 不陷入死循环，正常返回最短路径
```

### Step 5: 回归测试

```bash
# 1. 原有功能不受影响
openclaw zk doctor          # 16 OK
openclaw zk search "测试"    # 正常返回
openclaw zk new --title "回归测试" --content "内容"

# 2. 数据库完整性检查
openclaw zk init            # Schema 更新成功
```

### Step 6: 回滚（如发现问题）

```bash
# 1. 停止 Gateway
openclaw gateway stop

# 2. 恢复配置
cp ~/.openclaw/openclaw.json.backup.XXXX ~/.openclaw/openclaw.json

# 3. 恢复数据库
cp ~/.openclaw/zettelkasten/zettelkasten.db.backup.XXXX \
  ~/.openclaw/zettelkasten/zettelkasten.db

# 4. 恢复插件（如需要）
rm -rf ~/.openclaw/zettelkasten-plugin
cp -r ~/.openclaw/zettelkasten-plugin.backup.XXXX ~/.openclaw/zettelkasten-plugin

# 5. 重启
openclaw gateway restart
```

---

## 🧪 自动化测试脚本

创建 `scripts/test-in-openclaw.sh`:

```bash
#!/bin/bash
set -e

echo "=== OpenClaw Phase 3 测试套件 ==="
echo "OpenClaw版本: $(openclaw --version)"
echo "时间: $(date)"

# 1. 健康检查
echo "[1/5] 健康检查..."
openclaw zk doctor

# 2. 基础功能
echo "[2/5] 基础功能测试..."
openclaw zk status

# 3. 新增 MCP 工具测试
echo "[3/5] Wave 1 MCP 工具测试..."
# TODO: 添加 glow ranking 测试
# TODO: 添加 zombie detection 测试
# TODO: 添加 path finding 测试

# 4. 数据库 Schema 验证
echo "[4/5] Schema 验证..."
openclaw zk init

# 5. 性能基准
echo "[5/5] 性能基准..."
# TODO: 添加性能测试

echo "=== 测试完成 ==="
```

---

## 📋 配置文件检查清单

每次修改 `~/.openclaw/openclaw.json` 后，确认：

```json
{
  "plugins": {
    "load": {
      "paths": ["~/.openclaw/zettelkasten-plugin/plugin"]
    },
    "entries": {
      "zettelkasten": {
        "enabled": true
      }
    }
  },
  "agents": {
    "defaults": {
      "skills": ["zettelkasten-brain"]
    }
  },
  "tools": {
    "profile": "coding",
    "alsoAllow": ["zettelkasten"]
  }
}
```

---

## 🆘 故障排除

### "工具不可用"
```bash
# 检查 activation 模式
grep '"activation"' ~/.openclaw/zettelkasten-plugin/plugin/openclaw.plugin.json
# 应为: "onStartup": true

# 检查 alsoAllow
openclaw config get tools.alsoAllow
# 应包含: ["zettelkasten"]
```

### "skill not found"
```bash
ls ~/.openclaw/skills/zettelkasten-brain/SKILL.md
```

### 数据库损坏
```bash
# 从备份恢复
cp ~/.openclaw/zettelkasten/zettelkasten.db.backup.XXXX \
  ~/.openclaw/zettelkasten/zettelkasten.db
```

---

**最后更新**: 2026-05-11  
**OpenClaw 版本**: 2026.4.24
