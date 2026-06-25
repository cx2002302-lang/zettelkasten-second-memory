# Zettelkasten 第二记忆系统 — 未完成计划清单 (Backlog)

> **用途**: 记录已规划但未实现的功能，防止在夯实现有内容后遗忘。
> **更新规则**: 每完成一项从本清单移除并写入 CHANGELOG；每新增计划先写入本清单再排期。

---

## 🗺️ 一、来自原始路线图的延后项

来源: `plans/tech-selection-and-roadmap.md` — "可以延后 (Phase 2+)"

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 1.1 | **CEQRC 完整工作流** | ⏳ 部分完成 | 有 `CEQRCEngine` 基础引擎，但缺少完整的认知流水线（Capture → Explain → Question → Refine → Connect） |
| 1.2 | **AI 自动生成摘要** | ⏳ 未实现 | 用 LLM 给笔记内容生成摘要，写入 `summary` 字段 |
| 1.3 | **智能链接建议** | ⏳ 未实现 | 基于内容相似度自动推荐 "你可能还想链接到…" |
| 1.4 | **语义搜索 / 向量搜索** | ⏳ 未实现 | 引入 `sqlite-vec` 存储 embedding，做相似度检索；风险评估中已提及 |
| 1.5 | **高级图算法** | ⏳ 部分 | 只有最短路径；缺少连通子图、社区发现 (Clustering)、PageRank 等 |

---

## 🔮 二、来自 Phase 3 深度设计（"特效"）

来源: `plans/zettelkasten-phase3-deep-dive.md`

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 2.1 | **ViewCompositionEngine** | ⏳ 未实现 | 多维属性筛选 + 多视图输出（线性/树/图/MOC）；支持标签、关键词、状态、时间、链接关系、置信度等6维度过滤 |
| 2.2 | **多维属性过滤与特效表现** | ⏳ 未实现 | 时间轴回溯、知识演化可视化、长青笔记 vs 僵尸笔记动态标识 |

---

## 🧠 三、Phase 5/6 人机共生与系统调优

来源: `src/PHASE5-COMPLETION.md`, `src/PHASE5-IMPLEMENTATION-SUMMARY.md`

> ✅ **当前状态**: Phase 5/6 服务已通过 MCP 工具与 CLI 命令接入系统。

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 3.1 | **ReviewService 完整审核面板** | ✅ 已接入 | MCP: `zk_review_note`, `zk_get_review_panel`, `zk_get_review_stats`, `zk_submit_review`；CLI: `openclaw zk review-stats` / `review-pending` |
| 3.2 | **SampleCurationService 样本策划** | ✅ 已接入 | MCP: `zk_get_curation_stats`, `zk_export_samples` |
| 3.3 | **FeedbackService 人机反馈闭环** | ✅ 已接入 | MCP: `zk_submit_feedback`, `zk_get_feedback_stats`, `zk_analyze_feedback_trends` |
| 3.4 | **PromptVersion / PromptEvolution** | ✅ 已接入 | MCP: `zk_get_active_prompt`, `zk_get_prompt_stats` |
| 3.5 | **SystemTuning** | ✅ 已接入 | 内部由反馈服务调用，支持 sensitivity/search_depth/link_threshold 调优 |

---

## 🔌 四、原始 Phase 4 规划中的未实现集成

来源: `plans/tech-selection-and-roadmap.md` — Phase 4

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 4.1 | **MemoryHostBridge** | ⏳ 未实现 | 与 OpenClaw Memory Host SDK 的深度桥接 |
| 4.2 | **SessionBridge** | ⏳ 未实现 | 会话与笔记的自动关联（当前只有 `session_key` 字段，无自动关联逻辑） |

---

## 🧪 五、测试缺口与技术债务

| # | 问题 | 严重程度 | 说明 |
|---|------|---------|------|
| 5.1 | ~~`review-service.ts` 无单元测试~~ | ✅ 已修复 | 已有 `review-service.test.ts` (9 tests) |
| 5.2 | ~~`sample-curation-service.ts` 无单元测试~~ | ✅ 已修复 | 已有 `sample-curation-service.test.ts` (25 tests) |
| 5.3 | ~~`prompt-version-repository.ts` 测试失败~~ | ✅ 已修复 | 测试已通过 |
| 5.4 | ~~`template-manager.ts` 测试失败~~ | ✅ 已修复 | 测试已通过 |
| 5.5 | ~~`feedback-service.ts` / `system-tuning-service.ts`~~ | ✅ 已修复 | 均有测试（13 + 31 tests） |
| 5.6 | ~~`archive-service.ts` 测试覆盖不足~~ | ✅ 已修复 | 新增 `archive-service.test.ts` (14 tests) |
| 5.7 | ~~`heatmap-service.ts` 只有10个测试~~ | ✅ 已修复 | 新增边界测试（空数据库、空过滤、负数 limit、glowMin 越界等），共 20 tests |
| 5.8 | CLI 命令无端到端测试 | 🟡 P2 | 只有手动验证，无自动化 CLI 测试（需 OpenClaw API 模拟，ROI 较低） |
| 5.9 | MCP 工具 handler 无独立测试 | 🟡 P2 | server.test.ts 已验证注册和 schema；集成测试覆盖 handler 路径 |
| 5.10 | ~~`feedback-repository.ts` 无单元测试~~ | ✅ 已修复 | 新增 `feedback-repository.test.ts` (25 tests) |
| 5.11 | ~~`review-repository.ts` 无单元测试~~ | ✅ 已修复 | 新增 `review-repository.test.ts` (20 tests) |

