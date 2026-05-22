# Coordinator Plan — Round 2

> **目标**: 处理剩余 P3 代码异味 + P4 Info 级优化 + P1 测试覆盖补充（第一批）
> **上一轮状态**: 18 个 Critical/Warning 已修复，689/689 测试通过
> **本轮策略**: 3 Worker 并行，先处理冲突文件再分发无冲突任务

---

## 一、本轮问题总览

| 优先级 | 类别 | 数量 | 说明 |
|--------|------|------|------|
| P3 | 魔法数字散布 | ~12项 | 多处硬编码数字/阈值，应提取到 `constants.ts` |
| P3 | console.* 直接使用 | 12+ 文件 | 无统一日志抽象，需引入 Logger 并清理 |
| P3 | 硬编码 Prompt 模板 | 1 文件 | `ceqrc-engine.ts` 内联 Prompt 字符串 |
| P1 | 测试覆盖缺失 | 5 模块 | phase5-tools, phase6-tools, phase6 服务层零测试 |

> **重要勘误**: `src/repository/system-tuning-repository.ts` 实际上已有完整测试（`src/repository/__tests__/system-tuning-repository.test.ts`，474 行），**从本轮清单中移除**。

---

## 二、Worker D — 魔法数字提取

### 2.1 核心策略
1. 在 `src/core/constants.ts` 中新增常量分组（`PAGINATION_*`, `THRESHOLD_*`, `FTS_*`, `VALIDATION_*`, `AUDIT_*` 等）
2. 所有被提取点的原文件改为引用常量
3. **绝不修改逻辑行为**，只做字面值替换

### 2.2 文件清单与具体提取点

#### A. `src/core/constants.ts`（本 Worker 主导新增）
需新增常量：
```typescript
// 分页默认值
export const DEFAULT_SEARCH_LIMIT = 20;
export const DEFAULT_INBOX_LIMIT = 50;
export const DEFAULT_ARCHIVE_LOG_LIMIT = 50;
export const DEFAULT_EXPORT_LIMIT = 1000;
export const DEFAULT_MOC_SUGGESTION_LIMIT = 10;
export const DEFAULT_AUDIT_HISTORY_LIMIT = 10;
export const DEFAULT_SERENDIPITY_LIMIT = 20;
export const DEFAULT_GRAPH_MAX_NODES = 200;

// FTS 相关
export const FTS_SNIPPET_LENGTH = 64;
export const FALLBACK_SNIPPET_LENGTH = 100;
export const FALLBACK_SEARCH_SCORE = 0.5;

// 阈值
export const VECTOR_SIMILARITY_THRESHOLD = 0.85;
export const HIGH_CONFIDENCE_THRESHOLD = 0.7;
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.4;
export const MIN_CONFIDENCE_THRESHOLD = 0.5;
export const QUALITY_THRESHOLD = 0.8;
export const SERENDIPITY_AUTO_LINK_THRESHOLD = 0.8;
export const MOC_CONFIDENCE = 0.9;
export const MOC_GLOW_FIRE_THRESHOLD = 0.7;

// 蒸馏/验证
export const BATCH_SIZE = 10;
export const MAX_SLICE_TOKENS = 2000;
export const MIN_CONTENT_LENGTH = 50;
export const MIN_MEANINGFUL_WORDS = 5;
export const MAX_CANDIDATES = 5;

// 归档/审计
export const ZOMBIE_SCAN_LIMIT = 50;
export const RECENT_DAYS = 7;
export const HUB_NOTES_LIMIT = 5;
export const MOC_TOP_NOTES = 5;
export const MOC_HUB_TITLE_MAX_LEN = 20;
export const MOC_HUB_TITLE_PREVIEW_LEN = 15;

// CEQRC
export const CEQRC_PHASE_TIMEOUT_MS = 30000;

// MOC/社区
export const MOC_MIN_CLUSTER_SIZE = 5;
export const MOC_MAX_CLUSTERS = 10;

// Serendipity
export const SERENDIPITY_TOP_K = 5;
export const SERENDIPITY_MIN_SCORE = 0.5;
export const SERENDIPITY_MAX_PATH_LENGTH = 3;
```

