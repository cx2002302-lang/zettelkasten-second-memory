# Phase 3 实施路线图

> 基于现有代码库重新梳理的高阶应用实施计划
> 制定时间: 2026-05-11
> 预计总工期: 约 6-8 周（单人全职）

---

## 📊 当前基线（已实现的 Phase 1-2 功能）

| 模块 | 状态 | 说明 |
|------|------|------|
| 三级目录结构 | ✅ | /Inbox, /References, /Zettels |
| SQLite + FTS5 | ✅ | 11 张表，含 FTS5 中文搜索 |
| Markdown 文件系统 | ✅ | 笔记以 .md 存储 |
| Repository 层 | ✅ | Note/Link/Tag/Review/Feedback 等 |
| Service 层 | ✅ | NoteService, LinkService, CEQRCEngine, DistillerService |
| 两阶去重 | ✅ | DedupeService（向量相似度 + LLM 决断） |
| MCP 工具 | ✅ | 10 个工具（含 zk_find_path 路径搜索骨架） |
| 置信度路由 | ✅ | note 表已有 confidence/folder/source 字段 |
| 双 Agent 权限 | ✅ | agent-config.ts 已实现 CHAT_BRAIN / KNOWLEDGE_BRAIN 分离 |
| 定时任务 | ✅ | CronScheduler + SessionHook |

---

## 🎯 Phase 3 实施策略

**总原则**: "先特效、后流水线"——先让用户感受到知识图谱的"魔法"，再完善后台自动化。

###  waves 分波交付

```
Wave 1 (第1-2周): 发光度 + 路径搜索      → 立即可见的效果
Wave 2 (第3-4周): 语义吸附 + 断层检测    → 需要 sqlite-vec
Wave 3 (第5-6周): 动态拓扑组合           → 查询引擎复杂度最高
Wave 4 (第7-8周): 化学反应 +  polish     → LLM 密集 + 收尾
```

---

## 🌊 Wave 1: 知识发光度 + 路径搜索（第 1-2 周）

> 目标: 让用户一眼看出哪些笔记是核心，哪些已过期

### 1.1 知识发光度 (Glow Score) — 3 天

**已有基础**: `zettel_notes` + `zettel_links` 表完整，可直接计算

**新增内容**:
- `zettel_note_stats` 表（预计算指标）
- `GlowCalculator` 引擎
- `zk_glow_ranking` / `zk_find_zombies` MCP 工具
- 分类标签: evergreen / active / stable / zombie

**工作量**: ~12h → 压缩到 **3 天**（复用现有 SQL）

### 1.2 路径搜索强化 — 2 天

**已有基础**: `zk_find_path` MCP 工具已注册，但实现是骨架

**增强内容**:
- BFS 最短路径算法（带链接类型权重）
- 路径解释生成（中文/英文）
- 支持 `maxDepth` / `linkTypeFilter` 参数

**工作量**: ~10h → 压缩到 **2 天**（骨架已有）

### Wave 1 交付物
- [ ] `src/engine/glow-calculator.ts`
- [ ] `src/engine/path-finder.ts`
- [ ] `zk_glow_ranking` MCP 工具
- [ ] `zk_find_zombies` MCP 工具
- [ ] `zk_find_path` 完整实现

---

## 🌊 Wave 2: 语义吸附 + 知识断层检测（第 3-4 周）

> 目标: 让系统自动推荐"你可能想链接的笔记"

### 2.1 语义吸附 (Semantic Gravity) — 5 天

**依赖**: `sqlite-vec` 扩展（需确认 OpenClaw 环境是否可用）

**已有基础**: `DedupeService` 已有向量存储和余弦相似度计算

**新增内容**:
- `zettel_embeddings` 虚拟表（sqlite-vec）
- `zettel_note_stats` 表扩展（graph_centrality, vector_magnitude）
- `SemanticGravityEngine`
- 混合分数: 向量相似度 0.6 + 图距离 0.4
- `zk_suggest_links` MCP 工具

**工作量**: ~16h → **5 天**

### 2.2 知识断层检测 — 4 天

**依赖**: Wave 2.1 语义吸附的向量表

