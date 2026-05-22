/**
 * 反馈服务
 * 
 * 提供人机反馈闭环机制
 */

import type { DatabaseSync } from "node:sqlite";
import { FeedbackRepository } from "../repository/feedback-repository.js";
import { SystemTuningRepository } from "../repository/system-tuning-repository.js";
import type {
  Feedback,
  CreateFeedbackParams,
  FeedbackQueryParams,
  FeedbackStats,
  FeedbackType,
  FeedbackSource,
  ReviewTargetType,
  FeedbackServiceConfig,
} from "../core/types-phase5.js";

export class FeedbackService {
  private feedbackRepo: FeedbackRepository;
  private tuningRepo: SystemTuningRepository;
  private config: FeedbackServiceConfig;

  constructor(
    private db: DatabaseSync,
    config?: Partial<FeedbackServiceConfig>
  ) {
    this.feedbackRepo = new FeedbackRepository(db);
    this.tuningRepo = new SystemTuningRepository(db);
    this.config = {
      enabled: true,
      processingIntervalMinutes: 60,
      autoProcessThreshold: 0.8,
      retentionDays: 90,
      ...config,
    };
  }

  /**
   * 提交反馈
   */
  submitFeedback(params: CreateFeedbackParams): Feedback {
    const feedback = this.feedbackRepo.create(params);

    // 如果应该自动处理，则处理并返回更新后的反馈
    if (this.shouldAutoProcess(params)) {
      return this.processFeedbackAndReturn(feedback.id);
    }

    return feedback;
  }

  /**
   * 判断是否应自动处理反馈
   */
  private shouldAutoProcess(params: CreateFeedbackParams): boolean {
    // 系统反馈且评分明确定时自动处理
    if (params.rating !== undefined) {
      return params.rating >= this.config.autoProcessThreshold || params.rating < 0.3;
    }
    // 正面反馈自动处理
    if (params.feedbackType === "thumbs_up") {
      return true;
    }
    return false;
  }

  /**
   * 处理正面反馈
   */
  private handlePositiveFeedback(feedback: Feedback): void {
    // 正面反馈可用于提升相关内容的权重
    // TODO: replace with structured logger
    // console.log(`[FeedbackService] Positive feedback received for ${feedback.targetType}:${feedback.targetId}`);
  }

  /**
   * 处理负面反馈
   */
  private handleNegativeFeedback(feedback: Feedback): void {
    // 负面反馈触发人工审核
    // TODO: replace with structured logger
    // console.log(`[FeedbackService] Negative feedback received for ${feedback.targetType}:${feedback.targetId}`);
  }

  /**
   * 处理纠错反馈
   */
  private handleCorrectionFeedback(feedback: Feedback): void {
    // 纠错反馈用于改进系统
    // TODO: replace with structured logger
    // console.log(`[FeedbackService] Correction received for ${feedback.targetType}:${feedback.targetId}`);
  }

  /**
   * 处理建议反馈
   */
  private handleSuggestionFeedback(feedback: Feedback): void {
    // 建议反馈用于系统优化
    // TODO: replace with structured logger
    // console.log(`[FeedbackService] Suggestion received for ${feedback.targetType}:${feedback.targetId}`);
  }

  /**
   * 批量提交反馈
   */
  batchSubmitFeedback(paramsArray: CreateFeedbackParams[]): Feedback[] {
    return paramsArray.map((params) => this.submitFeedback(params));
  }

  /**
   * 处理反馈
   */
  processFeedback(feedbackId: string): boolean {
    const feedback = this.feedbackRepo.get(feedbackId);
    if (!feedback || feedback.processed) {
      return false;
    }

    // 标记为已处理
    const marked = this.feedbackRepo.markAsProcessed(feedbackId);
    if (!marked) {
      return false;
    }

    // 根据反馈类型执行相应操作
    switch (feedback.feedbackType) {
      case "thumbs_up":
        this.handlePositiveFeedback(feedback);
        break;
      case "thumbs_down":
        this.handleNegativeFeedback(feedback);
        break;
      case "correction":
        this.handleCorrectionFeedback(feedback);
        break;
      case "suggestion":
        this.handleSuggestionFeedback(feedback);
        break;
      default:
        break;
    }

    return true;
  }

  /**
   * 处理反馈并返回更新后的反馈对象
   */
  private processFeedbackAndReturn(feedbackId: string): Feedback {
    const feedback = this.feedbackRepo.get(feedbackId);
    if (!feedback || feedback.processed) {
      return feedback!;
    }

    // 根据反馈类型执行相应操作
    switch (feedback.feedbackType) {
      case "thumbs_up":
        this.handlePositiveFeedback(feedback);
        break;
      case "thumbs_down":
        this.handleNegativeFeedback(feedback);
        break;
      case "correction":
        this.handleCorrectionFeedback(feedback);
        break;
      case "suggestion":
        this.handleSuggestionFeedback(feedback);
        break;
      default:
        break;
    }

    // 标记为已处理
    this.feedbackRepo.markAsProcessed(feedbackId);

    // 返回更新后的反馈
    return { ...feedback, processed: true };
  }

