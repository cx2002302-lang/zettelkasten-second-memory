import { buildPluginConfigSchema, definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { z } from "openclaw/plugin-sdk/zod";
import { Type } from "@sinclair/typebox";
import { jsonResult, readStringParam, readNumberParam } from "openclaw/plugin-sdk/core";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";
import { existsSync, mkdirSync } from "node:fs";

import type { LLMProvider, ZettelNote, LinkType } from "../core/types.js";
import { NoteService } from "../service/note-service.js";
import { LinkService } from "../service/link-service.js";
import { CEQRCEngine } from "../service/ceqrc-engine.js";
import { DistillerService } from "../service/distiller-service.js";
import { GlowCalculator } from "../engine/glow-calculator.js";
import { PathFinder } from "../engine/path-finder.js";
import { ArchiveService } from "../service/archive-service.js";
import { KnowledgeHeatmapService } from "../service/heatmap-service.js";
import { ensureZettelkastenSchema, getDatabaseStats } from "../storage/db-schema.js";

// Safe parsers for Commander options (handler signature is (value, previous))
const safeParseInt = (v: string) => parseInt(v, 10);
const safeParseFloat = (v: string) => parseFloat(v);

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
}

export function resolveZettelkastenConfig(
  rawConfig: Partial<ZettelkastenPluginConfig>,
): ZettelkastenPluginConfig {
  const parsed = zettelkastenConfigSchema.parse(rawConfig ?? {});
  return {
    notesDir: parsed.notesDir ?? path.join(os.homedir(), ".openclaw", "zettelkasten", "notes"),
    databasePath: parsed.databasePath ?? path.join(os.homedir(), ".openclaw", "zettelkasten", "zettelkasten.db"),
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

function nullLLMProvider(): LLMProvider {
  return {
    async generateSummary() {
      throw new Error("LLM provider not configured for Zettelkasten");
    },
    async judgeDuplicate() {
      throw new Error("LLM provider not configured for Zettelkasten");
    },
    async generateEmbedding() {
      throw new Error("LLM provider not configured for Zettelkasten");
    },
    async processCEQRCPhase() {
      throw new Error("LLM provider not configured for Zettelkasten");
    },
  };
}

// ========== Tool Definitions ==========

function optionalStringEnum<const T extends readonly string[]>(
  values: T,
  options: { description?: string } = {},
) {
  return Type.Optional(
    Type.Unsafe<T[number]>({
      type: "string",
      enum: [...values],
      ...options,
    }),
  );
}

const ZkCreateNoteSchema = Type.Object(
  {
    title: Type.String({ description: "Note title (required)" }),
    content: Type.String({ description: "Markdown content of the note (required)" }),
    tags: Type.Optional(Type.Array(Type.String(), {
      description: "Tags for categorization",
    })),
    confidence: Type.Optional(Type.Number({
      description: "Confidence score 0-1 for routing (zettels >= 0.7, references >= 0.4, otherwise inbox)",
      minimum: 0,
      maximum: 1,
    })),
    source: optionalStringEnum(["manual", "distilled", "ceqrc"] as const, {
      description: "Source type of the note",
    }),
  },
  { additionalProperties: false },
);

const ZkSearchNotesSchema = Type.Object(
  {
    query: Type.String({ description: "Search query string" }),
    limit: Type.Optional(Type.Number({
      description: "Maximum number of results (default 20)",
      minimum: 1,
      maximum: 100,
    })),
  },
  { additionalProperties: false },
);

const ZkGetNoteSchema = Type.Object(
  {
    id: Type.String({ description: "Note ID to retrieve" }),
  },
  { additionalProperties: false },
);

const ZkGetBacklinksSchema = Type.Object(
  {
    note_id: Type.String({ description: "Note ID to get backlinks for" }),
  },
  { additionalProperties: false },
);

const ZkFindPathSchema = Type.Object(
  {
    from_note_id: Type.String({ description: "Starting note ID" }),
    to_note_id: Type.String({ description: "Target note ID" }),
  },
  { additionalProperties: false },
);

const ZkUpdateNoteSchema = Type.Object(
  {
    id: Type.String({ description: "Note ID to update" }),
    title: Type.Optional(Type.String({ description: "New title" })),
    content: Type.Optional(Type.String({ description: "New Markdown content" })),
    confidence: Type.Optional(Type.Number({
      description: "New confidence score 0-1",
      minimum: 0,
      maximum: 1,
    })),
    tags: Type.Optional(Type.Array(Type.String(), {
      description: "Replacement tag list",
    })),
  },
  { additionalProperties: false },
);

const ZkRunCeqrcSchema = Type.Object(
  {
    note_id: Type.String({ description: "Source note ID for CEQRC workflow" }),
    content: Type.String({ description: "Content to process through CEQRC pipeline" }),
  },
  { additionalProperties: false },
);

const ZkDistillMemorySchema = Type.Object(
  {
    memory_file_path: Type.Optional(Type.String({
      description: "Path to memory log file. If omitted, distills yesterday's memory.",
    })),
  },
  { additionalProperties: false },
);

const ZkReviewNoteSchema = Type.Object(
  {
    note_id: Type.String({ description: "Note ID to review" }),
    decision: Type.String({
      description: "Review decision: approve, reject, or improve",
      enum: ["approve", "reject", "improve"],
    }),
    improvements: Type.Optional(Type.Object({
      title: Type.Optional(Type.String({ description: "Improved title" })),
      content: Type.Optional(Type.String({ description: "Improved content" })),
      confidence: Type.Optional(Type.Number({
        description: "Revised confidence score",
        minimum: 0,
        maximum: 1,
      })),
    }, { additionalProperties: false })),
  },
  { additionalProperties: false },
);

const ZkGlowRankingSchema = Type.Object(
  {
    limit: Type.Optional(Type.Number({
      description: "Maximum number of results (default 20)",
      minimum: 1,
      maximum: 100,
    })),
    statusFilter: Type.Optional(Type.Array(
      Type.String({ enum: ["evergreen", "active", "stable", "zombie"] }),
      { description: "Filter by glow status categories" },
    )),
    minGlow: Type.Optional(Type.Number({
      description: "Minimum glow score (0-1)",
      minimum: 0,
      maximum: 1,
    })),
  },
  { additionalProperties: false },
);

const ZkFindZombiesSchema = Type.Object(
  {
    limit: Type.Optional(Type.Number({
      description: "Maximum number of zombie notes to return (default 20)",
      minimum: 1,
      maximum: 100,
    })),
  },
  { additionalProperties: false },
);

const ZkSearchArchivedSchema = Type.Object(
  {
    query: Type.String({ description: "Search query string" }),
    limit: Type.Optional(Type.Number({
      description: "Maximum number of results (default 20)",
      minimum: 1,
      maximum: 100,
    })),
  },
  { additionalProperties: false },
);

const ZkArchiveNoteSchema = Type.Object(
  {
    note_id: Type.String({ description: "Note ID to archive" }),
  },
  { additionalProperties: false },
);

const ZkUnarchiveNoteSchema = Type.Object(
  {
    note_id: Type.String({ description: "Note ID to unarchive" }),
  },
  { additionalProperties: false },
);

// ========== Tool Builders ==========

function createZkCreateNoteTool(noteService: NoteService, notesDir: string) {
  return {
    name: "zk_create_note",
    label: "ZK Create Note",
    description:
      "Create a new atomic note in the Zettelkasten. Content is confidence-routed: >= 0.7 goes to zettels, >= 0.4 to references, otherwise inbox.",
    parameters: ZkCreateNoteSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const title = readStringParam(rawParams, "title", { required: true });
      const content = readStringParam(rawParams, "content", { required: true });
      const tags = Array.isArray(rawParams.tags) ? (rawParams.tags as string[]).filter((t) => typeof t === "string") : undefined;
      const confidence = readNumberParam(rawParams, "confidence");
      const source = readStringParam(rawParams, "source") as "manual" | "distilled" | "ceqrc" | undefined;

      if (!existsSync(notesDir)) {
        mkdirSync(notesDir, { recursive: true });
      }

      const note = await noteService.createNote(
        { title, content, tags },
        { confidence: confidence ?? undefined, source: source ?? "manual" },
      );

      return jsonResult(note);
    },
  };
}

function createZkSearchNotesTool(noteService: NoteService) {
  return {
    name: "zk_search_notes",
    label: "ZK Search Notes",
    description:
      "Full-text search across all Zettelkasten notes. Returns scored results with content snippets.",
    parameters: ZkSearchNotesSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const query = readStringParam(rawParams, "query", { required: true });
      const limit = readNumberParam(rawParams, "limit", { integer: true }) ?? 20;

      const results = await noteService.searchNotes(query, limit);
      return jsonResult(results);
    },
  };
}

