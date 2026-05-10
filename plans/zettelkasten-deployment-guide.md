# Zettelkasten 第二记忆系统 — 上线部署方案

> OpenClaw v2026.3.13-1 集成 & 生产部署完整指南

---

## 第一部分：OpenClaw 端集成方案

### 1.1 版本兼容性与接口规范分析

**目标版本**: OpenClaw v2026.3.13-1  
**验证状态**: 当前运行的 OpenClaw 版本即为此版本，插件 SDK 接口均已稳定。

#### OpenClaw 插件开发核心接口

OpenClaw v2026.3.13-1 的插件体系通过 **三层结构** 实现：

| 层 | 文件/路径 | 作用 |
|---|---|---|
| **Manifest** | `openclaw.plugin.json` | 声明插件 id、name、configSchema、skills、uiHints、commandAliases |
| **Entry** | `definePluginEntry()` from `openclaw/plugin-sdk/plugin-entry` | 插件入口，接收 `register(api)` 回调 |
| **API Surface** | `OpenClawPluginApi` (30+ 注册方法) | `registerTool()`、`registerMcpServer()`、`registerCli()`、`registerSessionEndHook()`、`registerCronJob()`、`registerContextEngine()`、`setPluginContext()` 等 |

**插件发现流程**:
1. `discoverOpenClawPlugins()` 扫描 `openclaw.plugin.json` 文件
2. 发现源: bundled dir (`dist/extensions/`)、workspace dir、用户配置 `plugins.entries.<id>.path`
3. 通过 JITI 加载器加载 entry module
4. `createPluginRegistry()` 构建运行时注册表，将 `register*` 调用桥接到全局注册表

**Zettelkasten 已使用的注册接口**:
- `api.registerMcpServer(mcpServer, opts)` — 注册 MCP 工具集
- `api.registerTool(factory, { name })` — 注册单工具 (当前注册了 9 个)
- `api.registerCli(({ program }) => {...})` — 注册 `zk:init`、`zk:stats` CLI 命令
- `api.registerSessionEndHook(hook)` — 会话结束自动蒸馏
- `api.registerCronJob({ name, schedule, job })` — 夜间批处理蒸馏
- `api.setPluginContext(key, value)` — 存储插件运行时上下文

### 1.2 技术选型依据：为什么选择 Plugin 而不是 Skill

| 维度 | Plugin 方式 | Skill 方式 | 判定 |
|---|---|---|---|
| **数据库/存储** | ✅ 可访问 `node:sqlite`、文件系统 | ❌ Markdown only，无运行时逻辑 | Plugin |
| **生命周期管理** | ✅ `register`/`unregister`、cron、hooks | ❌ 仅静态文档注入 | Plugin |
| **侧效应执行** | ✅ 创建笔记、蒸馏、去重 | ❌ 不能执行代码 | Plugin |
| **配置系统** | ✅ zod schema + `pluginConfig` | ❌ 无配置能力 | Plugin |
| **多工具注册** | ✅ 9 个 MCP 工具 + CLI | ❌ 只能是 prompt | Plugin |

**结论**: Zettelkasten 需要 SQLite、文件 I/O、定时任务、会话钩子、9+ 个 MCP 工具 — 这些都是 **Plugin** 才能提供的。当前实现已正确选用 `definePluginEntry` 方式。

### 1.3 完整集成代码框架

#### 1.3.1 Manifest — `openclaw.plugin.json`

已存在: `src/zettelkasten/plugin/openclaw.plugin.json`

```json
{
  "id": "zettelkasten",
  "name": "Zettelkasten Second Memory System",
  "description": "Atomic note‑taking, bi‑directional linking, and knowledge‑graph distillation for OpenClaw.",
  "skills": ["./skills"],
  "uiHints": { /* ... 9 个 UI 提示 */ },
  "configSchema": { /* type: object, properties: notesDir, databasePath, agentConfigs, nightlyDistill, sessionHook, confidenceThreshold */ },
  "configContracts": { "compatibilityMigrationPaths": [] },
  "commandAliases": [{ "name": "zk" }]
}
```

#### 1.3.2 Plugin Entry — `plugin/index.ts`

当前已完整实现于 `src/zettelkasten/plugin/index.ts:72-223`。

**核心注册流程**:

```
register(api)
  │
  ├─ 1. 解析 config (api.pluginConfig → zod schema defaults)
  ├─ 2. 初始化 SQLite (node:sqlite open)
  ├─ 3. 创建 Repository 层 (NoteRepo, LinkRepo, TagRepo)
  ├─ 4. 创建 Service 层 (NoteService, LinkService, MemoryParser, DedupeService, CEQRCEngine, DistillerService)
  ├─ 5. 创建 ZettelkastenIntegration 集成编排器
  ├─ 6. api.registerMcpServer(...)          → MCP 工具集注册
  ├─ 7. api.registerTool(factory, {name})   → 9 个独立工具
  ├─ 8. api.registerCli(({program}) => ...) → zk:init, zk:stats
  ├─ 9. api.registerSessionEndHook(...)     → 会话蒸馏
  ├─10. api.registerCronJob(...)            → 夜间蒸馏
  └─11. api.setPluginContext("integration", integration)
```

