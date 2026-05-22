# Coordinator Plan — Round 3

> **目标**: 同时进行 **架构重构** + **集成层测试补充** + **beta.7 发布准备**  
> **制定时间**: 2026-05-22  
> **当前状态**: 752/752 测试通过，plugin/index.ts 1971 行

---

## 任务 1：plugin/index.ts 结构分析

### 1.1 逻辑块行号范围

| # | 逻辑块 | 起止行号 | 关键函数/标识 |
|---|--------|---------|--------------|
| 1 | **配置 Schema 定义** | 1–199 | `zettelkastenConfigSchema`, `ZettelkastenPluginConfig`, `resolveZettelkastenConfig`, `nullLLMProvider` |
| 2 | **MCP 工具 Schema 定义** | 218–397 | `ZkCreateNoteSchema` ~ `ZkUnarchiveNoteSchema`, `optionalStringEnum` |
| 3 | **MCP 工具 Builder 函数** | 399–1048 | `createZkCreateNoteTool` ~ `createZkExportSamplesTool` |
| 4 | **服务组装与生命周期** | 1051–1971 | `definePluginEntry.register()` — 含服务实例化(1059–1100)、工具注册调用(1102–1146)、CLI注册(1148–1787)、SessionHook(1789–1795)、NightlyCron(1797–1954)、DB生命周期(1958–1969) |
| 5 | **CLI 命令注册** | 1148–1787 | `api.registerCli(({ program }))` — `zk init/stats/new/list/search/show/link/doctor/status/archive-log/auto-archive/heatmap/graph-export/review-stats/review-pending/feedback-stats/prompt-stats/curation-stats/discover/scan-moc/audit` |
| 6 | **夜间定时任务** | 1797–1954 | `api.registerService({ id: "zettelkasten-nightly-distill", start/stop })` — 含蒸馏、归档、审核、飞书通知、Phase 6 任务 |

### 1.2 各块代码量统计

| 逻辑块 | 估算行数 | 占比 |
|--------|---------|------|
| 配置 Schema + 解析 | ~199 行 | 10.1% |
| 工具 Schema 定义 | ~180 行 | 9.1% |
| 工具 Builder 函数 | ~650 行 | 33.0% |
| CLI 命令实现 | ~640 行 | 32.5% |
| 服务组装 + 生命周期 + Cron | ~300 行 | 15.2% |
| **合计** | **~1971 行** | **100%** |

> 结论：工具 Builder（33%）和 CLI 命令（32.5%）是拆分重点，两者合计占 65.5%。

---

## 任务 2：拆分方案

### 2.1 目标目录结构

```
src/plugin/
├── index.ts          # 入口（目标 <500行）：组装 + 注册
├── config.ts         # 配置 Schema + 解析 + 默认值
├── tools/
│   ├── index.ts      # 工具统一导出（汇总所有 create*Tool 函数）
│   ├── notes.ts      # 笔记相关工具（Schema + Builder）
│   ├── links.ts      # 链接/路径相关工具
│   ├── review.ts     # 审核/反馈/提示进化/样本策展工具
│   └── heatmap.ts    # 热力图/网络图/归档工具
├── cli/
│   ├── index.ts      # CLI 统一导出（定义 zk command group）
│   └── commands.ts   # CLI 命令实现（按类别分组）
└── lifecycle.ts      # 服务组装 + Cron + DB 生命周期
```

### 2.2 各文件内容规划

#### `src/plugin/config.ts`（~200行）

- **导入**: `z`, `Type`, `path`, `os`, `buildPluginConfigSchema`
- **导出**:
  - `zettelkastenConfigSchema`（zod，行 35–77）
  - `ZettelkastenPluginConfig` interface（行 79–104）
  - `resolveZettelkastenConfig()`（行 106–199）
  - `nullLLMProvider()`（行 201–216）
- **依赖**: 仅依赖 SDK 和 Node 内置模块，零业务耦合

#### `src/plugin/tools/notes.ts`（~350行）

- **Schema**: `ZkCreateNoteSchema`, `ZkSearchNotesSchema`, `ZkGetNoteSchema`, `ZkUpdateNoteSchema`, `ZkSearchArchivedSchema`, `ZkArchiveNoteSchema`, `ZkUnarchiveNoteSchema`, `ZkGetArchiveLogSchema`
- **Builder 函数**:
  - `createZkCreateNoteTool(noteService, notesDir)`
  - `createZkSearchNotesTool(noteService)`
  - `createZkGetNoteTool(noteService)`
  - `createZkUpdateNoteTool(noteService)`
  - `createZkSearchArchivedTool(noteService)`
  - `createZkArchiveNoteTool(noteService)`
  - `createZkUnarchiveNoteTool(noteService)`
  - `createZkGetArchiveLogTool(archiveService)`
