/**
 * 提示词进化服务
 * 
 * 提供提示词版本管理和进化功能
 */

import type { DatabaseSync } from "node:sqlite";
import { PromptVersionRepository } from "../repository/prompt-version-repository.js";
import { FeedbackRepository } from "../repository/feedback-repository.js";
import type {
  PromptVersion,
  CreatePromptVersionParams,
  UpdatePromptVersionParams,
  PromptEffectiveness,
  PromptType,
  PromptEvolutionConfig,
  PromptEvolutionStats,
  CreateEvolutionSuggestionParams,
  PromptEvolutionSuggestion,
} from "../core/types-phase5.js";

export class PromptEvolutionService {
  private promptRepo: PromptVersionRepository;
  private feedbackRepo: FeedbackRepository;
  private config: PromptEvolutionConfig;

  constructor(
    private db: DatabaseSync,
    config?: Partial<PromptEvolutionConfig>
  ) {
    this.promptRepo = new PromptVersionRepository(db);
    this.feedbackRepo = new FeedbackRepository(db);
    this.config = {
      autoEvolution: false,
      minFeedbackSamples: 10,
      suggestionThreshold: 0.7,
      maxVersions: 10,
      ...config,
    };
  }

  /**
   * 创建提示词版本
   */
  createVersion(params: CreatePromptVersionParams): PromptVersion {
    return this.promptRepo.create(params);
  }

  /**
   * 获取活动提示词
   */
  getActivePrompt(promptType: PromptType): PromptVersion | null {
    return this.promptRepo.getActiveByType(promptType);
  }

  /**
   * 获取提示词版本
   */
  getVersion(id: string): PromptVersion | null {
    return this.promptRepo.get(id);
  }

  /**
   * 获取指定类型的所有版本
   */
  getVersionsByType(promptType: PromptType): PromptVersion[] {
    return this.promptRepo.getByType(promptType);
  }

  /**
   * 激活提示词版本
   */
  activateVersion(id: string): boolean {
    return this.promptRepo.activate(id);
  }

  /**
   * 更新提示词版本
   */
  updateVersion(id: string, params: UpdatePromptVersionParams): boolean {
    return this.promptRepo.update(id, params);
  }

  /**
   * 删除提示词版本
   */
  deleteVersion(id: string): boolean {
    return this.promptRepo.delete(id);
  }

  /**
   * 记录提示词使用
   */
  recordUsage(id: string, score?: number): boolean {
    this.promptRepo.incrementUsage(id);
    if (score !== undefined) {
      this.promptRepo.updateScore(id, score);
    }
    return true;
  }

  /**
   * 获取效果统计
   */
  getEffectivenessStats(): PromptEffectiveness[] {
    return this.promptRepo.getEffectivenessStats();
  }

  /**
   * 获取进化统计
   */
  getEvolutionStats(): PromptEvolutionStats {
    const allVersions = this.promptRepo.getAll();
    const activeVersions = allVersions.filter((v) => v.isActive);

    const stats: PromptEvolutionStats = {
      totalSuggestions: 0,
      appliedSuggestions: 0,
      pendingSuggestions: 0,
      rejectedSuggestions: 0,
      byPromptType: {} as Record<
        PromptType,
        { total: number; applied: number; averageConfidence: number }
      >,
    };

    // 按类型统计
    const promptTypes: PromptType[] = [
      "capture",
      "explain",
      "question",
      "refine",
      "connect",
      "distill",
      "dedupe",
    ];

    for (const type of promptTypes) {
      const typeVersions = allVersions.filter((v) => v.promptType === type);
      const activeVersion = typeVersions.find((v) => v.isActive);

      stats.byPromptType[type] = {
        total: typeVersions.length,
        applied: activeVersion ? typeVersions.indexOf(activeVersion) + 1 : 0,
        averageConfidence: activeVersion?.averageScore ?? 0,
      };
    }

    return stats;
  }