#### B. `src/repository/note-repository.ts`
| 行号 | 当前值 | 替换为 |
|------|--------|--------|
| 45 | `substring(0, 280)` | `SUMMARY_MAX_LENGTH`（已存在） |
| 365 | `limit: number = 20` | `DEFAULT_SEARCH_LIMIT` |
| 381 | `snippet(..., 64)` | `FTS_SNIPPET_LENGTH` |
| 444 | `limit: number = 20` | `DEFAULT_SEARCH_LIMIT` |
| 462 | `substring(0, 100)` | `FALLBACK_SNIPPET_LENGTH` |
| 483 | `score: 0.5` | `FALLBACK_SEARCH_SCORE` |

#### C. `src/mcp/server.ts`
| 行号 | 当前值 | 替换为 |
|------|--------|--------|
| 91 | `limit: number = 20` | `DEFAULT_SEARCH_LIMIT` |
| 158 | `limit: number = 20` | `DEFAULT_SEARCH_LIMIT` |
| 326 | `limit: number = 50` | `DEFAULT_INBOX_LIMIT` |
| 367,421,438,450 | `default: 20` | `DEFAULT_SEARCH_LIMIT` |
| 464 | `default: 50` | `DEFAULT_INBOX_LIMIT` |
| 490 | `default: 200` | `DEFAULT_GRAPH_MAX_NODES` |
| 515,572 | `default: 0.5` | `DEFAULT_CONFIDENCE`（已存在） |

#### D. `src/service/dedupe-service.ts`
| 行号 | 当前值 | 替换为 |
|------|--------|--------|
| 23 | `vectorSimilarityThreshold: 0.85` | `VECTOR_SIMILARITY_THRESHOLD` |
| 24 | `maxCandidates: 5` | `MAX_CANDIDATES` |

#### E. `src/service/distiller-service.ts`
| 行号 | 当前值 | 替换为 |
|------|--------|--------|
| 31 | `highConfidenceThreshold: 0.7` | `HIGH_CONFIDENCE_THRESHOLD` |
| 32 | `mediumConfidenceThreshold: 0.4` | `MEDIUM_CONFIDENCE_THRESHOLD` |
| 33 | `batchSize: 10` | `BATCH_SIZE` |
| 34 | `maxSliceTokens: 2000` | `MAX_SLICE_TOKENS` |
| 260 | `content.length < 50` | `MIN_CONTENT_LENGTH` |
| 303 | `words.length < 5` | `MIN_MEANINGFUL_WORDS` |
| 418 | `vectorSimilarityThreshold: 0.85` | `VECTOR_SIMILARITY_THRESHOLD` |

#### F. `src/service/archive-service.ts`
| 行号 | 当前值 | 替换为 |
|------|--------|--------|
| 64 | `options?.limit ?? 50` | `DEFAULT_ARCHIVE_LOG_LIMIT` |
| 104 | `options?.limit ?? 50` | `ZOMBIE_SCAN_LIMIT` |
| 160 | `'-7 days'` | `-${RECENT_DAYS} days`（模板字符串） |

#### G. `src/repository/sample-curation-repository.ts`
| 行号 | 当前值 | 替换为 |
|------|--------|--------|
| 120 | `params.limit ?? 50` | `DEFAULT_INBOX_LIMIT`（或新常量 `DEFAULT_CURATION_LIMIT`） |
| 216 | `limit: number = 1000` | `DEFAULT_EXPORT_LIMIT` |

#### H. `src/mcp/phase5-tools.ts`
| 行号 | 当前值 | 替换为 |
|------|--------|--------|
| 239 | `default: 0.8` | `QUALITY_THRESHOLD` |
| 328 | `minScore: number = 0.8` | `QUALITY_THRESHOLD` |
| 329 | `1000` | `DEFAULT_EXPORT_LIMIT` |
| 303 | `days: number = 7` | `RECENT_DAYS` |

