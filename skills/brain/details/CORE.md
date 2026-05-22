# Zettelkasten Brain Skill (Core)

**ID**: `zettelkasten-brain` | **Version**: 1.0.0-beta.2 | **OpenClaw**: >= 2026.4.24

将 OpenClaw 变成你的**第二记忆大脑**。AI 代理自动把对话中的知识保存到 Zettelkasten，建立双向链接，评估知识健康度，并在需要时检索。

---

## 安装

```bash
mkdir -p ~/.openclaw/skills
cp -r zettelkasten-brain ~/.openclaw/skills/
openclaw config set agents.defaults.skills '["zettelkasten-brain"]'
openclaw config set tools.alsoAllow '["zettelkasten"]'
openclaw gateway restart
```

---

## 文件结构

```
zettelkasten-brain/
├── SKILL.md      # 本文件
├── PROMPT.md     # 系统提示词
├── RULES.md      # 行为规则
├── VERSION       # 版本元数据
├── snapshot.sh   # 每周快照
├── evolve.sh     # 进化/回滚
├── ARCHIVE/      # 5档历史备份
└── FEEDBACK/     # 进化反馈数据
```

---

## MCP 工具（28 个）

| 类别 | 工具 |
|------|------|
| 搜索/读取 | `zk_search_notes` `zk_get_note` `zk_get_backlinks` `zk_find_path` `zk_search_archived` `zk_get_archive_log` |
| 知识健康 | `zk_glow_ranking` `zk_find_zombies` `zk_knowledge_heatmap` `zk_network_graph` |
| 审核/反馈 | `zk_get_review_panel` `zk_get_review_stats` `zk_submit_review` `zk_get_feedback_stats` `zk_analyze_feedback_trends` `zk_submit_feedback` |
| 提示词/策划 | `zk_get_active_prompt` `zk_get_prompt_stats` `zk_get_curation_stats` `zk_export_samples` |
| 写入/管理 | `zk_create_note` `zk_update_note` `zk_archive_note` `zk_unarchive_note` `zk_run_ceqrc` `zk_distill_memory` `zk_review_note` |

---

## 进化机制

- **每周快照**：周日 2 点自动执行，保留 5 档，超限时删除最旧
- **手动回滚**：`bash ~/.openclaw/skills/zettelkasten-brain/evolve.sh rollback v{YYYY}w{WW}`
- **反馈驱动**：根据 `notes_created` / `search_hit_rate` / `link_density` / `user_corrections` / `zombie_ratio` 自动调整行为

---

## 配置

在 `~/.openclaw/openclaw.json` 中：
- `tools.alsoAllow`: `["zettelkasten"]`（关键！否则 agent 看不到 zk 工具）
- `agents.defaults.skills`: `["zettelkasten-brain"]`
- `plugins.entries.zettelkasten.config`: 见项目文档

---

## 故障排除

```bash
openclaw config get tools.alsoAllow   # 检查工具暴露
openclaw zk doctor                    # 验证插件健康
bash ~/.openclaw/skills/zettelkasten-brain/snapshot.sh  # 手动快照
```

---

**进化状态**: v1.0.0-beta.2 → Wave 3 + Phase 5 已同步
