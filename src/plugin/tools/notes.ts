import { Type } from "@sinclair/typebox";
import { jsonResult, readStringParam, readNumberParam } from "openclaw/plugin-sdk/core";
import { existsSync, mkdirSync } from "node:fs";

import type { ZettelNote, NoteFolder, NoteStatus, QueryNotesParams } from "../../core/types.js";
import { NoteService } from "../../service/note-service.js";
import { LinkService } from "../../service/link-service.js";
import { CEQRCEngine } from "../../service/ceqrc-engine.js";
import { DistillerService } from "../../service/distiller-service.js";
import { GlowCalculator } from "../../engine/glow-calculator.js";
import { PathFinder } from "../../engine/path-finder.js";
import { ArchiveService } from "../../service/archive-service.js";
import { KnowledgeHeatmapService } from "../../service/heatmap-service.js";

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
    content: Type.String({ description: "Markdown content" }),
    tags: Type.Optional(Type.Array(Type.String(), {
      description: "Tags for categorization",
    })),
    confidence: Type.Optional(Type.Number({
      description: "Confidence 0-1, routes to zettels(≥0.7)/references(≥0.4)/inbox",
      minimum: 0,
      maximum: 1,
    })),
    source: optionalStringEnum(["manual", "distilled", "ceqrc"] as const, {
      description: "Source type of the note",
    }),
    folder: optionalStringEnum(["inbox", "references", "zettels", "archive"] as const, {
      description: "Override confidence-based folder routing",
    }),
    status: optionalStringEnum(["FLEETING", "LITERATURE", "PERMANENT"] as const, {
      description: "Lifecycle status of the note",
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
    tags: Type.Optional(Type.Array(Type.String(), {
      description: "Filter by tags (AND intersection)",
    })),
    folder: optionalStringEnum(["inbox", "references", "zettels", "archive"] as const, {
      description: "Filter by folder",
    }),
    minConfidence: Type.Optional(Type.Number({
      description: "Minimum confidence score 0-1",
      minimum: 0,
      maximum: 1,
    })),
    maxConfidence: Type.Optional(Type.Number({
      description: "Maximum confidence score 0-1",
      minimum: 0,
      maximum: 1,
    })),
    createdAfter: Type.Optional(Type.String({
      description: "Filter by created_at >= (ISO 8601 date string)",
    })),
    createdBefore: Type.Optional(Type.String({
      description: "Filter by created_at <= (ISO 8601 date string)",
    })),
    updatedAfter: Type.Optional(Type.String({
      description: "Filter by updated_at >= (ISO 8601 date string)",
    })),
    updatedBefore: Type.Optional(Type.String({
      description: "Filter by updated_at <= (ISO 8601 date string)",
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
    folder: optionalStringEnum(["inbox", "references", "zettels", "archive"] as const, {
      description: "Move note to a different folder",
    }),
    status: optionalStringEnum(["FLEETING", "LITERATURE", "PERMANENT"] as const, {
      description: "Update lifecycle status",
    }),
  },
  { additionalProperties: false },
);

const ZkRunCeqrcSchema = Type.Object(
  {
    note_id: Type.String({ description: "Source note ID for CEQRC workflow" }),
    content: Type.String({ description: "CEQRC content" }),
  },
  { additionalProperties: false },
);

const ZkDistillMemorySchema = Type.Object(
  {
    memory_file_path: Type.Optional(Type.String({
      description: "Memory log path, omit for yesterday",
    })),
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
      description: "Max results (default 20)",
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

const ZkGetArchiveLogSchema = Type.Object(
  {
    note_id: Type.Optional(Type.String({ description: "Filter by note ID" })),
    action: Type.Optional(Type.String({ description: "Action", enum: ["archive", "unarchive", "auto_archive"] })),
    limit: Type.Optional(Type.Number({ description: "Max results (default 50)", minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
);

const ZkKnowledgeHeatmapSchema = Type.Object(
  {
    days: Type.Optional(Type.Number({ description: "Days", minimum: 1, maximum: 365 })),
  },
  { additionalProperties: false },
);

const ZkNetworkGraphSchema = Type.Object(
  {
    limit: Type.Optional(Type.Number({ description: "Max nodes", minimum: 1, maximum: 500 })),
    folder_filter: Type.Optional(Type.Array(Type.String(), { description: "Filter by folders" })),
    glow_min: Type.Optional(Type.Number({ description: "Min glow", minimum: 0, maximum: 1 })),
  },
  { additionalProperties: false },
);

export function createZkCreateNoteTool(noteService: NoteService, notesDir: string) {
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
      const folder = readStringParam(rawParams, "folder") as NoteFolder | undefined;
      const status = readStringParam(rawParams, "status") as NoteStatus | undefined;

      if (!existsSync(notesDir)) {
        mkdirSync(notesDir, { recursive: true });
      }

      const note = await noteService.createNote(
        { title, content, tags, folder, status },
        { confidence: confidence ?? undefined, source: source ?? "manual" },
      );

      const hasHotTag = note.tags.includes("svm:hot");
      if (hasHotTag) {
        return jsonResult({ ...note, hot: true });
      }

      return jsonResult(note);
    },
  };
}

export function createZkSearchNotesTool(noteService: NoteService) {
  return {
    name: "zk_search_notes",
    label: "ZK Search Notes",
    description:
      "Full-text search across all Zettelkasten notes. Returns scored results with content snippets.",
    parameters: ZkSearchNotesSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const query = readStringParam(rawParams, "query", { required: true });
      const limit = readNumberParam(rawParams, "limit", { integer: true }) ?? 20;
      const tags = Array.isArray(rawParams.tags) ? (rawParams.tags as string[]).filter((t) => typeof t === "string") : undefined;
      const folder = readStringParam(rawParams, "folder");
      const minConfidence = readNumberParam(rawParams, "minConfidence");
      const maxConfidence = readNumberParam(rawParams, "maxConfidence");
      const createdAfter = readStringParam(rawParams, "createdAfter");
      const createdBefore = readStringParam(rawParams, "createdBefore");
      const updatedAfter = readStringParam(rawParams, "updatedAfter");
      const updatedBefore = readStringParam(rawParams, "updatedBefore");

      const filters: Partial<QueryNotesParams> = {};
      if (tags !== undefined) filters.tags = tags;
      if (folder !== undefined) filters.folder = folder as QueryNotesParams["folder"];
      if (minConfidence !== undefined) filters.minConfidence = minConfidence;
      if (maxConfidence !== undefined) filters.maxConfidence = maxConfidence;
      if (createdAfter !== undefined) filters.createdAfter = createdAfter;
      if (createdBefore !== undefined) filters.createdBefore = createdBefore;
      if (updatedAfter !== undefined) filters.updatedAfter = updatedAfter;
      if (updatedBefore !== undefined) filters.updatedBefore = updatedBefore;

      const results = await noteService.searchNotes(query, limit, {
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      });
      return jsonResult(results);
    },
  };
}

export function createZkGetNoteTool(noteService: NoteService) {
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

export function createZkGetBacklinksTool(linkService: LinkService) {
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

export function createZkFindPathTool(pathFinder: PathFinder) {
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

export function createZkUpdateNoteTool(noteService: NoteService) {
  return {
    name: "zk_update_note",
    label: "ZK Update Note",
    description:
      "Update an existing Zettelkasten note's title, content, confidence, tags, folder, or status. Only provided fields are changed.",
    parameters: ZkUpdateNoteSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const id = readStringParam(rawParams, "id", { required: true });
      const title = readStringParam(rawParams, "title");
      const content = readStringParam(rawParams, "content");
      const confidence = readNumberParam(rawParams, "confidence");
      const tags = Array.isArray(rawParams.tags) ? (rawParams.tags as string[]).filter((t) => typeof t === "string") : undefined;
      const folder = readStringParam(rawParams, "folder") as NoteFolder | undefined;
      const status = readStringParam(rawParams, "status") as NoteStatus | undefined;

      const updateParams: Record<string, unknown> = {};
      if (title !== undefined) updateParams.title = title;
      if (content !== undefined) updateParams.content = content;
      if (confidence !== undefined) updateParams.confidence = confidence;
      if (tags !== undefined) updateParams.tags = tags;
      if (folder !== undefined) updateParams.folder = folder;
      if (status !== undefined) updateParams.status = status;

      const updated = await noteService.updateNote(id, updateParams);
      if (!updated) {
        return jsonResult({ error: `Note "${id}" not found` });
      }

      const hasHotTag = updated.tags.includes("svm:hot");
      if (hasHotTag) {
        return jsonResult({ ...updated, hot: true });
      }

      return jsonResult(updated);
    },
  };
}

export function createZkRunCeqrcTool(
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

export function createZkDistillMemoryTool(distillerService: DistillerService) {
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

export function createZkGlowRankingTool(glowCalculator: GlowCalculator) {
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

export function createZkFindZombiesTool(glowCalculator: GlowCalculator) {
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

export function createZkSearchArchivedTool(noteService: NoteService) {
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

export function createZkArchiveNoteTool(noteService: NoteService) {
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

export function createZkUnarchiveNoteTool(noteService: NoteService) {
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

export function createZkGetArchiveLogTool(archiveService: ArchiveService) {
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

export function createZkKnowledgeHeatmapTool(heatmapService: KnowledgeHeatmapService) {
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

export function createZkNetworkGraphTool(heatmapService: KnowledgeHeatmapService) {
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
