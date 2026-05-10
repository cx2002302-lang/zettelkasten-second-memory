# 🧠 Zettelkasten Second Memory

> 为 AI 时代设计的卢曼卡片盒笔记系统 —— 原子化记录、双向链接、知识蒸馏、智能检索。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.14.0-blue.svg)](package.json)

---

## ✨ 核心特性

| 特性 | 说明 |
|------|------|
| 📝 **原子卡片** | 每条笔记都是独立、原子的知识单元，支持 `atomic` / `structure` / `source` 三种类型 |
| 🔗 **双向链接** | 11 种语义化链接类型（支持、细化、扩展、反驳、示例…），构建真正的知识图谱 |
| 🔍 **全文搜索** | SQLite FTS5 + LIKE 双引擎，支持中文分词与模糊匹配 |
| 🤖 **AI 集成** | 通过 MCP 协议与 OpenClaw 深度集成，AI 自动记录对话知识 |
| 🔄 **知识蒸馏** | CEQRC 流水线自动将碎片笔记提炼为永久知识 |
| 🏷️ **标签系统** | 灵活的标签分类与统计，支持标签云分析 |
| 📦 **Markdown 原生** | 所有笔记以 Markdown 存储，数据完全属于你 |

---

## 📐 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway                      │
│                  (MCP Protocol Layer)                    │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              Zettelkasten Plugin                         │
│  ┌─────────┐  ┌──────────┐  ┌─────────────┐            │
│  │  MCP    │  │   CLI    │  │  Session    │            │
│  │ Tools   │  │ Commands │  │   Hook      │            │
│  └────┬────┘  └────┬─────┘  └──────┬──────┘            │
│       └─────────────┴───────────────┘                   │
│                         │                                │
│  ┌──────────┬───────────┼───────────┬──────────┐        │
│  │ Service  │ Repository│  Storage  │  Core    │        │
│  │ Layer    │  Layer    │  Layer    │  Types   │        │
│  │          │           │           │          │        │
│  │• Note    │• NoteRepo │• DB Schema│• Types   │        │
│  │• Link    │• LinkRepo │• FTS5     │• Constants│       │
│  │• CEQRC   │• TagRepo  │• Templates│• Utils   │        │
│  │• Distill │• ReviewRepo│          │          │        │
│  └──────────┴───────────┴───────────┴──────────┘        │
│                         │                                │
│                    SQLite + Markdown                     │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 快速开始

### 环境要求

- **Node.js** >= 22.14.0（需要内置 `node:sqlite`）
- **OpenClaw** >= 2026.4.23（如需 AI 集成）

### 安装

```bash
# 克隆仓库
git clone https://github.com/YOUR_USERNAME/zettelkasten-second-memory.git
cd zettelkasten-second-memory

# 安装依赖
npm install

# 运行测试
npm test
```

### 作为 OpenClaw 插件使用

```bash
# 1. 部署插件
bash scripts/deploy.sh

# 2. 配置 OpenClaw（编辑 ~/.openclaw/openclaw.json）
# 确保 plugins.load.paths 包含插件路径

# 3. 重启 Gateway
openclaw gateway restart

# 4. 初始化数据库
openclaw zk init

# 5. 健康检查
openclaw zk doctor
```

### 作为独立库使用

```typescript
import { createZettelkasten } from "zettelkasten-second-memory";

// 创建客户端
const zk = await createZettelkasten("./data/zettelkasten.db", "./data");

// 创建笔记
const note = await zk.createNote({
  title: "Hello Zettelkasten",
  content: "这是我的第一条原子笔记。",
  tags: ["intro", "demo"],
  type: "atomic",
});

// 搜索
const results = zk.searchNotes("原子笔记", 10);
console.log(results);
```

---

## 🛠️ CLI 命令

