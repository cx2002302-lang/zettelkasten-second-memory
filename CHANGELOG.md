# Changelog

## v1.0.0-beta.7 — Security Hardening + Code Quality + Test Expansion

**Release Date**: 2026-05-22

### 🛡️ Security Fixes

- **SQL Injection Whitelist** — All raw SQL queries now use strict column-name whitelists to prevent injection via user-controlled `orderBy`/`sortBy` parameters
- **Path Traversal Protection** — File system operations validate and sanitize paths to block directory traversal attacks
- **Database Connection Safety** — Added explicit `db.close()` calls in all repository and service layers to prevent connection leaks
- **Promise Rejection Handling** — Unhandled Promise rejections in async flows are now properly caught and logged

### 🧹 Code Quality

- **Magic Numbers Eliminated** — Extracted 20+ magic numbers into named constants (`src/core/constants.ts`) for maintainability
- **Console Cleanup** — Removed all stray `console.log`/`console.error` calls; replaced with structured logging or removed entirely
- **Type Safety Enhancement** — Strengthened TypeScript strictness: added explicit return types, fixed `any` usages, tightened null checks
- **Dead Code Removal** — Deleted unused imports and obsolete helper functions across 12 files
- **Utility Reuse** — Consolidated duplicated validation logic into shared utility functions (`src/core/utils.ts`)
- **Promise.allSettled Adoption** — Replaced fragile `Promise.all` + manual error handling with `Promise.allSettled` for bulk operations

### 🧪 Test Coverage

- **862 tests passing**, 36 test files, 0 failures (was 689)
- **173 new test cases** added across 10 new test files:
  - `src/service/phase6/__tests__/audit-service.test.ts`
  - `src/service/phase6/__tests__/moc-service.test.ts`
  - `src/service/phase6/__tests__/serendipity-service.test.ts`
  - `src/mcp/__tests__/phase6-tools.test.ts`
- Security regression tests for SQL whitelist and path sanitization
- Boundary case coverage for new Phase 6 MCP tools

### 📦 Architecture

- Phase 6 services stabilized: `audit-service`, `moc-service`, `serendipity-service`
- MCP tool registry updated with Phase 6 endpoints
- Plugin manifest (`openclaw.plugin.json`) aligned with latest tool surface

---

## v1.0.0-beta.6 — Auto-Review + Distillation Quality Guard + Memory Format Fix

**Release Date**: 2026-05-21

### ✨ New Features

- **Nightly Auto-Review** — Plugin cron now automatically reviews Inbox notes at 2:00 AM
  - High-quality notes (confidence ≥ 0.7 + content length ≥ 200): auto-approved → `zettels`
  - Low-quality notes (quality < 0.4): auto-flagged → stays in `inbox` with review record
  - Medium-quality notes: kept in `inbox` for human review
  - `ReviewService.autoReviewInbox()` processes up to 100 pending notes per run

- **Distillation Quality Guard** — 6-layer content validation prevents placeholder notes from entering the database
  - Empty title rejection
  - Minimum 50-character content requirement
  - Placeholder title detection (9 patterns: `Memory entry X`, `Untitled`, `Note X`, etc.)
  - Metadata-only content detection
  - Title-content identical check
  - Meaningful word count validation (≥ 5 words)

- **Markdown Memory Format Support** — `MemoryParser` now supports `.md` memory logs in addition to `.json`
  - Auto-detects file extension and selects appropriate parser
  - Falls back from `.json` to `.md` when JSON file is missing
  - Parses Markdown sections (`## Entry`) with Type/Time/Content fields

### 🔧 Bug Fixes

- **Distillation Empty Content**: LLM-generated summaries with only metadata (e.g., `> 来源：Professional > 时间：... > 权重：X`) are now rejected at creation time instead of polluting the database
- **Inbox Accumulation**: 120 unreviewed notes accumulated because `autoReview()` existed but was never called by the plugin. Fixed by adding auto-review step to nightly cron
- **PR#1 Merged**: Accepted kriptoburak's placeholder URL fix (`YOUR_USERNAME` → `cx2002302-lang`) after TweetClaw promotional content was removed

### 🧹 Data Cleanup