function createZkGetNoteTool(noteService: NoteService) {
  return {
    name: "zk_get_note",
    label: "ZK Get Note",
    description:
      "Retrieve a single Zettelkasten note by its ID. Returns the full note with metadata, links, and tags.",
    parameters: ZkGetNoteSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const id = readStringParam(rawParams, "id", { required: true });

      const note = await noteService.getNote(id);
      if (!note) {
        return jsonResult({ error: `Note "${id}" not found` });
      }
      return jsonResult(note);
    },
  };
}

function createZkGetBacklinksTool(linkService: LinkService) {
  return {
    name: "zk_get_backlinks",
    label: "ZK Get Backlinks",
    description:
      "Get all notes that link TO the specified note (reverse links / backlinks). Useful for understanding what references a given note.",
    parameters: ZkGetBacklinksSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const noteId = readStringParam(rawParams, "note_id", { required: true });

      try {
        const links = linkService.getLinksTo(noteId);
        return jsonResult(links);
      } catch (err) {
        return jsonResult({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

function createZkFindPathTool(pathFinder: PathFinder) {
  return {
    name: "zk_find_path",
    label: "ZK Find Path",
    description:
      "Find the shortest weighted path through the link graph between two notes. Returns the sequence of note IDs with path explanation.",
    parameters: ZkFindPathSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const fromId = readStringParam(rawParams, "from_note_id", { required: true });
      const toId = readStringParam(rawParams, "to_note_id", { required: true });

      try {
        const result = pathFinder.findPath(fromId, toId);
        if (!result) {
          return jsonResult({ path: null, message: `No path found between "${fromId}" and "${toId}"` });
        }
        return jsonResult({
          path: result.path.map((n) => n.noteId),
          length: result.path.length,
          stepCount: result.stepCount,
          totalWeight: result.totalWeight,
          explanation: result.explanation,
        });
      } catch (err) {
        return jsonResult({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

function createZkUpdateNoteTool(noteService: NoteService) {
  return {
    name: "zk_update_note",
    label: "ZK Update Note",
    description:
      "Update an existing Zettelkasten note's title, content, confidence, or tags. Only provided fields are changed.",
    parameters: ZkUpdateNoteSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const id = readStringParam(rawParams, "id", { required: true });
      const title = readStringParam(rawParams, "title");
      const content = readStringParam(rawParams, "content");
      const confidence = readNumberParam(rawParams, "confidence");
      const tags = Array.isArray(rawParams.tags) ? (rawParams.tags as string[]).filter((t) => typeof t === "string") : undefined;

      const updateParams: {
        title?: string;
        content?: string;
        confidence?: number;
        tags?: string[];
      } = {};
      if (title !== undefined) updateParams.title = title;
      if (content !== undefined) updateParams.content = content;
      if (confidence !== undefined) updateParams.confidence = confidence;
      if (tags !== undefined) updateParams.tags = tags;

      const updated = await noteService.updateNote(id, updateParams);
      if (!updated) {
        return jsonResult({ error: `Note "${id}" not found` });
      }
      return jsonResult(updated);
    },
  };
}

function createZkRunCeqrcTool(
  ceqrcEngine: CEQRCEngine,
  noteService: NoteService,
) {
  return {
    name: "zk_run_ceqrc",
    label: "ZK Run CEQRC",
    description:
      "Run the CEQRC workflow (Capture → Explain → Question → Refine → Connect) on a source note. Creates a refined atomic note.",
    parameters: ZkRunCeqrcSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const noteId = readStringParam(rawParams, "note_id", { required: true });
      const content = readStringParam(rawParams, "content", { required: true });

      try {
        const workflow = ceqrcEngine.createWorkflow(noteId);
        const existingNotes: ZettelNote[] = [];
        await ceqrcEngine.runWorkflow(workflow.id, content, existingNotes);
        const result = ceqrcEngine.getWorkflowResult(workflow.id);
        if (!result) {
          return jsonResult({ error: "CEQRC workflow did not produce a result" });
        }
        return jsonResult(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ error: message });
      }
    },
  };
}

function createZkDistillMemoryTool(distillerService: DistillerService) {
  return {
    name: "zk_distill_memory",
    label: "ZK Distill Memory",
    description:
      "Run the memory distillation pipeline on a memory file or yesterday's conversation log. Creates atomic notes from chat history.",
    parameters: ZkDistillMemorySchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const memoryFilePath = readStringParam(rawParams, "memory_file_path");

      try {
        const existingNotes: ZettelNote[] = [];
        let job;

        if (memoryFilePath) {
          job = await distillerService.distillMemoryFile(memoryFilePath, existingNotes);
        } else {
          job = await distillerService.distillYesterday(existingNotes);
        }

        return jsonResult({
          jobId: job.id,
          status: job.status,
          sliceCount: job.sliceCount,
          summaryCount: job.summaryCount,
          createdCount: job.createdCount,
          mergedCount: job.mergedCount,
          skippedCount: job.skippedCount,
          error: job.error,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ error: message });
      }
    },
  };
}

function createZkReviewNoteTool(
  noteService: NoteService,
  config: ZettelkastenPluginConfig,
) {
  return {
    name: "zk_review_note",
    label: "ZK Review Note",
    description:
      "Review a note in the inbox: approve (route to zettels/references), reject (mark reviewed), or improve (update and re-evaluate).",
    parameters: ZkReviewNoteSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const noteId = readStringParam(rawParams, "note_id", { required: true });
      const decision = readStringParam(rawParams, "decision", { required: true }) as "approve" | "reject" | "improve";

      const improvements = rawParams.improvements as
        | { title?: string; content?: string; confidence?: number }
        | undefined
        | null;

      const updated = await noteService.reviewNote(
        noteId,
        decision,
        improvements ?? undefined,
      );

      if (!updated) {
        return jsonResult({ error: `Note "${noteId}" not found` });
      }
      return jsonResult(updated);
    },
  };
}

function createZkGlowRankingTool(glowCalculator: GlowCalculator) {
  return {
    name: "zk_glow_ranking",
    label: "ZK Glow Ranking",
    description:
      "Get notes ranked by glow score (knowledge vitality). Supports filtering by status (evergreen, active, stable, zombie) and minimum glow threshold.",
    parameters: ZkGlowRankingSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const limit = readNumberParam(rawParams, "limit", { integer: true }) ?? 20;
      const statusFilter = Array.isArray(rawParams.statusFilter)
        ? (rawParams.statusFilter as string[]).filter((s) => typeof s === "string")
        : undefined;
      const minGlow = readNumberParam(rawParams, "minGlow");

      const results = glowCalculator.getRanking({
        limit,
        statusFilter: statusFilter as Array<"evergreen" | "active" | "stable" | "zombie">,
        minGlow: minGlow ?? undefined,
      });
      return jsonResult(results);
    },
  };
}

function createZkFindZombiesTool(glowCalculator: GlowCalculator) {
  return {
    name: "zk_find_zombies",
    label: "ZK Find Zombies",
    description:
      "Find zombie notes — notes that haven't been updated for a long time and have no backlinks. Good candidates for archival.",
    parameters: ZkFindZombiesSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const limit = readNumberParam(rawParams, "limit", { integer: true }) ?? 20;

      const results = glowCalculator.findZombies(limit);
      return jsonResult(results);
    },
  };
}

function createZkSearchArchivedTool(noteService: NoteService) {
  return {
    name: "zk_search_archived",
    label: "ZK Search Archived",
    description:
      "Search across archived notes. By default, regular search excludes archived notes; use this tool to include them.",
    parameters: ZkSearchArchivedSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const query = readStringParam(rawParams, "query", { required: true });
      const limit = readNumberParam(rawParams, "limit", { integer: true }) ?? 20;

      const results = await noteService.searchNotes(query, limit, { includeArchived: true });
      return jsonResult(results);
    },
  };
}

function createZkArchiveNoteTool(noteService: NoteService) {
  return {
    name: "zk_archive_note",
    label: "ZK Archive Note",
    description:
      "Archive a note by moving it to the archive folder.",
    parameters: ZkArchiveNoteSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const noteId = readStringParam(rawParams, "note_id", { required: true });

      const updated = await noteService.archiveNote(noteId);
      if (!updated) {
        return jsonResult({ error: `Note "${noteId}" not found` });
      }
      return jsonResult(updated);
    },
  };
}

function createZkUnarchiveNoteTool(noteService: NoteService) {
  return {
    name: "zk_unarchive_note",
    label: "ZK Unarchive Note",
    description:
      "Unarchive a note by moving it back to the references folder.",
    parameters: ZkUnarchiveNoteSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const noteId = readStringParam(rawParams, "note_id", { required: true });

      const updated = await noteService.unarchiveNote(noteId);
      if (!updated) {
        return jsonResult({ error: `Note "${noteId}" not found` });
      }
      return jsonResult(updated);
    },
  };
}

