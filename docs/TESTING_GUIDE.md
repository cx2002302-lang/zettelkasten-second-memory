# Wave 1 端到端测试指南

> 本文档规范 Wave 1 功能的端到端测试方法，避免重复摸索。
> 
> **位置**: 开发目录 `docs/TESTING_GUIDE.md`（不进入发布目录）
> **适用**: OpenClaw 真实环境 + 真实数据库

---

## 快速开始

```bash
# 1. 进入开发目录
cd /home/myxia/.openclaw/project/zettelkasten

# 2. 填充测试数据（带 [TEST] 标记，可安全清理）
npx tsx scripts/seed-test-data.mjs

# 3. 运行端到端测试
npx tsx scripts/test-wave1-in-openclaw.mjs

# 4. 清理测试数据
npx tsx scripts/clean-test-data.mjs
```

---

## 脚本说明

### `scripts/seed-test-data.mjs`

向 OpenClaw 真实数据库注入测试数据，所有笔记标题带 `[TEST]` 前缀。

**生成数据**:
| 类别 | 数量 | 特征 |
|------|------|------|
| 僵尸笔记 | 3 | 200+ 天未更新，零入链 |
| Evergreen | 3 | 高质量，多引用，近期更新 |
| Active | 4 | 中等引用，近期更新 |
| Stable | 4 | 低引用，任意时间 |
| **链接** | ~18 | supports/extends/refines/related/is_example_of |

**安全机制**:
- 标题前缀 `[TEST]`，可通过 SQL `LIKE '[TEST]%'` 精确识别
- 内容内含 `<!-- TEST_DATA -->` 标记
- 清理脚本可一键删除，外键 CASCADE 自动清理链接和统计

### `scripts/clean-test-data.mjs`

清理所有 `[TEST]` 标记的笔记及其关联数据。

```bash
# 预览模式（不删除）
npx tsx scripts/clean-test-data.mjs --dry-run

# 执行删除
npx tsx scripts/clean-test-data.mjs
```

### `scripts/test-wave1-in-openclaw.mjs`

**7 项端到端测试**:

| # | 测试项 | 期望结果 |
|---|--------|----------|
| 1 | `glowRanking` | 返回排序列表，glow ∈ [0,1] |
| 2 | `findZombies` | 检出 ≥3 个 `[TEST]` 僵尸笔记 |
| 3 | `getSummary` | 总笔记 ≥20，zombie ≥3 |
| 4 | `findPath` | 测试笔记间发现有效路径 |
| 5 | `archive/unarchive` | folder 在 zettels ↔ archive 间切换 |
| 6 | `searchExcludeArchive` | 归档笔记被默认排除 |
| 7 | `linkWeights` | 多种链接类型正常分布 |

---

## OpenClaw Agent MCP 工具验证

引擎层验证通过后，需进一步验证 MCP 工具层（Agent 实际调用的接口）。

### 自动化验证脚本

```bash
npx tsx scripts/test-mcp-tools.mjs
```

**测试覆盖**:
| # | 工具 | 验证点 |
|---|------|--------|
| 1 | `zk_glow_ranking` | 返回排序列表，含 glow/status |
| 2 | `zk_find_zombies` | 检出 ≥3 个 TEST 僵尸笔记 |
| 3 | `zk_search_archived` | 归档笔记可被专门搜索 |
| 4 | `zk_find_path` | 路径发现返回 explanation |
| 5 | `zk_search_notes` | 默认排除 archive folder |
| 6 | `zk_get_note` + `zk_get_backlinks` | 单笔记读取 + 反向链接 |

### 人工 Agent 验证（对话模式）

```bash
# 启动 OpenClaw 对话（确保 Skill 已激活）
openclaw
```

在 Agent 对话中发送测试指令：
1. "知识发光度排行 top 5" → 验证 `zk_glow_ranking`
2. "找出僵尸笔记" → 验证 `zk_find_zombies`
3. "搜索归档笔记 TEST" → 验证 `zk_search_archived`
4. "归档笔记 xxx" / "恢复笔记 xxx" → 验证 `zk_archive_note` / `zk_unarchive_note`
5. "从 A 到 B 的知识路径" → 验证 `zk_find_path`

---

## 故障排查

| 问题 | 原因 | 解决 |
|------|------|------|
| `node:sqlite` 实验性警告 | Node 22+ 正常提示 | 可忽略 |
| 僵尸笔记为 0 | 未运行 seed 或数据已清理 | 重新运行 `seed-test-data.mjs` |
| glow 值异常 | stats 表未更新 | `glowCalc.recalculateAll()` 已自动调用 |
| 路径搜索无结果 | 测试笔记未链接 | seed 脚本已确保链接网络，如仍失败检查 links 表 |
| 模块找不到 | tsx 未安装 | `npm install -g tsx` 或 `npx tsx` |

---

## 版本记录

## Wave 2 新增测试

### Wave 2 快速开始

```bash
# 1. 确保测试数据已填充
npx tsx scripts/seed-test-data.mjs

# 2. 测试自动归档（dry-run 预览）
openclaw zk auto-archive

# 3. 执行自动归档
openclaw zk auto-archive --execute

# 4. 查看归档日志
openclaw zk archive-log

# 5. 归档不刷新时间戳验证
npx tsx scripts/test-wave2-in-openclaw.mjs

# 6. 清理
npx tsx scripts/clean-test-data.mjs
```

### Wave 2 验证清单

| # | 验证项 | 方法 |
|---|--------|------|
| 1 | 自动归档 dry-run | `openclaw zk auto-archive` |
| 2 | 自动归档执行 | `openclaw zk auto-archive --execute` |
| 3 | 归档日志查询 | `openclaw zk archive-log` |
| 4 | 归档不刷新 updated_at | `scripts/test-wave2-in-openclaw.mjs` |
| 5 | MCP 工具 `zk_get_archive_log` | `scripts/test-mcp-tools.mjs` |
| 6 | 夜间服务集成 | 查看 gateway 日志 `/tmp/openclaw/openclaw-*.log` |

---

## 版本记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-11 | v1 | 初版，Wave 1 端到端测试规范化 |
| 2026-05-11 | v2 | 新增 Wave 2 自动归档测试方法 |
