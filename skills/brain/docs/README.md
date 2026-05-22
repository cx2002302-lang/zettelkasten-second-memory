# Zettelkasten Brain 功能文档索引

> **简版速查**：每个文档顶部为简版（快速参考），下方为明细版（完整说明）。

---

## 功能模块速查表

| 模块 | 文档 | 核心工具 | 一句话说明 |
|------|------|----------|-----------|
| 🔍 检索与搜索 | [01-search-retrieval.md](01-search-retrieval.md) | `zk_search_notes` `zk_get_note` `zk_get_backlinks` `zk_find_path` `zk_search_archived` | 全文搜索、单条读取、反向链接、路径发现 |
| 📝 笔记管理 | [02-note-management.md](02-note-management.md) | `zk_create_note` `zk_update_note` `zk_archive_note` `zk_unarchive_note` `zk_review_note` | 创建、更新、归档、恢复、审核笔记 |
| 🔗 链接与关联 | [03-link-association.md](03-link-association.md) | `zk_create_link`（内部） | 建立双向语义链接，构建知识网络 |
| 📊 知识健康度 | [04-knowledge-health.md](04-knowledge-health.md) | `zk_glow_ranking` `zk_find_zombies` `zk_knowledge_heatmap` `zk_network_graph` `zk_get_archive_log` | 发光度评估、僵尸检测、热力图、知识图谱 |
| 🧠 CEQRC 与蒸馏 | [05-ceqrc-distillation.md](05-ceqrc-distillation.md) | `zk_run_ceqrc` `zk_distill_memory` | 深度内化工作流、Memory 日志蒸馏 |
| ✅ 审核与反馈 | [06-review-feedback.md](06-review-feedback.md) | `zk_submit_review` `zk_get_review_stats` `zk_submit_feedback` `zk_get_feedback_stats` `zk_analyze_feedback_trends` | 提交审核/反馈、查看统计、分析趋势 |
| 💬 提示词进化 | [07-prompt-evolution.md](07-prompt-evolution.md) | `zk_get_active_prompt` `zk_get_prompt_stats` | 获取活跃提示词、查看效果统计 |
| 🏆 样本策划 | [08-sample-curation.md](08-sample-curation.md) | `zk_get_curation_stats` `zk_export_samples` | 策划统计、导出高质量样本 |
| 🔄 进化机制 | [09-evolution-mechanism.md](09-evolution-mechanism.md) | `snapshot.sh` `evolve.sh` | 每周快照、5 档回滚、反馈驱动进化 |

---

## 文档格式说明

每个文档包含两部分：
- **简版**（顶部）：一句话 + 工具列表 + 核心参数，适合快速查阅
- **明细版**（下方）：详细说明 + 使用场景 + 注意事项 + 示例，适合深入理解

## 快速上手

```bash
# 1. 先看简版了解功能概览
cat docs/01-search-retrieval.md | head -40

# 2. 按需深入明细版
cat docs/06-review-feedback.md
```
