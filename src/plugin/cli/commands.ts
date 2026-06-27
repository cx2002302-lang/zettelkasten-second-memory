import { existsSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { LinkType, QueryNotesParams } from "../../core/types.js";
import { ensureZettelkastenSchema, getDatabaseStats } from "../../storage/db-schema.js";
import type { ZettelkastenPluginConfig } from "../config.js";
import type { ZettelkastenServices } from "../lifecycle.js";

const safeParseInt = (v: string) => parseInt(v, 10);
const safeParseFloat = (v: string) => parseFloat(v);

export function registerCLICommands(
  api: any,
  db: DatabaseSync,
  services: ZettelkastenServices,
  config: ZettelkastenPluginConfig,
) {
  const {
    noteService,
    linkService,
    archiveService,
    heatmapService,
    reviewService,
    feedbackService,
    promptEvolutionService,
    sampleCurationService,
    serendipityService,
    mocService,
    auditService,
  } = services;

  api.registerCli(
    ({ program }: { program: any }) => {
      const zk = program
        .command("zk")
        .description("Zettelkasten second memory system commands");

      zk
        .command("init")
        .description("Initialize Zettelkasten database and directory structure")
        .action(async () => {
          if (!existsSync(config.notesDir)) {
            mkdirSync(config.notesDir, { recursive: true });
            api.logger.info(`[zettelkasten] Created notes directory: ${config.notesDir}`);
          }

          const schemaResult = ensureZettelkastenSchema({ db, ftsEnabled: true });

          const requiredTables = [
            "zettel_meta", "zettel_notes", "zettel_tags",
            "zettel_note_tags", "zettel_links",
            "zettel_reviews", "zettel_feedback", "zettel_prompt_versions",
            "zettel_sample_curations", "zettel_system_tunings", "zettel_feedback_stats", "zettel_export_batches",
          ];
          const missing: string[] = [];
          for (const table of requiredTables) {
            const row = db.prepare(
              `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
            ).get(table);
            if (!row) missing.push(table);
          }

          if (missing.length > 0) {
            api.logger.error(`[zettelkasten] Missing tables: ${missing.join(", ")}`);
          } else {
            api.logger.info(`[zettelkasten] All ${requiredTables.length} tables verified`);
          }

          api.logger.info(`[zettelkasten] Database: ${config.databasePath}`);
          api.logger.info(`[zettelkasten] Notes dir: ${config.notesDir}`);
          api.logger.info(`[zettelkasten] FTS available: ${schemaResult.ftsAvailable}`);
          if (schemaResult.ftsError) {
            api.logger.warn(`[zettelkasten] FTS warning: ${schemaResult.ftsError}`);
          }
        });

      zk
        .command("stats")
        .description("Show Zettelkasten statistics")
        .action(async () => {
          const stats = getDatabaseStats(db);
          api.logger.info(`[zettelkasten] Notes: ${stats.notes}`);
          api.logger.info(`[zettelkasten] Links: ${stats.links}`);
          api.logger.info(`[zettelkasten] Tags: ${stats.tags}`);
          api.logger.info(`[zettelkasten] Note-Tag associations: ${stats.noteTags}`);
          api.logger.info(`[zettelkasten] Database: ${config.databasePath}`);
          api.logger.info(`[zettelkasten] Notes dir: ${config.notesDir}`);
        });

      zk
        .command("new")
        .description("Create a new Zettelkasten note")
        .requiredOption("--title <title>", "Note title")
        .requiredOption("--content <content>", "Note content (markdown)")
        .option("--tags <tags>", "Comma-separated tags")
        .option("--confidence <n>", "Confidence score 0-1", safeParseFloat)
        .option("--source <source>", "Source type", "manual")
        .option("--folder <folder>", "Override folder (inbox/references/zettels/archive)")
        .option("--status <status>", "Lifecycle status (FLEETING/LITERATURE/PERMANENT)")
        .action(async (opts: any) => {
          const tags = opts.tags
            ? (opts.tags as string).split(",").map((t: string) => t.trim()).filter(Boolean)
            : undefined;
          try {
            const note = await noteService.createNote(
              { title: opts.title, content: opts.content, tags, folder: opts.folder, status: opts.status },
              { confidence: opts.confidence, source: opts.source },
            );
            api.logger.info(`[zettelkasten] Created note: ${note.id} -> ${note.folder}`);
            api.logger.info(`  Title: ${note.title}`);
            api.logger.info(`  Type: ${note.type} | Status: ${note.status}`);
            api.logger.info(`  Confidence: ${note.confidence ?? "N/A"}`);
            if (note.tags.length > 0) api.logger.info(`  Tags: ${note.tags.join(", ")}`);
          } catch (err) {
            api.logger.error(`[zettelkasten] Failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        });

      zk
        .command("list")
        .description("List notes with optional filters")
        .option("--folder <folder>", "Filter by folder (inbox/references/zettels)")
        .option("--status <status>", "Filter by status (FLEETING/LITERATURE/PERMANENT)")
        .option("--tag <tag>", "Filter by tag")
        .option("--limit <n>", "Max results", safeParseInt, 20)
        .option("--offset <n>", "Offset for pagination", safeParseInt, 0)
        .action(async (opts: any) => {
          const conditions: string[] = [];
          const values: unknown[] = [];

          const validFolders = ["inbox", "references", "zettels", "archive"];
          const validStatuses = ["FLEETING", "LITERATURE", "PERMANENT"];

          if (opts.folder) {
            if (!validFolders.includes(opts.folder)) {
              api.logger.error(`[zettelkasten] Invalid folder: ${opts.folder}. Valid: ${validFolders.join(", ")}`);
              return;
            }
            conditions.push("folder = ?");
            values.push(opts.folder);
          }
          if (opts.status) {
            if (!validStatuses.includes(opts.status)) {
              api.logger.error(`[zettelkasten] Invalid status: ${opts.status}. Valid: ${validStatuses.join(", ")}`);
              return;
            }
            conditions.push("status = ?");
            values.push(opts.status);
          }
          if (opts.tag) {
            conditions.push(`id IN (SELECT note_id FROM zettel_note_tags WHERE tag_id IN (SELECT id FROM zettel_tags WHERE name = ?))`);
            values.push(opts.tag);
          }

          let sql = "SELECT id, title, type, status, folder, confidence, reviewed, created_at, updated_at FROM zettel_notes";
          if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
          sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
          values.push(opts.limit, opts.offset);

          const rows = db.prepare(sql).all(...values) as Array<Record<string, unknown>>;
          if (rows.length === 0) {
            api.logger.info("[zettelkasten] No notes found");
          } else {
            for (const row of rows) {
              api.logger.info(
                `[${row.id}] ${row.title} | ${row.folder} | ${row.status} | conf:${row.confidence ?? "-"}`,
              );
            }
            api.logger.info(`[zettelkasten] ${rows.length} note(s) shown`);
          }
        });

      zk
        .command("search")
        .description("Full-text search across notes")
        .argument("<query>", "Search query")
        .option("--limit <n>", "Max results", safeParseInt, 20)
        .option("--folder <folder>", "Filter by folder (inbox/references/zettels/archive)")
        .option("--tag <tag>", "Filter by tag (repeatable)", (v: string, prev: string[]) => prev.concat([v]), [])
        .option("--min-confidence <n>", "Minimum confidence", safeParseFloat)
        .option("--max-confidence <n>", "Maximum confidence", safeParseFloat)
        .option("--created-after <date>", "Created after (ISO 8601)")
        .option("--created-before <date>", "Created before (ISO 8601)")
        .option("--updated-after <date>", "Updated after (ISO 8601)")
        .option("--updated-before <date>", "Updated before (ISO 8601)")
        .action(async (query: string, opts: any) => {
          const filters: Partial<QueryNotesParams> = {};
          if (opts.folder) filters.folder = opts.folder;
          if (opts.tag && opts.tag.length > 0) filters.tags = opts.tag;
          if (opts.minConfidence !== undefined) filters.minConfidence = opts.minConfidence;
          if (opts.maxConfidence !== undefined) filters.maxConfidence = opts.maxConfidence;
          if (opts.createdAfter) filters.createdAfter = opts.createdAfter;
          if (opts.createdBefore) filters.createdBefore = opts.createdBefore;
          if (opts.updatedAfter) filters.updatedAfter = opts.updatedAfter;
          if (opts.updatedBefore) filters.updatedBefore = opts.updatedBefore;

          const results = await noteService.searchNotes(query, opts.limit, {
            filters: Object.keys(filters).length > 0 ? filters : undefined,
          });
          if (results.length === 0) {
            api.logger.info(`[zettelkasten] No results for: "${query}"`);
          } else {
            for (const r of results) {
              const n = r.note;
              api.logger.info(
                `[${n.id}] ${n.title} | ${n.folder} | score:${r.score.toFixed(2)}`,
              );
              if (r.snippet) api.logger.info(`  ${r.snippet}`);
            }
            api.logger.info(`[zettelkasten] ${results.length} result(s)`);
          }
        });

      zk
        .command("show")
        .description("Show a note by ID")
        .argument("<id>", "Note ID")
        .action(async (id: string) => {
          const note = await noteService.getNote(id);
          if (!note) {
            api.logger.error(`[zettelkasten] Note "${id}" not found`);
            return;
          }
          api.logger.info(`ID:        ${note.id}`);
          api.logger.info(`Title:     ${note.title}`);
          api.logger.info(`Type:      ${note.type} | Status: ${note.status} | Folder: ${note.folder}`);
          api.logger.info(`Confidence: ${note.confidence ?? "N/A"} | Source: ${note.source ?? "N/A"} | Reviewed: ${note.reviewed}`);
          if (note.tags.length > 0) api.logger.info(`Tags:      ${note.tags.join(", ")}`);
          api.logger.info(`Created:   ${note.createdAt}`);
          api.logger.info(`Updated:   ${note.updatedAt}`);
          if (note.links.length > 0) {
            api.logger.info(`Links (${note.links.length}):`);
            for (const link of note.links) {
              api.logger.info(`  -> [${link.to}] ${link.type}${link.context ? ` (${link.context})` : ""}`);
            }
          }
          api.logger.info(`---`);
          api.logger.info(note.content);
        });

      zk
        .command("link")
        .description("Create a link between two notes")
        .requiredOption("--from <id>", "Source note ID")
        .requiredOption("--to <id>", "Target note ID")
        .option("--type <type>", "Link type", "related")
        .option("--context <text>", "Link context")
        .action(async (opts: any) => {
          const validTypes = [
            "supports", "supported_by", "refines", "refined_by",
            "extends", "extended_by", "contradicts", "contradicted_by",
            "is_example_of", "has_example", "related",
          ];
          if (!validTypes.includes(opts.type)) {
            api.logger.error(`[zettelkasten] Invalid link type: ${opts.type}. Valid: ${validTypes.join(", ")}`);
            return;
          }
          try {
            linkService.createLink(opts.from, opts.to, opts.type as LinkType, {
              context: opts.context,
            });
            api.logger.info(`[zettelkasten] Link created: ${opts.from} --${opts.type}--> ${opts.to}`);
          } catch (err) {
            api.logger.error(`[zettelkasten] Failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        });

      zk
        .command("doctor")
        .description("Run health checks on Zettelkasten")
        .action(async () => {
          const checks: string[] = [];
          let ok = 0, warn = 0, fail = 0;

          // DB connectivity
          try {
            db.exec("SELECT 1");
            checks.push("DB connectivity: OK"); ok++;
          } catch (e) {
            checks.push(`DB connectivity: FAIL (${e instanceof Error ? e.message : String(e)})`); fail++;
          }

          // Table integrity
          const tables = [
            "zettel_meta", "zettel_notes", "zettel_tags", "zettel_note_tags",
            "zettel_links", "zettel_reviews", "zettel_feedback", "zettel_prompt_versions",
            "zettel_sample_curations", "zettel_system_tunings", "zettel_feedback_stats", "zettel_export_batches",
          ];
          for (const t of tables) {
            const row = db.prepare(
              `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
            ).get(t);
            if (row) {
              checks.push(`Table ${t}: OK`); ok++;
            } else {
              checks.push(`Table ${t}: MISSING`); fail++;
            }
          }

          // Notes directory
          if (existsSync(config.notesDir)) {
            checks.push(`Notes dir: OK (${config.notesDir})`); ok++;
          } else {
            checks.push(`Notes dir: MISSING (${config.notesDir})`); fail++;
          }

          // FTS
          let ftsOk = false;
          try {
            db.prepare("SELECT 1 FROM zettel_fts LIMIT 1").get();
            ftsOk = true;
          } catch { /* FTS table may not exist */ }
          if (ftsOk) {
            checks.push("FTS index: OK"); ok++;
          } else {
            checks.push("FTS index: UNAVAILABLE (search falls back to LIKE)"); warn++;
          }

          // Note count
          try {
            const count = (db.prepare("SELECT COUNT(*) as c FROM zettel_notes").get() as { c: number }).c;
            checks.push(`Notes: ${count}`); ok++;
          } catch {
            checks.push("Notes count: FAIL"); fail++;
          }

          // Link count
          try {
            const linkCount = (db.prepare("SELECT COUNT(*) as c FROM zettel_links").get() as { c: number }).c;
            checks.push(`Links: ${linkCount}`); ok++;
          } catch {
            checks.push("Link count: FAIL"); fail++;
          }

          api.logger.info(`[zettelkasten] Health check: ${ok} OK, ${warn} WARN, ${fail} FAIL`);
          for (const c of checks) {
            api.logger.info(`  ${c}`);
          }
        });

      zk
        .command("status")
        .description("Show Zettelkasten runtime status")
        .action(async () => {
          const now = new Date();
          api.logger.info("[zettelkasten] ════════════════════════════════════════");
          api.logger.info("[zettelkasten]  Zettelkasten Runtime Status");
          api.logger.info("[zettelkasten] ════════════════════════════════════════");

          // Database
          const dbSize = existsSync(config.databasePath)
            ? (await import("node:fs/promises")).stat(config.databasePath).then(s => `${(s.size / 1024).toFixed(1)} KB`).catch(() => "N/A")
            : "N/A";
          api.logger.info(`[zettelkasten] Database:  ${config.databasePath}`);
          api.logger.info(`[zettelkasten] DB Size:   ${await dbSize}`);

          // Notes
          const noteCount = (db.prepare("SELECT COUNT(*) as c FROM zettel_notes").get() as { c: number }).c;
          const noteThisWeek = (db.prepare(
            "SELECT COUNT(*) as c FROM zettel_notes WHERE created_at >= datetime('now', '-7 days')"
          ).get() as { c: number }).c;
          const noteToday = (db.prepare(
            "SELECT COUNT(*) as c FROM zettel_notes WHERE created_at >= datetime('now', '-1 day')"
          ).get() as { c: number }).c;
          api.logger.info(`[zettelkasten] Notes:     ${noteCount} total | ${noteThisWeek} this week | ${noteToday} today`);

          // Inbox queue
          const inboxCount = (db.prepare(
            "SELECT COUNT(*) as c FROM zettel_notes WHERE folder = 'inbox' AND reviewed = 0"
          ).get() as { c: number }).c;
          api.logger.info(`[zettelkasten] Inbox:     ${inboxCount} pending review`);

          // Links
          const linkCount = (db.prepare("SELECT COUNT(*) as c FROM zettel_links").get() as { c: number }).c;
          api.logger.info(`[zettelkasten] Links:     ${linkCount} total`);

          // Tags
          const tagCount = (db.prepare("SELECT COUNT(*) as c FROM zettel_tags").get() as { c: number }).c;
          const tagAssoc = (db.prepare("SELECT COUNT(*) as c FROM zettel_note_tags").get() as { c: number }).c;
          api.logger.info(`[zettelkasten] Tags:      ${tagCount} unique | ${tagAssoc} associations`);

          // Recent activity
          const recentNotes = db.prepare(
            "SELECT id, title, folder, created_at FROM zettel_notes ORDER BY created_at DESC LIMIT 3"
          ).all() as Array<{ id: string; title: string; folder: string; created_at: string }>;
          if (recentNotes.length > 0) {
            api.logger.info("[zettelkasten] Recent notes:");
            for (const n of recentNotes) {
              api.logger.info(`[zettelkasten]   [${n.id}] ${n.title} (${n.folder})`);
            }
          }

          // Folder distribution
          const folders = db.prepare(
            "SELECT folder, COUNT(*) as c FROM zettel_notes GROUP BY folder"
          ).all() as Array<{ folder: string; c: number }>;
          api.logger.info("[zettelkasten] Distribution:");
          for (const f of folders) {
            const pct = noteCount > 0 ? ((f.c / noteCount) * 100).toFixed(1) : "0.0";
            api.logger.info(`[zettelkasten]   ${f.folder}: ${f.c} (${pct}%)`);
          }

          // FTS status
          let ftsOk = false;
          try {
            db.prepare("SELECT 1 FROM zettel_fts LIMIT 1").get();
            ftsOk = true;
          } catch { /* ignore */ }
          api.logger.info(`[zettelkasten] FTS:       ${ftsOk ? "enabled" : "disabled (LIKE fallback)"}`);

          // Plugin config
          api.logger.info(`[zettelkasten] Nightly:   ${config.nightlyDistill.enabled ? "enabled" : "disabled"}`);
          api.logger.info(`[zettelkasten] Session:   ${config.sessionHook.enabled ? "enabled" : "disabled"}`);

          api.logger.info(`[zettelkasten] Time:      ${now.toISOString()}`);
          api.logger.info("[zettelkasten] ════════════════════════════════════════");
        });

      zk
        .command("archive-log")
        .description("Show archive/unarchive operation history")
        .option("--note-id <id>", "Filter by note ID")
        .option("--action <action>", "Filter by action (archive/unarchive/auto_archive)")
        .option("--limit <n>", "Max results", safeParseInt, 20)
        .action(async (opts: any) => {
          const log = archiveService.getArchiveLog({
            noteId: opts.noteId,
            action: opts.action,
            limit: opts.limit,
          });
          if (log.length === 0) {
            api.logger.info("[zettelkasten] No archive log entries found");
          } else {
            api.logger.info(`[zettelkasten] Archive log (${log.length} entries):`);
            for (const entry of log) {
              api.logger.info(
                `  [${entry.createdAt}] ${entry.action} | ${entry.noteTitle} (ID: ${entry.noteId})${entry.reason ? " | " + entry.reason : ""}`,
              );
            }
          }
          const stats = archiveService.getArchiveStats();
          api.logger.info(`[zettelkasten] Stats: archived=${stats.totalArchived} restored=${stats.totalRestored} auto=${stats.totalAutoArchived} recent7d=${stats.recent7Days}`);
        });

      zk
        .command("auto-archive")
        .description("Run auto-archive scan for zombie notes (dry-run by default)")
        .option("--execute", "Actually perform archiving (default is dry-run)")
        .option("--limit <n>", "Max zombies to archive", safeParseInt, 50)
        .action(async (opts: any) => {
          const dryRun = !opts.execute;
          api.logger.info(`[zettelkasten] Auto-archive scan (${dryRun ? "dry-run" : "LIVE"})...`);
          const result = archiveService.autoArchiveZombies({ dryRun, limit: opts.limit });
          if (result.archived === 0) {
            api.logger.info("[zettelkasten] No zombie notes found");
          } else {
            api.logger.info(`[zettelkasten] Found ${result.archived} zombie note(s):`);
            for (const n of result.notes) {
              api.logger.info(`  - ${n.title}: ${n.reason}`);
            }
            if (dryRun) {
              api.logger.info("[zettelkasten] (dry-run: no changes made, use --execute to archive)");
            }
          }
        });

      zk
        .command("heatmap")
        .description("Show knowledge base heatmap")
        .option("--days <n>", "Statistics period in days", safeParseInt, 30)
        .action(async (opts: any) => {
          const data = heatmapService.generateHeatmap(opts.days);
          api.logger.info("[zettelkasten] ════════════════════════════════════════");
          api.logger.info(`[zettelkasten] Knowledge Heatmap (${data.period.start} ~ ${data.period.end})`);
          api.logger.info("[zettelkasten] ════════════════════════════════════════");
          api.logger.info(`[zettelkasten] Notes: ${data.summary.totalNotes} | Links: ${data.summary.totalLinks} | AvgGlow: ${data.summary.avgGlow.toFixed(3)}`);
          
          api.logger.info("[zettelkasten] Folder Distribution:");
          for (const f of data.folderDistribution) {
            api.logger.info(`  ${f.folder}: ${f.count} (${f.percentage.toFixed(1)}%)`);
          }
          
          api.logger.info("[zettelkasten] Glow Distribution:");
          for (const g of data.glowDistribution) {
            api.logger.info(`  ${g.status}: ${g.count} (${g.percentage.toFixed(1)}%) avg=${g.avgGlow.toFixed(3)}`);
          }
          
          if (data.topConnected.length > 0) {
            api.logger.info("[zettelkasten] Top Connected Notes:");
            for (const n of data.topConnected.slice(0, 5)) {
              api.logger.info(`  ${n.title}: in=${n.inDegree} out=${n.outDegree}`);
            }
          }
          
          if (data.dailyActivity.length > 0) {
            api.logger.info("[zettelkasten] Recent Activity:");
            for (const d of data.dailyActivity.slice(-7)) {
              api.logger.info(`  ${d.date}: +${d.created} notes, ${d.updated} updates, ${d.linksCreated} links`);
            }
          }
        });

      zk
        .command("graph-export")
        .description("Export knowledge graph data (JSON)")
        .option("--limit <n>", "Max nodes", safeParseInt, 200)
        .option("--folder <folder>", "Filter by folder")
        .option("--glow-min <n>", "Minimum glow score", safeParseFloat, 0)
        .option("--output <path>", "Output file path")
        .action(async (opts: any) => {
          const folderFilter = opts.folder ? [opts.folder] : undefined;
          const graph = heatmapService.generateNetworkGraph({
            limit: Number.isFinite(opts.limit) ? opts.limit : 200,
            folderFilter,
            glowMin: Number.isFinite(opts.glowMin) ? opts.glowMin : 0,
          });
          
          const output = JSON.stringify(graph, null, 2);
          
          if (opts.output) {
            const { writeFileSync } = await import("node:fs");
            const path = await import("node:path");
            const resolvedOutput = path.resolve(opts.output);
            const resolvedCwd = path.resolve(process.cwd());
            if (!resolvedOutput.startsWith(resolvedCwd + path.sep) && resolvedOutput !== resolvedCwd) {
              api.logger.error("[zettelkasten] Output path must be within current directory");
              return;
            }
            writeFileSync(resolvedOutput, output, "utf-8");
            api.logger.info(`[zettelkasten] Graph exported to ${opts.output}`);
          } else {
            api.logger.info("[zettelkasten] ════════════════════════════════════════");
            api.logger.info(`[zettelkasten] Knowledge Graph: ${graph.meta.nodeCount} nodes, ${graph.meta.edgeCount} edges`);
            api.logger.info("[zettelkasten] ════════════════════════════════════════");
            api.logger.info(output);
          }
        });

      zk
        .command("review-stats")
        .description("Show review statistics")
        .action(async () => {
          const stats = reviewService.getStats();
          api.logger.info("[zettelkasten] ════════════════════════════════════════");
          api.logger.info("[zettelkasten]  Review Statistics");
          api.logger.info("[zettelkasten] ════════════════════════════════════════");
          api.logger.info(`[zettelkasten] Total reviews: ${stats.totalReviews}`);
          api.logger.info(`[zettelkasten] Pending: ${stats.pendingCount}`);
          api.logger.info(`[zettelkasten] Approved: ${stats.approvedCount}`);
          api.logger.info(`[zettelkasten] Rejected: ${stats.rejectedCount}`);
          api.logger.info(`[zettelkasten] Modified: ${stats.modifiedCount}`);
          api.logger.info(`[zettelkasten] Flagged: ${stats.flaggedCount}`);
          api.logger.info("[zettelkasten] By target type:");
          for (const [type, count] of Object.entries(stats.byTargetType)) {
            api.logger.info(`  ${type}: ${count}`);
          }
        });

      zk
        .command("review-pending")
        .description("List pending review items")
        .option("--limit <n>", "Max results", safeParseInt, 20)
        .action(async (opts: any) => {
          const items = reviewService.getPendingItems(opts.limit);
          if (items.length === 0) {
            api.logger.info("[zettelkasten] No pending review items");
          } else {
            api.logger.info(`[zettelkasten] Pending review items (${items.length}):`);
            for (const item of items) {
              api.logger.info(`  [${item.id}] ${item.targetType}:${item.targetId} | ${item.action} | ${item.createdAt}`);
            }
          }
        });

      zk
        .command("feedback-stats")
        .description("Show feedback statistics")
        .action(async () => {
          const stats = feedbackService.getStats();
          api.logger.info("[zettelkasten] ════════════════════════════════════════");
          api.logger.info("[zettelkasten]  Feedback Statistics");
          api.logger.info("[zettelkasten] ════════════════════════════════════════");
          api.logger.info(`[zettelkasten] Total feedback: ${stats.totalFeedback}`);
          api.logger.info(`[zettelkasten] Unprocessed: ${stats.unprocessedCount}`);
          api.logger.info("[zettelkasten] By type:");
          api.logger.info(`  thumbs_up: ${stats.thumbsUpCount}`);
          api.logger.info(`  thumbs_down: ${stats.thumbsDownCount}`);
          api.logger.info(`  comment: ${stats.commentCount}`);
          api.logger.info(`  correction: ${stats.correctionCount}`);
          api.logger.info(`  suggestion: ${stats.suggestionCount}`);
          api.logger.info("[zettelkasten] By target type:");
          for (const [type, count] of Object.entries(stats.byTargetType)) {
            api.logger.info(`  ${type}: ${count}`);
          }
        });

      zk
        .command("prompt-stats")
        .description("Show prompt effectiveness statistics")
        .action(async () => {
          const effectiveness = promptEvolutionService.getEffectivenessStats();
          api.logger.info("[zettelkasten] ════════════════════════════════════════");
          api.logger.info("[zettelkasten]  Prompt Statistics");
          api.logger.info("[zettelkasten] ════════════════════════════════════════");
          api.logger.info(`[zettelkasten] Total versions with stats: ${effectiveness.length}`);
          if (effectiveness.length > 0) {
            const avgScore = effectiveness.reduce((sum: number, p: any) => sum + (p.averageScore ?? 0), 0) / effectiveness.length;
            api.logger.info(`[zettelkasten] Average score: ${avgScore.toFixed(3)}`);
            const byType: Record<string, { count: number; avgScore: number }> = {};
            for (const p of effectiveness) {
              if (!byType[p.promptType]) {
                byType[p.promptType] = { count: 0, avgScore: 0 };
              }
              byType[p.promptType].count++;
              byType[p.promptType].avgScore += p.averageScore ?? 0;
            }
            api.logger.info("[zettelkasten] By prompt type:");
            for (const [type, data] of Object.entries(byType)) {
              api.logger.info(`  ${type}: count=${data.count} avg=${(data.avgScore / data.count).toFixed(3)}`);
            }
          }
        });

      zk
        .command("curation-stats")
        .description("Show sample curation statistics")
        .action(async () => {
          const stats = sampleCurationService.getStats();
          api.logger.info("[zettelkasten] ════════════════════════════════════════");
          api.logger.info("[zettelkasten]  Curation Statistics");
          api.logger.info("[zettelkasten] ════════════════════════════════════════");
          api.logger.info(`[zettelkasten] Total curated: ${stats.total}`);
          api.logger.info(`[zettelkasten] Pending: ${stats.pending}`);
          api.logger.info(`[zettelkasten] Approved: ${stats.approved}`);
          api.logger.info(`[zettelkasten] Rejected: ${stats.rejected}`);
          api.logger.info(`[zettelkasten] Exported: ${stats.exported}`);
          if (stats.averageQuality !== undefined) {
            api.logger.info(`[zettelkasten] Average quality: ${stats.averageQuality.toFixed(3)}`);
          }
        });

      // Phase 6 CLI 命令
      if (serendipityService) {
        zk
          .command("discover")
          .description("Run Serendipity Engine to find unexpected connections")
          .action(async () => {
            const result = serendipityService.runDiscovery();
            api.logger.info(`[zettelkasten] Serendipity: ${result.discovered} discovered, ${result.saved} saved`);
            const findings = serendipityService.getPendingFindings(5);
            for (const f of findings) {
              api.logger.info(`  [${f.score.toFixed(2)}] "${f.fromTitle}" ↔ "${f.toTitle}" | ${f.reason}`);
            }
          });
      }

      if (mocService) {
        zk
          .command("scan-moc")
          .description("Scan knowledge communities and suggest MOCs")
          .action(async () => {
            const result = mocService.scanAndSuggest();
            api.logger.info(`[zettelkasten] MOC scan: ${result.communities} communities, ${result.saved} suggestions`);
            const suggestions = mocService.getPendingSuggestions(3);
            for (const s of suggestions) {
              api.logger.info(`  [${s.noteCount} notes, density=${s.density}] ${s.title}`);
            }
          });
      }

      if (auditService) {
        zk
          .command("audit")
          .description("Generate knowledge health audit report")
          .action(async () => {
            const report = auditService.generateReport();
            api.logger.info("[zettelkasten] ════════════════════════════════════════");
            api.logger.info("[zettelkasten]  Knowledge Health Audit");
            api.logger.info("[zettelkasten] ════════════════════════════════════════");
            api.logger.info(`[zettelkasten] Total notes: ${report.totalNotes}`);
            api.logger.info(`[zettelkasten] Total links: ${report.totalLinks}`);
            api.logger.info(`[zettelkasten] Connection rate: ${report.connectionRate}%`);
            api.logger.info(`[zettelkasten] Orphan notes: ${report.orphanCount}`);
            api.logger.info(`[zettelkasten] Zombie notes: ${report.zombieCount}`);
            api.logger.info(`[zettelkasten] Inbox backlog: ${report.inboxBacklog}`);
            api.logger.info(`[zettelkasten] Avg content length: ${report.avgContentLength}`);
            api.logger.info("[zettelkasten] Recommendations:");
            for (const rec of report.recommendations) {
              api.logger.info(`  • ${rec}`);
            }
          });
      }
    },
    {
      commands: ["zk"],
      descriptors: [
        { name: "zk", description: "Zettelkasten second memory system commands", hasSubcommands: true },
      ],
    },
  );
}
