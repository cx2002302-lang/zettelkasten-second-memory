# Zettelkasten 开发包

**版本**: 1.0.0-beta.1  
**目标路径**: `~/.openclaw/project/zettelkasten`  
**开发工具**: Kimi Code CLI + OpenClaw 2026.4.24

---

## 目录结构

```
zettelkasten/
├── src/                    # 插件源码（20,028 LOC）
│   ├── plugin/            # 插件入口
│   ├── service/           # 业务层
│   ├── repository/        # 数据层
│   ├── storage/           # Schema
│   ├── integration/       # 集成层
│   ├── mcp/               # MCP 工具
│   ├── skills/brain/      # AI Skill
│   └── core/              # 类型定义
├── skills/brain/          # Skill 独立目录
├── plans/                 # 设计文档
├── scripts/               # 部署/开发脚本
├── docs/                  # 使用文档
├── AGENTS.md              # 项目指南
└── DEVELOPMENT.md         # 本文件
```

---

## 快速开始

### 1. 复制到目标位置

```bash
# 解压到 ~/.openclaw/project/
tar -xzf zettelkasten-dev-1.0.0-beta.1.tar.gz
mv zettelkasten-dev ~/.openclaw/project/zettelkasten
```

### 2. 用 Kimi Code CLI 打开

```bash
cd ~/.openclaw/project/zettelkasten

# 启动 kimi code cli（会自动读取 .kimi/project.md）
kimi code

# 或在 VS Code 中
# code .
```

### 3. 部署到 OpenClaw

```bash
# 方法 1：自动部署
bash scripts/deploy.sh

# 方法 2：手动复制
PLUGIN_DIR="$HOME/.openclaw/zettelkasten-plugin"
mkdir -p "$PLUGIN_DIR"
cp -r src/* "$PLUGIN_DIR/"
cd "$PLUGIN_DIR" && npm install --omit=dev

# 注册插件路径到 openclaw.json
openclaw config set plugins.load.paths '["'$PLUGIN_DIR'/plugin"]'
openclaw config set plugins.entries.zettelkasten '{"enabled":true}'
```

### 4. 重启并测试

```bash
openclaw gateway restart
openclaw zk doctor
openclaw zk status
openclaw zk new --title "Dev Test" --content "Testing from kimi code cli"
```

---

## Kimi Code CLI 开发工作流

### 初始化 Kimi Code 项目

项目根目录已包含 `.kimi/project.md`，Kimi Code CLI 会自动读取。

```bash
# 在 kimi code 交互中
/kimi 查看项目状态
/kimi 搜索 zk_search_notes 的实现
/kimi 修复 note-service.ts 的 listNotes 过滤逻辑
```

### 常用开发命令

| 命令 | 说明 |
|------|------|
| `kimi code` | 启动交互式开发 |
| `kimi code --file src/plugin/index.ts` | 直接编辑文件 |
| `kimi code --task "修复 zk init"` | 执行特定任务 |

### 修改 → 部署 → 测试 循环

```bash
# 1. 在 kimi code 中修改代码
# 2. 部署修改
bash scripts/deploy.sh

# 3. 重启 gateway
openclaw gateway restart

# 4. 测试
openclaw zk doctor
```

---

## OpenClaw 配置参考

### 插件配置（~/.openclaw/openclaw.json）

```json
{
  "plugins": {
    "load": {
      "paths": ["~/.openclaw/zettelkasten-plugin/plugin"]
    },
    "entries": {
      "zettelkasten": {
        "enabled": true,
        "config": {
          "notesDir": "~/.openclaw/zettelkasten/notes",
          "databasePath": "~/.openclaw/zettelkasten/zettelkasten.db",
          "nightlyDistill": { "enabled": false },
          "sessionHook": { "enabled": false }
        }
      }
    }
  },
  "skills": {
    "load": {
      "extraDirs": ["~/.openclaw/project/zettelkasten/skills"]
    }
  },
  "agents": {
    "defaults": {
      "skills": ["zettelkasten-brain"],
      "systemPromptOverride": "file:~/.openclaw/project/zettelkasten/skills/brain/PROMPT.md"
    }
  }
}
```

---

## 关键文件速查

| 文件 | 用途 |
|------|------|
| `src/plugin/index.ts` | 插件入口（注册工具、CLI、MCP） |
| `src/plugin/openclaw.plugin.json` | 插件清单（activation: onStartup） |
| `src/service/note-service.ts` | 笔记 CRUD + 搜索 |
| `src/storage/db-schema.ts` | SQLite Schema + FTS5 |
| `src/repository/note-repository.ts` | 数据访问层 |
| `src/skills/brain/PROMPT.md` | AI 系统提示词 |
| `src/skills/brain/RULES.md` | 行为规则矩阵 |

---

## 测试检查清单

```bash
# 基础功能
openclaw zk init
openclaw zk doctor          # 应显示 16 OK
openclaw zk status          # 显示运行时状态
openclaw zk new --title "Test" --content "Hello"
openclaw zk list
openclaw zk search "Hello"

# Skill 测试
openclaw config get agents.defaults.skills
# 应返回: ["zettelkasten-brain"]
```

---

## 故障排除

### "工具不可用"
确认 `openclaw.plugin.json` 中 `activation` 为 `onStartup`：
```bash
grep -A1 '"activation"' ~/.openclaw/zettelkasten-plugin/plugin/openclaw.plugin.json
```

### "skill not found"
检查路径：
```bash
ls ~/.openclaw/project/zettelkasten/skills/brain/SKILL.md
```

### 数据库权限
```bash
ls -la ~/.openclaw/zettelkasten/zettelkasten.db
chmod 644 ~/.openclaw/zettelkasten/zettelkasten.db
```

---

**Git 仓库**: `/home/myxia/.openclaw/project/zettelkasten/`  
**标签**: `备份: v1.0.0-beta.7 发布完成`
