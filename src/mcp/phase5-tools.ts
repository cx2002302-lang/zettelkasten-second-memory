/**
 * Phase 5 MCP 工具
 * 
 * 提供人机共生与反馈相关的 MCP 工具
 */

import type { DatabaseSync } from "node:sqlite";
import { ReviewService } from "../service/review-service.js";
import { FeedbackService } from "../service/feedback-service.js";
import { PromptEvolutionService } from "../service/prompt-evolution-service.js";
import { SampleCurationService } from "../service/sample-curation-service.js";
import type {
  ReviewAction,
  ReviewTargetType,
  FeedbackType,
  FeedbackSource,
  PromptType,
} from "../core/types-phase5.js";

export interface Phase5ToolsConfig {
  enableReviewTools: boolean;
  enableFeedbackTools: boolean;
  enablePromptTools: boolean;
  enableCurationTools: boolean;
}

export class Phase5MCPTools {
  private reviewService: ReviewService;
  private feedbackService: FeedbackService;
  private promptService: PromptEvolutionService;
  private curationService: SampleCurationService;
  private config: Phase5ToolsConfig;

  constructor(
    private db: DatabaseSync,
    config?: Partial<Phase5ToolsConfig>
  ) {
    this.reviewService = new ReviewService(db);
    this.feedbackService = new FeedbackService(db);
    this.promptService = new PromptEvolutionService(db);
    this.curationService = new SampleCurationService(db);
    this.config = {
      enableReviewTools: true,
      enableFeedbackTools: true,
      enablePromptTools: true,
      enableCurationTools: true,
      ...config,
    };
  }

  /**
   * 获取所有 Phase 5 工具
   */
  getTools(): any[] {
    const tools: any[] = [];

    // 审核工具
    if (this.config.enableReviewTools) {
      tools.push(
        {
          name: "zk_get_review_panel",
          description: "获取审核面板状态（待审核项目列表和统计）",
          inputSchema: {
            type: "object",
            properties: {},
          },
          handler: async () => await this.getReviewPanel(),
        },
        {
          name: "zk_submit_review",
          description: "提交审核决定",
          inputSchema: {
            type: "object",
            properties: {
              targetType: {
                type: "string",
                enum: ["note", "link", "tag", "system"],
                description: "审核目标类型",
              },
              targetId: { type: "string", description: "目标ID" },
              action: {
                type: "string",
                enum: ["approve", "reject", "modify", "flag"],
                description: "审核动作",
              },
              newConfidence: {
                type: "number",
                description: "新的置信度评分",
              },
              newFolder: {
                type: "string",
                enum: ["inbox", "references", "zettels"],
                description: "新的文件夹",
              },
              comment: { type: "string", description: "审核意见" },
            },
            required: ["targetType", "targetId", "action"],
          },
          handler: async (args: any) =>
            await this.submitReview(
              args.targetType,
              args.targetId,
              args.action,
              args.newConfidence,
              args.newFolder,
              args.comment
            ),
        },
        {
          name: "zk_get_review_stats",
          description: "获取审核统计信息",
          inputSchema: {
            type: "object",
            properties: {},
          },
          handler: async () => await this.getReviewStats(),
        }
      );
    }

    // 反馈工具
    if (this.config.enableFeedbackTools) {
      tools.push(
        {
          name: "zk_submit_feedback",
          description: "提交反馈",
          inputSchema: {
            type: "object",
            properties: {
              targetType: {
                type: "string",
                enum: ["note", "link", "tag", "system"],
                description: "反馈目标类型",
              },
              targetId: { type: "string", description: "目标ID" },
              feedbackType: {
                type: "string",
                enum: ["thumbs_up", "thumbs_down", "comment", "correction", "suggestion"],
                description: "反馈类型",
              },
              content: { type: "string", description: "反馈内容" },
              rating: { type: "number", description: "评分 1-5" },
            },
            required: ["targetType", "targetId", "feedbackType"],
          },
          handler: async (args: any) =>
            await this.submitFeedback(
              args.targetType,
              args.targetId,
              args.feedbackType,
              args.content,
              args.rating
            ),
        },
        {
          name: "zk_get_feedback_stats",
          description: "获取反馈统计",
          inputSchema: {
            type: "object",
            properties: {},
          },
          handler: async () => await this.getFeedbackStats(),
        },
        {
          name: "zk_analyze_feedback_trends",
          description: "分析反馈趋势",
          inputSchema: {
            type: "object",
            properties: {
              days: {
                type: "number",
                description: "分析最近多少天",
                default: 7,
              },
            },
          },
          handler: async (args: any) => await this.analyzeFeedbackTrends(args.days),
        }
      );
    }

    // 提示词工具
    if (this.config.enablePromptTools) {
      tools.push(
        {
          name: "zk_get_active_prompt",
          description: "获取指定类型的活动提示词",
          inputSchema: {
            type: "object",
            properties: {
              promptType: {
                type: "string",
                enum: ["capture", "explain", "question", "refine", "connect", "distill", "dedupe"],
                description: "提示词类型",
              },
            },
            required: ["promptType"],
          },
          handler: async (args: any) => await this.getActivePrompt(args.promptType),
        },
        {
          name: "zk_get_prompt_stats",
          description: "获取提示词效果统计",
          inputSchema: {
            type: "object",
            properties: {},
          },
          handler: async () => await this.getPromptStats(),
        }
      );
    }

    // 样本策划工具
    if (this.config.enableCurationTools) {
      tools.push(
        {
          name: "zk_get_curation_stats",
          description: "获取样本策划统计",
          inputSchema: {
            type: "object",
            properties: {},
          },
          handler: async () => await this.getCurationStats(),
        },
        {
          name: "zk_export_samples",
          description: "导出高质量样本",
          inputSchema: {
            type: "object",
            properties: {
              format: {
                type: "string",
                enum: ["jsonl", "json", "csv"],
                default: "jsonl",
              },
              minScore: {
                type: "number",
                description: "最低质量分数",
                default: 0.8,
              },
            },
          },
          handler: async (args: any) =>
            await this.exportSamples(args.format, args.minScore),
        }
      );
    }

    return tools;
  }