#### I. `src/service/phase6/moc-service.ts`
| 行号 | 当前值 | 替换为 |
|------|--------|--------|
| 19 | `minClusterSize: 5` | `MOC_MIN_CLUSTER_SIZE` |
| 20 | `maxClusters: 10` | `MOC_MAX_CLUSTERS` |
| 120 | `limit = 10` | `DEFAULT_MOC_SUGGESTION_LIMIT` |
| 174 | `0.9` | `MOC_CONFIDENCE` |
| 208 | `hubTitle.length <= 20` | `MOC_HUB_TITLE_MAX_LEN` |
| 212 | `substring(0, 15)` | `MOC_HUB_TITLE_PREVIEW_LEN` |
| 230 | `Math.min(5, ...)` | `MOC_TOP_NOTES` |
| 232 | `note.glowScore > 0.7` | `MOC_GLOW_FIRE_THRESHOLD` |

#### J. `src/service/phase6/serendipity-service.ts`
| 行号 | 当前值 | 替换为 |
|------|--------|--------|
| 20 | `topK: 5` | `SERENDIPITY_TOP_K` |
| 21 | `minScore: 0.5` | `SERENDIPITY_MIN_SCORE` |
| 22 | `maxPathLength: 3` | `SERENDIPITY_MAX_PATH_LENGTH` |
| 105 | `c.score >= 0.8` | `SERENDIPITY_AUTO_LINK_THRESHOLD` |
| 121 | `limit = 20` | `DEFAULT_SERENDIPITY_LIMIT` |

#### K. `src/service/phase6/audit-service.ts`
| 行号 | 当前值 | 替换为 |
|------|--------|--------|
| 96 | `LIMIT 5` | `HUB_NOTES_LIMIT` |
| 122 | `'-7 days'` | `-${RECENT_DAYS} days` |
| 202 | `limit = 10` | `DEFAULT_AUDIT_HISTORY_LIMIT` |
| 222 | `metrics.connectionRate < 0.5` | `MIN_CONFIDENCE_THRESHOLD` |
| 226 | `metrics.orphanCount > 5` | `MOC_MIN_CLUSTER_SIZE` 或新常量 `ORPHAN_WARNING_THRESHOLD` |
| 230 | `metrics.zombieCount > 3` | 新常量 `ZOMBIE_WARNING_THRESHOLD = 3` |
| 234 | `metrics.inboxBacklog > 10` | 新常量 `INBOX_BACKLOG_WARNING_THRESHOLD = 10` |
| 238 | `metrics.avgContentLength < 100` | 新常量 `MIN_AVG_CONTENT_LENGTH = 100` |

#### L. `src/service/note-service.ts`
| 行号 | 当前值 | 替换为 |
|------|--------|--------|
| 43 | `highConfidenceThreshold: 0.7` | `HIGH_CONFIDENCE_THRESHOLD` |
| 44 | `mediumConfidenceThreshold: 0.4` | `MEDIUM_CONFIDENCE_THRESHOLD` |

#### M. `src/service/ceqrc-engine.ts`
| 行号 | 当前值 | 替换为 |
|------|--------|--------|
| 31 | `phaseTimeoutMs: 30000` | `CEQRC_PHASE_TIMEOUT_MS` |
| 32 | `minConfidenceThreshold: 0.7` | `HIGH_CONFIDENCE_THRESHOLD` |

> **关于硬编码 Prompt**: `PHASE_PROMPTS` 对象是 CEQRC 引擎的核心业务模板，属于**业务常量**而非魔法数字。建议在 `ceqrc-engine.ts` 内保留，但可将其标记为 `readonly` 或提取到同目录的 `ceqrc-prompts.ts` 中（**P4 优化，非本轮必须**）。

---

## 三、Worker E — console.* 清理