- **依赖**: `NoteService`, `ArchiveService`, `jsonResult`, `readStringParam`, `readNumberParam`

#### `src/plugin/tools/links.ts`（~120行）

- **Schema**: `ZkGetBacklinksSchema`, `ZkFindPathSchema`
- **Builder 函数**:
  - `createZkGetBacklinksTool(linkService)`
  - `createZkFindPathTool(pathFinder)`
- **依赖**: `LinkService`, `PathFinder`

#### `src/plugin/tools/heatmap.ts`（~150行）

- **Schema**: `ZkGlowRankingSchema`, `ZkFindZombiesSchema`, `ZkKnowledgeHeatmapSchema`, `ZkNetworkGraphSchema`
- **Builder 函数**:
  - `createZkGlowRankingTool(glowCalculator)`
  - `createZkFindZombiesTool(glowCalculator)`
  - `createZkKnowledgeHeatmapTool(heatmapService)`
  - `createZkNetworkGraphTool(heatmapService)`
- **依赖**: `GlowCalculator`, `KnowledgeHeatmapService`

#### `src/plugin/tools/review.ts`（~300行）

- **Schema**: `ZkReviewNoteSchema`, `ZkGetReviewPanelSchema`, `ZkSubmitReviewSchema`, `ZkGetReviewStatsSchema`, `ZkSubmitFeedbackSchema`, `ZkGetFeedbackStatsSchema`, `ZkAnalyzeFeedbackTrendsSchema`, `ZkGetActivePromptSchema`, `ZkGetPromptStatsSchema`, `ZkGetCurationStatsSchema`, `ZkExportSamplesSchema`
- **Builder 函数**:
  - `createZkReviewNoteTool(noteService, config)`
  - `createZkGetReviewPanelTool(reviewService)`
  - `createZkSubmitReviewTool(reviewService)`
  - `createZkGetReviewStatsTool(reviewService)`
  - `createZkSubmitFeedbackTool(feedbackService)`
  - `createZkGetFeedbackStatsTool(feedbackService)`
  - `createZkAnalyzeFeedbackTrendsTool(feedbackService)`
  - `createZkGetActivePromptTool(promptService)`
  - `createZkGetPromptStatsTool(promptService)`
  - `createZkGetCurationStatsTool(curationService)`
  - `createZkExportSamplesTool(curationService)`
- **依赖**: `ReviewService`, `FeedbackService`, `PromptEvolutionService`, `SampleCurationService`

#### `src/plugin/tools/index.ts`（~30行）

- 统一 re-export 所有 `createZk*Tool` 函数
- 导出 `optionalStringEnum` 辅助函数

#### `src/plugin/cli/commands.ts`（~650行）

- **命令分组**:
  - **初始化**: `init`, `stats`, `doctor`, `status`
  - **笔记操作**: `new`, `list`, `search`, `show`, `link`
  - **归档**: `archive-log`, `auto-archive`
  - **分析**: `heatmap`, `graph-export`
  - **审核反馈**: `review-stats`, `review-pending`, `feedback-stats`, `prompt-stats`, `curation-stats`
  - **Phase 6**: `discover`, `scan-moc`, `audit`（条件注册）
- **导出**: 一个工厂函数 `createZkCommands(api, config, services)` 返回命令配置对象
- **依赖**: 所有 Service 实例 + `safeParseInt`, `safeParseFloat`

#### `src/plugin/cli/index.ts`（~20行）

- 导出 `registerZkCli(api, config, services)` 包装器
- 内部调用 `createZkCommands` 并执行 `api.registerCli()`

#### `src/plugin/lifecycle.ts`（~280行）

- **导出**:
  - `createServices(config, db)` — 统一创建所有 Service 实例（行 1059–1100）
  - `registerNightlyService(api, config, services)` — 夜间定时任务（行 1797–1954）
  - `registerDbLifecycle(api, db)` — DB 关闭管理（行 1958–1969）
  - `registerSessionHook(api, config)` — Session Hook（行 1789–1795）
- **依赖**: 所有 Service 类

