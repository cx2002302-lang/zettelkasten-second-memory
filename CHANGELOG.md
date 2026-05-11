# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/lang/zh-CN/spec/v2.0.0.html).

## [Unreleased]

### Planned
- [ ] English documentation completion
- [ ] Interactive web dashboard for knowledge graph visualization
- [ ] Plugin marketplace submission

---

## [1.0.0-beta.2] - 2026-05-11

### Added — Wave 2: Auto-Archive & Knowledge Health
- 🧟 **Zombie note detection** — Identify stale notes (180+ days, zero backlinks) via `zk_find_zombies`
- ✨ **Knowledge glow ranking** — PageRank + citation + recency decay scoring via `zk_glow_ranking`
- 🔎 **Weighted path discovery** — BFS shortest path with link-type weights and Chinese explanations via `zk_find_path`
- 📦 **Archive system** — Move notes to `archive` folder with `zk_archive_note` / `zk_unarchive_note`
- 🌙 **Auto-archive scheduler** — Nightly scan & auto-archive zombie notes at 2:00 AM
- 📜 **Archive audit log** — Full history of archive/unarchive/auto_archive actions via `zk_get_archive_log` / `zk archive-log`
- ⏱️ **Timestamp preservation** — Archive/unarchive operations no longer refresh `updated_at`
- 🔍 **Archived note search** — Dedicated `zk_search_archived` for finding archived content
- 🛠️ **New CLI commands** — `zk auto-archive`, `zk archive-log`

### Fixed
- Plugin now properly registers all 16 MCP tools (5 Wave 1 tools were missing from `plugin/index.ts`)

---

## [1.0.0-beta.1] - 2026-05-11

### Added — Wave 1: Core Foundation
- 📝 **Atomic note-taking system** — Three note types: `atomic`, `structure`, `source`
- 🔗 **11 semantic link types** — `supports`, `refines`, `extends`, `contradicts`, `is_example_of`, `related` and their reverse relations
- 🔍 **Full-text search engine** — SQLite FTS5 + LIKE dual-engine merge search with Chinese support
- 🤖 **OpenClaw MCP integration** — 10 MCP tools for AI agents to read/write the knowledge base
- 🔄 **CEQRC cognitive pipeline** — Confidence-routed inbox processing with nightly distillation
- 🏷️ **Tag system** — Tag creation, association, and statistical analysis
- 📦 **Markdown persistence** — All notes stored as `.md` files, database only holds metadata and links
- 🧠 **Brain Skill** — AI Skill with prompt evolution, feedback loops, and 5-version archive rotation
- 🛠️ **CLI commands** — `zk init`, `zk doctor`, `zk status`, `zk new`, `zk list`, `zk search`, `zk show`, `zk link`
- 🌙 **Nightly cron scheduler** — Automatic CEQRC distillation at 2:00 AM daily
- 📎 **Session hook** — Auto-archive session memories when conversations end
- ✅ **Test suite** — 20+ test files covering repository, service, integration, and MCP layers

### Technical
- Node.js 22+ with native `node:sqlite`
- TypeScript ESM modules
- Plugin manifest: `activation.onStartup` (required for MCP tool registration)
- Configurable confidence thresholds for inbox routing

---

## Release History

| Version | Date | Status |
|---------|------|--------|
| v1.0.0-beta.2 | 2026-05-11 | 🚧 Beta — Wave 2: Auto-archive & knowledge health |
| v1.0.0-beta.1 | 2026-05-11 | 🚧 Beta — First public release |

---

**Full Changelog**: 查看 GitHub [Releases](https://github.com/YOUR_USERNAME/zettelkasten-second-memory/releases) 页面
