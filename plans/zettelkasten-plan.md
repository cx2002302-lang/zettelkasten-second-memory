# OpenClaw 第二记忆系统 - Zettelkasten 集成规划

## 1. 项目概述

### 1.1 目标
为 OpenClaw 开发一套基于 Zettelkasten（卡片盒）方法的第二记忆系统，实现原子化知识管理、双向链接和智能知识发现。

### 1.2 核心概念

**Zettelkasten 方法核心原则：**
- **原子笔记（Atomic Notes）**：每个笔记包含单一概念，独立且完整
- **唯一标识**：使用时间戳ID（如 `20250915064516`）唯一标识每个笔记
- **双向链接**：笔记之间建立类型化的关系，形成知识图谱
- **永久笔记**：经过提炼的永久知识，区别于临时笔记
- **索引与搜索**：基于标签、链接和内容的全文检索

**CEQRC 工作流：**
1. **Capture** - 捕获初始想法
2. **Explain** - 添加详细解释
3. **Question** - AI生成探究性问题（费曼技巧）
4. **Refine** - 基于问题改进内容
5. **Connect** - 发现并创建相关链接

---

## 2. OpenClaw 现有架构分析

### 2.1 现有记忆系统 (memory-host-sdk)

**当前能力：**
- SQLite数据库存储（`node:sqlite`）
- 文件索引系统（files表）
- 文本块管理（chunks表）
- Embedding缓存（embedding_cache表）
- FTS5全文搜索支持
- 向量搜索支持（sqlite-vec）
- 多数据源支持：memory、sessions

### 2.2 会话系统 (sessions)

- 复杂的会话键命名空间（agent:cron:subagent:acp:thread）
- 会话标签支持
- 线程化会话支持

### 2.3 任务系统 (tasks)

- SQLite持久化存储
- 任务流管理
- 任务状态追踪

---

## 3. 集成架构设计

### 3.1 模块结构

```
src/zettelkasten/
├── core/
│   ├── note.ts              # 笔记实体定义
│   ├── link.ts              # 链接实体定义
│   ├── tag.ts               # 标签实体定义
│   └── types.ts             # 核心类型定义
├── repository/
│   ├── note-repository.ts   # 笔记存储操作
│   ├── link-repository.ts   # 链接存储操作
│   └── tag-repository.ts    # 标签存储操作
├── engine/
│   ├── zettel-engine.ts     # 核心引擎
│   ├── query-engine.ts      # 查询引擎
│   └── graph-engine.ts      # 图遍历引擎
├── workflow/
│   └── ceqrc-engine.ts      # CEQRC工作流
├── search/
│   └── note-search.ts       # 笔记搜索
└── integration/
    ├── memory-host-bridge.ts # 与memory-host-sdk集成
    └── session-bridge.ts     # 与会话系统集成
```

### 3.2 数据模型

**Note 实体：**
```typescript
interface ZettelNote {
  id: string;                    // 时间戳ID (YYYYMMDDHHMMSS)
  title: string;                 // 标题
  content: string;               // Markdown内容
  summary?: string;              // AI生成摘要
  tags: string[];                // 标签数组
  status: NoteStatus;            // 状态: FLEETING | LITERATURE | PERMANENT
  source?: string;               // 来源
  createdAt: Date;
  updatedAt: Date;
  sessionKey?: string;           // 关联的OpenClaw会话
}

type NoteStatus = 'FLEETING' | 'LITERATURE' | 'PERMANENT';
```

**Link 实体：**
```typescript
interface ZettelLink {
  id: string;
  fromNoteId: string;            // 源笔记ID
  toNoteId: string;              // 目标笔记ID
  type: LinkType;                // 链接类型
  description?: string;          // 链接描述
  createdAt: Date;
}

type LinkType = 
  | 'supports' | 'supported_by'
  | 'refines' | 'refined_by'
  | 'extends' | 'extended_by'
  | 'contradicts' | 'contradicted_by'
  | 'is_example_of' | 'has_example'
  | 'related';
```