**新增内容**:
- `CommunityDetector`（简化版 Louvain，基于标签聚类）
- 社区密度计算
- 跨社区语义相似度检测
- `zk_detect_gaps` MCP 工具

**工作量**: ~16h → **4 天**

### Wave 2 交付物
- [ ] `src/engine/semantic-gravity.ts`
- [ ] `src/engine/community-detection.ts`
- [ ] `zk_suggest_links` MCP 工具
- [ ] `zk_detect_gaps` MCP 工具

---

## 🌊 Wave 3: 动态拓扑组合（第 5-6 周）

> 目标: 用声明式查询实时组合知识视图

### 3.1 视图查询引擎 — 6 天

**新增内容**:
- `zettel_views` + `zettel_view_notes` 表
- `ViewCompositionEngine`
- 支持过滤: tags / keywords / status / confidence / linkedTo
- 支持排序: temporal / centrality / confidence / random
- 支持输出格式: linear / tree / graph / moc
- `zk_compose_view` MCP 工具

**工作量**: ~18h → **6 天**

### Wave 3 交付物
- [ ] `src/engine/view-composition.ts`
- [ ] `zk_compose_view` MCP 工具

---

## 🌊 Wave 4: 化学反应特效 + 收尾（第 7-8 周）

### 4.1 组合"化学反应" — 5 天

**新增内容**:
- `StackingEngine`: 多张卡片 → 自动生成 MOC (Map of Content)
- `CrossPollinationEngine`: 跨主题笔记碰撞生成新洞见
- `CascadeEngine`: 单张卡片更新触发下游笔记摘要更新

**工作量**: ~20h → **5 天**

### 4.2 收尾 polish — 3 天

- [ ] 所有 Phase 3 引擎的单元测试
- [ ] 性能基准测试（1000/10000 笔记规模）
- [ ] MCP 工具文档更新
- [ ] README 更新 Phase 3 功能说明

---

## 📋 依赖关系图

```
Wave 1 (基础特效)
├── 发光度 ──→ 无依赖
└── 路径搜索 ──→ 无依赖

Wave 2 (智能推荐)
├── 语义吸附 ──→ sqlite-vec
└── 断层检测 ──→ 依赖语义吸附

Wave 3 (查询引擎)
└── 拓扑组合 ──→ 无依赖（但最复杂）

Wave 4 (高阶组合)
└── 化学反应 ──→ 依赖 LLM + 以上所有引擎
```

---

## 🗓️ 排期总览

| 周次 | 主要任务 | 预计产出 |
|------|---------|---------|
| 第 1 周 | 发光度 + 路径搜索 | 2 个引擎 + 3 个 MCP 工具 |
| 第 2 周 | 测试 + 文档 + Wave 1 polish | 稳定的基础特效 |
| 第 3 周 | 语义吸附 | 向量引擎 + 推荐系统 |
| 第 4 周 | 断层检测 | 社区发现 + 桥梁推荐 |
| 第 5 周 | 动态拓扑组合（上）| 查询引擎核心 |
| 第 6 周 | 动态拓扑组合（下）| 多格式输出 + MCP 工具 |
| 第 7 周 | 化学反应特效 | MOC 生成 + 跨主题碰撞 |
| 第 8 周 | 全面测试 + 文档 | Phase 3 完整发布 |

---

## ⚠️ 关键风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| sqlite-vec 不可用 | 语义吸附、断层检测受阻 | 先实现纯 SQL 版语义相似度（基于 FTS5）作为 fallback |
| LLM embedding 成本高 | 语义吸附延迟高 | 实现 embedding 缓存 + 批量生成 |
| 大规模笔记性能下降 | 查询慢 | 所有引擎增加 LIMIT + 索引优化 |

---

## 🚀 下一步行动

**如果你同意这个计划，我们可以从 Wave 1 开始**:

1. 我立即开始实现 `GlowCalculator`（知识发光度引擎）
2. 同时完善 `PathFinder`（路径搜索）
3. 预计 **本周内**交付 Wave 1

你确认开始吗？或者有想调整优先级的地方？