#### `src/plugin/index.ts`（目标 <300行）

```typescript
export default definePluginEntry({
  id: "zettelkasten",
  name: "Zettelkasten Second Memory System",
  description: "...",
  configSchema: buildPluginConfigSchema(zettelkastenConfigSchema),

  register(api) {
    const config = resolveZettelkastenConfig(api.pluginConfig);
    const db = initDatabase(config);
    const services = createServices(config, db);

    // 注册 MCP 工具
    registerAllTools(api, services);
    registerPhase6ToolsWrapped(api, services); // 条件注册

    // 注册 CLI
    registerZkCli(api, config, services);

    // 注册生命周期服务
    registerNightlyService(api, config, services);
    registerDbLifecycle(api, db);
    registerSessionHook(api, config);
  },
});
```

### 2.3 拆分实施顺序（建议）

1. **Phase 1**: 新建 `config.ts`，迁移 Schema + 解析函数（零风险）
2. **Phase 2**: 新建 `tools/*.ts`，迁移工具 Schema + Builder（需更新 index.ts 中的 import）
3. **Phase 3**: 新建 `cli/commands.ts`，迁移 CLI 实现（最大块，最后迁移）
4. **Phase 4**: 新建 `lifecycle.ts`，迁移服务组装 + Cron（需确保所有 Service 已正确导入）
5. **Phase 5**: 精简 `index.ts` 为入口编排文件
6. **Phase 6**: 运行全量测试验证（752 tests）

### 2.4 风险与注意事项

| 风险点 | 缓解措施 |
|--------|---------|
| 工具函数内部闭包引用 `api.logger` | CLI 命令中多处使用 `api.logger`，需通过参数传入或封装 logger |
| `registerPhase6Tools` 非耦合设计 | 保持现有 `src/mcp/phase6-tools.ts` 不变，仅调整 plugin 中的 wrapper |
| CLI 命令大量内联 SQL | 暂时保持原样，后续 round 可提取到 Repository 层 |
| 拆分后 import 路径变更 | 统一使用相对路径 `../service/xxx`，避免循环依赖 |

---

## 任务 3：集成层测试补充计划

### 3.1 当前测试状态

| 模块 | 已有测试 | 覆盖率 | 待补充 |
|------|---------|--------|--------|
| `agent-config.ts` | ✅ `integration.test.ts` 已有 22 tests | 高 | 边界 case（无效 role、重复注册） |
| `cron-scheduler.ts` | ⚠️ 仅常量断言 | 低 | 调度逻辑、重试、日志清理 |
| `session-hook.ts` | ⚠️ 仅常量断言 | 低 | 事件触发、条件过滤、异步执行 |
| `zettelkasten-integration.ts` | ⚠️ 仅工厂函数断言 | 低 | 完整初始化流程、shutdown |

### 3.2 `cron-scheduler.ts` 测试策略（目标 12+ tests）

**文件**: `src/integration/__tests__/cron-scheduler.test.ts`

```
描述块:
├─ "生命周期管理"
│   ├─ start() 应该启动调度器并设置 isRunning=true
│   ├─ stop() 应该清除所有定时器并设置 isRunning=false
│   └─ 重复 start() 应该记录警告但不崩溃
├─ "任务调度"
│   ├─ scheduleNightlyDistill() 应该创建 JobRecord 并设置状态为 scheduled
│   ├─ calculateNextRun() 应该正确计算下一个 2:00 AM
│   └─ 应该支持跨天调度（当前时间已过 2:00）
├─ "任务执行"
│   ├─ executeNightlyDistill() 应该调用 distillerService.distillYesterday
│   ├─ 蒸馏成功时 job 状态应为 completed
│   ├─ 蒸馏失败时 job 状态应为 failed 并触发重试
│   └─ triggerManualDistill() 应该绕过调度直接执行
├─ "重试逻辑"
│   ├─ handleRetry() 应该在 retryCount 内重试
│   └─ 超过 retryCount 后应该标记为最终失败
├─ "日志管理"
│   ├─ getLogs() 应该支持按 level/jobId/limit 过滤
│   └─ cleanupOldLogs() 应该删除过期日志
```

**Mock 策略**:
- `DistillerService` → mock `distillYesterday()` 返回 `DistillJob`
- 使用 `vi.useFakeTimers()` 控制时间推进

### 3.3 `session-hook.ts` 测试策略（目标 10+ tests）

