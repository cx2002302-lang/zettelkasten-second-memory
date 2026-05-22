# 07 提示词进化

## 简版

| 工具 | 一句话 | 核心参数 |
|------|--------|----------|
| `zk_get_active_prompt` | 获取指定类型的活跃提示词 | `prompt_type` |
| `zk_get_prompt_stats` | 获取提示词效果统计 | — |

**提示词类型**：`capture` `explain` `question` `refine` `connect` `distill` `dedupe`

---

## 明细版

### 概述

提示词进化系统管理 Zettelkasten 内部使用的 AI 提示词版本。不同任务使用不同的提示词模板，系统通过效果反馈自动优化提示词质量。

### 提示词类型

| 类型 | 用途 | 典型场景 |
|------|------|----------|
| `capture` | 捕获/提取关键信息 | CEQRC 第一阶段 |
| `explain` | 解释概念 | CEQRC 第二阶段 |
| `question` | 生成深入问题 | CEQRC 第三阶段 |
| `refine` | 精炼内容 | CEQRC 第四阶段 |
| `connect` | 建立关联 | CEQRC 第五阶段 |
| `distill` | 蒸馏 memory | 夜间自动蒸馏 |
| `dedupe` | 去重判断 | 蒸馏时判断重复 |

### 可用工具详解

#### `zk_get_active_prompt` — 获取活跃提示词

**触发时机**：需要查看当前使用的提示词模板时。

**参数**：
- `prompt_type` (enum, required)：提示词类型

**返回**：
- `id`：提示词版本 ID
- `promptType`：类型
- `version`：版本号
- `content`：提示词内容
- `usageCount`：使用次数
- `averageScore`：平均效果评分

#### `zk_get_prompt_stats` — 提示词统计

**返回**：所有提示词类型的效果统计，包括：
- `promptId` / `promptType` / `version`
- `usageCount`：使用次数
- `averageScore`：平均评分
- `successRate`：成功率
- `lastUsedAt`：最后使用时间

### 进化机制

1. **版本管理**：每次优化提示词创建新版本，旧版本保留历史
2. **A/B 测试**：可同时激活多个版本，对比效果
3. **自动评分**：根据任务成功率自动计算效果评分
4. **效果阈值**：评分低于阈值的提示词自动降级

### 使用场景

**场景 1：查看当前提示词**
```
用户：看看蒸馏用的提示词
Agent：zk_get_active_prompt("distill") → 返回提示词内容
```

**场景 2：效果对比**
```
用户：哪个提示词效果最好？
Agent：zk_get_prompt_stats() → 按评分排序展示
```

### 注意事项

1. **提示词不透明**：提示词内容由系统管理，Agent 通常不需要手动修改
2. **效果统计有延迟**：评分基于历史任务，新提示词需要积累数据
3. **自动进化**：系统会根据反馈自动调整提示词，无需人工干预