### 3.3 数据库Schema

```sql
-- 笔记表
CREATE TABLE zettel_notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'FLEETING',
  source TEXT,
  session_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT -- JSON
);

-- 标签表
CREATE TABLE zettel_tags (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  color TEXT,
  note_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- 笔记-标签关联表
CREATE TABLE zettel_note_tags (
  note_id TEXT NOT NULL REFERENCES zettel_notes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES zettel_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

-- 链接表
CREATE TABLE zettel_links (
  id TEXT PRIMARY KEY,
  from_note_id TEXT NOT NULL REFERENCES zettel_notes(id) ON DELETE CASCADE,
  to_note_id TEXT NOT NULL REFERENCES zettel_notes(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  description TEXT,
  session_key TEXT,
  created_at INTEGER NOT NULL
);

-- FTS5全文搜索虚拟表
CREATE VIRTUAL TABLE zettel_fts USING fts5(
  title,
  content,
  summary,
  id UNINDEXED
);

-- 索引
CREATE INDEX idx_zettel_notes_status ON zettel_notes(status);
CREATE INDEX idx_zettel_notes_session ON zettel_notes(session_key);
CREATE INDEX idx_zettel_links_from ON zettel_links(from_note_id);
CREATE INDEX idx_zettel_links_to ON zettel_links(to_note_id);
CREATE INDEX idx_zettel_links_type ON zettel_links(type);
```

---

## 4. 核心功能设计

### 4.1 NoteService 接口

```typescript
interface NoteService {
  // CRUD操作
  createNote(params: CreateNoteParams): Promise<ZettelNote>;
  getNote(id: string): Promise<ZettelNote | null>;
  updateNote(id: string, params: UpdateNoteParams): Promise<ZettelNote>;
  deleteNote(id: string): Promise<void>;
  
  // 搜索与查询
  searchNotes(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  getBacklinks(noteId: string): Promise<ZettelLink[]>;
  getOutgoingLinks(noteId: string): Promise<ZettelLink[]>;
  
  // 标签操作
  addTag(noteId: string, tagName: string): Promise<void>;
  removeTag(noteId: string, tagName: string): Promise<void>;
  
  // AI增强
  generateSummary(noteId: string): Promise<string>;
  suggestTags(noteId: string): Promise<string[]>;
  suggestLinks(noteId: string): Promise<SuggestedLink[]>;
}
```

### 4.2 LinkService 接口

```typescript
interface LinkService {
  createLink(params: CreateLinkParams): Promise<ZettelLink>;
  deleteLink(linkId: string): Promise<void>;
  getLinksFromNote(noteId: string): Promise<ZettelLink[]>;
  getLinksToNote(noteId: string): Promise<ZettelLink[]>;
  getConnectedNotes(noteId: string, depth?: number): Promise<ConnectedNote[]>;
}
```

### 4.3 CEQRC 工作流引擎

```typescript
interface CEQRCEngine {
  runFullWorkflow(noteId: string): Promise<WorkflowResult>;
  capture(params: CaptureParams): Promise<ZettelNote>;
  explain(noteId: string, explanation: string): Promise<ZettelNote>;
  question(noteId: string): Promise<GeneratedQuestion[]>;
  refine(noteId: string, answers: Answer[]): Promise<ZettelNote>;
  connect(noteId: string): Promise<SuggestedLink[]>;
}
```

---

## 5. 集成策略

### 5.1 与 Memory Host SDK 集成

1. **复用现有数据库连接**：使用 `memory-host-sdk` 的 SQLite 连接
2. **扩展现有 Schema**：添加 zettelkasten 相关表
3. **复用 Embedding 系统**：使用现有的 embedding 缓存和向量搜索
4. **复用 FTS 系统**：使用现有的 FTS5 全文搜索基础设施

### 5.2 与 Session 系统集成

