# Release v1.0.0-beta.6

**Release Date**: 2026-05-21

## Downloads

| File | Size | Description |
|------|------|-------------|
| `zettelkasten-plugin-2026.5.21-v1.0.0-beta.6.tar.gz` | 3.1 MB | Full plugin source code |
| `zettelkasten-skill-v1.0.0-beta.6.tar.gz` | 6.4 KB | Brain Skill (PROMPT + SKILL) |

## What's New

### 🌙 Nightly Auto-Review

The plugin cron now automatically processes Inbox notes every night at 2:00 AM:

| Quality | Criteria | Action |
|---------|----------|--------|
| High | confidence ≥ 0.7 + content ≥ 200 chars | **Auto-approve** → `zettels` |
| Low | quality score < 0.4 | **Auto-flag** → stays in `inbox` |
| Medium | 0.4 ≤ quality < 0.7 | **Skip** → keep in `inbox` for human review |

- `ReviewService.autoReviewInbox()` processes up to 100 pending notes per run
- Quality score = confidence + content-length bonus/penalty

### 🛡️ Distillation Quality Guard

6-layer validation prevents placeholder notes from entering the database:

1. **Empty title** rejection
2. **Minimum 50-character** content requirement
3. **Placeholder title detection** (9 patterns):
   - `Memory entry X`, `Entry X`, `Note X`
   - `Untitled`, `No title`, `Item X`
   - `Log entry`, `Record X`, pure numbers
4. **Metadata-only content** detection
5. **Title-content identical** check
6. **Meaningful word count** validation (≥ 5 words > 2 chars)

### 📝 Markdown Memory Format Support

`MemoryParser` now supports `.md` memory logs in addition to `.json`:
- Auto-detects file extension
- Falls back from `.json` to `.md` when JSON is missing
- Parses Markdown sections (`## Entry`) with Type/Time/Content fields

## Bug Fixes

- **Distillation Empty Content**: LLM summaries with only metadata (`> 来源：Professional > 时间：... > 权重：X`) are now rejected at creation time
- **Inbox Accumulation**: Fixed 120-note backlog caused by `autoReview()` never being called. Now integrated into nightly cron
- **PR#1 Merged**: Accepted placeholder URL fix from @kriptoburak after promotional content was removed

## Data Cleanup

- Removed **33 empty/placeholder notes** (source=`distilled`, content = metadata only)
- Post-cleanup state: **129 notes | 0 inbox backlog | 17/17 health checks passing**

## Test Results

- **Unit Tests**: 689/689 passing (26 files)
- **Auto-review verified**: high→approve, medium→skip, low→flag
- **Health Check**: 17 OK, 0 WARN, 0 FAIL

## Requirements

- **Node.js**: >= 22.14.0 (for `node:sqlite`)
- **OpenClaw**: >= 2026.4.23 (2026.4.24 tested)

## Upgrade from beta.5

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
