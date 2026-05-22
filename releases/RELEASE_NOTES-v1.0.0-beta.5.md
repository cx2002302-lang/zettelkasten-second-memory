# Release v1.0.0-beta.5

**Release Date**: 2026-05-16

## Downloads

| File | Size | Description |
|------|------|-------------|
| `zettelkasten-plugin-2026.5.16-v1.0.0-beta.5.tar.gz` | 3.1 MB | Full plugin source code |
| `zettelkasten-skill-v1.0.0-beta.5.tar.gz` | 6.4 KB | Brain Skill (PROMPT + SKILL) |

## What's New

### Phase 5 Evolution System

10 new MCP tools for knowledge base self-improvement:

| Tool | Type | Description |
|------|------|-------------|
| `zk_get_review_panel` | Read | Get pending review panel |
| `zk_submit_review` | Write | Submit a review for a note |
| `zk_get_review_stats` | Read | Review statistics dashboard |
| `zk_submit_feedback` | Write | Submit user feedback |
| `zk_get_feedback_stats` | Read | Feedback statistics |
| `zk_analyze_feedback_trends` | Read | Trend analysis over time |
| `zk_get_active_prompt` | Read | Current active prompt version |
| `zk_get_prompt_stats` | Read | Prompt evolution statistics |
| `zk_get_curation_stats` | Read | Sample curation statistics |
| `zk_export_samples` | Write | Export curated samples |

5 new CLI commands:
- `openclaw zk review-stats`
- `openclaw zk review-pending`
- `openclaw zk feedback-stats`
- `openclaw zk prompt-stats`
- `openclaw zk curation-stats`

### Database Schema

4 new tables:
- `zettel_prompt_versions` — Prompt version history with quality scoring
- `zettel_sample_curations` — CEQRC sample quality assessment (6 dimensions)
- `zettel_system_tunings` — System parameter tuning history
- `zettel_export_batches` — Sample export batch tracking

### Documentation Overhaul

- Full `SKILL.md` (6,551 bytes) + `PROMPT.md` (7,737 bytes) with use cases and examples
- `details/` folder with compact versions for progressive disclosure
- `docs/` folder with 9 feature documents (README + 01-09)

### Concurrency Safety

Verified under rapid-fire parallel operations:
- 20 notes created in 194ms (9.7ms each)
- 20 feedback submitted in 68ms (3.4ms each)
- 10 links created (18 records with bidirectional) in 97ms
- 20 reviews submitted in 31ms (1.6ms each)
- Zero duplicate IDs, zero orphaned records, zero data inconsistency

### Bug Fixes

- **ZK-BUG-003**: `deploy.sh` alsoAllow cleanup incorrectly removed `"zettelkasten"` plugin ID
- **Schema Alignment**: 3 Phase 5 tables DDL fixed to match Repository code
- **Old Schema Migration**: Auto-detect and recreate tables with stale columns on `zk init`

## Test Results

- **Unit Tests**: 689/689 passing (26 files)
- **Agent E2E**: 7/7 rounds passed
- **Production Deployment**: Verified with 143 notes, 70 links, 543 feedback, 292 reviews
- **Health Check**: 17 OK, 0 WARN, 0 FAIL

## Requirements

- **Node.js**: >= 22.14.0 (for `node:sqlite`)
- **OpenClaw**: >= 2026.4.23 (2026.4.24 tested)

## Upgrade from beta.4

```bash
# Pull latest code
git pull origin main

# Re-deploy
bash scripts/deploy.sh

# Restart Gateway
openclaw gateway restart

# Health check
openclaw zk doctor
```

## Full Changelog

See [CHANGELOG.md](../CHANGELOG.md)
