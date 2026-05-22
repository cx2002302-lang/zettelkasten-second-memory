import { Type } from "@sinclair/typebox";
import { jsonResult, readStringParam, readNumberParam } from "openclaw/plugin-sdk/core";

import { NoteService } from "../../service/note-service.js";
import { ReviewService } from "../../service/review-service.js";
import { FeedbackService } from "../../service/feedback-service.js";
import { PromptEvolutionService } from "../../service/prompt-evolution-service.js";
import { SampleCurationService } from "../../service/sample-curation-service.js";
import type { ZettelkastenPluginConfig } from "../config.js";

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

const ZkGetReviewPanelSchema = Type.Object({}, { additionalProperties: false });

const ZkSubmitReviewSchema = Type.Object(
  {
    target_type: Type.String({ description: "Target type", enum: ["note", "link", "tag", "system"] }),
    target_id: Type.String({ description: "Target ID" }),
    action: Type.String({ description: "Action", enum: ["approve", "reject", "modify", "flag"] }),
    new_confidence: Type.Optional(Type.Number({ description: "New confidence 0-1", minimum: 0, maximum: 1 })),
    new_folder: Type.Optional(Type.String({ description: "Folder", enum: ["inbox", "references", "zettels"] })),
    comment: Type.Optional(Type.String({ description: "Review comment" })),
  },
  { additionalProperties: false },
);

const ZkGetReviewStatsSchema = Type.Object({}, { additionalProperties: false });

const ZkSubmitFeedbackSchema = Type.Object(
  {
    target_type: Type.String({ description: "Target type", enum: ["note", "link", "tag", "system"] }),
    target_id: Type.String({ description: "Target ID" }),
    feedback_type: Type.String({ description: "Type", enum: ["thumbs_up", "thumbs_down", "comment", "correction", "suggestion"] }),
    content: Type.Optional(Type.String({ description: "Feedback content" })),
    rating: Type.Optional(Type.Number({ description: "Rating 1-5", minimum: 1, maximum: 5 })),
  },
  { additionalProperties: false },
);

const ZkGetFeedbackStatsSchema = Type.Object({}, { additionalProperties: false });

const ZkAnalyzeFeedbackTrendsSchema = Type.Object(
  {
    days: Type.Optional(Type.Number({ description: "Days", minimum: 1, maximum: 365 })),
  },
  { additionalProperties: false },
);

const ZkGetActivePromptSchema = Type.Object(
  {
    prompt_type: Type.String({ description: "Type", enum: ["capture", "explain", "question", "refine", "connect", "distill", "dedupe"] }),
  },
  { additionalProperties: false },
);

const ZkGetPromptStatsSchema = Type.Object({}, { additionalProperties: false });

const ZkGetCurationStatsSchema = Type.Object({}, { additionalProperties: false });

const ZkExportSamplesSchema = Type.Object(
  {
    format: Type.Optional(Type.String({ description: "Format", enum: ["jsonl", "json", "csv"] })),
    min_score: Type.Optional(Type.Number({ description: "Min score 0-1", minimum: 0, maximum: 1 })),
  },
  { additionalProperties: false },
);

export function createZkReviewNoteTool(
  noteService: NoteService,
  _config: ZettelkastenPluginConfig,
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

export function createZkGetReviewPanelTool(reviewService: ReviewService) {
  return {
    name: "zk_get_review_panel",
    label: "ZK Get Review Panel",
    description: "Get review panel with pending items and stats",
    parameters: ZkGetReviewPanelSchema,
    execute: async () => {
      const result = reviewService.getReviewPanelState();
      return jsonResult(result);
    },
  };
}

export function createZkSubmitReviewTool(reviewService: ReviewService) {
  return {
    name: "zk_submit_review",
    label: "ZK Submit Review",
    description: "Submit a review decision",
    parameters: ZkSubmitReviewSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const targetType = readStringParam(rawParams, "target_type", { required: true }) as "note" | "link" | "tag" | "system";
      const targetId = readStringParam(rawParams, "target_id", { required: true });
      const action = readStringParam(rawParams, "action", { required: true }) as "approve" | "reject" | "modify" | "flag";
      const newConfidence = readNumberParam(rawParams, "new_confidence");
      const newFolder = readStringParam(rawParams, "new_folder") as "inbox" | "references" | "zettels" | undefined;
      const comment = readStringParam(rawParams, "comment");

      const result = reviewService.createReview({
        targetType,
        targetId,
        action,
        newConfidence: newConfidence ?? undefined,
        newFolder,
        comment: comment ?? undefined,
      });
      return jsonResult(result);
    },
  };
}

