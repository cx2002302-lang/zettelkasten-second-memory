# Zettelkasten 操作陷阱清单

> 实战踩过的坑，新人必读。

---

## 陷阱 1：找错 skill 文件（2026-06-07 教训）

**症状**：找了一个像 skill 的目录就读，结果内容过时或不一致。

**正解**：
- ✅ 真身在 `~/.openclaw/skills/<skill-name>/`（被 `openclaw.json::skills.load.extraDirs` 引用）
- ❌ `~/.openclaw/<plugin>/skills/<sub>` 是开发副本，**可能过时**

**正确流程**：
1. 查 `openclaw.json` 的 `skills.load.extraDirs`
2. 读 `extraDirs` 目录里的 `RULES.md` / `SKILL.md` / `PROMPT.md`

---

## 陷阱 2：R11 铁律（最常犯）

**症状**：用 `sqlite3` / `node -e` / `openclaw zk link` 直操作 db。

**正解**：
- **永远**只走 MCP 工具（28 个 `zk_*`）
- 不存在 `zk_create_link` 工具（设计上就没有）
- 链接是 zk nightlyDistill（每晚 2:00 UTC = 北京时间 10:00）自动维护
- AI 角色：只建议，不执行

---

## 陷阱 3：zk_update_note 会清空 tags（实测）

**症状**：调用 `zk_update_note` 改 `content`，**没传 `tags`**，结果 tags 字段被清空。

**正解**：
- 改任何字段时**显式传所有想保留的字段**
- 推荐做法：传 `tags` 时**重发整个新 tags 列表**

---

## 陷阱 4：create_note 置信度路由

- 置信度 ≥ 0.7 → zettels
- 置信度 ≥ 0.4 → references
- 置信度 < 0.4 → inbox

**建议**：
- 推测/常识 = 0.5
- 经验分享 = 0.7
- 确认事实 = 0.8+

---

## 陷阱 5：search 默认排除归档

`zk_search_notes` 默认不返回已归档笔记。要查归档用 `zk_search_archived`。

---

## 陷阱 6：openclaw.json 改动范围

**改前必做**：
1. 完整备份（带时间戳）
2. 用 Python json 读写（不要 sed）
3. 改后立刻 `json.load()` 验证
4. 用 diff 确认**只改了要改的字段**

**改后验证**：
- `openclaw zk doctor` 检查插件健康
- `openclaw config get` 验证配置可读
- 不立刻重启（用户拍板再重启）

---

## 陷阱 7：重复 51% 的提示词（2026-06-07 发现）

**症状**：SPO（systemPromptOverride）和 PROMPT.md 71 行完全相同，工具列表错（"用 zk_create_link"）。

**正解**：
- **删 SPO 字段**（已 2026-06-07 完成）
- 真正行为哲学以 RULES.md 为准
- 系统提示词 = skill 文件（SKILL + PROMPT + RULES）
