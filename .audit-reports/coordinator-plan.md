# Zettelkasten 审核修复协调计划

> 生成时间: 2026-05-22  
> 协调范围: Critical 安全与稳定性 + 测试缺陷 + 代码清理  
> 原则: 不修改源文件，仅做任务分配与冲突分析

---

## 一、原始文件快照

### 1.1 `src/repository/note-repository.ts` (line 324-327) — ORDER BY 拼接

```typescript
    // 排序
    const sortBy = params.sortBy ?? "createdAt";
    const sortDirection = params.sortDirection ?? "desc";
    query += ` ORDER BY ${sortBy} ${sortDirection}`;
```

**问题**: `sortBy` 和 `sortDirection` 直接拼接到 SQL，无白名单校验，存在注入风险。

---

### 1.2 `src/storage/db-schema.ts` (line 270-286) — PRAGMA/DROP 标识符

```typescript
    let isOld = false;
    try {
      if (oldColumn) {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        isOld = cols.some(c => c.name === oldColumn);
      } else {
        // ...
      }
    } catch { isOld = false; }
    
    if (isOld) {
      db.exec(`DROP TABLE IF EXISTS ${table};`);
    }
```

**问题**: `table` 变量直接拼接到 `PRAGMA table_info(...)` 和 `DROP TABLE` 中，虽来自内部常量数组，但无正则白名单校验。

---

### 1.3 `src/plugin/index.ts` (line 1066) — DatabaseSync 无 close 回调

```typescript
    const db = new DatabaseSync(config.databasePath);
    ensureZettelkastenSchema({ db });
```

**问题**: `db` 在 `register()` 中打开，但插件生命周期中未在 `stop()` 或等效回调中执行 `db.close()`。当前 `registerService` 的 `stop` 仅清理 `setInterval` timer。

---

### 1.4 `src/plugin/index.ts` (line 1787-1917) — setInterval(async) 未捕获 Promise 异常

```typescript
          timer = setInterval(async () => {
            const now = new Date();
            if (now.getHours() === 2 && now.getMinutes() === 0) {
              // 1. Nightly distillation
              try { ... } catch (err) { ... }
              // 2. Auto-archive zombies
              try { ... } catch (err) { ... }
              // ...更多阶段
            }
          }, intervalMs);
```

**问题**: `setInterval` 传入 `async` 回调函数。若回调内部抛出未捕获异常（例如 `now.getHours()` 之前发生错误），Promise rejection 不会被任何 `.catch()` 处理，可能导致 Node 进程 crash。

---

### 1.5 `src/plugin/index.ts` (line 1252-1255) — CLI WHERE 拼接

```typescript
            let sql = "SELECT id, title, type, status, folder, confidence, reviewed, created_at, updated_at FROM zettel_notes";
            if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
            sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
            values.push(opts.limit, opts.offset);

            const rows = db.prepare(sql).all(...values) as Array<Record<string, unknown>>;
```

**问题**: CLI `list` 命令直接拼接 SQL WHERE 子句，虽条件片段是硬编码的，但属于底层拼接模式，需抽象为查询构建器（或至少与 repository 层共用查询逻辑）。

---

### 1.6 `src/service/sample-curation-service.ts` (line 163-171) — exportPath 路径遍历

```typescript
    // 确保导出目录存在
    if (!fs.existsSync(this.config.exportPath)) {
      fs.mkdirSync(this.config.exportPath, { recursive: true });
    }

    // 生成文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `samples_${timestamp}.${format}`;
    const filePath = path.join(this.config.exportPath, filename);
```

**问题**: `this.config.exportPath` 未做边界校验，若被配置为系统敏感路径（如 `/etc`），`mkdirSync(..., { recursive: true })` 可能创建越权目录，且 `filePath` 可能写入非预期位置。

---

### 1.7 `src/service/distiller-service.ts` (line 90-98) — 非空断言

```typescript
      // Step 5: 执行决策并创建笔记
      const results = await this.executeDecisions(candidates);

      job.decisions = candidates.map((c) => c.llmDecision!);
      job.createdCount = results.created;
```

**问题**: `c.llmDecision!` 使用 TypeScript 非空断言 `!`。若 `deduplicate` 阶段未正确填充 `llmDecision`，运行时会得到 `undefined`，导致后续逻辑异常。需前置校验。

---

### 1.8 `src/integration/agent-config.ts` (line 14) — 死导入

