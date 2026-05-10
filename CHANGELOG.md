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

## [1.0.0-beta.1] - 2026-05-11

### Added
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
| v1.0.0-beta.1 | 2026-05-11 | 🚧 Beta — First public release |

---

**Full Changelog**: 查看 GitHub [Releases](https://github.com/YOUR_USERNAME/zettelkasten-second-memory/releases) 页面