**文件**: `src/integration/__tests__/session-hook.test.ts`

```
描述块:
├─ "生命周期"
│   ├─ initialize() 应该设置 isInitialized=true
│   ├─ 重复 initialize() 应该无操作
│   └─ destroy() 应该清理所有监听器和 pending hooks
├─ "事件系统"
│   ├─ addEventListener() 应该注册监听器
│   ├─ removeEventListener() 应该注销监听器
│   └─ emitEvent() 应该调用所有监听器
├─ "Session End 处理"
│   ├─ 禁用状态下应该直接返回 success=true, notesCreated=0
│   ├─ 消息数不足时应该跳过蒸馏
│   ├─ 会话时长不足时应该跳过蒸馏
│   ├─ 符合条件时应该执行蒸馏
│   └─ awaitCompletion=false 时应该异步执行并立即返回
├─ "重试机制"
│   └─ retrySession() 应该在 maxRetries 内重试
```

**Mock 策略**:
- `DistillerService` → mock `distillYesterday()`
- 构造 `SessionInfo` 对象测试边界条件（messageCount = 4 vs 5, duration = 0.5min vs 1min）

### 3.4 `zettelkasten-integration.ts` 测试策略（目标 8+ tests）

**文件**: `src/integration/__tests__/zettelkasten-integration.test.ts`

```
描述块:
├─ "初始化流程"
│   ├─ initialize() 应该按顺序初始化所有组件
│   ├─ 重复 initialize() 应该返回已有状态
│   ├─ 初始化完成后 overall 状态应为 ready
│   └─ 组件初始化失败时 overall 应为 error
├─ "生命周期管理"
│   ├─ shutdown() 应该停止 cronScheduler 和 sessionHook
│   └─ shutdown() 后 overall 应为 uninitialized
├─ "服务访问"
│   ├─ getNoteService() 应该返回 NoteService 实例
│   ├─ getDistillerService() 应该返回 DistillerService 实例
│   └─ getCronScheduler() 在 autoStartCron=false 时返回 undefined
├─ "全局单例"
│   ├─ set/get/resetZettelkastenIntegration() 应该管理全局实例
│   └─ initializeZettelkasten() 便捷函数应该返回已初始化的实例
```

**Mock 策略**:
- `DatabaseSync` → 内存 SQLite `:memory:`
- `LLMProvider` → mock 实现（返回空/固定值）
- `DistillerService` → mock（避免实际 LLM 调用）
- 使用 `vi.fn()` 监控 `cronScheduler.start()` 和 `sessionHook.initialize()`

### 3.5 测试实施优先级

| 优先级 | 文件 | 预计新增 tests | 预计工时 |
|--------|------|---------------|---------|
| P0 | `cron-scheduler.test.ts` | 12 | 2h |
| P1 | `session-hook.test.ts` | 10 | 1.5h |
| P2 | `zettelkasten-integration.test.ts` | 8 | 1.5h |
| P3 | `agent-config.test.ts`（扩展） | 4 | 0.5h |
| **合计** | | **~34** | **~5.5h** |

---

## 任务 4：beta.7 发布计划

### 4.1 版本号

- **建议版本**: `v1.0.0-beta.7`
- **版本依据**: beta.6 之后进行架构重构 + 测试补充，属于结构性迭代
- **package.json 当前版本**: `1.0.0`（保持不变，Release Tag 使用 `v1.0.0-beta.7`）

### 4.2 发布内容

#### 4.2.1 CHANGELOG 草案