#### 1.3.3 配置模板 — `openclaw.json` 插件段

```json
{
  "plugins": {
    "entries": {
      "zettelkasten": {
        "enabled": true,
        "config": {
          "notesDir": "~/.openclaw/zettelkasten/notes",
          "databasePath": "~/.openclaw/zettelkasten/zettelkasten.db",
          "agentConfigs": {
            "chat": {
              "tools": [
                "zk_search_notes",
                "zk_get_note",
                "zk_get_backlinks",
                "zk_find_path"
              ]
            },
            "knowledge": {
              "tools": [
                "zk_search_notes",
                "zk_get_note",
                "zk_get_backlinks",
                "zk_find_path",
                "zk_create_note",
                "zk_update_note",
                "zk_run_ceqrc",
                "zk_distill_memory",
                "zk_review_note"
              ]
            }
          },
          "nightlyDistill": {
            "enabled": true,
            "cronExpression": "0 2 * * *"
          },
          "sessionHook": {
            "enabled": true
          },
          "confidenceThreshold": {
            "zettels": 0.7,
            "references": 0.4
          }
        }
      }
    }
  }
}
```

### 1.4 模块注册与调用流程

#### 注册时序

```
OpenClaw 启动
  → Plugin Discovery 发现 openclaw.plugin.json
    → Plugin Loader 加载 plugin/index.js (JITI)
      → definePluginEntry.register(api) 执行
        → 初始化 SQLite、Repository、Service 层
        → 注册 MCP Server + 9 Tools
        → 注册 CLI、SessionHook、CronJob
        → 插件状态 → "ready"
```

#### 调用路径

```
用户/Agent 发起请求
  → Agent Runtime 匹配 MCP 工具 "zk_search_notes"
    → 路由到 Zettelkasten MCP Server
      → searchNotes() → NoteRepository.search()
        → FTS5 全文索引查询
          → 返回 ZettelNote[]

或

OpenClaw 会话结束事件
  → SessionEndHook 触发
    → DistillerService.distillFromSession()
      → MemoryParser 解析会话日志
        → DedupeService 两阶段去重
          → CEQRCEngine 认知流程
            → NoteService.createNote(confidence routed)
              → 写入 Markdown + SQLite
```

---

## 第二部分：通讯架构与部署实施

### 2.1 通讯协议设计

Zettelkasten 作为 OpenClaw 的 **进程内插件** 运行，不通过 HTTP/RPC 通讯。所有调用通过 **OpenClaw Plugin API** 和 **MCP (Model Context Protocol)** 完成。

#### API 接口设计

**MCP 工具列表 (9 个)**:

| 工具名 | 权限 | 参数 | 返回值 |
|---|---|---|---|
| `zk_search_notes` | read-only | `query: string`, `limit?: number` | `SearchResult[]` |
| `zk_get_note` | read-only | `id: string` | `ZettelNote \| null` |
| `zk_get_backlinks` | read-only | `noteId: string` | `Link[]` |
| `zk_find_path` | read-only | `fromNoteId: string`, `toNoteId: string` | `PathResult` |
| `zk_create_note` | read-write | `title`, `content`, `type?`, `confidence?`, `source?` | `ZettelNote` |
| `zk_update_note` | read-write | `id`, `title?`, `content?`, `folder?`, `reviewed?` | `ZettelNote \| null` |
| `zk_run_ceqrc` | read-write | `content: string`, `confidence?`, `source?` | `ZettelNote` |
| `zk_distill_memory` | read-write | `date: string (YYYY-MM-DD)` | `{ created, merged, skipped }` |
| `zk_review_note` | read-write | `id`, `decision`, `improvements?` | `ZettelNote \| null` |

#### 数据格式 (MCP Tool InputSchema — 示例)

```typescript
// zk_create_note 输入
{
  type: "object",
  properties: {
    title:      { type: "string", description: "笔记标题" },
    content:    { type: "string", description: "Markdown 内容" },
    type:       { type: "string", enum: ["atomic", "structure", "source"], default: "atomic" },
    confidence: { type: "number", description: "置信度评分 0-1", default: 0.5 },
    source:     { type: "string", enum: ["manual", "distilled", "ceqrc"], default: "manual" }
  },
  required: ["title", "content"]
}
```

#### 调用流程 (以知识 Agent 创建笔记为例)

```
1. Agent 决策 → 调用 MCP tool "zk_create_note"
2. OpenClaw MCP 路由 → ZettelkastenMCPServer.createNote(args)
3. NoteService.createNote(params, options)
   a. 置信度路由: confidence≥0.7→zettels/, ≥0.4→references/, <0.4→inbox/
   b. 生成 ID: YYYYMMDDHHMMSS + 碰撞检测
   c. 解析内容中 [[wikilinks]] → 自动创建 Link
   d. 写入 Markdown 文件 (gray-matter frontmatter + remark body)
   e. INSERT INTO zettel_notes + zettel_fts + zettel_links
4. 返回 ZettelNote 对象
```

