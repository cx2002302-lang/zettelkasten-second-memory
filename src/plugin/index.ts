import { buildPluginConfigSchema, definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";

import { resolveZettelkastenConfig, zettelkastenConfigSchema } from "./config.js";
import { ensureZettelkastenSchema } from "../storage/db-schema.js";
import { initializeServices, registerServices } from "./lifecycle.js";

import {
  createZkCreateNoteTool,
  createZkSearchNotesTool,
  createZkGetNoteTool,
  createZkGetBacklinksTool,
  createZkFindPathTool,
  createZkUpdateNoteTool,
  createZkRunCeqrcTool,
  createZkDistillMemoryTool,
  createZkGlowRankingTool,
  createZkFindZombiesTool,
  createZkSearchArchivedTool,
  createZkArchiveNoteTool,
  createZkUnarchiveNoteTool,
  createZkGetArchiveLogTool,
  createZkKnowledgeHeatmapTool,
  createZkNetworkGraphTool,
} from "./tools/notes.js";

import {
  createZkReviewNoteTool,
  createZkGetReviewPanelTool,
  createZkSubmitReviewTool,
  createZkGetReviewStatsTool,
  createZkSubmitFeedbackTool,
  createZkGetFeedbackStatsTool,
  createZkAnalyzeFeedbackTrendsTool,
  createZkGetActivePromptTool,
  createZkGetPromptStatsTool,
  createZkGetCurationStatsTool,
  createZkExportSamplesTool,
} from "./tools/review.js";

import { registerPhase6ToolsWithApi } from "./tools/phase6.js";
import { registerCLICommands } from "./cli/commands.js";

export default definePluginEntry({
  id: "zettelkasten",
  name: "Zettelkasten Second Memory System",
  description:
    "Atomic note-taking, bi-directional linking, and knowledge-graph distillation for OpenClaw.",
  configSchema: buildPluginConfigSchema(zettelkastenConfigSchema),

  register(api) {
    const config = resolveZettelkastenConfig(api.pluginConfig as Partial<import("./config.js").ZettelkastenPluginConfig>);

    const dbDir = path.dirname(config.databasePath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    const db = new DatabaseSync(config.databasePath);
    ensureZettelkastenSchema({ db });

    const services = initializeServices(db, config);

    // Register tools
    api.registerTool(createZkCreateNoteTool(services.noteService, config.notesDir), { name: "zk_create_note" });
    api.registerTool(createZkSearchNotesTool(services.noteService), { name: "zk_search_notes" });
    api.registerTool(createZkGetNoteTool(services.noteService), { name: "zk_get_note" });
    api.registerTool(createZkGetBacklinksTool(services.linkService), { name: "zk_get_backlinks" });
    api.registerTool(createZkFindPathTool(services.pathFinder), { name: "zk_find_path" });
    api.registerTool(createZkUpdateNoteTool(services.noteService), { name: "zk_update_note" });
    api.registerTool(createZkRunCeqrcTool(services.ceqrcEngine, services.noteService), { name: "zk_run_ceqrc" });
    api.registerTool(createZkDistillMemoryTool(services.distillerService), { name: "zk_distill_memory" });
    api.registerTool(createZkReviewNoteTool(services.noteService, config), { name: "zk_review_note" });
    api.registerTool(createZkGlowRankingTool(services.glowCalculator), { name: "zk_glow_ranking" });
    api.registerTool(createZkFindZombiesTool(services.glowCalculator), { name: "zk_find_zombies" });
    api.registerTool(createZkSearchArchivedTool(services.noteService), { name: "zk_search_archived" });
    api.registerTool(createZkArchiveNoteTool(services.noteService), { name: "zk_archive_note" });
    api.registerTool(createZkUnarchiveNoteTool(services.noteService), { name: "zk_unarchive_note" });
    api.registerTool(createZkGetArchiveLogTool(services.archiveService), { name: "zk_get_archive_log" });
    api.registerTool(createZkKnowledgeHeatmapTool(services.heatmapService), { name: "zk_knowledge_heatmap" });
    api.registerTool(createZkNetworkGraphTool(services.heatmapService), { name: "zk_network_graph" });
    api.registerTool(createZkGetReviewPanelTool(services.reviewService), { name: "zk_get_review_panel" });
    api.registerTool(createZkSubmitReviewTool(services.reviewService), { name: "zk_submit_review" });
    api.registerTool(createZkGetReviewStatsTool(services.reviewService), { name: "zk_get_review_stats" });
    api.registerTool(createZkSubmitFeedbackTool(services.feedbackService), { name: "zk_submit_feedback" });
    api.registerTool(createZkGetFeedbackStatsTool(services.feedbackService), { name: "zk_get_feedback_stats" });
    api.registerTool(createZkAnalyzeFeedbackTrendsTool(services.feedbackService), { name: "zk_analyze_feedback_trends" });
    api.registerTool(createZkGetActivePromptTool(services.promptEvolutionService), { name: "zk_get_active_prompt" });
    api.registerTool(createZkGetPromptStatsTool(services.promptEvolutionService), { name: "zk_get_prompt_stats" });
    api.registerTool(createZkGetCurationStatsTool(services.sampleCurationService), { name: "zk_get_curation_stats" });
    api.registerTool(createZkExportSamplesTool(services.sampleCurationService), { name: "zk_export_samples" });

    // Phase 6 MCP tools
    registerPhase6ToolsWithApi(api, services.serendipityService, services.mocService, services.auditService);

    // Register CLI commands
    registerCLICommands(api, db, services, config);

    // Register services (nightly cron, session hooks, db lifecycle)
    registerServices(api, services, config, db);
  },
});
