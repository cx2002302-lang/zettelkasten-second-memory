# 01 检索与搜索

## 简版

| 工具 | 一句话 | 核心参数 |
|------|--------|----------|
| `zk_search_notes` | 全文搜索笔记（默认排除归档） | `query` `limit` |
| `zk_get_note` | 获取单条笔记完整详情 | `id` |
| `zk_get_backlinks` | 获取指向某笔记的所有反向链接 | `note_id` |
| `zk_find_path` | 查找两条笔记间的带权最短路径 | `from_note_id` `to_note_id` |
| `zk_search_archived` | 搜索已归档笔记（常规搜索排除归档） | `query` `limit` |

---

## 明细版

### 概述

检索是 Zettelkasten 的入口功能。Agent 每次回复用户前，**必须先调用 `zk_search_notes`** 搜索相关知识库，有命中则在回复中引用。

搜索支持 **FTS 全文索引 + LIKE 模糊匹配** 双引擎，中文内容也能良好检索。

### 可用工具详解

#### `zk_search_notes` — 全文搜索

**触发时机**：每次用户提问时自动调用。

**参数**：
- `query` (string, required)：搜索关键词，支持多词
- `limit` (number, optional)：最大返回数，默认 20，范围 1-100

**返回**：按相关性排序的笔记列表，每条包含 `note`（完整笔记）和 `score`（匹配分数）

**行为**：
- 默认排除 `folder = 'archive'` 的笔记
- 如果 FTS 不可用，自动回退到 LIKE 匹配
- 同时搜索标题和内容

#### `zk_get_note` — 获取单条笔记

**触发时机**：需要查看某条笔记的完整内容时。

**参数**：
- `id` (string, required)：笔记 ID

**返回**：完整笔记对象，包含 `id` `title` `content` `folder` `confidence` `tags` `links` `createdAt` `updatedAt`

**注意**：如果笔记不存在，返回 `null`。

#### `zk_get_backlinks` — 反向链接

**触发时机**：分析某笔记被哪些其他笔记引用时。

**参数**：
- `note_id` (string, required)：目标笔记 ID

**返回**：指向该笔记的链接列表，每条包含 `from`（来源笔记 ID）`to` `type` `context`

#### `zk_find_path` — 路径发现

**触发时机**：用户问"A 和 B 之间有什么关系"时。

**参数**：
- `from_note_id` (string, required)：起始笔记 ID
- `to_note_id` (string, required)：目标笔记 ID

**返回**：最短路径（按链接权重计算），包含 `path`（笔记 ID 序列）`length` `stepCount` `totalWeight` `explanation`

**注意**：如果没有路径，返回 `null`。

#### `zk_search_archived` — 归档搜索

**触发时机**：用户明确要求搜索归档内容，或常规搜索找不到时作为补充。

**参数**：
- `query` (string, required)：搜索关键词
- `limit` (number, optional)：最大返回数，默认 20

**行为**：与 `zk_search_notes` 相同，但**只搜索已归档笔记**。

### 使用场景

**场景 1：日常问答**
```
用户：我之前是怎么配 Docker 网络的？
Agent：zk_search_notes("Docker 网络配置") → 找到笔记 → 引用回答
```

**场景 2：深度关联**
```
用户：Docker 网络和 Kubernetes 网络有什么关系？
Agent：zk_find_path(docker-note-id, k8s-note-id) → 显示路径
```

**场景 3：归档回溯**
```
用户：找一下我之前归档的 API 设计文档
Agent：zk_search_archived("API 设计") → 只返回归档笔记
```

### 注意事项

1. **必须先搜索**：每次回答用户前必须调用 `zk_search_notes`，不能直接说"我没记录"
2. **关键词提取**：从用户问题中提取 2-5 个关键词进行搜索
3. **结果引用**：搜索到命中时，在回复中告知笔记 ID，方便用户后续查阅
4. **FTS 回退**：FTS 不可用时自动回退到 LIKE，搜索质量可能下降