```markdown
## v1.0.0-beta.7 — Plugin Architecture Refactor + Integration Test Suite

**Release Date**: 2026-05-22

### 🏗️ Architecture

- **Plugin 入口重构** — `src/plugin/index.ts` 从 1971 行拆分为 8 个模块
  - `config.ts` — 配置 Schema + 解析（零业务耦合）
  - `tools/*.ts` — 4 个工具分类文件（笔记/链接/审核/热力图）
  - `cli/commands.ts` — CLI 命令集中实现
  - `lifecycle.ts` — 服务组装 + Cron + DB 生命周期
  - 入口文件目标 <300 行，职责单一

### 🧪 Test Coverage

- **Integration 层测试补齐** — 新增 34 个集成测试
  - `cron-scheduler.test.ts` (12 tests) — 调度/执行/重试/日志
  - `session-hook.test.ts` (10 tests) — 事件/过滤/异步/重试
  - `zettelkasten-integration.test.ts` (8 tests) — 初始化/生命周期/服务访问
  - `agent-config.test.ts` 扩展 (4 tests) — 边界 case
- **全量测试**: 786/786 通过（752 现有 + 34 新增）

### 🔧 Maintenance

- 零功能变更，零 API 变更，纯结构与测试增强
- 向后兼容 beta.6 所有配置项
```

### 4.3 发布步骤

```bash
# Step 1: 版本号标记（在源码目录执行）
cd /home/myxia/.openclaw/project/zettelkasten
echo "v1.0.0-beta.7" > .version

# Step 2: 更新 CHANGELOG
cat >> zettelkasten-github/CHANGELOG.md << 'EOF'
## v1.0.0-beta.7 — ...（上述内容）
EOF

# Step 3: 源码同步到 github 目录
rsync -av --exclude='node_modules' --exclude='.git' --exclude='zettelkasten-github' \
  src/ zettelkasten-github/src/
rsync -av package.json vitest.config.ts zettelkasten-github/
# 如有新增测试/文档也一并同步

# Step 4: Git 提交与打标签
cd zettelkasten-github
git add -A
git commit -m "release: v1.0.0-beta.7 — plugin refactor + integration tests"
git tag -a v1.0.0-beta.7 -m "v1.0.0-beta.7"

# Step 5: 打包
mkdir -p releases
tar czf releases/zettelkasten-plugin-2026.5.22-v1.0.0-beta.7.tar.gz \
  src/ package.json vitest.config.ts CHANGELOG.md AGENTS.md

# Step 6: Release Notes
cat > releases/RELEASE_NOTES-v1.0.0-beta.7.md << 'EOF'
# Release v1.0.0-beta.7

## 下载
- Plugin: `zettelkasten-plugin-2026.5.22-v1.0.0-beta.7.tar.gz`

## 升级指南
1. 停止 OpenClaw
2. 解压到 `~/.openclaw/zettelkasten-plugin/`
3. 运行 `openclaw zk doctor` 验证
4. 启动 OpenClaw

## 兼容性
- OpenClaw >= 2026.4.23
- Node >= 22.14.0
EOF
```

### 4.4 发布检查清单

- [ ] 752 现有测试全部通过
- [ ] 34 新增测试全部通过
- [ ] `plugin/index.ts` 行数 < 500
- [ ] 无 TypeScript 编译错误
- [ ] CHANGELOG 已更新
- [ ] Git Tag `v1.0.0-beta.7` 已创建
- [ ] Release 包已生成
- [ ] `openclaw zk doctor` 验证通过

---

## 附录：关键文件变更预览

### A. 新增文件列表

| 文件 | 类型 | 来源 |
|------|------|------|
| `src/plugin/config.ts` | 拆分提取 | index.ts 行 1–199 |
| `src/plugin/tools/notes.ts` | 拆分提取 | index.ts 行 233–395, 399–742 |
| `src/plugin/tools/links.ts` | 拆分提取 | index.ts 行 271–284, 463–511 |
| `src/plugin/tools/heatmap.ts` | 拆分提取 | index.ts 行 340–380, 649–704, 744–820 |
| `src/plugin/tools/review.ts` | 拆分提取 | index.ts 行 320–338, 616–647, 822–1048 |
| `src/plugin/tools/index.ts` | 新建 | 统一导出 |
| `src/plugin/cli/commands.ts` | 拆分提取 | index.ts 行 1148–1787 |
| `src/plugin/cli/index.ts` | 新建 | CLI 注册包装器 |
| `src/plugin/lifecycle.ts` | 拆分提取 | index.ts 行 1059–1100, 1789–1969 |
| `src/integration/__tests__/cron-scheduler.test.ts` | 新建 | — |
| `src/integration/__tests__/session-hook.test.ts` | 新建 | — |
| `src/integration/__tests__/zettelkasten-integration.test.ts` | 新建 | — |

### B. 修改文件列表

| 文件 | 变更内容 |
|------|---------|
| `src/plugin/index.ts` | 精简为入口编排，删除所有具体实现 |
| `src/integration/__tests__/integration.test.ts` | 重命名为 `agent-config.test.ts` 或保留作为总集 |
| `zettelkasten-github/CHANGELOG.md` | 追加 beta.7 条目 |

---

*计划制定完成。建议按 **测试先行 → 拆分迁移 → 全量验证 → 发布** 的顺序执行。*
