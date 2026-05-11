# Zettelkasten Brain Skill

**ID**: `zettelkasten-brain`  
**Version**: 1.0.0  
**OpenClaw**: >= 2026.4.23  
**Author**: Zettelkasten Team  
**License**: Same as OpenClaw

---

## 简介

将 OpenClaw 变成你的**第二记忆大脑**。这个 skill 让 AI 代理自动把对话中的知识保存到 Zettelkasten 知识库，建立双向链接，并在需要时检索。

**核心特性**：
- 🔍 回答前先搜索知识库
- 📝 自动识别并保存重要信息
- 🔗 智能建立笔记关联
- 📊 渐进式进化（每周自动备份，保留5档）
- 🔄 根据使用效果自我调整

---

## 安装

```bash
# 1. 复制 skill 到 OpenClaw skills 目录
mkdir -p ~/.openclaw/skills
cp -r zettelkasten-brain ~/.openclaw/skills/

# 2. 激活 skill（编辑 openclaw.json）
openclaw config set agents.default.skills '["~/.openclaw/skills/zettelkasten-brain/current/SKILL.md"]'

# 3. 设置自动备份 cron
crontab -l | { cat; echo "0 2 * * 0 bash ~/.openclaw/skills/zettelkasten-brain/snapshot.sh"; } | crontab -

# 4. 重启 Gateway
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

## 进化机制

### 每周快照（自动）

每周日凌晨 2 点自动执行：
1. 复制当前版本到 `ARCHIVE/v{YYYY}w{WW}/`
2. 如果超过 5 个备份，删除最旧的
3. 记录本周使用指标到 `FEEDBACK/metrics.json`

### 5 档备份轮换

```
[当前] → v2026w23 (最新)
         → v2026w22
         → v2026w21
         → v2026w20
         → v2026w19 (最旧，下周将被删除)
```

### 手动回滚

```bash
# 查看可用版本
bash ~/.openclaw/skills/zettelkasten-brain/evolve.sh list

# 回滚到第22周版本
bash ~/.openclaw/skills/zettelkasten-brain/evolve.sh rollback v2026w22

# 进化到下一版本（手动触发快照）
bash ~/.openclaw/skills/zettelkasten-brain/evolve.sh evolve
```

### 反馈驱动的进化

skill 会根据以下指标自动调整行为：

| 指标 | 说明 | 调整方向 |
|------|------|----------|
| `notes_created` | 每周创建笔记数 | >50 则降低敏感度，<5 则提高 |
| `search_hit_rate` | 搜索命中率 | <30% 则改进关键词提取 |
| `link_density` | 平均笔记链接数 | <1 则加强关联检测 |
| `user_corrections` | 用户修正次数 | >3 则调整置信度阈值 |

---

## 使用场景

### 场景 1：知识检索
```
用户：我之前是怎么配 Docker 网络的？
AI：🔍 搜索知识库...
     找到笔记 "Docker Bridge 配置"（ID: 20260510...）
     你之前用的是 bridge 模式，子网 172.18.0.0/16...
```

### 场景 2：自动记录
```
用户：我发现用 pnpm 比 npm 快多了
AI：📝 检测到新知识点，已保存：
     "pnpm vs npm 性能对比"（ID: 20260511...）
     标签: package-manager, performance
     要链接到 "Node.js 工具链" 笔记吗？
```

### 场景 3：会话归档
```
用户：（会话结束）
AI：📦 会话已归档。创建了 "微服务设计讨论摘要"，
     关联了 3 条已有笔记。
```

---

## 配置

在 `~/.openclaw/openclaw.json` 中调整：

```json
{
  "plugins": {
    "entries": {
      "zettelkasten": {
        "config": {
          "agentConfigs": {
            "chat": {
              "tools": ["zk_search_notes", "zk_get_note"]
            },
            "knowledge": {
              "tools": ["zk_create_note", "zk_update_note", "zk_create_link"]
            }
          },
          "sessionHook": { "enabled": true }
        }
      }
    }
  }
}
```

---

## 故障排除

### Skill 不生效
```bash
# 检查 skill 路径
openclaw config get agents.default.skills

# 验证 Zettelkasten 插件
openclaw zk doctor
```

### 备份失败
```bash
# 手动运行快照
bash ~/.openclaw/skills/zettelkasten-brain/snapshot.sh

# 检查磁盘空间
df -h ~/.openclaw
```

---

**进化状态**: v1.0.0 → 等待第一周数据
