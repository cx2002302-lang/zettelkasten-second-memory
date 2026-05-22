/**
 * Phase 5: 人机共生与反馈 - 类型定义
 * 
 * 本文件包含审核、反馈、提示词版本和样本策划相关的类型定义
 */

import type { ZettelNote, Link, Tag } from "./types.js";

// ============================================================================
// 审核系统类型
// ============================================================================

/** 审核目标类型 */
export type ReviewTargetType = "note" | "link" | "tag" | "system";

/** 审核动作 */
export type ReviewAction = "approve" | "reject" | "modify" | "flag";

/** 审核记录 */
export interface Review {
  id: string;
  targetType: ReviewTargetType;
  targetId: string;
  reviewerId?: string;
  action: ReviewAction;
  previousConfidence?: number;
  newConfidence?: number;
  previousFolder?: string;
  newFolder?: string;
  comment?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/** 创建审核记录参数 */
export interface CreateReviewParams {
  targetType: ReviewTargetType;
  targetId: string;
  reviewerId?: string;
  action: ReviewAction;
  previousConfidence?: number;
  newConfidence?: number;
  previousFolder?: string;
  newFolder?: string;
  comment?: string;
  metadata?: Record<string, unknown>;
}

/** 审核查询参数 */
export interface ReviewQueryParams {
  targetType?: ReviewTargetType;
  targetId?: string;
  reviewerId?: string;
  action?: ReviewAction;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

/** 审核统计 */
export interface ReviewStats {
  totalReviews: number;
  approvedCount: number;
  rejectedCount: number;
  modifiedCount: number;
  flaggedCount: number;
  pendingCount: number;
  averageReviewTime?: number;
  byTargetType: Record<ReviewTargetType, number>;
}

// ============================================================================
// 反馈系统类型
// ============================================================================

/** 反馈类型 */
export type FeedbackType = "thumbs_up" | "thumbs_down" | "comment" | "correction" | "suggestion";

/** 反馈来源 */
export type FeedbackSource = "user" | "agent" | "system";

/** 反馈记录 */
export interface Feedback {
  id: string;
  targetType: ReviewTargetType;
  targetId: string;
  feedbackType: FeedbackType;
  source: FeedbackSource;
  sourceId?: string;
  content?: string;
  rating?: number;
  metadata?: Record<string, unknown>;
  processed: boolean;
  processedAt?: string;
  createdAt: string;
}

/** 创建反馈参数 */
export interface CreateFeedbackParams {
  targetType: ReviewTargetType;
  targetId: string;
  feedbackType: FeedbackType;
  source: FeedbackSource;
  sourceId?: string;
  content?: string;
  rating?: number;
  metadata?: Record<string, unknown>;
}

/** 反馈查询参数 */
export interface FeedbackQueryParams {
  targetType?: ReviewTargetType;
  targetId?: string;
  feedbackType?: FeedbackType;
  source?: FeedbackSource;
  processed?: boolean;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

/** 反馈统计 */
export interface FeedbackStats {
  totalFeedback: number;
  thumbsUpCount: number;
  thumbsDownCount: number;
  commentCount: number;
  correctionCount: number;
  suggestionCount: number;
  averageRating?: number;
  processedCount: number;
  unprocessedCount: number;
  byTargetType: Record<ReviewTargetType, number>;
}

// ============================================================================
// 提示词版本类型
// ============================================================================

/** 提示词类型 */
export type PromptType = "capture" | "explain" | "question" | "refine" | "connect" | "distill" | "dedupe";

/** 提示词版本 */
export interface PromptVersion {
  id: string;
  promptType: PromptType;
  version: number;
  content: string;
  description?: string;
  isActive: boolean;
  usageCount: number;
  averageScore?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  activatedAt?: string;
}

/** 创建提示词版本参数 */
export interface CreatePromptVersionParams {
  promptType: PromptType;
  content: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/** 更新提示词版本参数 */
export interface UpdatePromptVersionParams {
  description?: string;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
}

/** 提示词效果统计 */
export interface PromptEffectiveness {
  promptId: string;
  promptType: PromptType;
  version: number;
  usageCount: number;
  averageScore: number;
  successRate: number;
  lastUsedAt?: string;
}

// ============================================================================
// 样本策划类型
// ============================================================================

/** 策划样本状态 */
export type CurationStatus = "pending" | "approved" | "rejected" | "exported";

/** 样本质量评分 */
export interface QualityScores {
  relevance: number;
  clarity: number;
  atomicity: number;
  connectivity: number;
  overall: number;
}

/** 策划样本 */
export interface SampleCuration {
  id: string;
  noteId: string;
  qualityScores: QualityScores;
  curationStatus: CurationStatus;
  curatorId?: string;
  curationNotes?: string;
  exportBatchId?: string;
  metadata?: Record<string, unknown>;
  curatedAt?: string;
  createdAt: string;
}

/** 创建策划样本参数 */
export interface CreateSampleCurationParams {
  noteId: string;
  qualityScores: QualityScores;
  curationStatus?: CurationStatus;
  curatorId?: string;
  curationNotes?: string;
  metadata?: Record<string, unknown>;
}

/** 更新策划样本参数 */
export interface UpdateSampleCurationParams {
  qualityScores?: Partial<QualityScores>;
  curationStatus?: CurationStatus;
  curatorId?: string;
  curationNotes?: string;
  exportBatchId?: string;
  metadata?: Record<string, unknown>;
}

/** 样本查询参数 */
export interface SampleQueryParams {
  curationStatus?: CurationStatus;
  curatorId?: string;
  minQualityScore?: number;
  exportBatchId?: string;
  limit?: number;
  offset?: number;
}

/** 导出批次 */
export interface ExportBatch {
  id: string;
  sampleCount: number;
  filePath: string;
  exportedAt: string;
  expiresAt: string;
}

/** 创建导出批次参数 */
export interface CreateExportBatchParams {
  sampleIds: string[];
  filePath: string;
  expiresAt: string;
}

// ============================================================================
// 系统调优类型
// ============================================================================

/** 系统调优参数 */
export interface SystemTuning {
  id: string;
  parameterName: string;
  parameterValue: string;
  previousValue?: string;
  changeReason?: string;
  feedbackId?: string;
  autoTuned: boolean;
  tuningScore?: number;
  metadata?: Record<string, unknown>;
  appliedAt: string;
}

/** 创建系统调优参数 */
export interface CreateSystemTuningParams {
  parameterName: string;
  parameterValue: string;
  previousValue?: string;
  changeReason?: string;
  feedbackId?: string;
  autoTuned?: boolean;
  tuningScore?: number;
  metadata?: Record<string, unknown>;
}

/** 系统调优查询参数 */
export interface SystemTuningQueryParams {
  parameterName?: string;
  autoTuned?: boolean;
  feedbackId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// 审核面板类型
// ============================================================================

/** 待审核项目 */
export interface PendingReviewItem {
  id: string;
  targetType: ReviewTargetType;
  targetId: string;
  targetTitle?: string;
  targetSummary?: string;
  currentConfidence?: number;
  currentFolder?: string;
  createdAt: string;
  source?: string;
}

/** 审核面板状态 */
export interface ReviewPanelState {
  pendingCount: number;
  totalCount: number;
  items: PendingReviewItem[];
  stats: ReviewStats;
}

/** 批量审核参数 */
export interface BatchReviewParams {
  items: Array<{
    targetType: ReviewTargetType;
    targetId: string;
    action: ReviewAction;
    newConfidence?: number;
    newFolder?: string;
    comment?: string;
  }>;
  reviewerId?: string;
}

// ============================================================================
// 反馈闭环类型
// ============================================================================

/** 反馈循环状态 */
export type FeedbackLoopStatus = "open" | "processing" | "resolved" | "closed";

/** 反馈循环 */
export interface FeedbackLoop {
  id: string;
  feedbackId: string;
  status: FeedbackLoopStatus;
  assignedTo?: string;
  priority: number;
  resolution?: string;
  relatedTuningId?: string;
  metadata?: Record<string, unknown>;
  openedAt: string;
  resolvedAt?: string;
  closedAt?: string;
}

/** 创建反馈循环参数 */
export interface CreateFeedbackLoopParams {
  feedbackId: string;
  assignedTo?: string;
  priority?: number;
  metadata?: Record<string, unknown>;
}

/** 反馈闭环统计 */
export interface FeedbackLoopStats {
  totalLoops: number;
  openCount: number;
  processingCount: number;
  resolvedCount: number;
  closedCount: number;
  averageResolutionTime?: number;
  byPriority: Record<number, number>;
}

// ============================================================================
// 提示词进化类型
// ============================================================================

/** 提示词进化建议 */
export interface PromptEvolutionSuggestion {
  id: string;
  promptType: PromptType;
  currentVersionId: string;
  suggestedContent: string;
  suggestionReason: string;
  confidence: number;
  basedOnFeedbackIds: string[];
  applied: boolean;
  appliedVersionId?: string;
  createdAt: string;
}

/** 创建进化建议参数 */
export interface CreateEvolutionSuggestionParams {
  promptType: PromptType;
  currentVersionId: string;
  suggestedContent: string;
  suggestionReason: string;
  confidence: number;
  basedOnFeedbackIds: string[];
}

/** 提示词进化统计 */
export interface PromptEvolutionStats {
  totalSuggestions: number;
  appliedSuggestions: number;
  pendingSuggestions: number;
  rejectedSuggestions: number;
  byPromptType: Record<PromptType, {
    total: number;
    applied: number;
    averageConfidence: number;
  }>;
}

// ============================================================================
// 服务配置类型
// ============================================================================

/** 审核服务配置 */
export interface ReviewServiceConfig {
  /** 是否需要人工审核 */
  requireHumanReview: boolean;
  /** 自动审核阈值 */
  autoReviewThreshold: number;
  /** 审核超时时间（小时） */
  reviewTimeoutHours: number;
  /** 通知方式 */
  notificationChannels: string[];
  /** 飞书 Webhook URL（可选，用于 Inbox 积压提醒） */
  feishuWebhook?: string;
  /** 积压处理：超过 N 天未审核的笔记强制处理 */
  staleReviewDays: number;
}

/** 反馈服务配置 */
export interface FeedbackServiceConfig {
  /** 是否启用反馈收集 */
  enabled: boolean;
  /** 反馈处理间隔（分钟） */
  processingIntervalMinutes: number;
  /** 自动处理阈值 */
  autoProcessThreshold: number;
  /** 保留天数 */
  retentionDays: number;
}

/** 提示词进化服务配置 */
export interface PromptEvolutionConfig {
  /** 是否启用自动进化 */
  autoEvolution: boolean;
  /** 最小反馈样本数 */
  minFeedbackSamples: number;
  /** 进化建议阈值 */
  suggestionThreshold: number;
  /** 最大版本数 */
  maxVersions: number;
}

/** 样本策划服务配置 */
export interface SampleCurationConfig {
  /** 质量阈值 */
  qualityThreshold: number;
  /** 自动策划 */
  autoCuration: boolean;
  /** 导出格式 */
  exportFormat: "jsonl" | "csv" | "json";
  /** 导出路径 */
  exportPath: string;
}

// ============================================================================
// Phase 5 综合类型
// ============================================================================

/** Phase 5 完整配置 */
export interface Phase5Config {
  review: ReviewServiceConfig;
  feedback: FeedbackServiceConfig;
  promptEvolution: PromptEvolutionConfig;
  sampleCuration: SampleCurationConfig;
}

/** Phase 5 系统统计 */
export interface Phase5Stats {
  reviews: ReviewStats;
  feedback: FeedbackStats;
  feedbackLoops: FeedbackLoopStats;
  promptEvolution: PromptEvolutionStats;
  activePrompts: number;
  pendingSamples: number;
  exportedSamples: number;
}

/** Phase 5 初始化参数 */
export interface Phase5InitParams {
  dbPath: string;
  config?: Partial<Phase5Config>;
}