### 2.2 服务端部署方案

#### 2.2.1 Zettelkasten 模块定位

当前 Zettelkasten 源码位于 `src/zettelkasten/`，属于 **in-tree source module**。这是与标准 bundled plugin (`extensions/`) 不同的组织方式。部署时需要：

1. 随 OpenClaw 主项目一起构建 (`pnpm build`)
2. 编译产物输出到 `dist/zettelkasten/`
3. 插件 Manifest 必须被 `discoverOpenClawPlugins()` 发现

#### 2.2.2 部署方式选择

| 方式 | 说明 | 推荐场景 |
|---|---|---|
| **方式 A: In-tree (当前)** | 源码在 `src/`，随主构建编译 | 开发/测试期 |
| **方式 B: Bundled Plugin** | 迁移到 `extensions/zettelkasten/` | 生产部署 |
| **方式 C: 独立 npm 包** | 发布为 `@openclaw/zettelkasten` | 分发给第三方 |

**推荐**: 测试阶段用 **方式 A**，确认稳定后迁移到 **方式 B** 实现标准化部署。

#### 2.2.3 环境依赖

```bash
# 核心依赖 (已通过 OpenClaw 满足)
Node.js >= 22                          # OpenClaw runtime 要求
node:sqlite (built-in)                 # SQLite 驱动 (Node 22+ 内置)
gray-matter ^4.0.3                     # YAML frontmatter 解析
dayjs ^1.11.0                          # ID 生成 (YYYYMMDDHHMMSS)

# 可选依赖
sqlite-vec (Phase 3 语义搜索)          # 向量索引
```

#### 2.2.4 进程守护

Zettelkasten 作为 OpenClaw 进程内插件运行，**无需独立的进程守护**。它随 OpenClaw Gateway 的生命周期一起启动/停止。

```bash
# OpenClaw Gateway 启动 (插件自动加载)
openclaw gateway run --bind loopback --port 18789

# 查看插件状态
openclaw plugins status

# Zettelkasten CLI 命令
openclaw zk:init       # 初始化数据库和目录
openclaw zk:stats      # 查看统计信息

# Cron 任务注册后由 OpenClaw 统一调度
# sessionHook 由 OpenClaw Session Manager 触发
```

#### 2.2.5 系统服务配置 (Linux systemd 示例)

```ini
# /etc/systemd/system/openclaw-gateway.service
[Unit]
Description=OpenClaw AI Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=openclaw
ExecStart=/usr/bin/openclaw gateway run --bind loopback --port 18789
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=HOME=/home/openclaw
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable openclaw-gateway
sudo systemctl start openclaw-gateway
sudo journalctl -u openclaw-gateway -f
```

### 2.3 存储方案与检索接口

#### 2.3.1 数据存储架构

```
~/.openclaw/zettelkasten/
├── zettelkasten.db          # SQLite 数据库 (链接、标签、元数据、FTS)
├── notes/
│   ├── inbox/               # 低置信度 (< 0.4) 笔记
│   │   └── 20260424143015.md
│   ├── references/          # 中置信度 (0.4 - 0.7) 笔记
│   │   └── 20260424120000.md
│   └── zettels/             # 高置信度 (≥ 0.7) 永久笔记
│       └── 20260424080000.md
└── templates/               # Markdown 模板
    ├── atomic.md
    ├── structure.md
    └── source.md
```

#### 2.3.2 SQLite Schema (已实现，见 `src/zettelkasten/storage/db-schema.ts`)

```sql
-- 笔记主表
CREATE TABLE zettel_notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  type TEXT NOT NULL DEFAULT 'atomic',
  status TEXT NOT NULL DEFAULT 'FLEETING',
  folder TEXT NOT NULL DEFAULT 'inbox',
  confidence REAL DEFAULT 0.5,
  source TEXT DEFAULT 'manual',
  reviewed INTEGER DEFAULT 0,
  session_key TEXT,
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 链接表 (支持 11 种类型)
CREATE TABLE zettel_links (
  id TEXT PRIMARY KEY,
  from_note_id TEXT NOT NULL REFERENCES zettel_notes(id) ON DELETE CASCADE,
  to_note_id TEXT NOT NULL REFERENCES zettel_notes(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  context TEXT,
  created_at TEXT NOT NULL
);

-- 标签表
CREATE TABLE zettel_tags (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  color TEXT,
  created_at TEXT NOT NULL
);

-- 笔记-标签关联
CREATE TABLE zettel_note_tags (
  note_id TEXT NOT NULL REFERENCES zettel_notes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES zettel_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

-- FTS5 全文搜索
CREATE VIRTUAL TABLE IF NOT EXISTS zettel_fts USING fts5(
  title, content, summary, id UNINDEXED
);

-- 索引
CREATE INDEX idx_notes_status ON zettel_notes(status);
CREATE INDEX idx_notes_folder ON zettel_notes(folder);
CREATE INDEX idx_notes_session ON zettel_notes(session_key);
CREATE INDEX idx_links_from ON zettel_links(from_note_id);
CREATE INDEX idx_links_to ON zettel_links(to_note_id);
CREATE INDEX idx_links_type ON zettel_links(type);
```

