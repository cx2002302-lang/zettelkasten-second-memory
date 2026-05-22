# 06 审核与反馈（Phase 5）

## 简版

| 工具 | 一句话 | 核心参数 |
|------|--------|----------|
| `zk_submit_review` | 提交审核决定（approve/reject/modify/flag） | `target_type` `target_id` `action` `comment` |
| `zk_get_review_stats` | 获取审核统计 | — |
| `zk_get_review_panel` | 获取审核面板（待审核列表） | — |
| `zk_submit_feedback` | 提交反馈（thumbs_up/down/comment/correction/suggestion） | `target_type` `target_id` `feedback_type` `content` `rating` |
| `zk_get_feedback_stats` | 获取反馈统计 | — |
| `zk_analyze_feedback_trends` | 分析反馈趋势 | `days` |

---

## 明细版

### 概述

Phase 5 提供**人机共生**的反馈闭环：
- **审核系统**：人工审核知识库内容，决定保留/修改/拒绝
- **反馈系统**：用户对 Agent 行为打分，驱动系统自我优化

### 审核系统

#### `zk_submit_review` — 提交审核

**触发时机**：
- 审核 Inbox 笔记时
- 审核链接、标签或系统功能时
- 发现问题需要标记时

**参数**：
- `target_type` (enum, required)：`note` | `link` | `tag` | `system`
- `target_id` (string, required)：目标 ID
- `action` (enum, required)：`approve` | `reject` | `modify` | `flag`
- `new_confidence` (number, optional)：新的置信度（approve 时）
- `new_folder` (enum, optional)：`inbox` | `references` | `zettels`
- `comment` (string, optional)：审核意见

**审核动作说明**：
| 动作 | 效果 |
|------|------|
| `approve` | 批准，可指定新文件夹和置信度 |
| `reject` | 拒绝，保留记录但不采纳 |
| `modify` | 建议修改，需附带修改意见 |
| `flag` | 标记问题，供后续处理 |

#### `zk_get_review_stats` — 审核统计

**返回**：
- `totalReviews`：总审核数
- `approvedCount` / `rejectedCount` / `modifiedCount` / `flaggedCount`：各状态数
- `pendingCount`：待处理数
- `byTargetType`：按目标类型分布

#### `zk_get_review_panel` — 审核面板

**返回**：
- 待审核项目列表
- 各类型统计
- 近期审核历史

### 反馈系统

#### `zk_submit_feedback` — 提交反馈

**触发时机**：
- 用户对 Agent 的回复满意/不满意时
- 用户发现 Agent 的错误时
- 用户有改进建议时

**参数**：
- `target_type` (enum, required)：`note` | `link` | `tag` | `system`
- `target_id` (string, required)：目标 ID
- `feedback_type` (enum, required)：
  - `thumbs_up`：赞同
  - `thumbs_down`：反对
  - `comment`：评论
  - `correction`：纠正
  - `suggestion`：建议
- `content` (string, optional)：反馈内容
- `rating` (number, optional)：评分 1-5

**自动处理**：
- 系统反馈且评分明确定时，自动标记为已处理
- 触发系统调优建议生成

#### `zk_get_feedback_stats` — 反馈统计

**返回**：
- `totalFeedback`：总反馈数
- `thumbsUpCount` / `thumbsDownCount` 等：按类型分布
- `averageRating`：平均评分
- `processedCount` / `unprocessedCount`：处理状态
- `byTargetType`：按目标类型分布

#### `zk_analyze_feedback_trends` — 趋势分析

**参数**：
- `days` (number, optional)：分析天数，默认 7

**返回**：
- 时间范围内的反馈趋势
- 按类型、目标类型的变化趋势
- 正向/负向比例变化

### 使用场景

**场景 1：审核 Inbox**
```
用户：审核这条笔记
Agent：zk_submit_review(
  target_type: "note",
  target_id: "xxx",
  action: "approve",
  new_folder: "zettels",
  comment: "内容准确，路由到 zettels"
)
```

**场景 2：用户反馈**
```
用户：这个回答有误
Agent：zk_submit_feedback(
  target_type: "system",
  target_id: "system",
  feedback_type: "correction",
  content: "Docker 网络模式说错了",
  rating: 2
)
```

**场景 3：趋势分析**
```
用户：最近反馈怎么样？
Agent：zk_analyze_feedback_trends(days=7) → 趋势报告
```

### 注意事项

1. **反馈驱动调优**：反馈数据会触发系统调优建议，但**不会自动执行**
2. **匿名反馈**：反馈可不带 user_id，但建议标识以便追踪
3. **批量处理**：支持批量审核和批量反馈
4. **审核不等于反馈**：审核是对内容的决策，反馈是对 Agent 行为的评价