### 3.1 核心策略
1. 创建 `src/core/logger.ts` — 轻量级日志抽象（支持 `debug/info/warn/error` 四级，生产环境可过滤 debug）
2. 所有 `console.*` 替换为 `logger.*`
3. 示例文件（`src/examples/quick-start.ts`）**不清理**（示例脚本允许 console）
4. 文档文件（`PHASE5-COMPLETION.md`, `INTEGRATION.md`）**不清理**（非源码）

### 3.2 新文件：`src/core/logger.ts`
```typescript
// 极简日志抽象，未来可接入 OpenClaw 的日志系统
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export const defaultLogger: Logger = {
  debug: () => {}, // 默认关闭 debug，避免测试噪音
  info: console.log,
  warn: console.warn,
  error: console.error,
};

export function createLogger(prefix: string): Logger {
  return {
    debug: (msg, ...args) => defaultLogger.debug(`[${prefix}] ${msg}`, ...args),
    info: (msg, ...args) => defaultLogger.info(`[${prefix}] ${msg}`, ...args),
    warn: (msg, ...args) => defaultLogger.warn(`[${prefix}] ${msg}`, ...args),
    error: (msg, ...args) => defaultLogger.error(`[${prefix}] ${msg}`, ...args),
  };
}
```

### 3.3 文件清单与清理点

#### A. `src/index.ts`
| 行号 | 当前代码 | 替换为 |
|------|----------|--------|
| 135 | `console.warn("Full-text search not available:", ...)` | `logger.warn(...)` |
| 140 | `console.log(\`Zettelkasten initialized at ...\`)` | `logger.info(...)` |

#### B. `src/repository/note-repository.ts`
| 行号 | 当前代码 | 替换为 |
|------|----------|--------|
| 38 | `console.warn("Atomicity check failed:", ...)` | `logger.warn(...)` |

#### C. `src/mcp/server.ts`
| 行号 | 当前代码 | 替换为 |
|------|----------|--------|
| 636 | `console.log("Zettelkasten MCP server started")` | `logger.info(...)` |
| 644 | `console.log("Zettelkasten MCP server stopped")` | `logger.info(...)` |

#### D. `src/integration/session-hook.ts`
| 行号 | 当前代码 | 替换为 |
|------|----------|--------|
| 132 | `console.warn("[Zettelkasten SessionHook] Already initialized")` | `logger.warn(...)` |
| 139 | `console.log("[Zettelkasten SessionHook] Initialized", ...)` | `logger.info(...)` |
| 152 | `console.log("[Zettelkasten SessionHook] Destroyed")` | `logger.info(...)` |
| 160 | `console.log("[Zettelkasten SessionHook] Config updated", ...)` | `logger.info(...)` |
| 200 | `console.error("[Zettelkasten SessionHook] Event listener error:", error)` | `logger.error(...)` |
| 215 | `console.log("[Zettelkasten SessionHook] Disabled, skipping session:", ...)` | `logger.info(...)` |
| 227 | `console.log("[Zettelkasten SessionHook] Session does not meet criteria:", ...)` | `logger.info(...)` |
| 387 | `console.log(\`[Zettelkasten SessionHook] Retrying session ...\`)` | `logger.info(...)` |