---

## ⚙️ 六、工程化与体验

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 6.1 | **功能开关系统** | ⏳ 未设计 | 用户可按需启用/禁用模块；这是 Wave 4 之前需要夯实的核心工程能力 |
| 6.2 | **审核面板手动/自动模式** | ⏳ 未设计 | `reviewMode: "manual" | "auto"`；auto 模式下 AI 生成笔记后自动审核通过，manual 模式下留在 inbox 等待人工审核 |
| 6.3 | **一键安装/部署** | ⏳ 未设计 | 用户通过 OpenClaw Agent 对话即可完成插件+Skill 的下载、配置、部署、重启全流程；类似 `npx zettelkasten-plugin install` |
| 6.4 | **配置文档** | ⏳ 不完整 | `openclaw.json` 中插件配置的完整说明缺失 |
| 6.5 | **README 演示图/GIF** | ⏳ 未做 | 有静态信息图，但缺少 CLI 运行效果的动态演示 |
| 6.6 | ~~错误处理与边界 case~~ | ✅ 已完成 | 核心服务已添加输入校验和异常处理 |
| 6.7 | ~~OpenClaw 2026.6.x 兼容~~ | ✅ 已完成 | `contracts.tools` + `scripts/lib/compat.sh` |
| 6.8 | ~~Hermes Agent 支持~~ | ✅ 已完成 | `src/mcp/http-bridge.ts` + E2E 验证 |
| 6.9 | ~~性能基准测试~~ | ✅ 已修复 | 旧 10K 笔记阈值测试已通过；性能信息图已移除 |

---

## 🎯 当前夯实优先级建议

**P0（必须先做）**:
- 6.1 功能开关系统设计 — 为后续解耦和模块化打基础
- ~~5.1 ~ 5.4 修复测试失败 + 补全核心服务测试~~ ✅ 已完成（1724 tests, 0 failures）

**P1（夯实现有内容）**:
- ~~5.6 ~ 5.9 补全测试覆盖~~ ✅ 已完成
- ~~5.7 ~ 5.9 补全测试覆盖~~ ✅ 已完成
- ~~6.4 输入校验和异常处理~~ ✅ 已完成
- 6.2 配置文档

**P2（可选延后）**:
- 3.1 ~ 3.5 将 Phase 5 代码接入系统
- 1.1 ~ 1.5 原始路线图延后项
- 2.1 ~ 2.2 Phase 3 "特效"

**P3（未来探索）**:
- 4.1 ~ 4.2 MemoryHostBridge / SessionBridge
- 1.4 语义搜索（sqlite-vec）

---

## 🆕 七、Wave 4 之后的新需求（已记录，暂不实现）

| # | 需求 | 来源 | 说明 |
|---|------|------|------|
| 7.1 | **功能开关系统** | 用户 2026-05-11 | 用户可按需启用/禁用模块；减少资源占用、降低学习成本 |
| 7.4 | **修复 README/CONTRIBUTING/package.json 占位符** | PR#1 2026-05-14 | `YOUR_USERNAME` → `cx2002302-lang`（4 个文件，~10 处）；**处理策略**：等 PR#1 作者 3-7 天修改，超期则关闭 PR + cherry-pick 占位符修复部分自行合并 |
| 7.2 | **审核面板手动/自动模式** | 用户 2026-05-11 | `reviewMode: "manual" | "auto"`；auto 模式下 AI 笔记自动审核通过 |
| 7.3 | **一键安装/部署** | 用户 2026-05-11 | 通过 OpenClaw Agent 对话或 `curl | bash` 完成插件+Skill 全自动安装 |

---

## 🏗️ 当前阶段：兼容性保障与发布打磨（Wave 3 收尾 → Wave 4 准备）

**目标**: 已发布 v1.0.0-beta.8.1；确保 OpenClaw 2026.4/2026.6+ 与 Hermes Agent 兼容性稳定，文档无死链。

**验收标准**:
- [x] 所有单元测试通过（0 失败）
- [x] OpenClaw 2026.4.24 / 2026.6.x 部署验证通过
- [x] Hermes v0.17.0 MCP/E2E 验证通过
- [x] README/AGENTS/COMPATIBILITY 无死链、无过期命令
- [ ] 配置文档完整
- [ ] README 有演示截图/GIF

*Last updated: 2026-06-25*
