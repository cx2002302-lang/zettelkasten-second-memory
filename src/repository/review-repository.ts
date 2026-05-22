/**
 * 审核记录 Repository
 * 
 * 提供审核记录的 CRUD 操作和查询功能
 */

import type { DatabaseSync } from "node:sqlite";
import type {
  Review,
  CreateReviewParams,
  ReviewQueryParams,
  ReviewStats,
  ReviewTargetType,
  ReviewAction,
} from "../core/types-phase5.js";

export class ReviewRepository {
  constructor(private db: DatabaseSync) {}

  /**
   * 创建审核记录
   */
  create(params: CreateReviewParams): Review {
    const id = `rev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const createdAt = new Date().toISOString();

    const review: Review = {
      id,
      ...params,
      createdAt,
    };

    const stmt = this.db.prepare(
      `INSERT INTO zettel_reviews (
        id, target_type, target_id, reviewer_id, action,
        previous_confidence, new_confidence, previous_folder, new_folder,
        comment, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      review.id,
      review.targetType,
      review.targetId,
      review.reviewerId ?? null,
      review.action,
      review.previousConfidence ?? null,
      review.newConfidence ?? null,
      review.previousFolder ?? null,
      review.newFolder ?? null,
      review.comment ?? null,
      review.metadata ? JSON.stringify(review.metadata) : null,
      review.createdAt
    );

    return review;
  }

  /**
   * 根据ID获取审核记录
   */
  get(id: string): Review | null {
    const row = this.db
      .prepare("SELECT * FROM zettel_reviews WHERE id = ?")
      .get(id) as Record<string, any> | undefined;

    if (!row) return null;

    return this.rowToReview(row);
  }

  /**
   * 查询审核记录
   */
  query(params: ReviewQueryParams = {}): Review[] {
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

    if (params.reviewerId) {
      conditions.push("reviewer_id = ?");
      values.push(params.reviewerId);
    }

    if (params.action) {
      conditions.push("action = ?");
      values.push(params.action);
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
        `SELECT * FROM zettel_reviews ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...values, limit, offset) as Record<string, any>[];

    return rows.map((row) => this.rowToReview(row));
  }

  /**
   * 获取目标的所有审核记录
   */
  getByTarget(targetType: ReviewTargetType, targetId: string): Review[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM zettel_reviews WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC"
      )
      .all(targetType, targetId) as Record<string, any>[];

    return rows.map((row) => this.rowToReview(row));
  }

  /**
   * 获取审核统计
   */
  getStats(): ReviewStats {
    const totalResult = this.db
      .prepare("SELECT COUNT(*) as count FROM zettel_reviews")
      .get() as { count: number };

    const actionCounts = this.db
      .prepare(
        `SELECT action, COUNT(*) as count FROM zettel_reviews GROUP BY action`
      )
      .all() as Array<{ action: string; count: number }>;

    const typeCounts = this.db
      .prepare(
        `SELECT target_type, COUNT(*) as count FROM zettel_reviews GROUP BY target_type`
      )
      .all() as Array<{ target_type: string; count: number }>;

    const stats: ReviewStats = {
      totalReviews: totalResult.count,
      approvedCount: 0,
      rejectedCount: 0,
      modifiedCount: 0,
      flaggedCount: 0,
      pendingCount: 0,
      byTargetType: {
        note: 0,
        link: 0,
        tag: 0,
        system: 0,
      },
    };

    for (const { action, count } of actionCounts) {
      switch (action) {
        case "approve":
          stats.approvedCount = count;
          break;
        case "reject":
          stats.rejectedCount = count;
          break;
        case "modify":
          stats.modifiedCount = count;
          break;
        case "flag":
          stats.flaggedCount = count;
          break;
      }
    }

    for (const { target_type, count } of typeCounts) {
      if (target_type in stats.byTargetType) {
        stats.byTargetType[target_type as ReviewTargetType] = count;
      }
    }

    return stats;
  }

  /**
   * 删除审核记录
   */
  delete(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM zettel_reviews WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  /**
   * 获取待审核项目列表
   */
  getPendingItems(): Array<{
    targetType: ReviewTargetType;
    targetId: string;
    createdAt: string;
  }> {
    // 查询尚未被审核的笔记
    const rows = this.db
      .prepare(
        `SELECT 
          'note' as target_type,
          id as target_id,
          created_at
        FROM zettel_notes
        WHERE reviewed = 0
        ORDER BY created_at DESC
        LIMIT 100`
      )
      .all() as Array<{
        target_type: string;
        target_id: string;
        created_at: string;
      }>;

    return rows.map((row) => ({
      targetType: row.target_type as ReviewTargetType,
      targetId: row.target_id,
      createdAt: row.created_at,
    }));
  }

  /**
   * 将数据库行转换为 Review 对象
   */
  private rowToReview(row: Record<string, any>): Review {
    return {
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      reviewerId: row.reviewer_id,
      action: row.action,
      previousConfidence: row.previous_confidence,
      newConfidence: row.new_confidence,
      previousFolder: row.previous_folder,
      newFolder: row.new_folder,
      comment: row.comment,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
    };
  }
}