```typescript
import type { ZettelkastenMCPServer } from "../mcp/server.js";
```

**问题**: 该类型在整个文件中未被引用，属于死导入。

---

### 1.9 `src/service/link-service.ts` (line 226-241) — 重复 reverseMap

```typescript
  private getReverseLinkType(type: LinkType): LinkType {
    const reverseMap: Record<string, LinkType> = {
      supports: "supported_by",
      supported_by: "supports",
      refines: "refined_by",
      refined_by: "refines",
      extends: "extended_by",
      extended_by: "extends",
      contradicts: "contradicted_by",
      contradicted_by: "contradicts",
      is_example_of: "has_example",
      has_example: "is_example_of",
      related: "related",
    };
    
    return (reverseMap[type] || type) as LinkType;
  }
```

**问题**: `src/core/utils.ts` 已存在完全相同的 `getReverseLinkType` 函数。`link-service.ts` 应直接导入复用，避免维护两份映射表。

---

### 1.10 `src/core/utils.ts` (line 242) — any 类型

```typescript
export function deepEqual(a: any, b: any): boolean {
```

**问题**: 参数类型应为 `unknown` 而非 `any`，以强化类型安全。

---

### 1.11 测试文件 beforeEach/afterEach 结构快照

#### `src/service/__tests__/archive-service.test.ts`
```typescript
import { describe, it, expect, beforeEach } from "vitest";
// ...
describe("ArchiveService", () => {
  let db: DatabaseSync;
  // ...
  beforeEach(() => {
    db = createTestDatabase();
    // ...
  });
  // ❌ 缺少 afterEach(() => closeTestDatabase(db))
```

#### `src/service/__tests__/prompt-evolution-service.test.ts`
```typescript
import { describe, it, expect, beforeEach } from "vitest";
// ...
describe("PromptEvolutionService", () => {
  let db: DatabaseSync;
  // ...
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    // 手动 CREATE TABLE ...
    service = new PromptEvolutionService(db);
  });
  // ❌ 缺少 afterEach(() => db.close())
```

#### `src/service/__tests__/sample-curation-service.test.ts`
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
// ...
describe("SampleCurationService", () => {
  let db: DatabaseSync;
  // ...
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    // ...
    service = new SampleCurationService(db, { ... });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    // ❌ 缺少 db.close()
  });
```

#### `src/service/__tests__/heatmap-service.test.ts`
```typescript
import { describe, it, expect, beforeEach } from "vitest";
// ...
describe("KnowledgeHeatmapService", () => {
  let db: DatabaseSync;
  // ...
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureZettelkastenSchema({ db });
    service = new KnowledgeHeatmapService(db);
    // 插入测试数据...
  });
  // ❌ 缺少 afterEach(() => db.close())