#### E. `src/integration/zettelkasten-integration.ts`
| 行号 | 当前代码 | 替换为 |
|------|----------|--------|
| 145 | `console.log("[Zettelkasten Integration] Already initialized")` | `logger.info(...)` |
| 152 | `console.log("[Zettelkasten Integration] Initializing...")` | `logger.info(...)` |
| 171 | `console.log("[Zettelkasten Integration] Initialization complete")` | `logger.info(...)` |
| 176 | `console.error("[Zettelkasten Integration] Initialization failed:", ...)` | `logger.error(...)` |
| 187 | `console.log("[Zettelkasten Integration] Initializing services...")` | `logger.info(...)` |
| 204 | `console.log("[Zettelkasten Integration] Initializing agent config...")` | `logger.info(...)` |
| 211 | `console.log(\`[Zettelkasten Integration] Configured ${agents.length} agents\`)` | `logger.info(...)` |
| 224 | `console.log("[Zettelkasten Integration] Cron scheduler disabled")` | `logger.info(...)` |
| 229 | `console.log("[Zettelkasten Integration] Initializing cron scheduler...")` | `logger.info(...)` |
| 250 | `console.log("[Zettelkasten Integration] Session hook disabled")` | `logger.info(...)` |
| 255 | `console.log("[Zettelkasten Integration] Initializing session hook...")` | `logger.info(...)` |
| 279 | `console.log("[Zettelkasten Integration] Shutting down...")` | `logger.info(...)` |
| 292 | `console.log("[Zettelkasten Integration] Shutdown complete")` | `logger.info(...)` |

#### F. `src/storage/template-manager.ts`
| 行号 | 当前代码 | 替换为 |
|------|----------|--------|
| 48 | `console.warn(\`Template initialization warning: ${result.reason}\`)` | `logger.warn(...)` |
| 52 | `console.error(\`Failed to initialize template directory: ${error}\`)` | `logger.error(...)` |
| 68 | `console.warn(\`Template file not found: ${filepath}, using default\`)` | `logger.warn(...)` |

#### G. `src/integration/cron-scheduler.ts`
| 行号 | 当前代码 | 替换为 |
|------|----------|--------|
| 172 | `console.error(prefix, message, details || "")` | `logger.error(...)` |
| 174 | `console.warn(prefix, message, details || "")` | `logger.warn(...)` |
| 176 | `console.log(prefix, message, details || "")` | `logger.info(...)` |

> 注意：cron-scheduler 有封装好的 `log()` 方法，内部用 `console.*`。可以直接将 `log()` 方法内部改为调用 `logger.*`。

#### H. `src/service/feedback-service.ts`
| 行号 | 当前代码 | 替换为 |
|------|----------|--------|
| 75 | `console.log(\`[FeedbackService] Positive feedback received ...\`)` | `logger.info(...)` |
| 83 | `console.log(\`[FeedbackService] Negative feedback received ...\`)` | `logger.info(...)` |
| 91 | `console.log(\`[FeedbackService] Correction received ...\`)` | `logger.info(...)` |
| 99 | `console.log(\`[FeedbackService] Suggestion received ...\`)` | `logger.info(...)` |

#### I. `src/service/distiller-service.ts`
| 行号 | 当前代码 | 替换为 |
|------|----------|--------|
| 314 | `console.warn(\`[Distiller] Skipping low-quality summary: ...\`)` | `logger.warn(...)` |
| 345 | `console.error("Failed to create note from summary:", error)` | `logger.error(...)` |
| 464 | `console.error("Night distillation failed:", error)` | `logger.error(...)` |

#### J. `src/service/note-service.ts`
| 行号 | 当前代码 | 替换为 |
|------|----------|--------|
| 119 | `console.error(\`Failed to create note "${params.title}":\`, error)` | `logger.error(...)` |
| 353 | `console.warn(\`Target note "${target}" not found, skipping link creation\`)` | `logger.warn(...)` |

#### K. `src/service/prompt-evolution-service.ts`
| 行号 | 当前代码 | 替换为 |
|------|----------|--------|
| 245 | `console.log(\`[PromptEvolution] Applying suggestion ${suggestionId}\`)` | `logger.info(...)` |

---

## 四、Worker F — 测试覆盖补充（第一批）

### 4.1 策略
- 为 5 个零测试模块编写单元测试
- 使用 `:memory:` SQLite 数据库隔离
- 参照已有测试风格（vitest + beforeEach 创建内存数据库）
- 测试目标：核心公共方法覆盖 ≥80%，构造函数和配置方法必测

### 4.2 模块列表