| 命令 | 说明 |
|------|------|
| `openclaw zk init` | 初始化数据库和目录结构 |
| `openclaw zk doctor` | 运行健康检查 |
| `openclaw zk status` | 查看系统状态 |
| `openclaw zk new` | 创建新笔记 |
| `openclaw zk list` | 列出笔记 |
| `openclaw zk search <query>` | 搜索笔记 |
| `openclaw zk show <id>` | 查看笔记详情 |
| `openclaw zk link <from> <to>` | 创建笔记链接 |

---

## 🧩 MCP 工具（供 AI 调用）

| 工具 | 权限 | 说明 |
|------|------|------|
| `zk_search_notes` | 读 | 全文搜索笔记 |
| `zk_get_note` | 读 | 获取单条笔记 |
| `zk_get_backlinks` | 读 | 获取反向链接 |
| `zk_find_path` | 读 | 查找笔记间的路径 |
| `zk_create_note` | 写 | 创建新笔记 |
| `zk_update_note` | 写 | 更新笔记 |
| `zk_create_link` | 写 | 创建笔记链接 |
| `zk_run_ceqrc` | 写 | 运行认知流水线 |
| `zk_distill_memory` | 写 | 蒸馏会话记忆 |
| `zk_review_note` | 写 | 审核笔记 |

---

## 📁 项目结构

```
zettelkasten-second-memory/
├── src/
│   ├── core/               # 类型定义、常量、工具函数
│   ├── storage/            # 数据库 Schema、FTS5、模板管理
│   ├── repository/         # 数据访问层（笔记、链接、标签、审核…）
│   ├── service/            # 业务逻辑（CEQRC、蒸馏、去重…）
│   ├── integration/        # OpenClaw 集成（Agent 配置、定时任务、会话钩子）
│   ├── mcp/                # MCP 工具定义与服务器
│   ├── plugin/             # OpenClaw 插件入口与清单
│   ├── skills/brain/       # AI Skill（提示词、规则、进化脚本）
│   ├── examples/           # 使用示例
│   └── index.ts            # 库入口
├── scripts/                # 部署脚本
├── plans/                  # 设计文档与架构图
├── docs/                   # 使用文档
├── package.json
├── LICENSE
└── README.md
```

---

## 🧠 第二记忆 Skill（AI 集成）

本项目包含一个 **Brain Skill**，让 AI 代理自动将对话中的知识保存到 Zettelkasten：

```bash
# 安装 Skill
cp -r src/skills/brain ~/.openclaw/skills/zettelkasten-brain

# 激活 Skill
openclaw config set agents.defaults.skills '["zettelkasten-brain"]'

# 重启 Gateway
openclaw gateway restart
```

激活后，AI 会在对话中自动：
- 🔍 回答前先搜索知识库
- 📝 识别并保存重要信息
- 🔗 智能建立笔记关联
- 📦 会话结束时归档讨论

---

## 📊 数据库 Schema

系统使用 SQLite，核心表包括：

| 表名 | 说明 |
|------|------|
| `zettel_notes` | 笔记主表（标题、内容、状态、置信度…） |
| `zettel_links` | 双向链接表（11 种语义链接类型） |
| `zettel_tags` | 标签表 |
| `zettel_note_tags` | 笔记-标签关联表 |
| `zettel_reviews` | 审核记录表 |
| `zettel_feedback` | 反馈数据表 |
| `zettel_prompt_versions` | 提示词版本表 |
| `zettel_meta` | 元数据表 |

FTS5 虚拟表提供全文搜索能力。

---

## 🧪 测试

```bash
# 运行所有测试
npm test

# 监视模式
npm run test:watch
```

当前测试覆盖：
- Repository 层（CRUD、搜索、链接、标签）
- Service 层（CEQRC、蒸馏、去重、解析）
- Integration 层（配置、调度）
- MCP Server（工具注册与调用）

---

## 📜 许可证

[MIT](LICENSE) © Zettelkasten Contributors

---

## 🙏 致谢

- 灵感来源于 [Niklas Luhmann](https://en.wikipedia.org/wiki/Niklas_Luhmann) 的 Zettelkasten 方法
- 基于 [OpenClaw](https://github.com/openclaw) 插件架构构建
- 使用 SQLite FTS5 实现全文搜索