export function createZkGetReviewStatsTool(reviewService: ReviewService) {
  return {
    name: "zk_get_review_stats",
    label: "ZK Get Review Stats",
    description: "Get review statistics",
    parameters: ZkGetReviewStatsSchema,
    execute: async () => {
      const result = reviewService.getStats();
      return jsonResult(result);
    },
  };
}

export function createZkSubmitFeedbackTool(feedbackService: FeedbackService) {
  return {
    name: "zk_submit_feedback",
    label: "ZK Submit Feedback",
    description: "Submit feedback",
    parameters: ZkSubmitFeedbackSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const targetType = readStringParam(rawParams, "target_type", { required: true }) as "note" | "link" | "tag" | "system";
      const targetId = readStringParam(rawParams, "target_id", { required: true });
      const feedbackType = readStringParam(rawParams, "feedback_type", { required: true }) as "thumbs_up" | "thumbs_down" | "comment" | "correction" | "suggestion";
      const content = readStringParam(rawParams, "content");
      const rating = readNumberParam(rawParams, "rating", { integer: true });

      const result = feedbackService.submitFeedback({
        targetType,
        targetId,
        feedbackType,
        source: "user",
        content: content ?? undefined,
        rating: rating ?? undefined,
      });
      return jsonResult(result);
    },
  };
}

export function createZkGetFeedbackStatsTool(feedbackService: FeedbackService) {
  return {
    name: "zk_get_feedback_stats",
    label: "ZK Get Feedback Stats",
    description: "Get feedback statistics",
    parameters: ZkGetFeedbackStatsSchema,
    execute: async () => {
      const result = feedbackService.getStats();
      return jsonResult(result);
    },
  };
}

export function createZkAnalyzeFeedbackTrendsTool(feedbackService: FeedbackService) {
  return {
    name: "zk_analyze_feedback_trends",
    label: "ZK Analyze Feedback Trends",
    description: "Analyze feedback trends",
    parameters: ZkAnalyzeFeedbackTrendsSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const days = readNumberParam(rawParams, "days", { integer: true }) ?? 7;
      const end = new Date();
      const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
      const result = feedbackService.analyzeTrends({
        start: start.toISOString(),
        end: end.toISOString(),
      });
      return jsonResult(result);
    },
  };
}

export function createZkGetActivePromptTool(promptService: PromptEvolutionService) {
  return {
    name: "zk_get_active_prompt",
    label: "ZK Get Active Prompt",
    description: "Get active prompt by type",
    parameters: ZkGetActivePromptSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const promptType = readStringParam(rawParams, "prompt_type", { required: true }) as "capture" | "explain" | "question" | "refine" | "connect" | "distill" | "dedupe";
      const result = promptService.getActivePrompt(promptType);
      return jsonResult(result);
    },
  };
}

export function createZkGetPromptStatsTool(promptService: PromptEvolutionService) {
  return {
    name: "zk_get_prompt_stats",
    label: "ZK Get Prompt Stats",
    description: "Get prompt statistics",
    parameters: ZkGetPromptStatsSchema,
    execute: async () => {
      const result = promptService.getEffectivenessStats();
      return jsonResult(result);
    },
  };
}

export function createZkGetCurationStatsTool(curationService: SampleCurationService) {
  return {
    name: "zk_get_curation_stats",
    label: "ZK Get Curation Stats",
    description: "Get curation statistics",
    parameters: ZkGetCurationStatsSchema,
    execute: async () => {
      const result = curationService.getStats();
      return jsonResult(result);
    },
  };
}

export function createZkExportSamplesTool(curationService: SampleCurationService) {
  return {
    name: "zk_export_samples",
    label: "ZK Export Samples",
    description: "Export curated samples",
    parameters: ZkExportSamplesSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const format = (readStringParam(rawParams, "format") ?? "jsonl") as "jsonl" | "json" | "csv";
      const minScore = readNumberParam(rawParams, "min_score") ?? 0.8;
      const samples = curationService.getHighQualitySamples(minScore, 1000);
      const sampleIds = samples.map((s) => s.id);
      const result = curationService.exportSamples(sampleIds, format);
      return jsonResult(result);
    },
  };
}