1. **会话关联笔记**：通过 `session_key` 字段关联笔记和会话
2. **自动捕获**：在会话中自动捕获重要信息为笔记
3. **上下文检索**：根据当前会话自动检索相关笔记

### 5.3 MCP 服务器设计

```typescript
// MCP Tools
interface ZettelkastenMCPTools {
  // 笔记管理
  'zettel_create_note': CreateNoteTool;
  'zettel_get_note': GetNoteTool;
  'zettel_update_note': UpdateNoteTool;
  'zettel_delete_note': DeleteNoteTool;
  'zettel_search_notes': SearchNotesTool;
  
  // 链接管理
  'zettel_create_link': CreateLinkTool;
  'zettel_get_backlinks': GetBacklinksTool;
  'zettel_suggest_links': SuggestLinksTool;
  
  // 工作流
  'zettel_run_ceqrc': RunCEQRCTool;
  'zettel_generate_summary': GenerateSummaryTool;
  'zettel_suggest_tags': SuggestTagsTool;
  
  // 图谱探索
  'zettel_get_note_graph': GetNoteGraphTool;
  'zettel_find_path': FindPathTool;
}
```

---

## 6. 实现计划

### Phase 1: 基础架构
- [ ] 创建 `src/zettelkasten/` 目录结构
- [ ] 实现核心数据模型（Note, Link, Tag）
- [ ] 实现数据库 Schema 和迁移
- [ ] 实现基础 Repository 层

### Phase 2: 核心功能
- [ ] 实现 NoteService CRUD 操作
- [ ] 实现 LinkService 链接管理
- [ ] 实现 TagService 标签管理
- [ ] 实现基础搜索功能

### Phase 3: 高级功能
- [ ] 实现 CEQRC 工作流引擎
- [ ] 集成 AI 摘要生成
- [ ] 实现链接建议算法
- [ ] 实现图谱可视化数据接口

### Phase 4: 集成与优化
- [ ] 集成 Memory Host SDK
- [ ] 集成 Session 系统
- [ ] 实现 MCP 服务器
- [ ] 性能优化和测试

---

## 7. 技术要点

### 7.1 ID 生成策略
使用 `YYYYMMDDHHMMSS` 格式的时间戳作为笔记ID，确保：
- 唯一性
- 时间排序
- 人类可读

### 7.2 链接类型语义
- `supports`/`supported_by`: 论证关系
- `refines`/`refined_by`: 细化关系
- `extends`/`extended_by`: 扩展关系
- `contradicts`/`contradicted_by`: 对立关系
- `is_example_of`/`has_example`: 实例关系
- `related`: 一般关联

### 7.3 笔记状态流转
```
FLEETING → LITERATURE → PERMANENT
   ↓
(丢弃或归档)
```

- **FLEETING**: 临时笔记，快速捕获的想法
- **LITERATURE**: 文献笔记，对来源的摘录和理解
- **PERMANENT**: 永久笔记，经过提炼的独立知识

---

## 8. 与参考项目的差异

| 特性 | joshylchen/zettelkasten | OpenClaw 集成方案 |
|------|------------------------|-------------------|
| 语言 | Python | TypeScript |
| 存储 | 独立 SQLite | 复用 Memory Host SDK |
| 架构 | 独立服务 | 嵌入式模块 |
| AI 集成 | OpenAI | 复用 OpenClaw LLM 能力 |
| 接口 | REST API + CLI + MCP | MCP + 内部 API |
| 部署 | 独立部署 | 随 OpenClaw 一起部署 |

---

## 9. 风险评估

### 9.1 技术风险
- **数据库兼容性**：需要确保与现有 SQLite 版本兼容
- **性能影响**：大量笔记可能影响现有搜索性能
- **存储增长**：Markdown 文件可能占用大量磁盘空间

### 9.2 缓解措施
- 使用渐进式 Schema 迁移
- 实现懒加载和分页
- 提供归档和清理功能
