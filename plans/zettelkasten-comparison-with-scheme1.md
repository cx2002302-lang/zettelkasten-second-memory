# Zettelkasten 方案对比分析：当前实现 vs 方案一

> 对比我们的实现与方案一，取长补短

---

## 方案一核心特点

### 技术栈
- **语言**: Python
- **ORM**: SQLAlchemy + Pydantic
- **向量数据库**: LanceDB
- **检索**: RRF (Reciprocal Rank Fusion) + 交叉编码器重排
- **UI**: Streamlit HITL 界面

### 核心流程
1. **夜间批处理流水线** (Step 9-12)
   - 读取对话日志 → LLM 提取想法 → 两阶去重 → CEQRC 内化 → 置信度分流
   
2. **混合检索** (Step 6)
   - Vector Top-20 + FTS5 Top-20 → RRF 融合 → 交叉编码器重排 → Weibull 衰减

3. **HITL 审查** (Step 14)
   - Streamlit 界面，Accept/Edit/Reject 工作流

---

## 当前实现特点

### 技术栈
- **语言**: TypeScript (与 OpenClaw 一致)
- **数据库**: SQLite + FTS5 + sqlite-vec
- **集成**: OpenClaw memory-host-sdk 原生集成
- **约束**: 原子化、自治性、永远链接强制内置

### 已完成
- ✅ 核心类型定义 (14位ID, ISO时间戳, 三种卡片类型)
- ✅ 数据库 Schema (notes, links, tags, FTS5)
- ✅ Repository 层 (Note, Link, Tag CRUD)
- ✅ 模板系统
- ✅ 基础工具函数 (原子化检查等)

---

## 取长补短分析

### 方案一的优点（值得借鉴）

#### 1. 夜间批处理流水线 ⭐⭐⭐⭐⭐
**方案一设计**:
```
对话日志 → LLM提取 → 向量预过滤(>0.85合并/>0.7重复) → LLM裁判 → CEQRC内化 → 置信度分流
```

**我们的差距**: 缺少完整的自动化认知闭环设计

**借鉴建议**: 
- 设计类似的夜间批处理服务
- 集成到 OpenClaw 的 session 系统
- 自动从对话中提取知识

#### 2. 混合检索策略 ⭐⭐⭐⭐⭐
**方案一设计**:
```
Vector Top-20 + FTS5 Top-20 → RRF融合 → 交叉编码器重排 → Weibull衰减
```

**我们的差距**: 目前只有 FTS5，缺少向量搜索和重排

**借鉴建议**:
- 添加 sqlite-vec 向量表
- 实现 RRF 融合算法
- 添加 Weibull 衰减计算

#### 3. Weibull 衰减 ⭐⭐⭐⭐
**方案一设计**:
```python
Score = Rerank_Score * Decay_Factor
Decay_Factor = f(accessed_at, created_at)  # Weibull分布
```

**我们的差距**: 有发光度概念，但没有具体公式

**借鉴建议**:
- 添加 `accessed_at` 字段到 notes 表
- 实现 Weibull 衰减计算
- 集成到搜索排序

#### 4. 两阶去重 ⭐⭐⭐⭐
**方案一设计**:
- 第一阶: 向量相似度预过滤 (cosine_sim > 0.85 → CANDIDATE_MERGE)
- 第二阶: LLM 裁判 (返回 CREATE/MERGE/SKIP)

**借鉴建议**:
- 在创建卡片时自动检测重复
- AI 辅助判断是否合并

#### 5. HITL 审查界面 ⭐⭐⭐
**方案一设计**: Streamlit 界面，Accept/Edit/Reject

**我们的优势**: 可以集成到 OpenClaw 的 UI，无需额外依赖

**借鉴建议**:
- 设计 CLI 审查工具
- 或集成到 OpenClaw 的 Web UI

---

## 技术差异与取舍

| 维度 | 方案一 | 我们的实现 | 评估 |
|------|--------|-----------|------|
| **语言** | Python | TypeScript | 我们更好 (与OpenClaw一致) |
| **向量DB** | LanceDB | sqlite-vec | 我们更好 (无需额外依赖) |
| **ORM** | SQLAlchemy | 原生 SQLite | 方案一更好 (更成熟) |
| **检索** | RRF+Rerank | FTS5 | 方案一更好 (效果更优) |
| **UI** | Streamlit | 待设计 | 方案一更好 (已有实现) |
| **集成** | 独立服务 | OpenClaw原生 | 我们更好 (更紧密) |
| **约束** | 可选 | 强制内置 | 我们更好 (符合原则) |

---

## Phase 2 改进建议

### 高优先级（必须实现）

#### 1. 混合检索引擎
```typescript
// 新增文件: search/hybrid-search.ts
interface HybridSearchResult {
  note: ZettelNote;
  ftsScore: number;
  vectorScore: number;
  rrfScore: number;
  finalScore: number;  // 含 Weibull 衰减
}

class HybridSearchEngine {
  async search(query: string, options?: SearchOptions): Promise<HybridSearchResult[]> {
    // 1. FTS5 搜索 Top-20
    // 2. 向量搜索 Top-20 (sqlite-vec)
    // 3. RRF 融合
    // 4. 重排 (可选，可调用外部 API)
    // 5. Weibull 衰减调整
  }
}
```

#### 2. Weibull 衰减计算
```typescript
// 新增到 utils.ts
function calculateWeibullDecay(
  lastAccessedAt: string,
  createdAt: string,
  citationCount: number
): number {
  // Weibull 分布公式
  // 考虑: 最后访问时间、创建时间、引用次数
}
```

#### 3. 数据库 Schema 扩展
```sql
-- 添加 accessed_at 字段
ALTER TABLE zettel_notes ADD COLUMN accessed_at TEXT;

-- 添加向量表 (sqlite-vec)
CREATE VIRTUAL TABLE zettel_vectors USING vec0(
  note_id TEXT PRIMARY KEY,
  embedding FLOAT[1024]
);
```

### 中优先级（建议实现）

#### 4. 夜间批处理服务
```typescript
// 新增文件: workflow/nightly-distill.ts
class NightlyDistillationService {
  async run(): Promise<void> {
    // 1. 读取 OpenClaw session 日志
    // 2. LLM 提取想法
    // 3. 两阶去重
    // 4. CEQRC 内化
    // 5. 置信度分流
  }
}
```

#### 5. 类型化链接 AI 辅助
```typescript
// 新增文件: engine/link-suggester.ts
class LinkSuggester {
  async suggestRelationType(
    sourceNote: ZettelNote,
    targetNote: ZettelNote
  ): Promise<LinkType | null> {
    // AI 辅助选择 6 种关系类型
  }
}
```

### 低优先级（可选）

#### 6. HITL CLI 工具
```typescript
// 新增文件: cli/review.ts
// 命令行审查工具，替代 Streamlit
```

---

## 总结

### 保持的优势
1. ✅ TypeScript/OpenClaw 原生集成
2. ✅ sqlite-vec 无需额外依赖
3. ✅ 核心约束强制内置

### 需要补充的
1. 🔄 混合检索 (RRF + 重排)
2. 🔄 Weibull 衰减计算
3. 🔄 夜间批处理流水线
4. 🔄 两阶去重机制
5. 🔄 类型化链接 AI 辅助

### 建议的 Phase 2 任务清单
- [ ] 添加 sqlite-vec 向量表
- [ ] 实现混合检索引擎
- [ ] 添加 Weibull 衰减计算
- [ ] 设计夜间批处理服务
- [ ] 实现两阶去重
- [ ] 类型化链接 AI 辅助
- [ ] CLI 审查工具