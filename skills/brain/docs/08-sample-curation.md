# 08 样本策划

## 简版

| 工具 | 一句话 | 核心参数 |
|------|--------|----------|
| `zk_get_curation_stats` | 获取样本策划统计 | — |
| `zk_export_samples` | 导出高质量策划样本 | `format` `min_score` |

**策划状态**：`pending`（待处理）→ `approved`（已批准）→ `rejected`（已拒绝）→ `exported`（已导出）

---

## 明细版

### 概述

样本策划系统对知识库中的笔记进行质量评估，筛选出高质量样本用于导出或进一步训练。

### 质量评分维度

| 维度 | 说明 | 权重 |
|------|------|------|
| **Relevance** | 相关性 | 25% |
| **Clarity** | 清晰度 | 25% |
| **Atomicity** | 原子化程度 | 20% |
| **Connectivity** | 连接度 | 20% |
| **Overall** | 综合评分 | 100% |

### 策划流程

```
笔记 → 质量评分 → 策划审核 → 批准/拒绝 → 导出
```

### 可用工具详解

#### `zk_get_curation_stats` — 策划统计

**返回**：
- `total`：总策划数
- `pending` / `approved` / `rejected` / `exported`：各状态数
- `averageQuality`：平均质量分

#### `zk_export_samples` — 导出样本

**触发时机**：需要导出高质量样本进行外部使用时。

**参数**：
- `format` (enum, optional)：`jsonl` | `json` | `csv`，默认 `jsonl`
- `min_score` (number, optional)：最低质量分，默认 0.8

**行为**：
1. 筛选 `quality_overall >= min_score` 且 `curation_status = 'approved'` 的笔记
2. 排除已导出的笔记（`export_batch_id IS NULL`）
3. 按指定格式导出
4. 创建导出批次记录

**返回**：
- `sampleCount`：导出样本数
- `filePath`：导出文件路径
- `format`：导出格式

### 使用场景

**场景 1：查看策划状态**
```
用户：有多少高质量样本？
Agent：zk_get_curation_stats() → 120 total, 0 approved
```

**场景 2：导出样本**
```
用户：导出 10 条高质量样本
Agent：zk_export_samples(format="json", min_score=0.8) → 导出文件
```

**场景 3：批量策划**
```
Agent（自动）：
  对新笔记批量评分
  标记为 pending 状态
  等待人工审核
```

### 注意事项

1. **策划需要人工审核**：系统评分后，仍需 `curator_id` 人工确认
2. **导出后锁定**：已导出的样本不可再次导出（除非重置状态）
3. **质量阈值**：默认 0.8，可根据需求调整
4. **格式选择**：jsonl 适合流式处理，json 适合查看，csv 适合表格工具
