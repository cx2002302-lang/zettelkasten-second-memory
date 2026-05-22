# 04 知识健康度

## 简版

| 工具 | 一句话 | 核心参数 |
|------|--------|----------|
| `zk_glow_ranking` | 按知识发光度排序（evergreen/active/stable/zombie） | `limit` `statusFilter` `minGlow` |
| `zk_find_zombies` | 找出僵尸笔记（180+天未更新、零引用） | `limit` |
| `zk_knowledge_heatmap` | 生成知识库热力图（活跃度/分布/密度） | `days` |
| `zk_network_graph` | 生成知识图谱数据（节点+边） | `limit` `folder_filter` `glow_min` |
| `zk_get_archive_log` | 获取归档/恢复操作历史 | `note_id` `action` `limit` |

---

## 明细版

### 概述

知识健康度帮助用户了解知识库的结构质量。通过 **发光度（Glow）** 算法，每篇笔记被分为四类状态：

| 状态 | 说明 | 判定条件 |
|------|------|----------|
| **Evergreen** | 常青笔记，持续被引用 | 高引用 + 近期更新 |
| **Active** | 活跃笔记，有引用 | 有引用 + 未过时 |
| **Stable** | 稳定笔记，偶尔引用 | 少量引用 |
| **Zombie** | 僵尸笔记，无引用且过时 | 零引用 + 180+天未更新 |

### 发光度算法

发光度综合以下指标：
- **PageRank**：基于链接网络的重要性评分
- **更新频率**：近期是否活跃
- **引用数量**：反向链接数
- **置信度**：笔记质量评分

### 可用工具详解

#### `zk_glow_ranking` — 发光度排行

**触发时机**：用户询问知识库状况，或主动维护时。

**参数**：
- `limit` (number, optional)：返回数量，默认 20
- `statusFilter` (string[], optional)：按状态筛选
- `minGlow` (number, optional)：最小发光度阈值

**返回**：按发光度排序的笔记列表

#### `zk_find_zombies` — 僵尸笔记检测

**触发时机**：定期维护，或用户要求清理时。

**参数**：
- `limit` (number, optional)：最大返回数，默认 20

**返回**：僵尸笔记候选列表

#### `zk_knowledge_heatmap` — 知识热力图

**触发时机**：需要全面了解知识库分布时。

**参数**：
- `days` (number, optional)：统计天数，默认 30

**返回**：
- 每日活动统计（创建/更新/链接数）
- 文件夹分布
- 发光度分布
- 链接密度排行

#### `zk_network_graph` — 知识图谱

**触发时机**：需要可视化知识网络时。

**参数**：
- `limit` (number, optional)：最大节点数，默认 200
- `folder_filter` (string[], optional)：按文件夹筛选
- `glow_min` (number, optional)：最小发光度

**返回**：节点（笔记）和边（链接）数据，可导出到可视化工具

#### `zk_get_archive_log` — 归档历史

**触发时机**：审计归档操作时。

**参数**：
- `note_id` (string, optional)：按笔记 ID 筛选
- `action` (enum, optional)：`archive` | `unarchive` | `auto_archive`
- `limit` (number, optional)：最大返回数，默认 50

### 使用场景

**场景 1：健康度报告**
```
用户：我的知识库健康状况怎么样？
Agent：
  zk_glow_ranking() → 获取分布
  zk_find_zombies() → 获取僵尸列表
  回复：📊 知识库健康报告...
```

**场景 2：定期清理**
```
Agent（夜间服务）：
  auto_archive: 发现 3 条僵尸笔记
  执行自动归档...
```

**场景 3：知识图谱导出**
```
用户：导出我的知识图谱
Agent：zk_network_graph(limit=500) → JSON 数据
```

### 注意事项

1. **Zombie 判定**：180 天未更新 + 零反向链接，可通过配置调整阈值
2. **Evergreen 为 0 是正常的**：新建知识库通常没有常青笔记
3. **链接密度目标**：建议平均每笔记 0.8+ 链接
4. **自动归档**：夜间服务可配置自动归档僵尸笔记