  /**
   * 获取反馈统计
   */
  getStats(): FeedbackStats {
    return this.feedbackRepo.getStats();
  }

  /**
   * 查询反馈
   */
  queryFeedback(params: FeedbackQueryParams = {}): Feedback[] {
    return this.feedbackRepo.query(params);
  }

  /**
   * 获取未处理的反馈
   */
  getUnprocessedFeedback(limit: number = 50): Feedback[] {
    return this.feedbackRepo.getUnprocessed(limit);
  }

  /**
   * 获取目标的反馈
   */
  getFeedbackByTarget(targetType: ReviewTargetType, targetId: string): Feedback[] {
    return this.feedbackRepo.getByTarget(targetType, targetId);
  }

  /**
   * 删除反馈
   */
  deleteFeedback(id: string): boolean {
    return this.feedbackRepo.delete(id);
  }

  /**
   * 分析反馈趋势
   */
  analyzeTrends(timeRange: { start: string; end: string }): {
    period: string;
    totalFeedback: number;
    positiveRate: number;
    negativeRate: number;
    averageRating: number;
    topIssues: Array<{ type: string; count: number }>;
  } {
    const feedbacks = this.feedbackRepo.query({
      startDate: timeRange.start,
      endDate: timeRange.end,
      limit: 10000,
    });

    const total = feedbacks.length;
    const positive = feedbacks.filter(
      (f) => f.feedbackType === "thumbs_up"
    ).length;
    const negative = feedbacks.filter(
      (f) => f.feedbackType === "thumbs_down"
    ).length;
    const ratings = feedbacks
      .filter((f) => f.rating !== undefined)
      .map((f) => f.rating!);

    // 统计各类问题
    const issueCounts: Record<string, number> = {};
    for (const feedback of feedbacks) {
      if (feedback.feedbackType === "correction" || feedback.feedbackType === "suggestion") {
        issueCounts[feedback.feedbackType] = (issueCounts[feedback.feedbackType] || 0) + 1;
      }
    }

    const topIssues = Object.entries(issueCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      period: `${timeRange.start} to ${timeRange.end}`,
      totalFeedback: total,
      positiveRate: total > 0 ? positive / total : 0,
      negativeRate: total > 0 ? negative / total : 0,
      averageRating:
        ratings.length > 0
          ? ratings.reduce((a, b) => a + b, 0) / ratings.length
          : 0,
      topIssues,
    };
  }

  /**
   * 生成系统调优建议
   */
  generateTuningSuggestions(): Array<{
    parameter: string;
    currentValue: string;
    suggestedValue: string;
    confidence: number;
    reason: string;
  }> {
    const suggestions: Array<{
      parameter: string;
      currentValue: string;
      suggestedValue: string;
      confidence: number;
      reason: string;
    }> = [];

    // 分析反馈趋势
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const trends = this.analyzeTrends({
      start: oneWeekAgo.toISOString(),
      end: now.toISOString(),
    });

    // 根据负面反馈率建议调整
    if (trends.negativeRate > 0.3) {
      const currentThreshold = this.tuningRepo.getLatestByParameter("autoReviewThreshold");
      const currentValue = currentThreshold?.parameterValue ?? "0.9";
      const newValue = Math.min(parseFloat(currentValue) + 0.1, 1.0).toString();

      suggestions.push({
        parameter: "autoReviewThreshold",
        currentValue,
        suggestedValue: newValue,
        confidence: trends.negativeRate,
        reason: `High negative feedback rate (${(trends.negativeRate * 100).toFixed(1)}%), suggesting stricter auto-review threshold`,
      });
    }

    // 根据平均评分建议调整
    if (trends.averageRating < 3.0) {
      suggestions.push({
        parameter: "confidenceWeight",
        currentValue: "0.5",
        suggestedValue: "0.7",
        confidence: 0.7,
        reason: `Low average rating (${trends.averageRating.toFixed(2)}), suggesting higher confidence weight`,
      });
    }

    return suggestions;
  }

  /**
   * 应用系统调优
   */
  applyTuning(
    parameterName: string,
    newValue: string,
    reason: string,
    autoTuned: boolean = false
  ): boolean {
    const currentValue = this.tuningRepo.getLatestByParameter(parameterName)?.parameterValue;

    this.tuningRepo.create({
      parameterName,
      parameterValue: newValue,
      previousValue: currentValue,
      changeReason: reason,
      autoTuned,
      tuningScore: autoTuned ? 0.8 : undefined,
    });

    return true;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<FeedbackServiceConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
