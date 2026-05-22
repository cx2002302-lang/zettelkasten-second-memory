# Phase 3: 高级功能（"特效"）深度技术分析

> 基于现有架构的五大特效实现方案

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    现有架构基础                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ zettel_notes │  │ zettel_links │  │   FTS5       │       │
│  │   (笔记)      │  │   (链接)      │  │ (全文搜索)    │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                 │                 │               │
│         └─────────────────┴─────────────────┘               │
│                           │                                 │
└───────────────────────────┼─────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
    ┌─────────▼──┐ ┌────────▼────┐ ┌──────▼──────┐
    │  图引擎     │ │  向量引擎    │ │  统计引擎    │
    │ (Graph)    │ │  (Vector)   │ │  (Stats)    │
    └─────┬──────┘ └──────┬──────┘ └──────┬──────┘
          │               │               │
    ┌─────▼───────────────▼───────────────▼─────┐
    │              Phase 3 特效层                │
    │  1.动态拓扑组合  2.语义吸附  3.知识发光度   │
    │  4.路径搜索     5.化学反应                │
    └───────────────────────────────────────────┘
```

---

## 1. 动态拓扑组合 (Dynamic Composition)

### 核心概念
将知识图谱视为可动态查询的数据库视图，而非静态文件集合。用户通过声明式查询语言，实时组合出符合特定条件的卡片集合。

### 技术实现

#### 1.1 数据模型扩展

```sql
-- 视图定义表（存储查询条件，非结果）
CREATE TABLE zettel_views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  query_json TEXT NOT NULL,  -- 序列化的 ViewCompositionQuery
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 视图-卡片关联（物化缓存，可重建）
CREATE TABLE zettel_view_notes (
  view_id TEXT NOT NULL REFERENCES zettel_views(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL REFERENCES zettel_notes(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (view_id, note_id)
);
```

#### 1.2 查询引擎实现

```typescript
// src/zettelkasten/engine/view-composition.ts
interface ViewCompositionQuery {
  filter: {
    tags?: string[];
    keywords?: string[];
    status?: NoteStatus[];
    createdAfter?: Date;
    createdBefore?: Date;
    linkedTo?: string[];      // 必须链接到指定卡片
    notLinkedTo?: string[];   // 不能链接到指定卡片
    confidence?: { min: number; max: number };
  };
  sortBy: "temporal" | "centrality" | "confidence" | "random" | "custom";
  sortOrder?: "asc" | "desc";
  output: {
    format: "linear" | "tree" | "graph" | "moc";
    maxDepth?: number;        // 树/图模式的深度限制
    maxNodes?: number;        // 最大节点数
    includeBacklinks?: boolean;
  };
}

class ViewCompositionEngine {
  constructor(
    private db: DatabaseSync,
    private noteService: NoteService,
    private linkService: LinkService
  ) {}

  // 核心：将查询条件转换为 SQL
  async composeView(query: ViewCompositionQuery): Promise<ComposedView> {
    const whereClauses: string[] = ["1=1"];
    const params: any[] = [];

    // 标签过滤
    if (query.filter.tags?.length) {
      whereClauses.push(`EXISTS (
        SELECT 1 FROM zettel_note_tags nt
        WHERE nt.note_id = n.id AND nt.tag_id IN (${query.filter.tags.map(() => '?').join(',')})
      )`);
      params.push(...query.filter.tags);
    }

    // 关键词过滤（FTS5）
    if (query.filter.keywords?.length) {
      whereClauses.push(`EXISTS (
        SELECT 1 FROM zettel_fts fts
        WHERE fts.id = n.id AND fts MATCH ?
      )`);
      params.push(query.filter.keywords.join(' OR '));
    }

    // 状态过滤
    if (query.filter.status?.length) {
      whereClauses.push(`n.status IN (${query.filter.status.map(() => '?').join(',')})`);
      params.push(...query.filter.status);
    }

    // 时间范围
    if (query.filter.createdAfter) {
      whereClauses.push('n.created_at >= ?');
      params.push(query.filter.createdAfter.getTime());
    }

    // 链接过滤
    if (query.filter.linkedTo?.length) {
      whereClauses.push(`EXISTS (
        SELECT 1 FROM zettel_links l
        WHERE l.from_note_id = n.id AND l.to_note_id IN (${query.filter.linkedTo.map(() => '?').join(',')})
      )`);
      params.push(...query.filter.linkedTo);
    }

    const sql = `
      SELECT n.* FROM zettel_notes n
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY ${this.getSortClause(query.sortBy)}
      LIMIT ?
    `;
    params.push(query.output.maxNodes || 100);

    const notes = this.db.prepare(sql).all(...params) as ZettelNote[];

    // 根据输出格式构建视图结构
    return this.buildViewStructure(notes, query.output);
  }

  private buildViewStructure(
    notes: ZettelNote[],
    output: ViewCompositionQuery['output']
  ): ComposedView {
    switch (output.format) {
      case 'tree':
        return this.buildTreeView(notes, output.maxDepth || 3);
      case 'graph':
        return this.buildGraphView(notes);
      case 'moc':
        return this.buildMOCView(notes);
      default:
        return { format: 'linear', nodes: notes };
    }
  }

  // 树视图：以中心性最高的节点为根
  private buildTreeView(notes: ZettelNote[], maxDepth: number): TreeView {
    const noteIds = new Set(notes.map(n => n.id));
    const root = this.findMostCentral(notes);
    const tree = this.expandNode(root, noteIds, maxDepth, 0);
    return { format: 'tree', root: tree };
  }
}
```

#### 1.3 SQL 查询示例

```sql
-- 查询所有与"机器学习"相关、 confidence > 0.7 的 PERMANENT 笔记
-- 按中心性排序，返回树形结构（深度3）

WITH RECURSIVE
  -- 第1步：基础过滤
  filtered_notes AS (
    SELECT n.* FROM zettel_notes n
    JOIN zettel_fts fts ON fts.id = n.id
    WHERE fts MATCH '机器学习'
      AND n.status = 'PERMANENT'
      AND n.confidence >= 0.7
  ),
  
  -- 第2步：计算中心性（简化版：入度+出度）
  centrality AS (
    SELECT 
      n.id,
      (SELECT COUNT(*) FROM zettel_links WHERE to_note_id = n.id) +
      (SELECT COUNT(*) FROM zettel_links WHERE from_note_id = n.id) as degree
    FROM filtered_notes n
  ),
  
  -- 第3步：递归构建树（从中心性最高的节点开始）
  tree AS (
    -- 根节点
    SELECT 
      n.id, n.title, n.content,
      0 as depth,
      CAST(n.id AS TEXT) as path
    FROM filtered_notes n
    JOIN centrality c ON c.id = n.id
    ORDER BY c.degree DESC
    LIMIT 1
    
    UNION ALL
    
    -- 递归子节点
    SELECT 
      n.id, n.title, n.content,
      t.depth + 1,
      t.path || ',' || n.id
    FROM tree t
    JOIN zettel_links l ON l.from_note_id = t.id
    JOIN filtered_notes n ON n.id = l.to_note_id
    WHERE t.depth < 3
      AND instr(t.path, n.id) = 0  -- 避免循环
  )

SELECT * FROM tree ORDER BY path;
```

### 集成点
- **复用**: 现有 `zettel_notes`, `zettel_links`, `zettel_fts` 表
- **新增**: `zettel_views`, `zettel_view_notes` 表
- **服务**: `ViewCompositionEngine` 类
- **MCP 工具**: `zk_compose_view` 暴露给 AI 调用

### 预估工作量
- 数据模型: 2 小时
- 查询引擎: 8 小时
- 视图格式化: 4 小时
- 测试: 4 小时
- **总计: 约 18 小时**

---

## 2. 语义吸附 (Semantic Gravity)

### 核心概念
当用户编辑卡片时，系统像"引力场"一样自动推荐语义相近的卡片。结合向量相似度（语义）和图距离（结构）进行混合排序。

### 技术实现

#### 2.1 向量存储扩展

```sql
-- 卡片向量表（使用 sqlite-vec 扩展）
CREATE VIRTUAL TABLE zettel_embeddings USING vec0(
  note_id TEXT PRIMARY KEY,
  embedding float[384]  -- 使用轻量级模型，如 all-MiniLM-L6-v2
);

-- 预计算统计表
CREATE TABLE zettel_note_stats (
  note_id TEXT PRIMARY KEY REFERENCES zettel_notes(id) ON DELETE CASCADE,
  vector_magnitude REAL,    -- 向量模长（用于快速相似度计算）
  last_embedding_at INTEGER,
  graph_centrality REAL,    -- 预计算的中心性
  citation_count INTEGER,   -- 被引用次数
  updated_at INTEGER
);
```

#### 2.2 语义吸附引擎

```typescript
// src/zettelkasten/engine/semantic-gravity.ts
interface SemanticGravityResult {
  noteId: string;
  title: string;
  vectorSimilarity: number;  // 0-1，向量余弦相似度
  graphDistance: number;     // 图距离（∞表示不连通）
  combinedScore: number;     // 混合分数
  reason: string;            // 推荐理由
}

class SemanticGravityEngine {
  constructor(
    private db: DatabaseSync,
    private llmProvider: LLMProvider
  ) {}

  // 核心：计算混合分数
  async getRecommendations(
    sourceNoteId: string,
    options: {
      limit?: number;
      minSimilarity?: number;
      includeDisconnected?: boolean;
    } = {}
  ): Promise<SemanticGravityResult[]> {
    const { limit = 10, minSimilarity = 0.5 } = options;

    // 第1步：获取源卡片的向量
    const sourceVector = await this.getEmbedding(sourceNoteId);

    // 第2步：向量相似度搜索（sqlite-vec）
    const similarByVector = this.db.prepare(`
      SELECT 
        note_id,
        distance as vector_distance
      FROM zettel_embeddings
      WHERE embedding MATCH ? AND k = ? AND note_id != ?
    `).all(
      JSON.stringify(sourceVector),
      limit * 3,  // 获取更多候选，后续用图距离筛选
      sourceNoteId
    ) as Array<{ note_id: string; vector_distance: number }>;

    // 第3步：计算图距离
    const results: SemanticGravityResult[] = [];
    for (const candidate of similarByVector) {
      const graphDistance = await this.calculateGraphDistance(
        sourceNoteId,
        candidate.note_id
      );

      // 混合分数：向量相似度权重 0.6，图距离权重 0.4
      const vectorSim = 1 - candidate.vector_distance;
      const graphScore = graphDistance === Infinity 
        ? 0 
        : 1 / (graphDistance + 1);
      const combinedScore = vectorSim * 0.6 + graphScore * 0.4;

      if (combinedScore >= minSimilarity) {
        const note = await this.getNoteSummary(candidate.note_id);
        results.push({
          noteId: candidate.note_id,
          title: note.title,
          vectorSimilarity: vectorSim,
          graphDistance,
          combinedScore,
          reason: this.generateReason(vectorSim, graphDistance)
        });
      }
    }

    // 按混合分数排序
    return results
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, limit);
  }

  // 使用 SQL CTE 计算最短路径距离
  private calculateGraphDistance(
    fromId: string,
    toId: string
  ): number | typeof Infinity {
    const result = this.db.prepare(`
      WITH RECURSIVE
        paths(node_id, distance, path) AS (
          -- 起点
          SELECT ?, 0, ?
          
          UNION ALL
          
          -- 遍历链接
          SELECT 
            CASE 
              WHEN l.from_note_id = p.node_id THEN l.to_note_id
              ELSE l.from_note_id
            END,
            p.distance + 1,
            p.path || ',' || CASE 
              WHEN l.from_note_id = p.node_id THEN l.to_note_id
              ELSE l.from_note_id
            END
          FROM paths p
          JOIN zettel_links l ON 
            l.from_note_id = p.node_id OR l.to_note_id = p.node_id
          WHERE p.distance < 5
            AND instr(p.path, CASE 
              WHEN l.from_note_id = p.node_id THEN l.to_note_id
              ELSE l.from_note_id
            END) = 0
        )
      SELECT MIN(distance) as min_distance
      FROM paths
      WHERE node_id = ?
    `).get(fromId, fromId, toId) as { min_distance: number | null };

    return result.min_distance ?? Infinity;
  }

  private generateReason(
    vectorSim: number,
    graphDistance: number
  ): string {
    if (graphDistance === 1) {
      return `直接链接，语义相似度 ${(vectorSim * 100).toFixed(1)}%`;
    } else if (graphDistance <= 3) {
      return `通过 ${graphDistance} 步可达，语义相似度 ${(vectorSim * 100).toFixed(1)}%`;
    } else {
      return `语义相似度 ${(vectorSim * 100).toFixed(1)}%，建议建立链接`;
    }
  }

  // 异步生成/更新卡片的 embedding
  async updateEmbedding(noteId: string): Promise<void> {
    const note = await this.getNote(noteId);
    const text = `${note.title}\n${note.content}`;
    const embedding = await this.llmProvider.generateEmbedding(text);

    this.db.prepare(`
      INSERT INTO zettel_embeddings (note_id, embedding)
      VALUES (?, ?)
      ON CONFLICT(note_id) DO UPDATE SET
        embedding = excluded.embedding
    `).run(noteId, JSON.stringify(embedding));

    // 更新统计
    const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    this.db.prepare(`
      INSERT INTO zettel_note_stats (note_id, vector_magnitude, last_embedding_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(note_id) DO UPDATE SET
        vector_magnitude = excluded.vector_magnitude,
        last_embedding_at = excluded.last_embedding_at,
        updated_at = excluded.updated_at
    `).run(noteId, magnitude, Date.now(), Date.now());
  }
}
```

### 集成点
- **复用**: 现有 `zettel_notes`, `zettel_links` 表
- **依赖**: `sqlite-vec` 扩展（已在 memory-host-sdk 中可用）
- **新增**: `zettel_embeddings` 虚拟表, `zettel_note_stats` 表
- **触发时机**: 卡片保存后、编辑时（防抖 2 秒）
- **MCP 工具**: `zk_suggest_links` 暴露给 AI

### 预估工作量
- 向量表设计: 2 小时
- Embedding 生成集成: 4 小时
- 混合排序算法: 4 小时
- 实时推荐触发: 2 小时
- 测试: 4 小时
- **总计: 约 16 小时**

---

## 3. 知识断层检测

### 核心概念
通过社区发现算法识别知识图谱中的"孤岛"——高度互连的集群之间存在逻辑断层，需要建立桥梁链接。

### 技术实现

#### 3.1 简化版 Louvain 算法

由于完整 Louvain 算法较复杂，建议先实现简化版：

```typescript
// src/zettelkasten/engine/community-detection.ts
interface Community {
  id: string;
  nodes: string[];
  density: number;      // 内部连接密度
  boundaryNodes: string[];  // 边界节点（连接其他社区）
}

interface Gap {
  fromCommunity: string;
  toCommunity: string;
  semanticSimilarity: number;
  recommendedBridge: Array<{
    fromNode: string;
    toNode: string;
    score: number;
  }>;
}

class CommunityDetector {
  constructor(private db: DatabaseSync) {}

  // 简化版：标签聚类 + 图密度
  detectCommunities(): Community[] {
    // 第1步：基于标签初始聚类
    const tagGroups = this.db.prepare(`
      SELECT 
        t.name as tag,
        GROUP_CONCAT(nt.note_id) as note_ids
      FROM zettel_tags t
      JOIN zettel_note_tags nt ON nt.tag_id = t.id
      GROUP BY t.name
      HAVING COUNT(*) >= 3
    `).all() as Array<{ tag: string; note_ids: string }>;

    // 第2步：合并重叠的聚类
    const communities = this.mergeOverlappingClusters(tagGroups);

    // 第3步：计算每个社区的密度
    return communities.map(community => ({
      ...community,
      density: this.calculateDensity(community.nodes),
      boundaryNodes: this.findBoundaryNodes(community.nodes)
    }));
  }

  // 检测断层：社区间语义相似但无直接连接
  detectGaps(communities: Community[]): Gap[] {
    const gaps: Gap[] = [];

    for (let i = 0; i < communities.length; i++) {
      for (let j = i + 1; j < communities.length; j++) {
        const commA = communities[i];
        const commB = communities[j];

        // 检查是否有直接连接
        const hasDirectLink = this.checkDirectLink(commA.nodes, commB.nodes);

        if (!hasDirectLink) {
          // 计算跨社区语义相似度（基于向量）
          const similarity = this.calculateCrossCommunitySimilarity(
            commA.nodes,
            commB.nodes
          );

          // 如果语义相似但无连接，则是一个断层
          if (similarity > 0.6) {
            gaps.push({
              fromCommunity: commA.id,
              toCommunity: commB.id,
              semanticSimilarity: similarity,
              recommendedBridge: this.findBestBridgeNodes(commA, commB)
            });
          }
        }
      }
    }

    return gaps.sort((a, b) => b.semanticSimilarity - a.semanticSimilarity);
  }

  private findBestBridgeNodes(
    commA: Community,
    commB: Community
  ): Array<{ fromNode: string; toNode: string; score: number }> {
    // 找出跨社区最相似的节点对
    const candidates: Array<{ fromNode: string; toNode: string; score: number }> = [];

    for (const nodeA of commA.boundaryNodes) {
      for (const nodeB of commB.boundaryNodes) {
        const score = this.calculateNodeSimilarity(nodeA, nodeB);
        candidates.push({ fromNode: nodeA, toNode: nodeB, score });
      }
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  private calculateDensity(nodes: string[]): number {
    const nodeSet = new Set(nodes);
    const nodeCount = nodes.length;
    
    if (nodeCount <= 1) return 1;

    // 实际连接数 / 最大可能连接数
    const linkCount = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM zettel_links
      WHERE (from_note_id IN (${nodes.map(() => '?').join(',')})
         AND to_note_id IN (${nodes.map(() => '?').join(',')}))
    `).all(...nodes, ...nodes) as { count: number }[];

    const maxPossibleLinks = nodeCount * (nodeCount - 1) / 2;
    return maxPossibleLinks > 0 ? linkCount[0].count / maxPossibleLinks : 0;
  }
}
```

### 集成点
- **复用**: `zettel_notes`, `zettel_links`, `zettel_tags`
- **依赖**: `zettel_embeddings`（语义吸附的向量表）
- **调度**: 定期任务（每周）或手动触发
- **MCP 工具**: `zk_detect_gaps`

### 预估工作量
- 简化版聚类算法: 6 小时
- 断层检测逻辑: 4 小时
- 桥接推荐: 3 小时
- 测试: 3 小时
- **总计: 约 16 小时**

---

## 4. 知识发光度 (Decay & Glow)

### 核心概念
基于网络中心性、引用频率和时间衰减，计算每张卡片的"发光度"——反映其在知识网络中的重要性和活跃度。

### 技术实现

#### 4.1 统计表设计

```sql
-- 卡片统计表（预计算，定期更新）
CREATE TABLE zettel_note_stats (
  note_id TEXT PRIMARY KEY REFERENCES zettel_notes(id) ON DELETE CASCADE,
  
  -- 中心性指标（PageRank 简化版）
  pagerank_score REAL DEFAULT 0,
  betweenness_score REAL DEFAULT 0,
  
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
  
  last_calculated_at INTEGER
);

-- 时间序列统计（用于追踪变化趋势）
CREATE TABLE zettel_glow_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id TEXT NOT NULL,
  glow_score REAL NOT NULL,
  calculated_at INTEGER NOT NULL
);
```

#### 4.2 发光度计算引擎

```typescript
// src/zettelkasten/engine/glow-calculator.ts
interface GlowMetrics {
  noteId: string;
  pagerank: number;
  betweenness: number;
  citations: number;
  recency: number;
  glow: number;
  decay: number;
  status: 'evergreen' | 'active' | 'stable' | 'zombie';
}

class GlowCalculator {
  constructor(private db: DatabaseSync) {}

  // 核心公式
  calculateGlow(metrics: {
    pagerank: number;
    citations: number;
    recency: number;
    decay: number;
  }): number {
    // brightness = (centrality * 0.4 + citation * 0.3 + recency * 0.3) * (1 - decay)
    const centralityComponent = metrics.pagerank * 0.4;
    const citationComponent = Math.min(metrics.citations / 10, 1) * 0.3;
    const recencyComponent = metrics.recency * 0.3;

    return (centralityComponent + citationComponent + recencyComponent) 
           * (1 - metrics.decay);
  }

  // 批量计算所有卡片的发光度
  async recalculateAll(): Promise<GlowMetrics[]> {
    const notes = this.db.prepare(`
      SELECT id, created_at, updated_at FROM zettel_notes
    `).all() as Array<{ id: string; created_at: number; updated_at: number }>;

    const now = Date.now();
    const results: GlowMetrics[] = [];

    for (const note of notes) {
      // 计算 PageRank（简化版：基于入度/出度）
      const pagerank = this.calculatePageRank(note.id);

      // 计算引用数
      const citations = this.db.prepare(`
        SELECT COUNT(*) as count FROM zettel_links WHERE to_note_id = ?
      `).get(note.id) as { count: number };

      // 计算时间衰减
      const daysSinceUpdate = (now - note.updated_at) / (1000 * 60 * 60 * 24);
      const decay = Math.min(daysSinceUpdate / 365, 0.8); // 一年后衰减 80%

      // 计算新鲜度（最近 30 天内更新为 1）
      const recency = Math.max(0, 1 - daysSinceUpdate / 30);

      const glow = this.calculateGlow({
        pagerank,
        citations: citations.count,
        recency,
        decay
      });

      const status = this.determineStatus(glow, daysSinceUpdate, citations.count);

      // 更新统计表
      this.db.prepare(`
        INSERT INTO zettel_note_stats (
          note_id, pagerank_score, backlink_count,
          days_since_updated, glow_score, decay_factor, last_calculated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(note_id) DO UPDATE SET
          pagerank_score = excluded.pagerank_score,
          backlink_count = excluded.backlink_count,
          days_since_updated = excluded.days_since_updated,
          glow_score = excluded.glow_score,
          decay_factor = excluded.decay_factor,
          last_calculated_at = excluded.last_calculated_at
      `).run(
        note.id, pagerank, citations.count,
        Math.floor(daysSinceUpdate), glow, decay, now
      );

      results.push({
        noteId: note.id,
        pagerank,
        betweenness: 0, // 简化版暂不计算
        citations: citations.count,
        recency,
        glow,
        decay,
        status
      });
    }

    return results;
  }

  private calculatePageRank(noteId: string): number {
    // 简化版 PageRank：基于入度的加权分数
    const result = this.db.prepare(`
      WITH RECURSIVE
        backlinks(node_id, depth) AS (
          SELECT ?, 0
          
          UNION ALL
          
          SELECT l.from_note_id, b.depth + 1
          FROM backlinks b
          JOIN zettel_links l ON l.to_note_id = b.node_id
          WHERE b.depth < 3
        )
      SELECT 
        SUM(1.0 / (depth + 1)) as score
      FROM backlinks
      WHERE node_id != ?
    `).get(noteId, noteId) as { score: number | null };

    return Math.min((result.score || 0) / 10, 1);
  }

  private determineStatus(
    glow: number,
    daysSinceUpdate: number,
    citations: number
  ): 'evergreen' | 'active' | 'stable' | 'zombie' {
    if (glow > 0.8 && citations > 5) return 'evergreen';
    if (glow > 0.6) return 'active';
    if (daysSinceUpdate > 180 && citations === 0) return 'zombie';
    return 'stable';
  }
}
```

#### 4.3 SQL 视图：发光度排行

```sql
-- 创建发光度排行视图
CREATE VIEW v_notes_by_glow AS
SELECT 
  n.id,
  n.title,
  n.status,
  s.glow_score,
  s.decay_factor,
  s.backlink_count,
  CASE 
    WHEN s.glow_score > 0.8 AND s.backlink_count > 5 THEN 'evergreen'
    WHEN s.glow_score > 0.6 THEN 'active'
    WHEN s.days_since_updated > 180 AND s.backlink_count = 0 THEN 'zombie'
    ELSE 'stable'
  END as glow_status,
  ROUND(s.glow_score * 100, 1) as glow_percentage
FROM zettel_notes n
LEFT JOIN zettel_note_stats s ON s.note_id = n.id
ORDER BY s.glow_score DESC;
```

### 集成点
- **复用**: `zettel_notes`, `zettel_links`
- **新增**: `zettel_note_stats`, `zettel_glow_history`
- **调度**: 后台任务（每日）或触发式更新
- **MCP 工具**: `zk_get_stats`, `zk_find_zombies`

### 预估工作量
- 统计表设计: 1 小时
- 发光度计算: 4 小时
- 状态分类: 2 小时
- 历史追踪: 2 小时
- 测试: 3 小时
- **总计: 约 12 小时**

---

## 5. 路径搜索

### 核心概念
发现两张卡片之间的逻辑路径，支持带权重的最短路径搜索。

### 技术实现

#### 5.1 路径搜索引擎

```typescript
// src/zettelkasten/engine/path-finder.ts
interface PathNode {
  noteId: string;
  title: string;
  viaLinkId?: string;
  linkType?: LinkType;
}

interface PathResult {
  fromId: string;
  toId: string;
  path: PathNode[];
  totalWeight: number;
  explanation: string;
}

class PathFinder {
  constructor(private db: DatabaseSync) {}

  // BFS 最短路径
  async findPath(
    fromId: string,
    toId: string,
    options: {
      maxDepth?: number;
      linkTypeFilter?: LinkType[];
    } = {}
  ): Promise<PathResult | null> {
    const { maxDepth = 6 } = options;

    // 使用 SQL CTE 进行 BFS
    const result = this.db.prepare(`
      WITH RECURSIVE
        -- BFS 遍历
        search_queue(node_id, path, depth, total_weight, visited) AS (
          -- 起点
          SELECT 
            ?,
            json_array(json_object('noteId', ?, 'title', (SELECT title FROM zettel_notes WHERE id = ?))),
            0,
            0.0,
            ?
          
          UNION ALL
          
          -- 扩展邻居
          SELECT 
            CASE 
              WHEN l.from_note_id = q.node_id THEN l.to_note_id
              ELSE l.from_note_id
            END,
            json_insert(
              q.path,
              '$[#]',
              json_object(
                'noteId', CASE WHEN l.from_note_id = q.node_id THEN l.to_note_id ELSE l.from_note_id END,
                'title', n.title,
                'linkType', l.type
              )
            ),
            q.depth + 1,
            q.total_weight + ${this.getLinkWeightSQL()},
            q.visited || ',' || CASE WHEN l.from_note_id = q.node_id THEN l.to_note_id ELSE l.from_note_id END
          FROM search_queue q
          JOIN zettel_links l ON 
            (l.from_note_id = q.node_id OR l.to_note_id = q.node_id)
          JOIN zettel_notes n ON n.id = CASE WHEN l.from_note_id = q.node_id THEN l.to_note_id ELSE l.from_note_id END
          WHERE q.depth < ?
            AND instr(q.visited, CASE WHEN l.from_note_id = q.node_id THEN l.to_note_id ELSE l.from_note_id END) = 0
            AND q.node_id != ?
        )
      SELECT 
        path,
        total_weight,
        depth
      FROM search_queue
      WHERE node_id = ?
      ORDER BY total_weight ASC, depth ASC
      LIMIT 1
    `).get(fromId, fromId, fromId, fromId, maxDepth, toId, toId) as {
      path: string;
      total_weight: number;
      depth: number;
    } | undefined;

    if (!result) return null;

    const path: PathNode[] = JSON.parse(result.path);
    return {
      fromId,
      toId,
      path,
      totalWeight: result.total_weight,
      explanation: this.generatePathExplanation(path)
    };
  }

  // 链接权重计算（用于 SQL）
  private getLinkWeightSQL(): string {
    return `
      CASE l.type
        WHEN 'supports' THEN 1.0
        WHEN 'refines' THEN 1.2
        WHEN 'extends' THEN 1.5
        WHEN 'contradicts' THEN 2.0
        WHEN 'is_example_of' THEN 1.3
        WHEN 'related' THEN 2.0
        ELSE 1.5
      END
    `;
  }

  // 生成路径解释
  private generatePathExplanation(path: PathNode[]): string {
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
}
```

### 集成点
- **复用**: `zettel_notes`, `zettel_links`
- **无新增表**
- **MCP 工具**: `zk_find_path`（已部分实现）

### 预估工作量
- BFS 路径算法: 3 小时
- 权重计算: 2 小时
- 路径解释: 2 小时
- 测试: 3 小时
- **总计: 约 10 小时**

---

## 6. 组合"化学反应"特效

### 6.1 层叠组合 (Stacking)

```typescript
// 自动提取多张卡片摘要，生成 MOC (Map of Content)
class StackingEngine {
  async createMOC(
    noteIds: string[],
    title: string
  ): Promise<ZettelNote> {
    // 获取所有卡片的摘要
    const summaries = await Promise.all(
      noteIds.map(id => this.summarizeNote(id))
    );

    // 使用 LLM 生成 MOC
    const mocContent = await this.llmProvider.generateSummary(
      `基于以下笔记摘要，生成一个结构化的知识地图（MOC）：\n\n` +
      summaries.map((s, i) => `${i + 1}. ${s.title}: ${s.content}`).join('\n')
    );

    // 创建 MOC 卡片
    return this.noteService.createNote({
      title: `MOC: ${title}`,
      content: mocContent,
      tags: ['moc', 'auto-generated'],
      links: noteIds.map(id => ({ to: id, type: 'is_example_of' }))
    });
  }
}
```

### 6.2 逻辑碰撞 (Collision)

```typescript
// 检测对立观点，生成对比视图
class CollisionDetector {
  async findCollisions(): Promise<Array<{
    noteA: ZettelNote;
    noteB: ZettelNote;
    contradictionType: string;
  }>> {
    // 查询所有 contradicts 链接
    return this.db.prepare(`
      SELECT 
        n1.*,
        n2.id as contra_id,
        n2.title as contra_title
      FROM zettel_links l
      JOIN zettel_notes n1 ON n1.id = l.from_note_id
      JOIN zettel_notes n2 ON n2.id = l.to_note_id
      WHERE l.type = 'contradicts'
    `).all() as any[];
  }
}
```

### 6.3 随机漫步 (Random Walk)

```typescript
class RandomWalkEngine {
  async randomWalk(
    startId: string,
    steps: number = 5
  ): Promise<ZettelNote[]> {
    const path: ZettelNote[] = [await this.getNote(startId)];
    let currentId = startId;

    for (let i = 0; i < steps; i++) {
      // 获取邻居并加权随机选择
      const neighbors = this.db.prepare(`
        SELECT 
          CASE 
            WHEN from_note_id = ? THEN to_note_id
            ELSE from_note_id
          END as neighbor_id,
          type
        FROM zettel_links
        WHERE from_note_id = ? OR to_note_id = ?
      `).all(currentId, currentId, currentId) as Array<{ neighbor_id: string; type: string }>;

      if (neighbors.length === 0) break;

      // 根据链接类型加权
      const weighted = neighbors.map(n => ({
        ...n,
        weight: this.getTypeWeight(n.type)
      }));
      
      const totalWeight = weighted.reduce((sum, n) => sum + n.weight, 0);
      let random = Math.random() * totalWeight;
      
      for (const n of weighted) {
        random -= n.weight;
        if (random <= 0) {
          currentId = n.neighbor_id;
          path.push(await this.getNote(currentId));
          break;
        }
      }
    }

    return path;
  }
}
```

### 6.4 版本分支 (Branching)

```sql
-- 版本历史表
CREATE TABLE zettel_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id TEXT NOT NULL,
  branch_name TEXT DEFAULT 'main',
  parent_version_id INTEGER,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  commit_message TEXT
);
```

### 预估工作量
- 层叠组合: 4 小时
- 逻辑碰撞: 2 小时
- 随机漫步: 3 小时
- 版本分支: 6 小时
- 测试: 5 小时
- **总计: 约 20 小时**

---

## 实施优先级建议

| 优先级 | 特效 | 工作量 | 依赖 |
|--------|------|--------|------|
| 1 | 知识发光度 | 12h | 无 |
| 2 | 路径搜索 | 10h | 无 |
| 3 | 语义吸附 | 16h | sqlite-vec |
| 4 | 动态拓扑组合 | 18h | 无 |
| 5 | 知识断层检测 | 16h | 语义吸附 |
| 6 | 化学反应特效 | 20h | LLM |
| **总计** | | **92h** | |

## 新增数据表汇总

```sql
-- Phase 3 新增表
CREATE TABLE zettel_views (...);
CREATE TABLE zettel_view_notes (...);
CREATE VIRTUAL TABLE zettel_embeddings USING vec0(...);
CREATE TABLE zettel_note_stats (...);
CREATE TABLE zettel_glow_history (...);
CREATE TABLE zettel_versions (...);