#### 2.3.3 检索接口

| 检索方式 | 接口 | 底层技术 |
|---|---|---|
| 全文搜索 | `NoteService.searchNotes(query, limit)` | SQLite FTS5 |
| ID 精确查 | `NoteService.getNote(id)` | 主键查询 |
| 反向链接 | `LinkService.getLinksTo(noteId)` | SQL JOIN |
| 路径发现 | `LinkService.findPath(fromId, toId)` | BFS 图算法 |
| 标签过滤 | `TagRepository.getNotesByTag(tagName)` | JOIN zettel_note_tags |
| 文件夹浏览 | `NoteService.listNotes({ folder })` | SQL WHERE |
| 置信度审查 | `NoteService.getInboxQueue(limit)` | folder='inbox' + ORDER BY |
| 向量搜索 (Phase 3+) | `DedupeService.findSimilar(embedding)` | sqlite-vec cosine |

### 2.4 测试验证流程

#### 2.4.1 基础功能测试

```bash
# 1. 确认插件已注册
openclaw plugins list | grep zettelkasten

# 2. 初始化 Zettelkasten
openclaw zk:init

# 3. 验证目录创建
ls -la ~/.openclaw/zettelkasten/
ls -la ~/.openclaw/zettelkasten/notes/
ls -la ~/.openclaw/zettelkasten/notes/inbox/
ls -la ~/.openclaw/zettelkasten/notes/references/
ls -la ~/.openclaw/zettelkasten/notes/zettels/

# 4. 创建测试笔记 (通过 openclaw agent 调用 MCP tool)
openclaw message send --message "使用 zk_create_note 创建一个标题为'测试笔记'、内容为'## 测试\n这是一个原子化笔记'的卡片，置信度设为 0.8"

# 5. 搜索笔记
openclaw message send --message "使用 zk_search_notes 搜索关键词'测试'"

# 6. 查看统计
openclaw zk:stats
```

#### 2.4.2 程序化测试脚本

```typescript
// test/zk-deployment.test.ts
import { describe, it, expect } from "vitest";
import { createZettelkasten, ZettelkastenClient } from "../src/zettelkasten/index.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const TEST_DIR = path.join(os.tmpdir(), `zk-test-${Date.now()}`);

describe("Zettelkasten 部署验证", () => {
  let client: ZettelkastenClient;

  beforeAll(async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    client = await createZettelkasten(
      path.join(TEST_DIR, "test.db"),
      TEST_DIR
    );
    await client.initialize();
  });

  it("应正确初始化数据库和目录", () => {
    expect(fs.existsSync(path.join(TEST_DIR, ".zettelkasten", "notes"))).toBe(true);
    const stats = client.getStats();
    expect(stats).toBeDefined();
  });

  it("应能创建原子化笔记", async () => {
    const note = await client.createNote({
      title: "测试原子笔记",
      content: "# 原子笔记\n这是一个最小知识单元。",
      type: "atomic",
      tags: ["test", "deployment"],
    });
    expect(note.id).toMatch(/^\d{14}$/); // YYYYMMDDHHMMSS
    expect(note.folder).toBe("inbox");
    expect(note.tags).toContain("test");
  });

  it("应能创建高置信度笔记到 zettels", async () => {
    const note = await client.createNote({
      title: "永久笔记",
      content: "经过深思熟虑的永久知识。",
      confidence: 0.9,
    });
    expect(note.folder).toBe("zettels");
    expect(fs.existsSync(
      path.join(TEST_DIR, ".zettelkasten", "notes", "zettels", `${note.id}.md`)
    )).toBe(true);
  });

  it("应能创建链接", () => {
    const notes = client.queryNotes({});
    expect(notes.length).toBeGreaterThanOrEqual(2);

    client.createLink(notes[0].id, notes[1].id, "related", "测试链接");
    const backlinks = client.queryNotes({
      linksTo: notes[1].id,
    });
    // 链接查询需通过 linkRepo
  });

  it("应能全文搜索", () => {
    const results = client.searchNotes("原子", 10);
    expect(results.length).toBeGreaterThan(0);
  });

  afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });
});
```

#### 2.4.3 MCP 工具端到端测试

```bash
# 启动 OpenClaw agent 并验证工具可用
openclaw agent --message "列出所有可用的 zk_ 工具" --thinking low

# 测试创建 -> 搜索 -> 获取 -> 反向链接 完整链路
openclaw agent --message "
请执行以下操作:
1. 用 zk_create_note 创建一条标题为'E2E测试'、内容为'端到端测试笔记'的笔记 (confidence=0.8)
2. 用 zk_search_notes 搜索'E2E测试'
3. 用 zk_get_note 获取上一步搜索结果中第一条笔记的详情
4. 用 zk_get_backlinks 查看该笔记的反向链接
" --thinking low
```

