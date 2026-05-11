/**
 * 反馈记录 Repository
 * 
 * 提供反馈记录的 CRUD 操作和查询功能
 */

import type { DatabaseSync } from "node:sqlite";
import type {
  Feedback,
  CreateFeedbackParams,
  FeedbackQueryParams,
  FeedbackStats,
  FeedbackType,
  FeedbackSource,
  ReviewTargetType,
} from "../core/types-phase5.js";

export class FeedbackRepository {
  constructor(private db: DatabaseSync) {}

  /**
   * 创建反馈记录
   */
  create(params: CreateFeedbackParams): Feedback {
    const id = `fb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const createdAt = new Date().toISOString();

    const feedback: Feedback = {
      id,
      ...params,
      processed: false,
      createdAt,
    };

    // 将 0-1 范围的 rating 转换为 1-5 范围的整数存储
    const dbRating = feedback.rating !== undefined
      ? Math.max(1, Math.min(5, Math.round(feedback.rating * 4) + 1))
      : null;

    const stmt = this.db.prepare(
      `INSERT INTO zettel_feedback (
        id, target_type, target_id, feedback_type, source, source_id,
        content, rating, metadata, processed, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      feedback.id,
      feedback.targetType,
      feedback.targetId,
      feedback.feedbackType,
      feedback.source ?? null,
      feedback.sourceId ?? null,
      feedback.content ?? null,
      dbRating,
      feedback.metadata ? JSON.stringify(feedback.metadata) : null,
      feedback.processed ? 1 : 0,
      feedback.createdAt
    );

    return feedback;
  }

  /**
   * 根据ID获取反馈记录
   */
  get(id: string): Feedback | null {
    const row = this.db
      .prepare("SELECT * FROM zettel_feedback WHERE id = ?")
      .get(id) as Record<string, any> | undefined;

    if (!row) return null;

    return this.rowToFeedback(row);
  }

  /**
   * 查询反馈记录
   */
  query(params: FeedbackQueryParams = {}): Feedback[] {
    const conditions: string[] = [];
    const values: any[] = [];

    if (params.targetType) {
      conditions.push("target_type = ?");
      values.push(params.targetType);
    }

    if (params.targetId) {
      conditions.push("target_id = ?");
      values.push(params.targetId);
    }

    if (params.feedbackType) {
      conditions.push("feedback_type = ?");
      values.push(params.feedbackType);
    }

    if (params.source) {
      conditions.push("source = ?");
      values.push(params.source);
    }

    if (params.processed !== undefined) {
      conditions.push("processed = ?");
      values.push(params.processed ? 1 : 0);
    }

    if (params.startDate) {
      conditions.push("created_at >= ?");
      values.push(params.startDate);
    }

    if (params.endDate) {
      conditions.push("created_at <= ?");
      values.push(params.endDate);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM zettel_feedback ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...values, limit, offset) as Record<string, any>[];

    return rows.map((row) => this.rowToFeedback(row));
  }

  /**
   * 获取目标的所有反馈
   */
  getByTarget(targetType: ReviewTargetType, targetId: string): Feedback[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM zettel_feedback WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC"
      )
      .all(targetType, targetId) as Record<string, any>[];

    return rows.map((row) => this.rowToFeedback(row));
  }

  /**
   * 标记反馈为已处理
   */
  markAsProcessed(id: string): boolean {
    const stmt = this.db.prepare(
      "UPDATE zettel_feedback SET processed = 1, processed_at = ? WHERE id = ?"
    );
    const result = stmt.run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  /**
   * 获取反馈统计
   */
  getStats(): FeedbackStats {
    const totalResult = this.db
      .prepare("SELECT COUNT(*) as count FROM zettel_feedback")
      .get() as { count: number };

    const typeCounts = this.db
      .prepare(
        `SELECT feedback_type, COUNT(*) as count FROM zettel_feedback GROUP BY feedback_type`
      )
      .all() as Array<{ feedback_type: string; count: number }>;

    const targetTypeCounts = this.db
      .prepare(
        `SELECT target_type, COUNT(*) as count FROM zettel_feedback GROUP BY target_type`
      )
      .all() as Array<{ target_type: string; count: number }>;

    const processedResult = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM zettel_feedback WHERE processed = 1"
      )
      .get() as { count: number };

    const ratingResult = this.db
      .prepare(
        "SELECT AVG(rating) as avg_rating FROM zettel_feedback WHERE rating IS NOT NULL"
      )
      .get() as { avg_rating: number | null };

    const stats: FeedbackStats = {
      totalFeedback: totalResult.count,
      thumbsUpCount: 0,
      thumbsDownCount: 0,
      commentCount: 0,
      correctionCount: 0,
      suggestionCount: 0,
      averageRating: ratingResult.avg_rating ?? undefined,
      processedCount: processedResult.count,
      unprocessedCount: totalResult.count - processedResult.count,
      byTargetType: {
        note: 0,
        link: 0,
        tag: 0,
        system: 0,
      },
    };

    for (const { feedback_type, count } of typeCounts) {
      switch (feedback_type) {
        case "thumbs_up":
          stats.thumbsUpCount = count;
          break;
        case "thumbs_down":
          stats.thumbsDownCount = count;
          break;
        case "comment":
          stats.commentCount = count;
          break;
        case "correction":
          stats.correctionCount = count;
          break;
        case "suggestion":
          stats.suggestionCount = count;
          break;
      }
    }

    for (const { target_type, count } of targetTypeCounts) {
      if (target_type in stats.byTargetType) {
        stats.byTargetType[target_type as ReviewTargetType] = count;
      }
    }

    return stats;
  }

  /**
   * 删除反馈记录
   */
  delete(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM zettel_feedback WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  /**
   * 获取未处理的反馈
   */
  getUnprocessed(limit: number = 50): Feedback[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM zettel_feedback WHERE processed = 0 ORDER BY created_at ASC LIMIT ?"
      )
      .all(limit) as Record<string, any>[];

    return rows.map((row) => this.rowToFeedback(row));
  }

  /**
   * 将数据库行转换为 Feedback 对象
   */
  private rowToFeedback(row: Record<string, any>): Feedback {
    return {
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      feedbackType: row.feedback_type,
      source: row.source,
      sourceId: row.source_id,
      content: row.content,
      rating: row.rating ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      processed: row.processed === 1,
      processedAt: row.processed_at,
      createdAt: row.created_at,
    };
  }
}