import { z } from "openclaw/plugin-sdk/zod";
import path from "node:path";
import os from "node:os";

export const zettelkastenConfigSchema = z.object({
  notesDir: z.string().optional(),
  databasePath: z.string().optional(),
  agentConfigs: z.object({
    chat: z.object({
      tools: z.array(z.string()).optional(),
    }).optional(),
    knowledge: z.object({
      tools: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
  nightlyDistill: z.object({
    enabled: z.boolean().optional(),
    cronExpression: z.string().optional(),
  }).optional(),
  sessionHook: z.object({
    enabled: z.boolean().optional(),
  }).optional(),
  confidenceThreshold: z.object({
    zettels: z.number().min(0).max(1).optional(),
    references: z.number().min(0).max(1).optional(),
  }).optional(),
  feishuWebhook: z.string().optional(),
  staleReviewDays: z.number().min(1).max(90).optional(),
  phase6: z.object({
    serendipity: z.object({
      enabled: z.boolean().optional(),
      topK: z.number().optional(),
      minScore: z.number().optional(),
      autoCreateLinks: z.boolean().optional(),
    }).optional(),
    autoMOC: z.object({
      enabled: z.boolean().optional(),
      minClusterSize: z.number().optional(),
      maxClusters: z.number().optional(),
      autoCreate: z.boolean().optional(),
    }).optional(),
    knowledgeAudit: z.object({
      enabled: z.boolean().optional(),
      schedule: z.enum(["daily", "weekly", "monthly"]).optional(),
    }).optional(),
  }).optional(),
});

export interface ZettelkastenPluginConfig {
  notesDir: string;
  databasePath: string;
  agentConfigs: {
    chat: { tools: string[] };
    knowledge: { tools: string[] };
  };
  nightlyDistill: {
    enabled: boolean;
    cronExpression: string;
  };
  sessionHook: {
    enabled: boolean;
  };
  confidenceThreshold: {
    zettels: number;
    references: number;
  };
  feishuWebhook?: string;
  staleReviewDays: number;
  phase6: {
    serendipity: { enabled: boolean; topK: number; minScore: number; autoCreateLinks: boolean };
    autoMOC: { enabled: boolean; minClusterSize: number; maxClusters: number; autoCreate: boolean };
    knowledgeAudit: { enabled: boolean; schedule: "daily" | "weekly" | "monthly" };
  };
}

export function resolveZettelkastenConfig(
  rawConfig: Partial<ZettelkastenPluginConfig>,
): ZettelkastenPluginConfig {
  const parsed = zettelkastenConfigSchema.parse(rawConfig ?? {});
  return {
    notesDir: parsed.notesDir ?? path.join(os.homedir(), ".openclaw", "zettelkasten", "notes"),
    databasePath: parsed.databasePath ?? path.join(os.homedir(), ".openclaw", "zettelkasten", "zettelkasten.db"),
    feishuWebhook: parsed.feishuWebhook,
    staleReviewDays: parsed.staleReviewDays ?? 14,
    phase6: {
      serendipity: {
        enabled: parsed.phase6?.serendipity?.enabled ?? true,
        topK: parsed.phase6?.serendipity?.topK ?? 5,
        minScore: parsed.phase6?.serendipity?.minScore ?? 0.5,
        autoCreateLinks: parsed.phase6?.serendipity?.autoCreateLinks ?? false,
      },
      autoMOC: {
        enabled: parsed.phase6?.autoMOC?.enabled ?? true,
        minClusterSize: parsed.phase6?.autoMOC?.minClusterSize ?? 5,
        maxClusters: parsed.phase6?.autoMOC?.maxClusters ?? 10,
        autoCreate: parsed.phase6?.autoMOC?.autoCreate ?? false,
      },
      knowledgeAudit: {
        enabled: parsed.phase6?.knowledgeAudit?.enabled ?? true,
        schedule: parsed.phase6?.knowledgeAudit?.schedule ?? "weekly",
      },
    },
    agentConfigs: {
      chat: {
        tools: parsed.agentConfigs?.chat?.tools ?? [
          "zk_search_notes",
          "zk_get_note",
          "zk_get_backlinks",
          "zk_find_path",
          "zk_glow_ranking",
          "zk_find_zombies",
          "zk_search_archived",
          "zk_get_archive_log",
          "zk_knowledge_heatmap",
          "zk_network_graph",
          "zk_get_review_panel",
          "zk_get_review_stats",
          "zk_get_feedback_stats",
          "zk_analyze_feedback_trends",
          "zk_get_active_prompt",
          "zk_get_prompt_stats",
          "zk_get_curation_stats",
        ],
      },
      knowledge: {
        tools: parsed.agentConfigs?.knowledge?.tools ?? [
          "zk_search_notes",
          "zk_get_note",
          "zk_get_backlinks",
          "zk_find_path",
          "zk_glow_ranking",
          "zk_find_zombies",
          "zk_search_archived",
          "zk_get_archive_log",
          "zk_knowledge_heatmap",
          "zk_network_graph",
          "zk_create_note",
          "zk_update_note",
          "zk_run_ceqrc",
          "zk_distill_memory",
          "zk_review_note",
          "zk_archive_note",
          "zk_unarchive_note",
          "zk_get_review_panel",
          "zk_get_review_stats",
          "zk_submit_review",
          "zk_submit_feedback",
          "zk_get_feedback_stats",
          "zk_analyze_feedback_trends",
          "zk_get_active_prompt",
          "zk_get_prompt_stats",
          "zk_get_curation_stats",
          "zk_export_samples",
        ],
      },
    },
    nightlyDistill: {
      enabled: parsed.nightlyDistill?.enabled ?? true,
      cronExpression: parsed.nightlyDistill?.cronExpression ?? "0 2 * * *",
    },
    sessionHook: {
      enabled: parsed.sessionHook?.enabled ?? true,
    },
    confidenceThreshold: {
      zettels: parsed.confidenceThreshold?.zettels ?? 0.7,
      references: parsed.confidenceThreshold?.references ?? 0.4,
    },
  };
}