#### 2.4.4 Nightly Distill 验证

```bash
# 手动触发蒸馏 (不等到凌晨2点)
openclaw message send --message "用 zk_distill_memory 蒸馏今天的 memory 日志"

# 检查 Cron 注册状态
openclaw plugins cron list | grep zettelkasten
```

#### 2.4.5 Session Hook 验证

```bash
# 完成一次对话会话后，检查是否自动创建了笔记
# 查看蒸馏日志
tail -f ~/.openclaw/zettelkasten/logs/distill.log

# 检查 inbox 是否有新笔记
openclaw message send --message "用 zk_get_inbox_queue 查看待审核队列"
```

### 2.5 完整验证检查清单

```
□ 插件正确注册到 OpenClaw
  □ openclaw plugins list 显示 zettelkasten (enabled: true)
  □ MCP 工具列表包含 9 个 zk_* 工具

□ 存储初始化正确
  □ ~/.openclaw/zettelkasten/zettelkasten.db 存在
  □ notes/inbox/、notes/references/、notes/zettels/ 目录存在
  □ zettel_notes、zettel_links、zettel_tags、zettel_note_tags、zettel_fts 表已创建

□ 核心功能可用
  □ zk_create_note: 创建笔记并写入 Markdown + SQLite
  □ zk_search_notes: FTS5 全文搜索可返回结果
  □ zk_get_note: 按 ID 获取笔记详情
  □ zk_get_backlinks: 获取反向链接列表
  □ zk_find_path: 查找两笔记间最短路径
  □ zk_update_note: 更新笔记内容
  □ zk_run_ceqrc: CEQRC 工作流完成
  □ zk_review_note: 审核笔记并路由

□ 自动化功能
  □ NightlyDistill Cron 已注册 (cronExpression: 0 2 * * *)
  □ SessionEndHook 已注册 (会话结束自动蒸馏)

□ CLI 命令可用
  □ openclaw zk:init
  □ openclaw zk:stats

□ 置信度路由正确
  □ confidence ≥ 0.7 → zettels/ 文件夹
  □ confidence ≥ 0.4 & < 0.7 → references/ 文件夹
  □ confidence < 0.4 → inbox/ 文件夹

□ 双向链接自动维护
  □ 创建 Link 自动生成反向链接
  □ [[wikilinks]] 自动解析为链接
```

---

## 第三部分：生产环境稳定性、安全性与可维护性

### 3.1 生产环境配置最佳实践

```json
// production openclaw.json
{
  "plugins": {
    "entries": {
      "zettelkasten": {
        "enabled": true,
        "config": {
          "notesDir": "/data/openclaw/zettelkasten/notes",
          "databasePath": "/data/openclaw/zettelkasten/zettelkasten.db",
          "nightlyDistill": {
            "enabled": true,
            "cronExpression": "0 3 * * *"
          },
          "sessionHook": {
            "enabled": true
          },
          "confidenceThreshold": {
            "zettels": 0.75,
            "references": 0.45
          }
        }
      }
    }
  }
}
```

### 3.2 数据库维护

```bash
# 启用 WAL 模式 (更好并发)
sqlite3 ~/.openclaw/zettelkasten/zettelkasten.db "PRAGMA journal_mode=WAL;"

# 定期 VACUUM (建议 cron weekly)
echo "VACUUM;" | sqlite3 ~/.openclaw/zettelkasten/zettelkasten.db

# 备份脚本
#!/bin/bash
BACKUP_DIR="/backup/zettelkasten"
mkdir -p "$BACKUP_DIR"
cp ~/.openclaw/zettelkasten/zettelkasten.db "$BACKUP_DIR/zettelkasten-$(date +%Y%m%d).db"
tar -czf "$BACKUP_DIR/notes-$(date +%Y%m%d).tar.gz" -C ~/.openclaw/zettelkasten notes/
# 保留最近 30 天备份
find "$BACKUP_DIR" -mtime +30 -delete
```

### 3.3 日志与监控

```bash
# Zettelkasten 运行日志
tail -f ~/.openclaw/zettelkasten/logs/zettelkasten.log

# OpenClaw Gateway 日志 (含插件启动信息)
journalctl -u openclaw-gateway -f | grep -i zettelkasten

# 监控指标
openclaw zk:stats  # 笔记数、链接数、标签数、存储大小
```

### 3.4 常见问题排查