#### A. `src/mcp/phase5-tools.ts` → `src/mcp/__tests__/phase5-tools.test.ts`
**测试目标**: Phase5MCPTools 类
- `constructor` — 默认配置与自定义配置
- `getTools()` — 返回工具列表长度、名称校验、开关控制
- 各 handler 代理测试（mock service 返回值）
  - `getReviewPanel`, `submitReview`, `getReviewStats`
  - `submitFeedback`, `getFeedbackStats`, `analyzeFeedbackTrends`
  - `getActivePrompt`, `getPromptStats`
  - `getCurationStats`, `exportSamples`

#### B. `src/mcp/phase6-tools.ts` → `src/mcp/__tests__/phase6-tools.test.ts`
**测试目标**: `registerPhase6Tools()` 函数
- 所有服务为 `null` 时返回空列表
- 各服务提供时注册正确工具
  - `zk_discover_serendipity` — 验证 handler 返回值结构
  - `zk_get_serendipity_stats`
  - `zk_scan_moc` — 验证 handler 返回值结构
  - `zk_get_moc_stats`
  - `zk_knowledge_audit` — 验证 handler 返回值结构
  - `zk_get_audit_history`
- Schema 校验（参数类型、默认值）

#### C. `src/service/phase6/audit-service.ts` → `src/service/__tests__/phase6/audit-service.test.ts`
**测试目标**: KnowledgeAuditService 类
- `constructor` — Schema 自动创建
- `generateReport()` — 各种场景：
  - 空数据库（全部为零）
  - 有笔记无链接（connectionRate=0, orphanCount=全部）
  - 有链接笔记
  - 有 zombie 笔记
  - inbox 积压
  - `enabled=false` 返回空报告
- `getLatestReport()` — 无记录返回 null，有记录正确解析
- `getReportHistory()` — 限制条数
- `generateRecommendations()` — 各阈值边界测试

#### D. `src/service/phase6/moc-service.ts` → `src/service/__tests__/phase6/moc-service.test.ts`
**测试目标**: MOCService 类
- `constructor` — Schema 自动创建
- `scanAndSuggest()` — 空图、单社区、多社区、已存在建议跳过
- `getPendingSuggestions()` — 排序、限制
- `createMOCFromSuggestion()` — 成功创建笔记
- `rejectSuggestion()` — 成功/失败
- `getStats()` — 计数正确
- `generateMOCTitle()` — 长短标题分支
- `generateMOCContent()` — 内容结构

#### E. `src/service/phase6/serendipity-service.ts` → `src/service/__tests__/phase6/serendipity-service.test.ts`
**测试目标**: SerendipityService 类
- `constructor` — Schema 自动创建
- `runDiscovery()` — 无候选、有候选、已存在跳过
- `autoCreateLinks` 配置为 true 且 score≥0.8 时自动创建链接
- `getPendingFindings()` — 排序、限制
- `acceptFinding()` — 成功创建链接并更新状态
- `rejectFinding()` — 状态更新
- `getStats()` — 计数正确
- `getConfig()` — 返回当前配置副本

### 4.3 测试基础设施
- 所有 phase6 测试共享一个 `test-utils/phase6-setup.ts`（可选）：
  - 创建 `zettel_notes`, `zettel_links`, `zettel_note_stats` 等必要表
  - 提供 `createTestNote(db, overrides)` 辅助函数
- 但优先保持各测试文件自包含（与现有测试风格一致）

---

## 五、冲突检查矩阵

### 5.1 文件级冲突（同一文件被多个 Worker 修改）