```

#### `src/mcp/__tests__/server.test.ts` — 工具数量描述与断言不一致
```typescript
    it("只读服务器应该返回7个工具", () => {
      // ...
      const tools = readonlyServer.getTools();
      expect(tools).toHaveLength(10);  // ❌ 描述说7，断言是10
```

#### `src/service/__tests__/link-service.test.ts` — setTimeout(2) flaky test
```typescript
  async function createNotes(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      // 小延迟避免 generateZettelId() 秒级时间戳冲突
      if (i > 0) await new Promise((r) => setTimeout(r, 2));  // ❌ 2ms 极易导致 ID 冲突
```

#### `src/service/__tests__/distiller-service.test.ts` — 幽灵断言
```typescript
      const job = await distillerService.distillMemoryFile("/test/memory.json", []);

      expect(job.status).toBe("completed");
      expect(job.summaryCount).toBeGreaterThanOrEqual(0);  // ❌ 幽灵断言：永远为真
```

---

### 1.12 console.* → logger 待清理清单

| 文件 | 行号 | 当前代码 | 建议 |
|------|------|----------|------|
| `src/index.ts` | 135 | `console.warn("Full-text search not available:", ...)` | 改为注入的 logger 或移除 |
| `src/index.ts` | 140 | `console.log(\`Zettelkasten initialized...\`)` | 改为 logger |
| `src/repository/note-repository.ts` | 38 | `console.warn("Atomicity check failed:", ...)` | 改为 logger（或通过返回值让上层记录） |
| `src/mcp/server.ts` | 636, 644 | `console.log("Zettelkasten MCP server started/stopped")` | 改为 logger 或删除 |
| `src/integration/session-hook.ts` | 132, 139, 152, 160, 200, 215, 227, 387 | 多处 `console.log/warn/error` | 统一改为 api.logger |
| `src/integration/zettelkasten-integration.ts` | 145, 152, 171, 176, 187, 204, 211, 224, 229, 250, 255, 279, 292 | 多处 `console.log/error` | 统一改为注入 logger |
| `src/storage/template-manager.ts` | 47, 63 | `console.error/warn` | 改为 logger 或抛出 |
| `src/integration/cron-scheduler.ts` | 172, 174, 176 | `console.error/warn/log` | 改为 logger |
| `src/service/feedback-service.ts` | 75, 83, 91, 99 | `console.log` | 改为 logger |
| `src/service/distiller-service.ts` | 308, 339, 451 | `console.warn/error` | 改为 logger |
| `src/service/note-service.ts` | 119, 353 | `console.error/warn` | 改为 logger |
| `src/service/prompt-evolution-service.ts` | 245 | `console.log` | 改为 logger |

---

## 二、任务分配表

### Worker A — 安全修复（Security & Stability）

| # | 文件 | 行号 | 修复内容 | 修复策略 |
|---|------|------|----------|----------|
| A1 | `src/repository/note-repository.ts` | 324-327 | ORDER BY 直接拼接 | 增加白名单校验：允许的 `sortBy` 字段限定为 `{"createdAt","updatedAt","title","confidence"}`；`sortDirection` 限定为 `{"asc","desc"}`。非法值回退到默认。 |
| A2 | `src/storage/db-schema.ts` | 273, 285 | PRAGMA/DROP 标识符无校验 | 对 `table` 增加正则白名单校验（如 `/^[a-zA-Z_][a-zA-Z0-9_]*$/`），不通过则抛出 `Error("Invalid table identifier")`。 |
| A3 | `src/plugin/index.ts` | 1066 | DatabaseSync 打开后无 `db.close()` | 在插件生命周期中注册 `stop()` 回调（或利用 `api.registerService` 的 `stop`）关闭数据库连接。注意 nightly service 已有 `stop` 只清理 timer，需确保 `db.close()` 在插件卸载时执行。 |
| A4 | `src/plugin/index.ts` | 1787-1917 | `setInterval(async)` 未处理 Promise reject | 将 `async () => {...}` 改为内部立即执行函数 `(async () => { ... })().catch(err => api.logger.error(...))`，或在外层增加 `process.on('unhandledRejection')` 不推荐；推荐把每个阶段已有的 `try/catch` 外再包一层总 `try/catch`，并确保 `setInterval` 回调本身不抛同步异常。 |
| A5 | `src/service/sample-curation-service.ts` | 163-171 | `exportPath` 路径遍历风险 | 对 `this.config.exportPath` 做边界校验：1) 解析为绝对路径；2) 检查是否落在允许的基目录内（或至少拒绝 `".."` 和根目录越界）；3) `mkdirSync` 前校验。 |
| A6 | `src/service/distiller-service.ts` | 95 | `c.llmDecision!` 非空断言 | 前置校验：`if (!c.llmDecision) { job.status = "failed"; ...; return job; }`。 |
| A7 | `src/plugin/index.ts` | 1252-1255 | CLI WHERE 拼接模式 | 将 CLI `list` 命令的 SQL 构建逻辑抽象为轻量查询构建器（或复用 `NoteRepository.search`），避免在 CLI action 中直接写原生 SQL。 |

### Worker B — 测试修复（Test Quality）

| # | 文件 | 行号 | 修复内容 | 修复策略 |
|---|------|------|----------|----------|
| B1 | `src/service/__tests__/archive-service.test.ts` | 全局 | 缺少 `afterEach db.close()` | 添加 `import { afterEach } from "vitest"; import { closeTestDatabase } from "..."; afterEach(() => { closeTestDatabase(db); });` |
| B2 | `src/service/__tests__/prompt-evolution-service.test.ts` | 全局 | 缺少 `afterEach db.close()` | 同上，直接调用 `db.close()`（该测试未使用 test-helpers）。 |
| B3 | `src/service/__tests__/sample-curation-service.test.ts` | 全局 | `afterEach` 缺少 `db.close()` | 在现有的 `afterEach` 末尾追加 `db.close();`。注意 `db` 是 `DatabaseSync`，需确保关闭顺序：先删目录再关 DB 或反之均可，但都要执行。 |
| B4 | `src/service/__tests__/heatmap-service.test.ts` | 全局 | 缺少 `afterEach db.close()` | 同上。 |
| B5 | `src/mcp/__tests__/server.test.ts` | 66 | 描述与断言不一致 | 将测试描述从 `"只读服务器应该返回7个工具"` 改为 `"只读服务器应该返回10个工具"`；同步检查 `"读写服务器应该返回15个工具"` 与 `toHaveLength(18)` 是否也需要修正。 |
| B6 | `src/service/__tests__/link-service.test.ts` | 36 | `setTimeout(2)` flaky | 将 `setTimeout(r, 2)` 改为确定性 ID 生成方式：在 `createTestNoteData` 中传入显式 `id`，绕过 `generateZettelId()` 的秒级冲突；或增大延迟到 `> 1000ms`，但推荐前者。 |
| B7 | `src/service/__tests__/distiller-service.test.ts` | 249 | 幽灵断言 `toBeGreaterThanOrEqual(0)` | 由于该测试期望生成 1 个 summary，改为 `expect(job.summaryCount).toBe(1)` 或 `toBeGreaterThan(0)`。 |

### Worker C — 代码清理（Code Cleanup）

| # | 文件 | 行号 | 修复内容 | 修复策略 |
|---|------|------|----------|----------|
| C1 | `src/integration/agent-config.ts` | 14 | 死导入 `ZettelkastenMCPServer` | 删除整行 `import type { ZettelkastenMCPServer } from "../mcp/server.js";`。 |
| C2 | `src/service/link-service.ts` | 226-241 | 重复 `reverseMap` | 删除 `getReverseLinkType` 私有方法，改为从 `src/core/utils.js` 导入 `getReverseLinkType` 并复用。注意 `core/utils.ts` 返回 `string`，需确认类型兼容（可添加 `as LinkType`）。 |
| C3 | 多处 | 见 1.12 节 | `console.*` → `logger` | 逐文件替换。策略：若文件所在层已有 `logger` 注入（如 plugin 的 `api.logger`、service 构造函数传入 logger），则使用之；若无，评估是否需要添加 `logger` 参数或改为静默处理。优先修改非示例/文档的源码文件。 |
| C4 | `src/core/utils.ts` | 242 | `deepEqual(a: any, b: any)` | 改为 `deepEqual(a: unknown, b: unknown): boolean`。 |

---

## 三、冲突检查报告

### 3.1 多 Worker 触及同一文件的冲突

| 文件 | 涉及 Worker | 冲突行号范围 | 冲突等级 | 建议处理顺序 |
|------|-------------|--------------|----------|--------------|
| `src/repository/note-repository.ts` | A (安全), C (清理) | A1: 324-327; C3: 38 | 🔶 低 | **先 A 后 C**。行号相距远（38 vs 324），无逻辑交叉，可安全串行。 |
| `src/service/distiller-service.ts` | A (安全), C (清理) | A6: 95; C3: 308,339,451 | 🔶 低 | **先 A 后 C**。A6 修改第 95 行，C3 修改第 308/339/451 行，无重叠。 |
| `src/plugin/index.ts` | A (安全) | A3: 1066; A4: 1787-1917; A7: 1252-1255 | 🔷 内部 | 仅 Worker A 内部，无跨 Worker 冲突。 |

### 3.2 无冲突文件（可并行）

- **Worker A 独占**: `src/storage/db-schema.ts`, `src/service/sample-curation-service.ts`
- **Worker B 独占**: 全部 7 个测试文件
- **Worker C 独占**: `src/integration/agent-config.ts`, `src/service/link-service.ts`, `src/core/utils.ts`, `src/index.ts`, `src/mcp/server.ts`, `src/integration/session-hook.ts`, `src/integration/zettelkasten-integration.ts`, `src/storage/template-manager.ts`, `src/integration/cron-scheduler.ts`, `src/service/feedback-service.ts`, `src/service/note-service.ts`, `src/service/prompt-evolution-service.ts`

### 3.3 依赖顺序建议

1. **Worker A 优先启动**（安全修复影响运行时行为，是根基）。
2. **Worker B 可与 Worker A 并行启动**（测试文件与源码文件无交叉）。
3. **Worker C 在 Worker A 完成后启动**（C 需要修改 A 已修改的 2 个文件，避免 rebase）。
4. 若 CI 环境允许，最优并行策略：
   - **阶段 1**: Worker A + Worker B 并行
   - **阶段 2**: Worker C（基于阶段 1 的最新代码）

---

## 四、验证清单

### Worker A 验证项

| # | 验证项 | 验证方法 |
|---|--------|----------|
| A1 | ORDER BY 白名单生效 | 单元测试：传入非法 `sortBy="1; DROP TABLE"`，断言抛出异常或回退默认；传入合法字段，断言 SQL 正常。 |
| A2 | PRAGMA/DROP 标识符白名单生效 | 单元测试：传入非法表名（含空格或注入字符），断言 `ensureZettelkastenSchema` 抛出 `Invalid table identifier`。 |
| A3 | 插件 stop 时 db 正确关闭 | 集成测试：Mock `api.registerService` 的 `stop` 回调，调用后断言 `db` 状态已关闭（再次 prepare 抛出 `database is closed`）。 |
| A4 | setInterval 异常不导致进程退出 | 手动/单元测试：在 `setInterval` 回调中抛出一个同步错误，断言错误被 `api.logger.error` 捕获，进程未退出。 |
| A5 | exportPath 越界被拒绝 | 单元测试：传入 `exportPath="/etc/passwd"`，断言 `exportSamples` 抛出路径遍历异常。 |
| A6 | `llmDecision` 缺失时优雅失败 | 单元测试：Mock `deduplicate` 返回 `llmDecision: undefined`，断言 `distillMemoryFile` 返回 `status: "failed"` 且 `job.error` 有内容。 |
| A7 | CLI list 不再直接拼接 WHERE | 代码审查：CLI action 中不再出现 `" WHERE " + conditions.join(" AND ")`，改为调用统一查询接口。 |

### Worker B 验证项

| # | 验证项 | 验证方法 |
|---|--------|----------|
| B1-B4 | 测试后数据库连接关闭 | 运行 `npx vitest run <对应测试文件>`，在 `--reporter=verbose` 下观察无 `"database is locked"` 或句柄泄漏警告；或在测试末尾注入 `expect(db.prepare("SELECT 1")).toThrow()` 验证已关闭。 |
| B5 | 描述与断言一致 | 运行 `npx vitest run src/mcp/__tests__/server.test.ts`，全部通过；审查代码中 `"返回7个工具"` 已改为 `"返回10个工具"`。 |
| B6 | `createNotes` 不再 flaky | 运行 `npx vitest run src/service/__tests__/link-service.test.ts` 连续 10 次，无 ID 冲突失败。 |
| B7 | 幽灵断言消除 | 审查 `distiller-service.test.ts` 中 `toBeGreaterThanOrEqual(0)` 已改为 `toBe(1)` 或 `toBeGreaterThan(0)`；测试仍通过。 |

### Worker C 验证项

| # | 验证项 | 验证方法 |
|---|--------|----------|
| C1 | 死导入已删除 | `grep -n "ZettelkastenMCPServer" src/integration/agent-config.ts` 无结果；编译通过（`tsc --noEmit`）。 |
| C2 | `link-service.ts` 复用 `core/utils.ts` | `grep -n "getReverseLinkType" src/service/link-service.ts` 显示为 `import { getReverseLinkType } from "../core/utils.js"`；`link-service.ts` 中无 `reverseMap` 定义；测试通过。 |
| C3 | console.* 已替换为 logger | 对每文件执行 `grep -n "console\." src/<file>`，结果为空（排除 `console` 为变量名的情况）；运行对应测试通过。 |
| C4 | `deepEqual` 参数类型为 `unknown` | `grep -n "deepEqual" src/core/utils.ts` 显示 `deepEqual(a: unknown, b: unknown)`；编译通过。 |

---

## 五、执行检查点（Checkpoints）

- [ ] Worker A 完成所有安全修复并自测通过
- [ ] Worker B 完成所有测试修复并 `vitest run` 全量通过
- [ ] Worker C 完成所有清理并 `tsc --noEmit` 通过
- [ ] 冲突文件（`note-repository.ts`, `distiller-service.ts`）已按 A→C 顺序合并
- [ ] 全量测试套件 `npm test` 通过
- [ ] Coordinator 最终复核：对比本计划与实际 diff，确认无遗漏、无额外修改