  // ========== 审核工具方法 ==========

  private async getReviewPanel() {
    return this.reviewService.getReviewPanelState();
  }

  private async getReviewStats() {
    return this.reviewService.getStats();
  }

  private async submitReview(
    targetType: ReviewTargetType,
    targetId: string,
    action: ReviewAction,
    newConfidence?: number,
    newFolder?: string,
    comment?: string
  ) {
    return this.reviewService.createReview({
      targetType,
      targetId,
      action,
      newConfidence,
      newFolder,
      comment,
    });
  }

  // ========== 反馈工具方法 ==========

  private async submitFeedback(
    targetType: ReviewTargetType,
    targetId: string,
    feedbackType: FeedbackType,
    content?: string,
    rating?: number
  ) {
    return this.feedbackService.submitFeedback({
      targetType,
      targetId,
      feedbackType,
      source: "user",
      content,
      rating,
    });
  }

  private async getFeedbackStats() {
    return this.feedbackService.getStats();
  }

  private async analyzeFeedbackTrends(days: number = 7) {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    return this.feedbackService.analyzeTrends({
      start: start.toISOString(),
      end: end.toISOString(),
    });
  }

  // ========== 提示词工具方法 ==========

  private async getActivePrompt(promptType: PromptType) {
    return this.promptService.getActivePrompt(promptType);
  }

  private async getPromptStats() {
    return this.promptService.getEffectivenessStats();
  }

  // ========== 样本策划工具方法 ==========

  private async getCurationStats() {
    return this.curationService.getStats();
  }

  private async exportSamples(format: "jsonl" | "json" | "csv" = "jsonl", minScore: number = 0.8) {
    const samples = this.curationService.getHighQualitySamples(minScore, 1000);
    const sampleIds = samples.map((s) => s.id);
    return this.curationService.exportSamples(sampleIds, format);
  }
}