  /**
   * 分析提示词效果并生成改进建议
   */
  analyzeAndSuggest(promptType: PromptType): PromptEvolutionSuggestion | null {
    const activePrompt = this.getActivePrompt(promptType);
    if (!activePrompt) return null;

    // 获取该提示词的反馈
    const feedbacks = this.feedbackRepo.query({
      targetType: "system",
      limit: 100,
    });

    // 过滤相关反馈
    const relevantFeedbacks = feedbacks.filter(
      (f) =>
        f.metadata &&
        (f.metadata as Record<string, any>).promptType === promptType
    );

    if (relevantFeedbacks.length < this.config.minFeedbackSamples) {
      return null;
    }

    // 分析反馈趋势
    const positiveCount = relevantFeedbacks.filter(
      (f) => f.feedbackType === "thumbs_up"
    ).length;
    const negativeCount = relevantFeedbacks.filter(
      (f) => f.feedbackType === "thumbs_down"
    ).length;
    const correctionCount = relevantFeedbacks.filter(
      (f) => f.feedbackType === "correction"
    ).length;

    const total = relevantFeedbacks.length;
    const positiveRate = positiveCount / total;
    const negativeRate = negativeCount / total;

    // 如果负面反馈率过高，建议改进
    if (negativeRate > 0.3 || correctionCount > total * 0.2) {
      // 收集纠错和建议内容
      const corrections = relevantFeedbacks
        .filter((f) => f.feedbackType === "correction" && f.content)
        .map((f) => f.content!);

      const suggestions = relevantFeedbacks
        .filter((f) => f.feedbackType === "suggestion" && f.content)
        .map((f) => f.content!);

      // 生成改进建议（简化版，实际可能需要LLM生成）
      const suggestedContent = this.generateImprovedPrompt(
        activePrompt.content,
        corrections,
        suggestions
      );

      const suggestionParams: CreateEvolutionSuggestionParams = {
        promptType,
        currentVersionId: activePrompt.id,
        suggestedContent,
        suggestionReason: `Based on ${negativeCount} negative feedbacks and ${correctionCount} corrections out of ${total} total feedbacks`,
        confidence: 1 - positiveRate,
        basedOnFeedbackIds: relevantFeedbacks.map((f) => f.id),
      };

      return this.createEvolutionSuggestion(suggestionParams);
    }

    return null;
  }

  /**
   * 创建进化建议
   */
  createEvolutionSuggestion(
    params: CreateEvolutionSuggestionParams
  ): PromptEvolutionSuggestion {
    const id = `evo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return {
      id,
      ...params,
      applied: false,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * 应用进化建议
   */
  applyEvolutionSuggestion(suggestionId: string): PromptVersion | null {
    // 这里简化处理，实际应该从存储中获取建议并应用
    // TODO: replace with structured logger
    // console.log(`[PromptEvolution] Applying suggestion ${suggestionId}`);
    return null;
  }

  /**
   * 生成改进后的提示词（简化版）
   */
  private generateImprovedPrompt(
    currentContent: string,
    corrections: string[],
    suggestions: string[]
  ): string {
    // 简化实现：添加改进注释
    let improved = currentContent;

    if (corrections.length > 0) {
      improved += `\n\n<!-- Improvements based on feedback:\n`;
      for (const correction of corrections.slice(0, 3)) {
        improved += `- Address: ${correction.substring(0, 100)}...\n`;
      }
      improved += `-->`;
    }

    return improved;
  }

  /**
   * 运行自动进化（如果启用）
   */
  runAutoEvolution(): Array<{
    promptType: PromptType;
    suggestion: PromptEvolutionSuggestion | null;
  }> {
    if (!this.config.autoEvolution) {
      return [];
    }

    const results: Array<{
      promptType: PromptType;
      suggestion: PromptEvolutionSuggestion | null;
    }> = [];

    const promptTypes: PromptType[] = [
      "capture",
      "explain",
      "question",
      "refine",
      "connect",
      "distill",
      "dedupe",
    ];

    for (const promptType of promptTypes) {
      const suggestion = this.analyzeAndSuggest(promptType);
      if (suggestion && suggestion.confidence >= this.config.suggestionThreshold) {
        results.push({ promptType, suggestion });
      }
    }

    return results;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PromptEvolutionConfig>): void {
    this.config = { ...this.config, ...config };
  }
}