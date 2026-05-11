# Changelog

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
