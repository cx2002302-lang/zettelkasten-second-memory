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

### 1.3 参考实现分析

参考项目 [joshylchen/zettelkasten](https://github.com/joshylchen/zettelkasten) 的核心架构：

```
数据层:
├── Markdown文件（源数据）- data/notes/
│   └── 20250915064516.md
└── SQLite索引 - data/db/zettelkasten.db
    ├── zettel表 - 核心笔记数据
    ├── tag表 - 标签定义
    ├── zettel_tag表 - 笔记-标签关系
    ├── link表 - 笔记间类型化关系
    └── zettel_fts表 - FTS5全文搜索索引

笔记结构:
---
id: '20250915064516'
title: 'Machine Learning Fundamentals'
summary: 'Core concepts of ML...'
tags: [ai, learning, algorithms]
links:
  - {to: '20250915064517', type: 'supports'}
created_at: '2025-09-15T06:45:16Z'
updated_at: '2025-09-15T06:45:50Z'
status: 'PERMANENT'
---

# Machine Learning Fundamentals
笔记正文内容...
```

**链接类型定义：**
- `supports` / `supported_by` - 证据或论证关系
- `refines` / `refined_by` - 细化关系
- `extends` / `extended_by` - 扩展关系
- `contradicts` / `contradicted_by` - 对立观点
- `is_example_of` / `has_example` - 实例关系
- `related` - 一般关联

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

**数据库Schema：**
```sql
-- 现有表结构
meta - 元数据键值存储
files - 文件索引（path, source, hash, mtime, size）
chunks - 文本块（id, path, source, start_line, end_line, hash, model, text, embedding）
embedding_cache - Embedding缓存
fts5虚拟表 - 全文搜索
```

**搜索能力：**
- 语义搜索（基于embedding）
- 全文搜索（FTS5）
- 查询扩展（多语言停用词处理）
- 混合搜索模式

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

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenClaw Core                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Agent   │  │  Memory  │  │  Session │  │   Task   │    │
│  │ Runtime  │  │ Host SDK │  │ Manager  │  │ Registry │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│       │             │             │             │          │
│       └─────────────┴──────┬──────┴─────────────┘          │
│                            │                                │
│                    ┌───────┴───────┐                        │
│                    │  Zettelkasten │                        │
│                    │    Engine     │                        │
│                    └───────┬───────┘                        │
└────────────────────────────┼────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼──────┐    ┌────────▼────────┐   ┌──────▼──────┐
│   Note       │    │     Link        │   │   CEQRC     │
│ Repository   │    │    Manager      │   │   Engine    │
└───────┬──────┘    └────────┬────────┘   └──────┬──────┘
        │                    │                    │
┌───────▼────────────────────▼────────────────────▼──────┐
│                      Storage Layer                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ SQLite Notes │  │ SQLite Links │  │  FTS5 Index  │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│  ┌──────────────┐  ┌──────────────┐                   │
│  │   Vectors    │  │   Markdown   │                   │
│  │  (sqlite-vec)│  │    Files     │                   │
│  └──────────────┘  └──────────────┘                   │
└────────────────────────────────────────────────────────┘
```

### 3.2 模块设计

#### 3.2.1 Zettelkasten Core Module (`src/zettelkasten/`)

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
│   ├── ceqrc-engine.ts      # CEQRC工作流
│   ├── capture.ts           # 捕获阶段
│   ├── explain.ts           # 解释阶段
│   ├── question.ts          # 提问阶段
│   ├── refine.ts            # 精炼阶段
│   └── connect.ts           # 连接阶段
├── search/
│   ├── note-search.ts       # 笔记搜索
│   ├── link-search.ts       # 链接搜索
│   └── graph-search.ts      # 图谱搜索
├── mcp/
│   └── zettel-mcp-server.ts # MCP服务器
└── integration/
    ├── memory-host-bridge.ts # 与memory-host-sdk集成
    └── session-bridge.ts     # 与会话系统集成
```

#### 3.2.2 数据模型

**Note 实体：**
```typescript
interface ZettelNote {
  id: string;                    // 时间戳ID (YYYYMMDDHHMMSS)
  title: string;                 // 标题
  content: string;               // Markdown内容
  summary?: string;              // AI生成摘要
