# 09 进化机制

## 简版

| 脚本/功能 | 一句话 | 用法 |
|-----------|--------|------|
| `snapshot.sh` | 每周自动快照，保留 5 档 | `bash snapshot.sh` |
| `evolve.sh list` | 列出可用历史版本 | `bash evolve.sh list` |
| `evolve.sh rollback` | 回滚到指定版本 | `bash evolve.sh rollback v{YYYY}w{WW}` |
| `evolve.sh evolve` | 手动触发进化（快照） | `bash evolve.sh evolve` |

**5 档备份**：当前 → v2026w23(最新) → v2026w22 → v2026w21 → v2026w20 → v2026w19(最旧)

---

## 明细版

### 概述

进化机制让 Skill 能够**自我迭代**。每周自动保存当前版本，保留 5 档历史，根据使用反馈自动调整行为参数。

### 每周快照（自动）

**触发时间**：每周日凌晨 2 点（cron）

**执行内容**：
1. 复制当前 SKILL.md / PROMPT.md / RULES.md 到 `ARCHIVE/v{YYYY}w{WW}/`
2. 复制 FEEDBACK 数据到备份目录
3. 如果超过 5 个备份，删除最旧的
4. 记录本周使用指标到 `FEEDBACK/metrics.json`

**cron 配置**：
```bash
0 2 * * 0 bash ~/.openclaw/skills/zettelkasten-brain/snapshot.sh
```

### 5 档备份轮换

```
[当前运行版本]
    ↓
ARCHIVE/v2026w23/  ← 本周快照（最新）
    ↓
ARCHIVE/v2026w22/
    ↓
ARCHIVE/v2026w21/
    ↓
ARCHIVE/v2026w20/
    ↓
ARCHIVE/v2026w19/  ← 最旧，下周将被删除
```

### 手动回滚

```bash
# 查看可用版本
bash ~/.openclaw/skills/zettelkasten-brain/evolve.sh list

# 回滚到第 22 周版本
bash ~/.openclaw/skills/zettelkasten-brain/evolve.sh rollback v2026w22

# 手动触发快照（进化）
bash ~/.openclaw/skills/zettelkasten-brain/evolve.sh evolve
```

### 反馈驱动的进化

系统根据以下指标自动调整行为参数：

| 指标 | 说明 | 调整方向 | 影响参数 |
|------|------|----------|----------|
| `notes_created` | 每周创建笔记数 | >50 降低敏感度，<5 提高 | `sensitivity` |
| `search_hit_rate` | 搜索命中率 | <30% 改进关键词提取 | `search_depth` |
| `link_density` | 平均笔记链接数 | <1 加强关联检测 | `link_threshold` |
| `user_corrections` | 用户修正次数 | >3 调整置信度阈值 | `confidence_threshold` |
| `zombie_ratio` | 僵尸笔记占比 | >20% 加强健康度报告 | `auto_archive` |

### 调整日志

所有自动调整记录在 `FEEDBACK/adjustments.log`：
```
[2026-05-15T02:00:00Z] sensitivity: 0.7 → 0.6 (notes_created=55)
[2026-05-08T02:00:00Z] search_depth: 20 → 30 (search_hit_rate=25%)
```

### 使用场景

**场景 1：查看调整历史**
```
用户：skill 最近有什么调整？
Agent：cat FEEDBACK/adjustments.log → 展示调整记录
```

**场景 2：回滚到上周版本**
```
用户：上周的提示词更好，回滚一下
Agent：evolve.sh rollback v2026w22
```

**场景 3：手动触发快照**
```
用户：保存当前版本
Agent：evolve.sh evolve → 创建新快照
```

### 注意事项

1. **回滚不可逆**：回滚后当前版本丢失，如需保留请先执行 `evolve.sh evolve`
2. **备份不包含笔记数据**：只备份 skill 文件，不备份 Zettelkasten 数据库
3. **自动调整保守**：系统不会大幅调整参数，每次变化幅度 ≤20%
4. **手动覆盖**：用户可通过 `openclaw config` 手动设置参数，优先级高于自动调整