| 文件 | Worker D | Worker E | 冲突级别 | 解决策略 |
|------|----------|----------|----------|----------|
| `src/repository/note-repository.ts` | 魔法数字替换 (280, 64, 100, 20, 0.5) | console.warn → logger (line 38) | 🔴 **高** | **Worker E 先执行**（只改1行），然后 Worker D 在此基础上做常量替换 |
| `src/mcp/server.ts` | 分页默认值提取 (20, 50, 200, 0.5) | console.log → logger (line 636, 644) | 🔴 **高** | **Worker E 先执行**（只改2行），然后 Worker D 做常量替换 |
| `src/service/distiller-service.ts` | 阈值提取 (0.7, 0.4, 10, 2000, 50, 5, 0.85) | console.* → logger (line 314, 345, 464) | 🔴 **高** | **Worker E 先执行**，然后 Worker D 做常量替换 |
| `src/service/note-service.ts` | 阈值提取 (0.7, 0.4) | console.* → logger (line 119, 353) | 🔴 **高** | **Worker E 先执行**，然后 Worker D 做常量替换 |

### 5.2 无冲突文件（可并行）

**Worker D 独有（与 E/F 无交集）:**
- `src/core/constants.ts`
- `src/service/dedupe-service.ts`
- `src/service/archive-service.ts`
- `src/repository/sample-curation-repository.ts`
- `src/mcp/phase5-tools.ts`
- `src/service/phase6/moc-service.ts`
- `src/service/phase6/serendipity-service.ts`
- `src/service/phase6/audit-service.ts`
- `src/service/ceqrc-engine.ts`

**Worker E 独有（与 D/F 无交集）:**
- `src/core/logger.ts`（新文件）
- `src/index.ts`
- `src/integration/session-hook.ts`
- `src/integration/zettelkasten-integration.ts`
- `src/storage/template-manager.ts`
- `src/integration/cron-scheduler.ts`
- `src/service/feedback-service.ts`
- `src/service/prompt-evolution-service.ts`

**Worker F 独有（测试文件，与 D/E 无交集）:**
- `src/mcp/__tests__/phase5-tools.test.ts`（新）
- `src/mcp/__tests__/phase6-tools.test.ts`（新）
- `src/service/__tests__/phase6/audit-service.test.ts`（新）
- `src/service/__tests__/phase6/moc-service.test.ts`（新）
- `src/service/__tests__/phase6/serendipity-service.test.ts`（新）

### 5.3 执行顺序建议

```
Step 1: Worker E 执行（清理 console.*，包括冲突文件中的 console 行）
  └─ 同时 Worker F 执行（编写测试，完全独立）
  └─ 同时 Worker D 执行非冲突文件（constants.ts + 8 个无冲突文件）

Step 2: Worker D 执行冲突文件中的魔法数字替换
  └─ note-repository.ts, server.ts, distiller-service.ts, note-service.ts
```

> **关键**: Worker E 完成后必须提交/同步，Worker D 冲突文件任务在拿到 E 的结果后再执行。

---

## 六、验收标准

1. **Worker D**: 
   - `constants.ts` 新增 ≥25 个命名常量
   - 所有提取点的原文件通过编译，行为不变
   - `grep -rn "console\." src/` 不命中任何业务代码（示例除外）

2. **Worker E**:
   - 新文件 `src/core/logger.ts` 存在且导出正确
   - 所有业务代码的 `console.*` 替换为 `logger.*`
   - `npm test` 仍通过

3. **Worker F**:
   - 5 个新测试文件存在
   - `npm test` 新增测试全部通过
   - 测试覆盖率报告显示 phase5-tools, phase6-tools, audit-service, moc-service, serendipity-service 均有覆盖

4. **整体**:
   - `npm test` 全部通过（目标：689+ 新增测试数）
   - `npm run build` 或 `tsc --noEmit` 无错误

---

## 七、附录：上一轮遗留的 P4 Info 项

以下项目**不在本轮处理**，留给第三轮或后续优化：
- 缺少显式返回类型（大量公共方法）— 需要全局类型推断，工作量大
- `ceqrc-engine.ts` 的 `PHASE_PROMPTS` 提取到独立文件 — P4 业务优化
- `plugin/index.ts` 中的魔法数字（已部分覆盖，但 CLI 部分仍有硬编码）— 需要额外分析
- `engine/phase6/community-detector.ts` 和 `engine/phase6/serendipity-engine.ts` 中的魔法数字 — 属于 engine 层，非服务层