| 问题 | 排查步骤 |
|---|---|
| **插件未加载** | 1. 检查 `~/.openclaw/openclaw.json` 中 `plugins.entries.zettelkasten.enabled` 是否为 `true` <br>2. 检查 `openclaw.plugin.json` 是否在正确路径 <br>3. 运行 `openclaw plugins list` 查看状态 |
| **数据库文件权限错误** | 1. `ls -la ~/.openclaw/zettelkasten/zettelkasten.db` <br>2. `chmod 644` 确保读写权限 <br>3. 检查父目录 `chmod 755 ~/.openclaw/zettelkasten/` |
| **MCP 工具返回空** | 1. 确认数据库已初始化: `openclaw zk:init` <br>2. 检查 FTS5 是否可用: Node 22+ 内置支持 <br>3. 尝试创建一条测试笔记后再搜索 |
| **Cron 不执行** | 1. 确认 `nightlyDistill.enabled: true` <br>2. 验证 cronExpression (5 字段标准 cron) <br>3. 检查 OpenClaw 系统时间 `date` |
| **Session Hook 不触发** | 1. 确认 `sessionHook.enabled: true` <br>2. 检查会话是否满足最小长度/时长 <br>3. 查看日志中是否有错误信息 |
| **Markdown 文件未生成** | 1. 检查 `notesDir` 目录权限 <br>2. 确认 `confidence` 值在配置阈值内 <br>3. 查看 `createNote` 调用时有无异常 |
| **磁盘空间不足** | 1. `df -h ~/.openclaw/zettelkasten/` <br>2. 考虑归档旧笔记或清理 inbox <br>3. Markdown 文件通常很小，瓶颈在 SQLite 数据库增长 |

### 3.5 安全注意事项

- **不要将 `zettelkasten.db` 纳入版本控制** — 它包含所有知识笔记的完整内容
- **数据库文件设置合理权限** — `chmod 600` 限制为当前用户
- **备份加密** — 生产备份应加密存储 (gpg 或加密卷)
- **LLM Provider 密钥** — 通过环境变量或 OpenClaw credentials 系统管理，永不硬编码
- **会话关联数据** — `session_key` 字段记录关联的 OpenClaw 会话，应遵循会话隐私策略

### 3.6 升级与迁移

```
当前版本 → 生产版本迁移步骤:

1. 备份: 复制 zettelkasten.db + notes/ 目录
2. 升级 OpenClaw: sudo npm i -g openclaw@latest
3. 重启 Gateway: sudo systemctl restart openclaw-gateway
4. 验证: openclaw plugins list (检查状态)
5. 运行 zk:stats 对比数据完整性
6. 回滚: 如果失败，恢复备份并降级 OpenClaw
```

### 3.7 从 In-tree 迁移到 Bundled Plugin (Phase B)

当测试通过后，将 `src/zettelkasten/` 迁移到标准 `extensions/zettelkasten/` 结构：

```
extensions/zettelkasten/
├── package.json              # name: @openclaw/zettelkasten
├── openclaw.plugin.json     # 同现有 manifest
├── tsconfig.json
├── src/
│   ├── index.ts              # Plugin entry (definePluginEntry)
│   ├── api.ts                # Public API surface
│   ├── runtime-api.ts        # Runtime-specific exports
│   ├── core/                 # 核心类型/常量
│   ├── storage/              # 数据库 schema
│   ├── repository/           # 数据访问层
│   ├── service/              # 业务逻辑层
│   ├── mcp/                  # MCP server
│   └── integration/          # 集成适配器
└── __tests__/                # 测试 (vitest)
```

迁移后的 import 路径从 `../core/types.js` 变为 `./core/types.js` (同包内相对路径)，对 `openclaw/plugin-sdk/*` 的导入无需改变。

---

## 第四部分：Zettelkasten Brain Skill 部署

### 4.1 Skill 简介

Zettelkasten Brain Skill 是 Zettelkasten 插件的可进化 AI 助手扩展。它让 OpenClaw 代理自动把对话中的知识保存到 Zettelkasten 知识库，建立双向链接，并在需要时检索和关联。

> **⚠️ Zettelkasten 操作铁律 — 所有 AI 代理必须遵守**
>
> 1. **必须通过 MCP 工具操作** — 所有对 Zettelkasten 的读写必须使用注册的 MCP 工具（`zk_search_notes`, `zk_create_note`, `zk_create_link` 等），**绝对禁止**直接执行 SQL、脚本或命令行工具修改数据库或文件系统。
> 2. **必须遵守 SKILL.md 和 RULES.md** — 创建笔记前必须先搜索，发现关联时主动建立链接，置信度评估必须准确。
> 3. **禁止绕过 Skill 规则** — 不得以"效率"为由跳过查重、跳过标签提取、跳过关联检测。所有操作必须可追溯、可审核。
> 4. **用户修正优先** — 当用户说"不对""错了"时，必须立即记录正确信息，不得覆盖用户的明确意图。
>
> **违反后果**: 直接操作数据库会导致笔记状态不一致、链接丢失、FTS 索引损坏。任何绕过 Skill 规则的操作都必须回滚并报告给用户。

**核心特性**：
- 🔍 回答前先搜索知识库
- 📝 自动识别并保存重要信息
- 🔗 智能建立笔记关联
- 📊 渐进式进化（每周自动备份，保留5档）
- 🔄 根据使用效果自我调整

### 4.2 部署前提

