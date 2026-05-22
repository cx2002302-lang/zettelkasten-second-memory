# Wave 1 技术设计文档

> **版本**: v1.0  
> **日期**: 2026-05-11  
> **范围**: 知识发光度 + 路径搜索  
> **目标**: 让用户一眼看出知识库中哪些笔记是核心、哪些已过期

---

## 1. 需求概述

### 1.1 知识发光度 (Glow Score)

**用户价值**:
- 快速识别核心知识（evergreen）
- 发现被遗忘的笔记（zombie）
- 了解知识库的"健康度"

**功能清单**:
- [ ] 计算每张笔记的综合发光度分数（0-1）
- [ ] 按发光度排序展示笔记
- [ ] 自动分类：evergreen / active / stable / zombie
- [ ] MCP 工具暴露：`zk_glow_ranking`、`zk_find_zombies`

### 1.2 路径搜索 (Path Finder)

**用户价值**:
- 发现两张笔记之间的逻辑关联
- 理解知识网络的连接方式

**功能清单**:
- [ ] BFS 最短路径算法（带链接类型权重）
- [ ] 自动生成中文路径解释
- [ ] 支持 maxDepth / linkTypeFilter 参数
- [ ] MCP 工具强化：`zk_find_path` 完整实现

---

## 2. 数据库 Schema 变更

### 2.1 扩展 zettel_notes 表：增加 archive 支持

```sql
-- 扩展 folder 枚举，增加 archive
-- 原: CHECK (folder IN ('inbox', 'references', 'zettels'))
-- 新: CHECK (folder IN ('inbox', 'references', 'zettels', 'archive'))

-- SQLite 不支持直接修改 CHECK 约束，需要通过以下方式：
-- 1. 新系统直接创建新表（兼容）
-- 2. 旧系统迁移：重建表或忽略约束（archive 值不会出现在旧代码中）
```

> **兼容性处理**: OpenClaw 2026.4.24 环境下，新部署直接创建含 archive 的 Schema。旧数据库通过 `zk init` 的 `ensureZettelkastenSchema` 自动升级（已预留扩展空间）。

### 2.2 新增表：zettel_note_stats

```sql
CREATE TABLE IF NOT EXISTS zettel_note_stats (
  note_id TEXT PRIMARY KEY REFERENCES zettel_notes(id) ON DELETE CASCADE,
  
  -- 图中心性（简化版 PageRank）
  pagerank_score REAL DEFAULT 0,
  
  -- 引用指标
  backlink_count INTEGER DEFAULT 0,
  outgoing_link_count INTEGER DEFAULT 0,
  
  -- 时间指标
  days_since_created INTEGER DEFAULT 0,
  days_since_updated INTEGER DEFAULT 0,
  
  -- 综合发光度（0-1）
  glow_score REAL DEFAULT 0,
  
  -- 衰减因子
  decay_factor REAL DEFAULT 0,
  
  -- 分类标签（zombie = 待归档候选）
  glow_status TEXT DEFAULT 'stable' CHECK (glow_status IN ('evergreen', 'active', 'stable', 'zombie')),
  
  -- 元数据
  last_calculated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_note_stats_glow ON zettel_note_stats(glow_score DESC);
CREATE INDEX IF NOT EXISTS idx_note_stats_status ON zettel_note_stats(glow_status);
CREATE INDEX IF NOT EXISTS idx_notes_folder ON zettel_notes(folder);
```

### 2.2 Schema 兼容性

- **向后兼容**: 新增表不影响现有查询
- **数据填充**: 首次计算时批量插入，后续增量更新
- **降级策略**: 删除 `zettel_note_stats` 表即可回滚到 Phase 2

---

## 3. 接口设计

### 3.1 GlowCalculator

```typescript
// src/engine/glow-calculator.ts

export interface GlowMetrics {
  noteId: string;
  title: string;
  pagerank: number;
  backlinkCount: number;
  outgoingLinkCount: number;
  recency: number;
  decay: number;
  glow: number;
  status: 'evergreen' | 'active' | 'stable' | 'zombie';
  lastCalculatedAt: string;
}

export interface GlowRankingOptions {
  limit?: number;
  statusFilter?: Array<'evergreen' | 'active' | 'stable' | 'zombie'>;
  minGlow?: number;
  maxGlow?: number;
}

export class GlowCalculator {
  constructor(private db: DatabaseSync);
  
  // 计算单张笔记的发光度
  calculate(noteId: string): GlowMetrics;
  
  // 批量计算全部笔记
  recalculateAll(): GlowMetrics[];
  
  // 获取发光度排行
  getRanking(options?: GlowRankingOptions): GlowMetrics[];
  
  // 获取僵尸笔记
  findZombies(limit?: number): GlowMetrics[];
  
  // 获取知识库统计摘要
  getSummary(): {
    totalNotes: number;
    evergreenCount: number;
    activeCount: number;
    stableCount: number;
    zombieCount: number;
    averageGlow: number;
  };
}
```

### 3.2 PathFinder

