# Zettelkasten Brain Skill

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
├── SKILL.md              # 本文件（skill 入口）
├── PROMPT.md             # 动态系统提示词
├── RULES.md              # 行为规则（可调整权重）
├── VERSION               # 当前版本元数据
├── snapshot.sh           # 每周快照脚本
├── evolve.sh             # 进化/回滚脚本
├── details/              # 渐进披露详细文档
│   ├── CORE.md           # 核心精简参考
│   ├── SCENARIOS.md      # 使用场景
│   ├── CONFIG-GUIDE.md   # 配置指南
│   └── EVOLUTION.md      # 进化机制详解
├── ARCHIVE/              # 5档历史备份
│   ├── v2026w19/        # 第19周版本
│   ├── v2026w20/        # 第20周版本
│   ├── v2026w21/        # 第21周版本
│   ├── v2026w22/        # 第22周版本
│   └── v2026w23/        # 第23周版本（最新）
└── FEEDBACK/             # 进化反馈数据
    ├── sessions.json     # 会话效果记录
    ├── metrics.json      # 指标统计
    └── adjustments.log   # 自动调整日志
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
- **反馈驱动**：根据以下指标自动调整行为

| 指标 | 说明 | 调整方向 |
|------|------|----------|
| `notes_created` | 每周创建笔记数 | >50 则降低敏感度，<5 则提高 |
| `search_hit_rate` | 搜索命中率 | <30% 则改进关键词提取 |
| `link_density` | 平均笔记链接数 | <1 则加强关联检测 |
| `user_corrections` | 用户修正次数 | >3 则调整置信度阈值 |
| `zombie_ratio` | 僵尸笔记占比 | >20% 则加强健康度报告 |

---

## 使用场景

### 场景 1：知识检索
```
用户：我之前是怎么配 Docker 网络的？
AI：🔍 搜索知识库...
     找到笔记 "Docker Bridge 配置"（ID: 20260510...）
     你之前用的是 bridge 模式，子网 172.18.0.0/16...
```

### 场景 2：知识健康度报告
```
用户：我的知识库健康状况怎么样？
AI：📊 知识库健康报告
     - 总笔记: 31 | Evergreen: 0 | Active: 0 | Stable: 28 | Zombie: 3
     - 僵尸笔记候选: [列表]
     - 建议: 3 条僵尸笔记可归档；Evergreen 为 0，建议补充高引用核心笔记
```

### 场景 3：自动记录
```
用户：我发现用 pnpm 比 npm 快多了
AI：📝 检测到新知识点，已保存：
     "pnpm vs npm 性能对比"（ID: 20260511...）
     标签: package-manager, performance
     要链接到 "Node.js 工具链" 笔记吗？
```

### 场景 4：归档管理
```
用户：归档那条旧笔记
AI：📦 已归档 "旧版 API 设计草案"（ID: 20260511...）
     说明: 归档数据保留，可通过 zk_search_archived 专门检索
```

---

## 配置

在 `~/.openclaw/openclaw.json` 中：

```json
{
  "tools": {
    "profile": "coding",
    "alsoAllow": ["zettelkasten"]
  },
  "agents": {
    "defaults": {
      "skills": ["zettelkasten-brain"],
      "systemPromptOverride": "# Zettelkasten Brain..."
    }
  },
  "plugins": {
    "entries": {
      "zettelkasten": {
        "config": {
          "agentConfigs": {
            "chat": {
              "tools": [
                "zk_search_notes",
                "zk_get_note",
                "zk_get_backlinks",
                "zk_find_path",
                "zk_glow_ranking",
                "zk_find_zombies",
                "zk_search_archived",
                "zk_get_archive_log",
                "zk_knowledge_heatmap",
                "zk_network_graph",
                "zk_get_review_panel",
                "zk_get_review_stats",
                "zk_get_feedback_stats",
                "zk_analyze_feedback_trends",
                "zk_get_active_prompt",
                "zk_get_prompt_stats",
                "zk_get_curation_stats"
              ]
            },
            "knowledge": {
              "tools": [
                "zk_search_notes",
                "zk_get_note",
                "zk_get_backlinks",
                "zk_find_path",
                "zk_glow_ranking",
                "zk_find_zombies",
                "zk_search_archived",
                "zk_get_archive_log",
                "zk_knowledge_heatmap",
                "zk_network_graph",
                "zk_create_note",
                "zk_update_note",
                "zk_archive_note",
                "zk_unarchive_note",
                "zk_run_ceqrc",
                "zk_distill_memory",
                "zk_review_note",
                "zk_submit_review",
                "zk_submit_feedback",
                "zk_export_samples"
              ]
            }
          },
          "sessionHook": { "enabled": true },
          "nightlyDistill": { "enabled": true }
        }
      }
    }
  }
}
```

---

## 故障排除

```bash
openclaw config get tools.alsoAllow   # 检查工具暴露
openclaw zk doctor                    # 验证插件健康
bash ~/.openclaw/skills/zettelkasten-brain/snapshot.sh  # 手动快照
```

---

**进化状态**: v1.0.0-beta.2 → Wave 3 + Phase 5 已同步