- OpenClaw >= 2026.4.24
- Zettelkasten 插件已安装并启用
- `openclaw zk doctor` 返回 16 OK

### 4.3 部署步骤

#### Step 1: 复制 Skill

```bash
# 创建 skills 目录
mkdir -p ~/.openclaw/skills

# 从发布包复制 skill（假设已解压 zettelkasten-skill-v1.0.0.tar.gz）
tar -xzf zettelkasten-skill-v1.0.0.tar.gz
cp -r zettelkasten-skill ~/.openclaw/skills/zettelkasten-brain
```

Skill 文件结构：
```
~/.openclaw/skills/zettelkasten-brain/
├── SKILL.md           # Skill 入口
├── PROMPT.md          # 4阶段系统提示词
├── RULES.md           # 行为规则矩阵
├── VERSION            # 版本元数据
├── INSTALL.md         # 安装指南
├── snapshot.sh        # 每周自动备份
├── evolve.sh          # 版本管理器
└── FEEDBACK/
    └── metrics.json   # 进化追踪数据
```

#### Step 2: 激活 Skill

**重要**: OpenClaw 2026.4.24 的配置字段：
- `agents.defaults`（复数，不是 `agents.default`）
- `agents.defaults.systemPromptOverride`（不是 `systemPrompt`）
- `agents.defaults.skills` 填 **skill ID**（不是文件路径）

```bash
# 1. 注册 skill 目录
openclaw config set skills.load.extraDirs '["~/.openclaw/skills"]'

# 2. 设置系统提示词
openclaw config set agents.defaults.systemPromptOverride \
  "file:~/.openclaw/skills/zettelkasten-brain/PROMPT.md"

# 3. 注册 skill（用 skill ID）
openclaw config set agents.defaults.skills '["zettelkasten-brain"]'
```

或在 `~/.openclaw/openclaw.json` 中手动添加：
```json
{
  "skills": {
    "load": {
      "extraDirs": ["~/.openclaw/skills"]
    }
  },
  "agents": {
    "defaults": {
      "skills": ["zettelkasten-brain"],
      "systemPromptOverride": "file:~/.openclaw/skills/zettelkasten-brain/PROMPT.md"
    }
  }
}
```

#### Step 3: 设置自动备份

```bash
# 确保脚本可执行
chmod +x ~/.openclaw/skills/zettelkasten-brain/snapshot.sh
chmod +x ~/.openclaw/skills/zettelkasten-brain/evolve.sh

# 添加 cron 任务（每周日凌晨2点自动快照）
(crontab -l 2>/dev/null; echo "0 2 * * 0 bash ~/.openclaw/skills/zettelkasten-brain/snapshot.sh") | crontab -

# 验证
crontab -l | grep zettelkasten
```

#### Step 4: 重启 Gateway

```bash
openclaw gateway restart
```

### 4.4 验证 Skill

```bash
# 检查 skill 目录注册
openclaw config get skills.load.extraDirs

# 检查 skill 启用状态
openclaw config get agents.defaults.skills

# 检查系统提示词
openclaw config get agents.defaults.systemPromptOverride

# 检查进化管理器
bash ~/.openclaw/skills/zettelkasten-brain/evolve.sh current
```

### 4.5 Skill 进化管理

```bash
# 查看所有存档版本
bash ~/.openclaw/skills/zettelkasten-brain/evolve.sh list

# 手动触发进化快照
bash ~/.openclaw/skills/zettelkasten-brain/evolve.sh evolve

# 回滚到指定版本
bash ~/.openclaw/skills/zettelkasten-brain/evolve.sh rollback v2026w19

# 对比版本差异
bash ~/.openclaw/skills/zettelkasten-brain/evolve.sh diff current v2026w19

# 查看进化指标
bash ~/.openclaw/skills/zettelkasten-brain/evolve.sh metrics
```

### 4.6 常见问题

| 错误 | 原因 | 解决 |
|---|---|---|
| `Unrecognized key: "default"` | 用了 `agents.default` | 改为 `agents.defaults` |
| `Unrecognized key: "systemPrompt"` | 用了 `systemPrompt` | 改为 `systemPromptOverride` |
| **zk 工具不可用** | 插件配置为 `onCommands` 懒加载 | 改为 `onStartup` 启动时加载（见下方修复） |
| `skill not found` | skill 目录未注册 | 检查 `skills.load.extraDirs` |
| `snapshot.sh permission denied` | 无执行权限 | `chmod +x snapshot.sh` |

### 4.6.1 修复：zk 工具不可用（关键）

**症状**: Agent 说 "zk_search_notes 等工具不可用"

**根因**: `openclaw.plugin.json` 中 `activation` 配置为 `onCommands: ["zk"]`，插件只在执行 `zk` CLI 命令时才懒加载。AI 代理运行时不会触发 CLI 命令，所以看不到工具。

**修复方法**（二选一）：

#### 方法 A：修改已部署的 plugin.json（推荐）