```typescript
// src/engine/path-finder.ts

export interface PathNode {
  noteId: string;
  title: string;
  linkType?: string;
}

export interface PathResult {
  fromId: string;
  fromTitle: string;
  toId: string;
  toTitle: string;
  path: PathNode[];
  totalWeight: number;
  stepCount: number;
  explanation: string;
}

export interface PathFinderOptions {
  maxDepth?: number;
  linkTypeFilter?: string[];
  excludeNoteIds?: string[];
}

export class PathFinder {
  constructor(private db: DatabaseSync);
  
  // 查找最短路径
  findPath(
    fromId: string,
    toId: string,
    options?: PathFinderOptions
  ): PathResult | null;
  
  // 查找从某笔记出发的所有路径（用于探索）
  findPathsFrom(
    fromId: string,
    options?: PathFinderOptions
  ): PathResult[];
}
```

---

## 4. 算法设计

### 4.1 发光度计算公式

```
glow = (centrality * 0.4 + citation * 0.3 + recency * 0.3) * (1 - decay)

其中:
- centrality = min(pagerank / 10, 1)
- citation = min(backlinks / 10, 1)
- recency = max(0, 1 - days_since_update / 30)
- decay = min(days_since_update / 365, 0.8)
```

### 4.2 状态分类规则

| 状态 | 条件 |
|------|------|
| evergreen | glow > 0.8 AND backlinks > 5 |
| active | glow > 0.6 |
| zombie | days_since_update > 180 AND backlinks = 0 |
| stable | 其他 |

### 4.3 路径搜索算法

```
算法: 带权 BFS

权重矩阵:
- supports: 1.0
- refines: 1.2
- extends: 1.5
- contradicts: 2.0
- is_example_of: 1.3
- related: 2.0

特殊处理:
- 循环检测: visited 集合防重
- 最大深度: maxDepth 默认 6
- 无路径: 返回 null（不报错）
```

### 4.4 路径解释生成

```typescript
function generateExplanation(path: PathNode[]): string {
  if (path.length <= 2) {
    return `直接通过「${path[1]?.linkType || '相关'}」链接`;
  }
  
  const steps = [];
  for (let i = 1; i < path.length; i++) {
    const linkType = path[i].linkType || '相关';
    steps.push(`从「${path[i-1].title}」${linkType}到「${path[i].title}」`);
  }
  
  return `经过 ${path.length - 1} 步: ${steps.join('，')}`;
}
```

---

## 5. MCP 工具设计

### 5.1 zk_glow_ranking

```typescript
{
  name: "zk_glow_ranking",
  description: "按发光度排序展示笔记，支持分类筛选",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", default: 20 },
      statusFilter: { 
        type: "array", 
        items: { enum: ["evergreen", "active", "stable", "zombie"] }
      },
      minGlow: { type: "number", minimum: 0, maximum: 1 }
    }
  }
}
```

**返回示例**:
```json
{
  "notes": [
    { "id": "20260510...", "title": "Docker Bridge 配置", "glow": 0.92, "status": "evergreen" },
    { "id": "20260509...", "title": "pnpm vs npm", "glow": 0.75, "status": "active" }
  ],
  "summary": { "total": 156, "evergreen": 12, "active": 45, "stable": 89, "zombie": 10 }
}
```

### 5.2 zk_find_zombies

```typescript
{
  name: "zk_find_zombies",
  description: "找出过期僵尸笔记（半年未更新且无引用）",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", default: 20 }
    }
  }
}
```

### 5.3 zk_find_path（强化版）

```typescript
{
  name: "zk_find_path",
  description: "查找两张笔记之间的最短路径",
  inputSchema: {
    type: "object",
    properties: {
      fromNoteId: { type: "string" },
      toNoteId: { type: "string" },
      maxDepth: { type: "number", default: 6 },
      linkTypeFilter: { type: "array", items: { type: "string" } }
    },
    required: ["fromNoteId", "toNoteId"]
  }
}
```

### 5.4 zk_search_archived

```typescript
{
  name: "zk_search_archived",
  description: "搜索已归档的笔记（默认搜索不包含归档）",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number", default: 20 }
    },
    required: ["query"]
  }
}
```

### 5.5 zk_archive_note / zk_unarchive_note

```typescript
{
  name: "zk_archive_note",
  description: "手动归档笔记（移到 archive 文件夹）",
  inputSchema: {
    type: "object",
    properties: {
      noteId: { type: "string" }
    },
    required: ["noteId"]
  }
}
```

---

## 6. 测试用例设计

### 6.1 发光度测试

| TC | 场景 | 输入 | 期望输出 |
|----|------|------|---------|
| G-01 | 高引用+近期更新 | backlinks=10, days=5 | status=evergreen, glow>0.8 |
| G-02 | 无引用+长期未更新 | backlinks=0, days=200 | status=zombie |
| G-03 | 普通笔记 | backlinks=2, days=30 | status=stable |
| G-04 | 空库计算 | 0 张笔记 | 返回空数组，不报错 |
| G-05 | 单张笔记 | 1 张笔记 | glow=1.0（默认最大值） |
| G-06 | 循环链接不影响 | A→B→C→A | 正常计算，不死循环 |