- Cleaned 33 empty/placeholder notes (source=`distilled`, content only metadata) from production database
- Post-cleanup state: 129 notes | 0 inbox backlog | 17/17 health checks passing

### 🧪 Test Coverage

- **689 tests passing**, 26 test files, 0 failures
- Auto-review verified with 3-tier test: high-quality→approve, medium→flag/skip, low→flag

---

## v1.0.0-beta.5 — Phase 5 Evolution System + Concurrency Safety + Documentation Overhaul

**Release Date**: 2026-05-16

### ✨ New Features

- **Phase 5 Evolution System** — 10 new MCP tools + 5 new CLI commands
  - Review system: `zk_get_review_panel`, `zk_submit_review`, `zk_get_review_stats`
  - Feedback system: `zk_submit_feedback`, `zk_get_feedback_stats`, `zk_analyze_feedback_trends`
  - Prompt evolution: `zk_get_active_prompt`, `zk_get_prompt_stats`
  - Sample curation: `zk_get_curation_stats`, `zk_export_samples`
  - CLI: `zk review-stats`, `zk review-pending`, `zk feedback-stats`, `zk prompt-stats`, `zk curation-stats`

- **Database Schema** — 4 new tables for evolution tracking
  - `zettel_prompt_versions` — Prompt version history with quality scoring
  - `zettel_sample_curations` — CEQRC sample quality assessment (6 dimensions)
  - `zettel_system_tunings` — System parameter tuning history
  - `zettel_export_batches` — Sample export batch tracking

- **Documentation Overhaul** — Complete documentation system rebuilt
  - Full `SKILL.md` (6551 bytes) + `PROMPT.md` (7737 bytes) with use cases and examples
  - `details/` folder with compact versions for progressive disclosure
  - `docs/` folder with 9 feature documents (README + 01-09)

- **Concurrency Safety** — Verified under rapid-fire parallel operations
  - 20 notes + 20 feedback + 10 links (bidirectional = 18) + 20 reviews
  - Zero duplicate IDs, zero orphaned records, zero data inconsistency

### 🔧 Bug Fixes

- **ZK-BUG-003**: `deploy.sh` alsoAllow cleanup incorrectly removed `"zettelkasten"` plugin ID, causing MCP tools to become invisible to agents. Fixed by adding `or x == 'zettelkasten'` to the filter condition.
- **Schema Alignment**: 3 Phase 5 tables (`zettel_prompt_versions`, `zettel_sample_curations`, `zettel_system_tunings`) had DDL fields mismatched with Repository code. Fixed DDL to match runtime expectations.
- **Old Schema Migration**: Auto-detect and recreate tables with stale column definitions on `zk init`.

### 🧪 Test Coverage

- **689 tests passing**, 26 test files, 0 failures
- Agent E2E: **7/7 rounds passed** (boundary cases, composition, Phase 5, error recovery, intelligence, Chinese search, concurrency)
- Production deployment verified: 143 notes, 70 links, 543 feedback, 292 reviews
- All 28 MCP tools callable via OpenClaw Agent

---

## v1.0.0-beta.4 — Test Suite + Input Validation + Performance Benchmark

**Release Date**: 2026-05-12

### ✨ New Features

- **Performance Benchmark Suite** (`scripts/benchmark.mjs`)
  - Tested at 1K / 5K / 10K notes scale
  - All 7 performance thresholds passed at 10K scale
  - FTS search 1.9ms, single note read 0.08ms, glow recalc 1,013ms
  - Full report: `plans/PERFORMANCE-BENCHMARK.md`

- **E2E Tool Chain Test** (`scripts/e2e-tool-test.mjs`)
  - End-to-end validation of all 16 MCP tool flows
  - Covers create, search, link, glow, path, heatmap, archive, review, feedback

### 🛡️ Input Validation

- **NoteService**: Reject empty title/content, confidence must be 0-1 (create + update)
- **LinkService**: Reject self-links, validate link type against 11 allowed values
- **HeatmapService**: Clamp `glowMin` to [0,1], normalize negative `limit` to 0

### 🔧 Bug Fixes

