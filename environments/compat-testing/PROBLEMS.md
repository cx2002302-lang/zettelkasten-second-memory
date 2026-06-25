# 兼容测试已知问题汇总

> 本文件汇总测试过程中遇到的实际问题，用于快速定位风险和后续修复跟踪。
> 最新全量报告见 `reports/2026-06-25-120531/full-report.md`。

---

## 🔴 严重问题

### 1. `openclaw agent --local` 在 OpenClaw 2026.4.x 上挂起

- **影响版本**: `ghcr.io/openclaw/openclaw:2026.4.23`、`ghcr.io/openclaw/openclaw:2026.4.24`
- **现象**: 执行 `openclaw agent --local --agent main --message '...'` 后，输出停留在：
  ```text
  [codex/catalog] codex model discovery failed; using fallback catalog
  ```
  随后进程挂起，直到 timeout 被杀死。
- **复现范围**: 容器内和生产环境（宿主机 `~/.openclaw`）均复现
- **根因**: 2026.4.x embedded agent 的 codex catalog fallback 逻辑存在阻塞
- **Workaround**: Agent CLI 测试在 2026.4.x 使用 Gateway 模式；或升级到 2026.6.x+ 使用 `--local`
- **状态**: 未修复，需 OpenClaw 官方排查或升级版本

---

## 🟠 中等问题

### 2. `zk_glow_ranking` 在空图/空缓存时返回空

- **影响版本**: 所有 OpenClaw 版本
- **现象**: 当 `zettel_links` 为空且 `zettel_note_stats` 缓存表无数据时，`zk_glow_ranking` 返回 `[]`
- **根因**: 发光度算法依赖 backlinks、引用和缓存；测试夹具无链接且 `recalculateAll()` 未触发
- **影响**: Agent 报告发光度为空，容易误判为工具故障
- **建议**: 在测试脚本中触发一次 knowledge audit / distill，或给测试库预置少量链接
- **状态**: 测试环境预期行为，待改进测试夹具

### 3. `zk_knowledge_audit` 未在 `openclaw.plugin.json` 默认工具列表中声明

- **影响版本**: 所有 OpenClaw 版本
- **现象**: `agentConfigs.{chat,knowledge}.tools` 默认列表包含 `zk_glow_ranking`，但不包含 `zk_knowledge_audit`
- **根因**: 工具在 `src/mcp/phase6-tools.ts` 中注册，但未同步到 manifest 默认值
- **影响**: Agent 能否调用该工具取决于系统提示/技能是否显式注入，行为不稳定（2026.4.24 成功调用，2026.6.10 未注入）
- **建议**: 在 `src/plugin/openclaw.plugin.json` 的 `agentConfigs.*.tools` 默认值中补充 `zk_knowledge_audit`
- **状态**: 待插件修复

### 4. `zk_knowledge_audit` 数据口径不一致

- **影响版本**: 2026.4.24（可能所有版本）
- **现象**: 报告 `hubNotes[*].linkCount = 1`，但 `totalLinks = 0`，且 `zk_search_notes` 显示 `links: []`
- **根因**: 待排查——可能是 hub note 的 `linkCount` 计算口径包含自环、草稿链接或统计缓存未刷新
- **影响**: 审计指标自相矛盾，可能误导健康度判断
- **建议**: 复核 `KnowledgeAuditService` 中 `linkCount` 的计算逻辑，确保与 `zettel_links` 表一致
- **状态**: 待排查

### 5. 测试夹具污染知识库

- **影响版本**: 所有 OpenClaw 版本
- **现象**: `run-compat-tests.sh` 和 `run-agent-project-test.sh` 会创建 `[TEST] ...` 标题的笔记，导致：
  - `zettel_notes` 表中积累测试记录（笔记数逐轮增加：8 → 10 → 11 → 12）
  - `zettel_note_stats` 为空但 `zettel_notes` 有数据，指标失真
  - 连接率、平均长度、glow 等都被夹具扭曲
- **建议**: 增加 `--cleanup` 模式或在独立测试库中运行测试
- **状态**: 待改进

### 6. DB 与文件系统不同步

- **影响版本**: 所有 OpenClaw 版本
- **现象**: `zettel_notes.file_path` 指向 `notes/` 目录下的 `.md` 文件，但 `notes/` 目录为空
- **根因**: `zk new` 似乎只写入 DB，未导出 `.md` 文件到 `notesDir`
- **影响**: 基于文件系统的工具可能出现“幽灵笔记”
- **状态**: 待排查

---

## 🟡 低风险 / 已知差异

### 7. OpenClaw 2026.6.x+ 移除 `agents.defaults.systemPromptOverride`

- **影响版本**: `openclaw-latest`（2026.6.10）
- **现象**: 无法设置 `agents.defaults.systemPromptOverride`，部署脚本显示 "not applicable"
- **状态**: 已知架构变更，不影响 Zettelkasten 插件核心功能

### 8. `tools.allow allowlist contains unknown entries (zettelkasten)` 警告

- **影响版本**: 2026.6.10
- **现象**: Agent 日志出现 `[tools] tools.allow allowlist contains unknown entries (zettelkasten). These entries won't match any tool unless the plugin is enabled.`
- **说明**: 当前配置为 `tools.alsoAllow: ["zettelkasten"]`，插件已启用；该警告目前未导致功能失败
- **建议**: 确认 2026.6.x 工具策略字段是否已由 `alsoAllow` 迁移为 `allow`，必要时调整部署脚本
- **状态**: 待确认

### 9. Hermes 仅完成探测，未做功能集成

- **影响版本**: `hermes-latest`
- **现象**: 容器启动成功并记录版本，但未验证 Hermes 是否能调用 zk MCP 工具
- **状态**: 当前测试范围仅到探测级，完整集成待后续补充

### 10. 2026.4.23 Agent 拒绝跳过 `BOOTSTRAP.md`

- **影响版本**: 2026.4.23
- **现象**: Agent 将提示中的 "忽略 BOOTSTRAP.md" 识别为 prompt-injection 并拒绝执行，随后仍完成审计
- **说明**: 这是 OpenClaw 的安全行为，符合 `AGENTS.md` 中 "If `BOOTSTRAP.md` exists, follow it" 的约束
- **影响**: 仅导致旧的完成检测脚本误判为未完成
- **状态**: 非缺陷，已更新完成检测逻辑

### 11. Agent 完成检测脚本误报 2026.4.x 为未完成

- **影响版本**: 2026.4.23、2026.4.24
- **现象**: 旧脚本只识别 `[agent] run ... ended with stopReason=`，而 2026.4.x gateway/embedded 模式输出的是 `embedded run done: ... aborted=false`
- **修复**: 已在 `scripts/run-agent-project-test.sh` 中增加对 `embedded run done: ... aborted=false` 的识别
- **状态**: 已修复

---

## 修复优先级建议

| 优先级 | 问题 | 负责人 |
|--------|------|--------|
| P0 | `openclaw agent --local` 在 2026.4.x 挂起 | OpenClaw 官方 / 升级 OpenClaw |
| P0 | `zk_knowledge_audit` 未加入 manifest 默认工具 | Zettelkasten 插件 |
| P1 | `zk_knowledge_audit` linkCount / totalLinks 不一致 | Zettelkasten 插件 |
| P1 | 测试夹具污染 | 测试脚本 |
| P1 | DB ↔ FS 不同步 | Zettelkasten 插件 |
| P2 | Hermes 功能集成 | 后续扩展 |
| P2 | 2026.6.x `tools.allow` 警告 | 测试脚本 |

---

*最后更新：2026-06-25*
