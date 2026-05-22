/**
 * 审核服务
 * 
 * 提供审核面板功能，支持人工审核和自动审核
 */

import type { DatabaseSync } from "node:sqlite";
import { ReviewRepository } from "../repository/review-repository.js";
import { NoteRepository } from "../repository/note-repository.js";
import type {
  Review,
  CreateReviewParams,
  ReviewQueryParams,
  ReviewStats,
  ReviewTargetType,
  ReviewAction,
  PendingReviewItem,
  ReviewPanelState,
  BatchReviewParams,
  ReviewServiceConfig,
} from "../core/types-phase5.js";
import type { NoteFolder } from "../core/types.js";

export class ReviewService {
  private reviewRepo: ReviewRepository;
  private config: ReviewServiceConfig;

  constructor(
    private db: DatabaseSync,
    config?: Partial<ReviewServiceConfig>
  ) {
    this.reviewRepo = new ReviewRepository(db);
    this.config = {
      requireHumanReview: true,
      autoReviewThreshold: 0.9,
      reviewTimeoutHours: 24,
      notificationChannels: [],
      staleReviewDays: 14,
      ...config,
    };
  }

  /**
   * 创建审核记录
   */
  createReview(params: CreateReviewParams): Review {
    // 如果审核通过且设置了新文件夹，更新笔记状态
    if (params.action === "approve" && params.targetType === "note" && params.newFolder) {
      const validFolders: NoteFolder[] = ["inbox", "references", "zettels"];
      if (validFolders.includes(params.newFolder as NoteFolder)) {
        this.updateNoteAfterReview(params.targetId, params.newFolder as NoteFolder, params.newConfidence);
      }
    }

    return this.reviewRepo.create(params);
  }

  /**
   * 批量审核
   */
  batchReview(params: BatchReviewParams): Review[] {
    const reviews: Review[] = [];

    for (const item of params.items) {
      const review = this.createReview({
        targetType: item.targetType,
        targetId: item.targetId,
        reviewerId: params.reviewerId,
        action: item.action,
        newConfidence: item.newConfidence,
        newFolder: item.newFolder,
        comment: item.comment,
      });
      reviews.push(review);
    }

    return reviews;
  }

  /**
   * 获取待审核项目列表
   */
  getPendingItems(): PendingReviewItem[] {
    const items: PendingReviewItem[] = [];

    // 获取未审核的笔记
    const pendingNotes = this.db
      .prepare(
        `SELECT 
          id,
          title,
          summary,
          confidence,
          folder,
          created_at
        FROM zettel_notes
        WHERE reviewed = 0
        ORDER BY created_at DESC
        LIMIT 100`
      )
      .all() as Array<{
        id: string;
        title: string;
        summary?: string;
        confidence?: number;
        folder: string;
        created_at: string;
      }>;

    for (const note of pendingNotes) {
      items.push({
        id: `pending_${note.id}`,
        targetType: "note",
        targetId: note.id,
        targetTitle: note.title,
        targetSummary: note.summary,
        currentConfidence: note.confidence,
        currentFolder: note.folder,
        createdAt: note.created_at,
        source: "auto",
      });
    }

    return items;
  }

  /**
   * 获取审核面板状态
   */
  getReviewPanelState(): ReviewPanelState {
    const pendingItems = this.getPendingItems();
    const stats = this.reviewRepo.getStats();

    // 获取总审核数
    const totalResult = this.db
      .prepare("SELECT COUNT(*) as count FROM zettel_reviews")
      .get() as { count: number };

    return {
      pendingCount: pendingItems.length,
      totalCount: totalResult.count,
      items: pendingItems.slice(0, 20), // 只返回前20个
      stats,
    };
  }

  /**
   * 查询审核记录
   */
  queryReviews(params: ReviewQueryParams = {}): Review[] {
    return this.reviewRepo.query(params);
  }

  /**
   * 获取审核统计
   */
  getStats(): ReviewStats {
    return this.reviewRepo.getStats();
  }

  /**
   * 自动审核（基于置信度 + 内容质量）
   * @param targetType 审核目标类型
   * @param targetId 目标ID
   * @param confidence 置信度
   * @param contentLength 内容长度（可选，用于质量判断）
   * @returns 审核记录或 null（需要人工审核）
   */
  autoReview(
    targetType: ReviewTargetType,
    targetId: string,
    confidence: number,
    contentLength?: number
  ): Review | null {
    // 内容质量评分：结合置信度和内容长度
    let qualityScore = confidence;
    if (contentLength !== undefined) {
      if (contentLength >= 200) qualityScore += 0.1;
      else if (contentLength < 50) qualityScore -= 0.3;
    }
    qualityScore = Math.min(1.0, Math.max(0.0, qualityScore));

    // 高质量笔记：自动通过
    if (qualityScore >= this.config.autoReviewThreshold) {
      return this.createReview({
        targetType,
        targetId,
        action: "approve",
        newConfidence: confidence,
        comment: `Auto-approved (quality=${qualityScore.toFixed(2)}, confidence=${confidence.toFixed(2)}, len=${contentLength || "?"})`,
      });
    }

    // 低质量笔记：自动标记（flag），移入 inbox
    if (qualityScore < 0.4) {
      return this.createReview({
        targetType,
        targetId,
        action: "flag",
        previousConfidence: confidence,
        comment: `Auto-flagged (quality=${qualityScore.toFixed(2)}, confidence=${confidence.toFixed(2)}, len=${contentLength || "?"})`,
      });
    }

    // 中等质量：不做自动处理，保留 inbox 状态等待人工审核
    return null;
  }