- **ZK-BUG-001**: `tools.alsoAllow` 放入 Skill ID（如 `"zettelkasten-brain"`）导致 OpenClaw Gateway 工具策略验证失败，引发崩溃-重启循环。修复：`deploy.sh` 自动清理 alsoAllow 中的非 `zk_` 前缀条目；`AGENTS.md` 明确文档说明。
- **ZK-BUG-002**: `SKILL.md` 缺少 YAML frontmatter，可能影响 Skill 加载。修复：添加标准 frontmatter（name, description, version）。
- **archive-service.ts**: `zombie.folder` field did not exist in `GlowMetrics`, causing already-archived notes to be re-processed. Fixed by querying `zettel_notes.folder` directly.
- **feedback-repository.ts**: `source` field could be `undefined`, causing SQLite binding error. Fixed with `source ?? null`.
- **feedback-repository.ts**: `rating` returned `null` from DB but type expected `undefined`. Fixed with `row.rating ?? undefined`.
- **feedback-service.test.ts**: Time race condition in `analyzeTrends` test — `now` created before `submitFeedback`, causing feedback `created_at` to be later than query end time. Fixed by using `tomorrow` as end boundary.

### 🧪 Test Coverage

- **689 tests passing**, 26 test files, 0 failures
- New test files: `feedback-repository.test.ts` (25), `review-repository.test.ts` (20), `archive-service.test.ts` (14)
- Heatmap boundary tests: empty DB, empty filters, negative limit, glowMin overflow
- Input validation tests: empty strings, out-of-range confidence, self-links, invalid types

---

## v1.0.0-beta.3 — Wave 3: Knowledge Heatmap & Network Graph

**Release Date**: 2026-05-11

### ✨ New Features

- **Knowledge Heatmap** (`zk_heatmap`)
  - Real-time knowledge base activity analysis
  - Folder distribution, glow score distribution, connection density ranking
  - Isolated notes detection, recent activity tracking
  - CLI: `openclaw zk heatmap --days 30`

- **Network Graph Visualization** (`zk_network_graph`)
  - Export knowledge graph as JSON with nodes and edges
  - Support folder filter, glow score threshold, node limit
  - Degree calculation and weighted edge rendering
  - CLI: `openclaw zk graph-export --limit 200 --glow-min 0.4`

- **18 MCP Tools** (9 read-only + 9 read-write)
  - Read-only: `zk_search_notes`, `zk_get_note`, `zk_get_backlinks`, `zk_find_path`, `zk_glow_ranking`, `zk_find_zombies`, `zk_search_archived`, `zk_get_archive_log`, `zk_knowledge_heatmap`, `zk_network_graph`
  - Read-write: `zk_create_note`, `zk_update_note`, `zk_archive_note`, `zk_unarchive_note`, `zk_run_ceqrc_workflow`, `zk_distill_memory`, `zk_get_inbox_queue`, `zk_review_note`

### 🔧 Bug Fixes

- **Commander.js `parseInt`/`parseFloat` NaN bug**: Option handler signature `(value, previous)` caused `parseInt("10", 200)` → `NaN` → SQLite `datatype mismatch`. Fixed with `safeParseInt`/`safeParseFloat` wrappers and `Number.isFinite()` validation.

### 🧪 Test Coverage

- Agent E2E: **34/34 passed** (CLI + MCP handlers + plugin config)
- Unit tests: **112/112 passed** (heatmap-service, note-service)

---

## v1.0.0-beta.2 — Wave 2: Auto-Archive & Knowledge Health

**Release Date**: 2026-05-10

### ✨ New Features

- **Auto-Archive Scheduling**: Cron-based zombie note detection and archiving
- **Archive History**: Full log of archive/unarchive operations with timestamps
- **Timestamp Preservation**: Archived notes retain original creation/update times
- **Archive Service**: `archive-service.ts` with dry-run support

---

## v1.0.0-beta.1 — Wave 1: Knowledge Glow & Path Search

**Release Date**: 2026-05-09

### ✨ New Features

- **Knowledge Glow Score**: CEQRC engine with confidence, entropy, quality, recency, connections
- **Path Finder**: Bidirectional BFS for shortest knowledge path between notes
- **Archive Mechanism**: Manual archive/unarchive with folder migration
- **FTS Search**: Full-text search with SQLite FTS5