const ZkGetArchiveLogSchema = Type.Object(
  {
    note_id: Type.Optional(Type.String({ description: "Filter by note ID" })),
    action: Type.Optional(Type.String({ description: "Filter by action type", enum: ["archive", "unarchive", "auto_archive"] })),
    limit: Type.Optional(Type.Number({ description: "Max results (default 50)", minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
);

function createZkGetArchiveLogTool(archiveService: ArchiveService) {
  return {
    name: "zk_get_archive_log",
    label: "ZK Get Archive Log",
    description:
      "Retrieve the archive/unarchive operation history. Shows when notes were archived, restored, or auto-archived.",
    parameters: ZkGetArchiveLogSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const noteId = readStringParam(rawParams, "note_id");
      const action = readStringParam(rawParams, "action");
      const limit = readNumberParam(rawParams, "limit", { integer: true }) ?? 50;

      const log = archiveService.getArchiveLog({ noteId, action, limit });
      return jsonResult(log);
    },
  };
}

const ZkKnowledgeHeatmapSchema = Type.Object(
  {
    days: Type.Optional(Type.Number({ description: "统计天数", minimum: 1, maximum: 365 })),
  },
  { additionalProperties: false },
);

function createZkKnowledgeHeatmapTool(heatmapService: KnowledgeHeatmapService) {
  return {
    name: "zk_knowledge_heatmap",
    label: "ZK Knowledge Heatmap",
    description:
      "Generate knowledge base heatmap data: daily activity, folder distribution, glow distribution, and link density ranking.",
    parameters: ZkKnowledgeHeatmapSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const days = readNumberParam(rawParams, "days", { integer: true }) ?? 30;
      const data = heatmapService.generateHeatmap(days);
      return jsonResult(data);
    },
  };
}

const ZkNetworkGraphSchema = Type.Object(
  {
    limit: Type.Optional(Type.Number({ description: "Max nodes", minimum: 1, maximum: 500 })),
    folder_filter: Type.Optional(Type.Array(Type.String(), { description: "Filter by folders" })),
    glow_min: Type.Optional(Type.Number({ description: "Minimum glow score", minimum: 0, maximum: 1 })),
  },
  { additionalProperties: false },
);

function createZkNetworkGraphTool(heatmapService: KnowledgeHeatmapService) {
  return {
    name: "zk_network_graph",
    label: "ZK Network Graph",
    description:
      "Generate knowledge graph data with nodes (notes) and edges (links) for visualization export.",
    parameters: ZkNetworkGraphSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const limit = readNumberParam(rawParams, "limit", { integer: true }) ?? 200;
      const folderFilter = Array.isArray(rawParams.folder_filter)
        ? (rawParams.folder_filter as string[]).filter((f) => typeof f === "string")
        : undefined;
      const glowMin = readNumberParam(rawParams, "glow_min") ?? 0;

      const graph = heatmapService.generateNetworkGraph({ limit, folderFilter, glowMin });
      return jsonResult(graph);
    },
  };
}

// ========== Plugin Entry ==========

export default definePluginEntry({
  id: "zettelkasten",
  name: "Zettelkasten Second Memory System",
  description:
    "Atomic note-taking, bi-directional linking, and knowledge-graph distillation for OpenClaw.",
  configSchema: buildPluginConfigSchema(zettelkastenConfigSchema),

  register(api) {
    const config = resolveZettelkastenConfig(api.pluginConfig as Partial<ZettelkastenPluginConfig>);

    const dbDir = path.dirname(config.databasePath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    const db = new DatabaseSync(config.databasePath);
    ensureZettelkastenSchema({ db });

    const confidenceConfig = {
      highConfidenceThreshold: config.confidenceThreshold.zettels,
      mediumConfidenceThreshold: config.confidenceThreshold.references,
    };
    const noteService = new NoteService(db, config.notesDir, confidenceConfig);
    const linkService = new LinkService(db);
    const glowCalculator = new GlowCalculator(db);
    const pathFinder = new PathFinder(db);
    const archiveService = new ArchiveService(db);
    const heatmapService = new KnowledgeHeatmapService(db);

    const nullLLM = nullLLMProvider();
    const ceqrcEngine = new CEQRCEngine(nullLLM);
    const distillerService = new DistillerService(nullLLM, noteService, linkService);

    api.registerTool(createZkCreateNoteTool(noteService, config.notesDir), { name: "zk_create_note" });
    api.registerTool(createZkSearchNotesTool(noteService), { name: "zk_search_notes" });
    api.registerTool(createZkGetNoteTool(noteService), { name: "zk_get_note" });
    api.registerTool(createZkGetBacklinksTool(linkService), { name: "zk_get_backlinks" });
    api.registerTool(createZkFindPathTool(pathFinder), { name: "zk_find_path" });
    api.registerTool(createZkUpdateNoteTool(noteService), { name: "zk_update_note" });
    api.registerTool(createZkRunCeqrcTool(ceqrcEngine, noteService), { name: "zk_run_ceqrc" });
    api.registerTool(createZkDistillMemoryTool(distillerService), { name: "zk_distill_memory" });
    api.registerTool(createZkReviewNoteTool(noteService, config), { name: "zk_review_note" });
    api.registerTool(createZkGlowRankingTool(glowCalculator), { name: "zk_glow_ranking" });
    api.registerTool(createZkFindZombiesTool(glowCalculator), { name: "zk_find_zombies" });
    api.registerTool(createZkSearchArchivedTool(noteService), { name: "zk_search_archived" });
    api.registerTool(createZkArchiveNoteTool(noteService), { name: "zk_archive_note" });
    api.registerTool(createZkUnarchiveNoteTool(noteService), { name: "zk_unarchive_note" });
    api.registerTool(createZkGetArchiveLogTool(archiveService), { name: "zk_get_archive_log" });
    api.registerTool(createZkKnowledgeHeatmapTool(heatmapService), { name: "zk_knowledge_heatmap" });
    api.registerTool(createZkNetworkGraphTool(heatmapService), { name: "zk_network_graph" });

    api.registerCli(
      ({ program }) => {
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
              "zettel_sample_curations", "zettel_system_tunings", "zettel_feedback_stats",
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
          .action(async (opts) => {
            const tags = opts.tags
              ? (opts.tags as string).split(",").map((t: string) => t.trim()).filter(Boolean)
              : undefined;
            try {
              const note = await noteService.createNote(
                { title: opts.title, content: opts.content, tags },
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
          .action(async (opts) => {
            const conditions: string[] = [];
            const values: unknown[] = [];

            if (opts.folder) { conditions.push("folder = ?"); values.push(opts.folder); }
            if (opts.status) { conditions.push("status = ?"); values.push(opts.status); }
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
          .action(async (query, opts) => {
            const results = await noteService.searchNotes(query, opts.limit);
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
          .action(async (id) => {
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
          .action(async (opts) => {
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
              "zettel_sample_curations", "zettel_system_tunings", "zettel_feedback_stats",
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
          .action(async (opts) => {
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
          .action(async (opts) => {
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
          .action(async (opts) => {
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
          .action(async (opts) => {
            const folderFilter = opts.folder ? [opts.folder] : undefined;
            const graph = heatmapService.generateNetworkGraph({
              limit: Number.isFinite(opts.limit) ? opts.limit : 200,
              folderFilter,
              glowMin: Number.isFinite(opts.glowMin) ? opts.glowMin : 0,
            });
            
            const output = JSON.stringify(graph, null, 2);
            
            if (opts.output) {
              const { writeFileSync } = await import("node:fs");
              writeFileSync(opts.output, output, "utf-8");
              api.logger.info(`[zettelkasten] Graph exported to ${opts.output}`);
            } else {
              api.logger.info("[zettelkasten] ════════════════════════════════════════");
              api.logger.info(`[zettelkasten] Knowledge Graph: ${graph.meta.nodeCount} nodes, ${graph.meta.edgeCount} edges`);
              api.logger.info("[zettelkasten] ════════════════════════════════════════");
              api.logger.info(output);
            }
          });
      },
      {
        commands: ["zk"],
        descriptors: [
          { name: "zk", description: "Zettelkasten second memory system commands", hasSubcommands: true },
        ],
      },
    );

    if (config.sessionHook.enabled) {
      api.on("session_end", async (event, ctx) => {
        api.logger.info(
          `[zettelkasten] Session ended: ${event.sessionId}, messages: ${event.messageCount}`,
        );
      });
    }

    if (config.nightlyDistill.enabled) {
      let timer: ReturnType<typeof setInterval> | undefined;
      api.registerService({
        id: "zettelkasten-nightly-distill",
        start(_ctx) {
          api.logger.info("[zettelkasten] Nightly service started (distill + auto-archive)");
          const intervalMs = 60 * 60 * 1000;
          timer = setInterval(async () => {
            const now = new Date();
            if (now.getHours() === 2 && now.getMinutes() === 0) {
              // 1. Nightly distillation
              api.logger.info("[zettelkasten] Running nightly distillation...");
              try {
                const existingNotes: ZettelNote[] = [];
                const job = await distillerService.distillYesterday(existingNotes);
                api.logger.info(
                  `[zettelkasten] Nightly distill complete: created=${job.createdCount} merged=${job.mergedCount} skipped=${job.skippedCount}`,
                );
              } catch (err) {
                api.logger.error(`[zettelkasten] Nightly distill failed: ${err instanceof Error ? err.message : String(err)}`);
              }

              // 2. Auto-archive zombies
              api.logger.info("[zettelkasten] Running nightly auto-archive...");
              try {
                const result = archiveService.autoArchiveZombies();
                if (result.archived > 0) {
                  api.logger.info(
                    `[zettelkasten] Auto-archive complete: ${result.archived} zombie(s) archived`,
                  );
                  for (const n of result.notes) {
                    api.logger.info(`  - ${n.title}: ${n.reason}`);
                  }
                } else {
                  api.logger.info("[zettelkasten] Auto-archive: no zombies found");
                }
              } catch (err) {
                api.logger.error(`[zettelkasten] Auto-archive failed: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          }, intervalMs);
        },
        stop(_ctx) {
          if (timer) {
            clearInterval(timer);
            timer = undefined;
          }
          api.logger.info("[zettelkasten] Nightly service stopped");
        },
      });
    }
  },
});