```bash
# 1. 找到插件目录
PLUGIN_DIR="$HOME/.openclaw/zettelkasten-plugin"
# 或如果是旧部署
# PLUGIN_DIR="/opt/openclaw-zettelkasten/zettelkasten"

# 2. 修改 openclaw.plugin.json
sed -i 's/"onCommands": \["zk"\]/"onStartup": true/' "$PLUGIN_DIR/plugin/openclaw.plugin.json"

# 3. 验证修改
grep -A1 '"activation"' "$PLUGIN_DIR/plugin/openclaw.plugin.json"
# 应该输出:
#   "activation": {
#     "onStartup": true
#   }

# 4. 重启 Gateway
openclaw gateway restart

# 5. 验证工具可用
openclaw agent --message "列出可用的 zk_ 工具" --thinking low
```

#### 方法 B：重新部署（如果方法 A 无效）

```bash
# 1. 删除旧部署
rm -rf ~/.openclaw/zettelkasten-plugin

# 2. 重新解压部署包
tar -xzf zettelkasten-plugin-2026.4.23-v1.0.0.tar.gz
cd zettelkasten-plugin-2026.4.23-v1.0.0

# 3. 确认 openclaw.plugin.json 已修复
grep '"onStartup"' src/zettelkasten/plugin/openclaw.plugin.json

# 4. 执行安装
bash install.sh

# 5. 重启
openclaw gateway restart
```

### 4.7 卸载 Skill

```bash
# 移除配置
openclaw config set agents.defaults.skills '[]'
openclaw config set agents.defaults.systemPromptOverride ""

# 删除文件
rm -rf ~/.openclaw/skills/zettelkasten-brain

# 移除 cron
crontab -l | grep -v zettelkasten | crontab -

# 重启
openclaw gateway restart
```

---

## 附录 A：命令行快速参考

```bash
# 初始化
openclaw zk:init

# 统计概览
openclaw zk:stats

# 创建笔记 (通过 agent)
openclaw message send --message @"
使用 zk_create_note 创建笔记:
title: 设计决策: 使用 FTS5 做全文搜索
content: 选择 SQLite FTS5 而非 Elasticsearch 的原因...
confidence: 0.85
"@

# 搜索笔记
openclaw message send --message "用 zk_search_notes 搜索'FTS5'，返回前 10 条"

# 手动触发蒸馏
openclaw message send --message "用 zk_distill_memory 蒸馏 2026-04-24 的记忆日志"
```

## 附录 B：Zettelkasten 工具权限矩阵

| 工具 | Chat Agent (read-only) | Knowledge Agent (read-write) |
|---|---|---|
| `zk_search_notes` | ✅ | ✅ |
| `zk_get_note` | ✅ | ✅ |
| `zk_get_backlinks` | ✅ | ✅ |
| `zk_find_path` | ✅ | ✅ |
| `zk_create_note` | ❌ | ✅ |
| `zk_update_note` | ❌ | ✅ |
| `zk_run_ceqrc` | ❌ | ✅ |
| `zk_distill_memory` | ❌ | ✅ |
| `zk_review_note` | ❌ | ✅ |

## 附录 C：目录索引

| 文件 | 用途 |
|---|---|
| `src/zettelkasten/index.ts` | 模块主入口 / `ZettelkastenClient` |
| `src/zettelkasten/plugin/index.ts` | `definePluginEntry` 插件注册 |
| `src/zettelkasten/plugin/openclaw.plugin.json` | 插件 Manifest |
| `src/zettelkasten/core/types.ts` | 核心类型: `ZettelNote`, `Link`, `Tag` |
| `src/zettelkasten/core/constants.ts` | 默认值: ID 格式、链接类型映射 |
| `src/zettelkasten/storage/db-schema.ts` | SQLite schema + FTS5 定义 |
| `src/zettelkasten/repository/note-repository.ts` | 笔记 CRUD + 搜索 |
| `src/zettelkasten/repository/link-repository.ts` | 链接 CRUD + BFS 路径查找 |
| `src/zettelkasten/repository/tag-repository.ts` | 标签 CRUD + 统计 |
| `src/zettelkasten/service/note-service.ts` | 置信度路由、链接自动维护 |
| `src/zettelkasten/service/link-service.ts` | 双向链接、图算法 |
| `src/zettelkasten/service/memory-parser.ts` | OpenClaw 会话日志解析 |
| `src/zettelkasten/service/dedupe-service.ts` | 两阶段去重 |
| `src/zettelkasten/service/ceqrc-engine.ts` | CEQRC 认知流水线 |
| `src/zettelkasten/service/distiller-service.ts` | 夜间批处理蒸馏 |
| `src/zettelkasten/mcp/server.ts` | MCP Server (9 tool handlers) |
| `src/zettelkasten/integration/agent-config.ts` | 双 Agent 权限配置 |
| `src/zettelkasten/integration/cron-scheduler.ts` | Cron 批处理调度 |
| `src/zettelkasten/integration/session-hook.ts` | 会话结束触发蒸馏 |
| `src/zettelkasten/integration/zettelkasten-integration.ts` | 统一集成编排器 |
