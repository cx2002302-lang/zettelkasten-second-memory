# Zettelkasten 工具目录（28 个 MCP 工具）

> 详见本目录的所有 zk_* 工具，按类别分组。每个工具标注：用途、参数、权限（前台/后台 agent 可用性）。

---

## 一、搜索/读取类（6 个）—— 前台 Agent 必用

| 工具 | 用途 | 关键参数 |
|------|------|----------|
| `zk_search_notes` | 全文搜索笔记（默认排除归档） | `query`（必填，2-5 关键词）, `limit`（默认 20） |
| `zk_get_note` | 获取单条笔记详情 | `id`（必填，笔记 ID 如 20260607002636722） |
| `zk_get_backlinks` | 获取反向链接（谁链到这条） | `note_id`（必填） |
| `zk_find_path` | 两条笔记间的带权最短路径 | `from_note_id`, `to_note_id`（都必填） |
| `zk_search_archived` | 搜索已归档笔记 | `query`, `limit` |
| `zk_get_archive_log` | 归档/恢复操作历史 | 可选 `note_id`、`action`、`limit` |

**使用要点**：
- 每次回复前必用 `zk_search_notes`（R01 硬规则）
- 找到候选笔记后用 `zk_get_note` 看详情
- 想了解某条笔记的影响范围用 `zk_get_backlinks`

---

## 二、知识健康度类（4 个）—— 用户询问时用

| 工具 | 用途 | 关键参数 |
|------|------|----------|
| `zk_glow_ranking` | 按发光度排序（evergreen/active/stable/zombie） | 可选 `limit`, `statusFilter`, `minGlow` |
| `zk_find_zombies` | 找僵尸笔记（180+天未更新、零引用） | 可选 `limit` |
| `zk_knowledge_heatmap` | 生成热力图（日活、文件夹分布、glow 分布、链接密度） | `days`（默认 7） |
| `zk_network_graph` | 生成知识图谱数据（节点+边） | 可选 `limit`, `folder_filter`, `glow_min` |

**使用要点**：
- 用户问"知识库怎么样" → `zk_glow_ranking` + `zk_find_zombies`
- 用户问"最近活跃度" → `zk_knowledge_heatmap`
- 找跨簇意外关联 → `zk_network_graph`

---

## 三、审核/反馈类（6 个）

| 工具 | 用途 | 关键参数 |
|------|------|----------|
| `zk_get_review_panel` | 获取审核面板（待审核项+统计） | 无 |
| `zk_get_review_stats` | 审核统计 | 无 |
| `zk_submit_review` | 提交审核决定 | `target_type`, `target_id`, `action`, 可选 `new_confidence`, `new_folder`, `comment` |
| `zk_get_feedback_stats` | 反馈统计 | 无 |
| `zk_analyze_feedback_trends` | 分析反馈趋势 | `days`（默认 30） |
| `zk_submit_feedback` | 提交反馈 | `target_type`, `target_id`, `feedback_type`, 可选 `content`, `rating` |

**使用要点**：
- inbox 笔记需要走 `zk_review_note`（见写入类）
- 给某个工具/笔记/系统提交反馈用 `zk_submit_feedback`

---

## 四、提示词/策划类（4 个）

| 工具 | 用途 |
|------|------|
| `zk_get_active_prompt` | 获取活跃提示词（capture/explain/question/refine/connect/distill/dedupe） |
| `zk_get_prompt_stats` | 提示词效果统计 |
| `zk_get_curation_stats` | 策划统计 |
| `zk_export_samples` | 导出高质量样本（min_score 阈值过滤） |

---

## 五、写入/管理类（8 个）—— **只通过 MCP，禁止 CLI/直查 db**

| 工具 | 用途 | 关键参数 | ⚠️ 陷阱 |
|------|------|----------|---------|
| `zk_create_note` | 创建原子笔记（标题 5-15 字 + Markdown + 2-5 标签） | `title`, `content`, `tags`, `confidence` | OK，是允许的写入 |
| `zk_update_note` | 更新笔记 | `id` + 可选 `title`/`content`/`confidence`/`tags` | **不传 tags 会被清空**（实测） |
| `zk_archive_note` | 归档笔记 | `note_id` | 不删数据，默认搜索排除 |
| `zk_unarchive_note` | 恢复归档 | `note_id` | 同上 |
| `zk_run_ceqrc` | CEQRC 工作流（Capture→Explain→Question→Refine→Connect） | `note_id`, `content` | 深度内化 |
| `zk_distill_memory` | 蒸馏 memory 日志为原子笔记 | 可选 `memory_file_path` | 系统/手动触发 |
| `zk_review_note` | 审核 inbox 笔记 | `note_id`, `decision`（approve/reject/improve） | + 可选 improvements |
| `zk_export_samples` | 导出策划样本 | `format`（jsonl/json/csv）, `min_score` | 配合策划 |

**R11 铁律**（绝对禁止）：
- ❌ `sqlite3` 直改 db
- ❌ `echo`/`cat`/`write` 写 Markdown
- ❌ CLI 工具（`openclaw zk link` 等）批量修改
- ❌ `node -e` 直查 db
- ❌ 任何绕过 MCP 的操作

---

## 六、配置参考：openclaw.json 中 agent 类型决定可用工具

```json
{
  "chat": { "tools": [只读工具，17 个] },
  "knowledge": { "tools": [读写工具，20 个] }
}
```

- **前台 chat agent**：只能只读 + 部分审核
- **后台 knowledge agent**：可读写（创建/更新/归档）

---

## 七、链接类型枚举（11 种，仅 CLI/内部用，AI 不该直接调用）

```
supports / supported_by
refines / refined_by
extends / extended_by
contradicts / contradicted_by
is_example_of / has_example
related
```

**AI 角色**：只建议，不创建。链接由 zk nightlyDistill（每晚 2:00 UTC = 北京时间 10:00）通过 LLM 蒸馏自动建链。