### 6.2 路径搜索测试

| TC | 场景 | 输入 | 期望输出 |
|----|------|------|---------|
| P-01 | 直接链接 | A→B | path=[A,B], weight=1.0 |
| P-02 | 间接路径 | A→C→B | path=[A,C,B], explanation 含"经过 2 步" |
| P-03 | 无路径 | A 和 B 无关联 | null |
| P-04 | 循环链接 | A→B→C→A, 找 A→C | path=[A,B,C] 或 [A,C]（取最短） |
| P-05 | 超深路径 | 链长 > maxDepth | 返回 null（受深度限制） |
| P-06 | 链接类型过滤 | 只查 supports | 只返回 supports 链接组成的路径 |

### 6.3 集成测试（Agent 端到端）

| TC | 用户输入 | Agent 动作 | 验证点 |
|----|---------|-----------|--------|
| I-01 | "哪些笔记最重要？" | 调用 zk_glow_ranking | 返回 evergreen 列表 |
| I-02 | "有哪些过期的笔记？" | 调用 zk_find_zombies | 返回 zombie 列表 |
| I-03 | "A 和 B 有什么关联？" | 调用 zk_find_path | 返回中文路径解释 |
| I-04 | "找两个无关笔记的路径" | 调用 zk_find_path | 友好提示"未找到关联" |

---

## 7. OpenClaw 2026.4.24 集成点

### 7.1 配置文件变更

无需变更 `openclaw.json`，新增 MCP 工具自动注册。

### 7.2 Agent 工具权限

```typescript
// CHAT_BRAIN_TOOLS（只读）
const CHAT_BRAIN_TOOLS = [
  'zk_search_notes',
  'zk_get_note',
  'zk_get_backlinks',
  'zk_find_path',        // ← 新增
  'zk_glow_ranking',     // ← 新增
  'zk_find_zombies',     // ← 新增
];

// KNOWLEDGE_BRAIN_TOOLS（读写）
const KNOWLEDGE_BRAIN_TOOLS = [
  ...CHAT_BRAIN_TOOLS,
  'zk_create_note',
  'zk_update_note',
  'zk_create_link',
  'zk_run_ceqrc',
  'zk_distill_memory',
  'zk_review_note',
];
```

### 7.3 部署流程

```bash
# 1. 备份
bash scripts/backup-config.sh

# 2. 部署 Wave 1
bash scripts/deploy.sh

# 3. 重启 Gateway
openclaw gateway restart

# 4. 验证
openclaw zk doctor
openclaw zk status
```

---

## 8. 工作量估算

| 任务 | 时间 | 依赖 |
|------|------|------|
| Schema 设计 + 创建 | 0.5 天 | 无 |
| GlowCalculator 引擎 | 1.5 天 | Schema |
| PathFinder 引擎 | 1 天 | 无 |
| MCP 工具注册 | 0.5 天 | 引擎 |
| 单元测试（发光度） | 1 天 | 引擎 |
| 单元测试（路径） | 1 天 | 引擎 |
| Agent 集成测试 | 1 天 | MCP |
| 性能基准 | 0.5 天 | 全部 |
| **总计** | **7 天** | |

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 大规模笔记计算慢 | 发光度计算耗时 | SQL 批量操作 + LIMIT + 后台异步 |
| 循环链接导致死循环 | 路径搜索挂起 | visited 集合 + maxDepth 硬限制 |
| Schema 变更不兼容 | 现有数据损坏 | 新表独立 + ON DELETE CASCADE |
| 自动归档误伤重要笔记 | 数据丢失感 | 只改 folder 不删除，可恢复 |

---

## 10. 归档机制设计

### 10.1 归档触发条件

| 触发方式 | 条件 | 动作 |
|---------|------|------|
| **自动归档** | zombie 状态（半年未更新 + 零引用） | folder → archive |
| **手动归档** | 用户通过 `zk_archive_note` | folder → archive |
| **手动恢复** | 用户通过 `zk_unarchive_note` | folder → 原位置 |

### 10.2 搜索行为

| 搜索场景 | 是否包含 archive |
|---------|-----------------|
| `zk_search_notes` 默认 | ❌ 不包含 |
| `zk_search_notes` + `includeArchived: true` | ✅ 包含 |
| `zk_search_archived` | ✅ 只搜 archive |
| `zk_glow_ranking` | ❌ 不包含 |
| `zk_find_path` | ✅ 包含（路径可能经过归档笔记） |

### 10.3 归档与删除的区别

| 特性 | 归档 | 删除 |
|------|------|------|
| 数据保留 | ✅ 保留 | ❌ 永久删除 |
| 默认搜索 | ❌ 不出现 | ❌ 不出现 |
| 可恢复 | ✅ 一键恢复 | ❌ 不可恢复 |
| 链接关系 | ✅ 保留 | ❌ 链接断裂 |
| 文件系统 | ✅ .md 文件保留 | ❌ .md 文件删除 |

---

**设计完成，等待评审。**

评审通过后进入编码阶段。