  /**
   * 批量自动审核 Inbox 中的笔记
   * @returns 审核结果统计
   */
  autoReviewInbox(): { approved: number; flagged: number; skipped: number; total: number } {
    const pendingNotes = this.db
      .prepare(
        `SELECT id, confidence, LENGTH(content) as content_length, title
         FROM zettel_notes
         WHERE reviewed = 0
         ORDER BY created_at DESC
         LIMIT 100`
      )
      .all() as Array<{
        id: string;
        confidence: number;
        content_length: number;
        title: string;
      }>;

    let approved = 0;
    let flagged = 0;
    let skipped = 0;

    for (const note of pendingNotes) {
      const review = this.autoReview("note", note.id, note.confidence || 0, note.content_length || 0);
      if (review) {
        if (review.action === "approve") approved++;
        else if (review.action === "flag") flagged++;
      } else {
        skipped++;
      }
    }

    return { approved, flagged, skipped, total: pendingNotes.length };
  }

  /**
   * 自动处理积压的 Inbox 笔记（超过 staleReviewDays 天未审核）
   *
   * 策略：
   * - conf ≥ 0.5 且 content ≥ 50 → auto-approve → zettels
   * - conf < 0.3 或 content < 50 → auto-archive
   * - 其他 → flag（保留 inbox，但创建 review 记录）
   *
   * @returns 处理结果统计
   */
  autoReviewStaleInbox(): { approved: number; archived: number; flagged: number; total: number } {
    const staleNotes = this.db
      .prepare(
        `SELECT id, confidence, LENGTH(content) as content_length, title, created_at,
                julianday('now') - julianday(created_at) as age_days
         FROM zettel_notes
         WHERE reviewed = 0
         AND julianday('now') - julianday(created_at) > ?
         ORDER BY created_at ASC`
      )
      .all(this.config.staleReviewDays) as Array<{
        id: string;
        confidence: number;
        content_length: number;
        title: string;
        created_at: string;
        age_days: number;
      }>;

    let approved = 0;
    let archived = 0;
    let flagged = 0;

    for (const note of staleNotes) {
      const conf = note.confidence || 0;
      const len = note.content_length || 0;

      if (conf >= 0.5 && len >= 50) {
        // 积压但质量不错 → 自动通过
        this.createReview({
          targetType: "note",
          targetId: note.id,
          action: "approve",
          newConfidence: conf,
          comment: `Auto-approved stale inbox (age=${Math.floor(note.age_days)}d, conf=${conf.toFixed(2)}, len=${len})`,
        });
        approved++;
      } else if (conf < 0.3 || len < 50) {
        // 积压且质量差 → 自动归档（不创建 review 记录，直接归档）
        this.db.prepare(
          `UPDATE zettel_notes SET folder = 'archive', reviewed = 1 WHERE id = ?`
        ).run(note.id);
        archived++;
      } else {
        // 中间地带 → flag，保留 inbox
        this.createReview({
          targetType: "note",
          targetId: note.id,
          action: "flag",
          previousConfidence: conf,
          comment: `Auto-flagged stale inbox (age=${Math.floor(note.age_days)}d, conf=${conf.toFixed(2)}, len=${len})`,
        });
        flagged++;
      }
    }

    return { approved, archived, flagged, total: staleNotes.length };
  }

  /**
   * 获取 Inbox 积压摘要（用于飞书通知）
   */
  getInboxDigest(): { total: number; oldestDays: number; topItems: Array<{ title: string; confidence: number; ageDays: number }> } {
    const pendingNotes = this.db
      .prepare(
        `SELECT title, confidence, julianday('now') - julianday(created_at) as age_days
         FROM zettel_notes
         WHERE reviewed = 0
         ORDER BY created_at ASC
         LIMIT 10`
      )
      .all() as Array<{
        title: string;
        confidence: number;
        age_days: number;
      }>;

    const total = (
      this.db.prepare("SELECT COUNT(*) as c FROM zettel_notes WHERE reviewed = 0").get() as { c: number }
    ).c;

    const oldest = pendingNotes.length > 0 ? Math.floor(pendingNotes[0].age_days) : 0;

    return {
      total,
      oldestDays: oldest,
      topItems: pendingNotes.slice(0, 5).map((n) => ({
        title: n.title?.substring(0, 40) || "[无标题]",
        confidence: n.confidence || 0,
        ageDays: Math.floor(n.age_days),
      })),
    };
  }

  /**
   * 获取目标的审核历史
   */
  getReviewHistory(targetType: ReviewTargetType, targetId: string): Review[] {
    return this.reviewRepo.getByTarget(targetType, targetId);
  }

  /**
   * 删除审核记录
   */
  deleteReview(id: string): boolean {
    return this.reviewRepo.delete(id);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ReviewServiceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): ReviewServiceConfig {
    return { ...this.config };
  }

  /**
   * 更新笔记审核状态
   */
  private updateNoteAfterReview(
    noteId: string,
    newFolder: NoteFolder,
    newConfidence?: number
  ): void {
    const updates: string[] = [];
    const values: any[] = [];

    updates.push("folder = ?");
    values.push(newFolder);

    updates.push("reviewed = ?");
    values.push(1);

    if (newConfidence !== undefined) {
      updates.push("confidence = ?");
      values.push(newConfidence);
    }

    values.push(noteId);

    // 注：updates 中的字段名均为内部硬编码，非用户输入，无需白名单校验
    this.db.prepare(
      `UPDATE zettel_notes SET ${updates.join(", ")} WHERE id = ?`
    ).run(...values);
  }
}
