# Zettelkasten 设计决策记录

> 基于原子卡片模板和 GitHub 参考项目的综合设计决策

---

## 1. ID 格式

**决策**: 使用 `YYYYMMDDHHMMSS` (14位时间戳)

**理由**:
- GitHub 项目使用此格式，实践证明有效
- 秒级精度基本避免冲突
- 无需复杂的 `-N` 后缀处理
- 与 ISO 8601 时间戳格式一致

**示例**:
```
20250915064516  # 2025年9月15日 06:45:16
```

---

## 2. 时间戳格式

**决策**: 使用 ISO 8601 格式

**理由**:
- 国际标准，易于解析
- 包含时区信息
- 与 GitHub 项目一致

**字段**:
```yaml
---
id: "20250915064516"
created_at: "2025-09-15T06:45:16Z"
updated_at: "2025-09-15T06:45:50Z"
---
```

---

## 3. 卡片类型 (type)

**决策**: 支持三种核心类型

| 类型 | 说明 | 用途 |
|------|------|------|
| `atomic` | 原子卡片 | 包含单一概念，独立完整 |
| `structure` | 结构笔记 | 索引、目录、主题聚合 |
| `source` | 源头笔记 | 记录文献、书籍、文章摘录 |

**与 NoteStatus 的关系**:
- `type`: 卡片的结构性分类（原子/结构/源头）
- `status`: 卡片的生命周期状态（FLEETING/LITERATURE/PERMANENT）
- 两者正交，可以同时存在

---

## 4. 双向链接格式

**决策**: 使用简单数组格式，反向链接动态计算

**Frontmatter 中的链接**:
```yaml
---
links:
  - { to: "20250915064517", type: "supports", context: "解释了核心概念" }
  - { to: "20250915064518", type: "extends", context: "进一步发展了该理论" }
---
```

**链接类型**:
- `supports` / `supported_by` - 支持/证实
- `refines` / `refined_by` - 细化/改进
- `extends` / `extended_by` - 扩展/深化
- `contradicts` / `contradicted_by` - 反驳/对比
- `is_example_of` / `has_example` - 是...的实例
- `related` - 相关

**反向链接**: 由系统动态查询生成，不存储在 frontmatter 中

---

## 5. 状态标记

**决策**: 使用 YAML 字段 + 标签混合

**YAML 字段** (机器可读):
```yaml
---
status: PERMANENT  # FLEETING | LITERATURE | PERMANENT
confidence: 5      # 1-5 置信度
---
```

**标签** (人类可读 + 搜索):
```markdown
# 状态标签
#草稿 #进行中 #已完成

# 置信度标签  
#高置信度 #中置信度 #低置信度
```

---

## 6. 文件存储结构

**决策**: 扁平目录结构

**理由**:
- GitHub 项目证明扁平目录在万级卡片下也能工作
- 简化路径处理逻辑
- ID 本身包含时间信息，无需额外分层

**结构**:
```
.zettelkasten/                    # 数据目录
├── db/
│   └── zettelkasten.db          # SQLite 索引数据库
├── notes/
│   ├── 20250915064516.md
│   ├── 20250915064517.md
│   └── ...                      # 扁平存储
├── attachments/                  # 附件目录
│   ├── images/
│   ├── pdfs/
│   └── ...
└── templates/                    # 模板目录
    ├── atomic.md
    ├── structure.md
    └── source.md
```

---

## 7. Markdown 模板

**原子卡片模板** (`templates/atomic.md`):
```markdown
---
id: {{id}}
title: {{title}}
summary: {{summary}}
tags: {{tags}}
type: atomic
status: FLEETING
confidence: 3
links: []
created_at: {{created_at}}
updated_at: {{updated_at}}
---

# {{title}}

{{content}}
```

**Structure Note 模板** (`templates/structure.md`):
```markdown
---
id: {{id}}
title: {{title}}
summary: {{summary}}
tags: {{tags}}
type: structure
status: PERMANENT
confidence: 4
links: []
created_at: {{created_at}}
updated_at: {{updated_at}}
---

# {{title}}

## 导航

{{navigation}}

## 包含的卡片

{{card_list}}
```

---

## 8. 与 OpenClaw 的集成点

**会话集成**:
```yaml
# 在卡片 frontmatter 中记录来源会话
session_key: "agent:2026-04-20:abc123"
source: "session"  # 来源类型: session | manual | import
```

**记忆系统集成**:
- 卡片创建时自动索引到 memory-host-sdk
- 支持通过记忆搜索发现相关卡片
- 会话总结可自动转换为原子卡片

**AI 增强**:
- CEQRC 工作流集成到卡片创建流程
- AI 自动提取关键词、生成摘要（280字符限制）
- AI 建议相关链接

---

## 9. 数据库 Schema

**notes 表**:
```sql
CREATE TABLE zettel_notes (
  id TEXT PRIMARY KEY,           -- YYYYMMDDHHMMSS
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,                  -- AI 生成摘要，280字符限制
  type TEXT NOT NULL,            -- atomic | structure | source
  status TEXT NOT NULL,          -- FLEETING | LITERATURE | PERMANENT
  confidence INTEGER,            -- 1-5
  source TEXT,                   -- 来源描述
  session_key TEXT,              -- 关联会话
  file_path TEXT NOT NULL,       -- Markdown 文件路径
  created_at TEXT NOT NULL,      -- ISO 8601
  updated_at TEXT NOT NULL,      -- ISO 8601
  
  FOREIGN KEY (session_key) REFERENCES sessions(key)
);
```

**links 表**:
```sql
CREATE TABLE zettel_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_note_id TEXT NOT NULL,
  to_note_id TEXT NOT NULL,
  type TEXT NOT NULL,            -- supports | refines | extends | contradicts | is_example_of | related
  context TEXT,                  -- 链接上下文描述
  created_at TEXT NOT NULL,
  
  FOREIGN KEY (from_note_id) REFERENCES zettel_notes(id),
  FOREIGN KEY (to_note_id) REFERENCES zettel_notes(id),
  UNIQUE(from_note_id, to_note_id, type)
);
```

**tags 表**:
```sql
CREATE TABLE zettel_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE zettel_note_tags (
  note_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  
  PRIMARY KEY (note_id, tag_id),
  FOREIGN KEY (note_id) REFERENCES zettel_notes(id),
  FOREIGN KEY (tag_id) REFERENCES zettel_tags(id)
);
```

**FTS5 全文搜索表**:
```sql
CREATE VIRTUAL TABLE zettel_fts USING fts5(
  title,
  content,
  summary,
  content='zettel_notes',
  content_rowid='id'
);
```

---

## 10. API 设计

**创建卡片**:
```typescript
interface CreateNoteParams {
  title: string;
  content: string;
  type: 'atomic' | 'structure' | 'source';
  tags?: string[];
  links?: {
    to: string;           // 目标卡片 ID
    type: LinkType;       // 链接类型
    context