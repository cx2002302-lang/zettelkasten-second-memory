/**
 * GlowCalculator - 知识发光度计算引擎
 *
 * 职责：
 * 1. 计算笔记的发光度分数（0-1）
 * 2. 自动分类：evergreen / active / stable / zombie
 * 3. 预计算并缓存统计指标
 * 4. 提供排行和僵尸笔记检测
 */

import type { DatabaseSync } from "node:sqlite";

export interface GlowMetrics {
  noteId: string;
  title: string;
  pagerank: number;
  backlinkCount: number;
  outgoingLinkCount: number;
  recency: number;
  decay: number;
  glow: number;
  status: "evergreen" | "active" | "stable" | "zombie";
  lastCalculatedAt: string;
}

export interface GlowRankingOptions {
  limit?: number;
  statusFilter?: Array<"evergreen" | "active" | "stable" | "zombie">;
  minGlow?: number;
  maxGlow?: number;
}

export interface GlowSummary {
  totalNotes: number;
  evergreenCount: number;
  activeCount: number;
  stableCount: number;
  zombieCount: number;
  averageGlow: number;
}

/** 默认配置 */
const DEFAULT_CONFIG = {
  centralityWeight: 0.4,
  citationWeight: 0.3,
  recencyWeight: 0.3,
  maxDecayDays: 365,
  maxDecayRatio: 0.8,
  recencyWindowDays: 30,
  evergreenGlowThreshold: 0.8,
  evergreenBacklinkThreshold: 5,
  activeGlowThreshold: 0.6,
  zombieDaysThreshold: 180,
  pagerankNormalizeFactor: 10,
  citationNormalizeFactor: 10,
};

export class GlowCalculator {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /**
   * 计算单张笔记的发光度
   */
  calculate(noteId: string): GlowMetrics | null {
    const note = this.db
      .prepare(
        `SELECT id, title, created_at, updated_at FROM zettel_notes WHERE id = ?`
      )
      .get(noteId) as
      | { id: string; title: string; created_at: string; updated_at: string }
      | undefined;

    if (!note) return null;

    const metrics = this.computeMetrics(noteId, note.title, note.created_at, note.updated_at);

    // 更新统计表
    this.upsertStats(metrics);

    return metrics;
  }

  /**
   * 批量计算所有笔记的发光度
   */
  recalculateAll(): GlowMetrics[] {
    const notes = this.db
      .prepare(`SELECT id, title, created_at, updated_at FROM zettel_notes`)
      .all() as Array<{
      id: string;
      title: string;
      created_at: string;
      updated_at: string;
    }>;

    const results: GlowMetrics[] = [];

    for (const note of notes) {
      const metrics = this.computeMetrics(note.id, note.title, note.created_at, note.updated_at);
      this.upsertStats(metrics);
      results.push(metrics);
    }

    return results;
  }

  /**
   * 如果统计表为空但笔记表有数据，自动触发一次重算
   */
  private ensureStats(): void {
    const statsCount = (this.db
      .prepare("SELECT COUNT(*) as c FROM zettel_note_stats")
      .get() as { c: number }).c;
    if (statsCount > 0) return;

    const noteCount = (this.db
      .prepare("SELECT COUNT(*) as c FROM zettel_notes")
      .get() as { c: number }).c;
    if (noteCount > 0) {
      this.recalculateAll();
    }
  }

  /**
   * 获取发光度排行
   */
  getRanking(options: GlowRankingOptions = {}): GlowMetrics[] {
    // 如果缓存表为空但已有笔记，自动重算一次，避免首次调用返回空
    this.ensureStats();

    const {
      limit = 20,
      statusFilter,
      minGlow = 0,
      maxGlow = 1,
    } = options;

    let sql = `
      SELECT
        s.note_id as noteId,
        n.title,
        s.pagerank_score as pagerank,
        s.backlink_count as backlinkCount,
        s.outgoing_link_count as outgoingLinkCount,
        s.days_since_updated as daysSinceUpdated,
        s.glow_score as glow,
        s.decay_factor as decay,
        s.glow_status as status,
        s.last_calculated_at as lastCalculatedAt
      FROM zettel_note_stats s
      JOIN zettel_notes n ON n.id = s.note_id
      WHERE s.glow_score >= ? AND s.glow_score <= ?
    `;
    const params: (number | string)[] = [minGlow, maxGlow];

    if (statusFilter && statusFilter.length > 0) {
      const placeholders = statusFilter.map(() => "?").join(",");
      sql += ` AND s.glow_status IN (${placeholders})`;
      params.push(...statusFilter);
    }

    sql += ` ORDER BY s.glow_score DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      noteId: string;
      title: string;
      pagerank: number;
      backlinkCount: number;
      outgoingLinkCount: number;
      daysSinceUpdated: number;
      glow: number;
      decay: number;
      status: string;
      lastCalculatedAt: string;
    }>;

    return rows.map((row) => ({
      ...row,
      recency: this.calculateRecency(row.daysSinceUpdated),
      status: row.status as GlowMetrics["status"],
    }));
  }

  /**
   * 获取僵尸笔记（待归档候选）
   */
  findZombies(limit: number = 20): GlowMetrics[] {
    // 如果缓存表为空但已有笔记，自动重算一次
    this.ensureStats();

    const rows = this.db
      .prepare(
        `
        SELECT
          s.note_id as noteId,
          n.title,
          s.pagerank_score as pagerank,
          s.backlink_count as backlinkCount,
          s.outgoing_link_count as outgoingLinkCount,
          s.days_since_updated as daysSinceUpdated,
          s.glow_score as glow,
          s.decay_factor as decay,
          s.glow_status as status,
          s.last_calculated_at as lastCalculatedAt
        FROM zettel_note_stats s
        JOIN zettel_notes n ON n.id = s.note_id
        WHERE s.glow_status = 'zombie'
        ORDER BY s.days_since_updated DESC
        LIMIT ?
      `
      )
      .all(limit) as Array<{
      noteId: string;
      title: string;
      pagerank: number;
      backlinkCount: number;
      outgoingLinkCount: number;
      daysSinceUpdated: number;
      glow: number;
      decay: number;
      status: string;
      lastCalculatedAt: string;
    }>;

    return rows.map((row) => ({
      ...row,
      recency: this.calculateRecency(row.daysSinceUpdated),
      status: row.status as GlowMetrics["status"],
    }));
  }

  /**
   * 获取知识库统计摘要
   */
  getSummary(): GlowSummary {
    const stats = this.db
      .prepare(
        `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN glow_status = 'evergreen' THEN 1 ELSE 0 END) as evergreen,
          SUM(CASE WHEN glow_status = 'active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN glow_status = 'stable' THEN 1 ELSE 0 END) as stable,
          SUM(CASE WHEN glow_status = 'zombie' THEN 1 ELSE 0 END) as zombie,
          AVG(glow_score) as avgGlow
        FROM zettel_note_stats
      `
      )
      .get() as {
      total: number;
      evergreen: number;
      active: number;
      stable: number;
      zombie: number;
      avgGlow: number;
    };

    return {
      totalNotes: stats.total ?? 0,
      evergreenCount: stats.evergreen ?? 0,
      activeCount: stats.active ?? 0,
      stableCount: stats.stable ?? 0,
      zombieCount: stats.zombie ?? 0,
      averageGlow: stats.avgGlow ?? 0,
    };
  }

  // ============ 私有方法 ============

  /**
   * 计算核心指标
   */
  private computeMetrics(
    noteId: string,
    title: string,
    createdAt: string,
    updatedAt: string
  ): GlowMetrics {
    const now = Date.now();
    const createdTime = new Date(createdAt).getTime();
    const updatedTime = new Date(updatedAt).getTime();

    const daysSinceCreated = Math.max(0, Math.floor((now - createdTime) / (1000 * 60 * 60 * 24)));
    const daysSinceUpdated = Math.max(0, Math.floor((now - updatedTime) / (1000 * 60 * 60 * 24)));

    // 引用统计
    const backlinkCount = this.getBacklinkCount(noteId);
    const outgoingLinkCount = this.getOutgoingLinkCount(noteId);

    // PageRank（简化版）
    const pagerank = this.calculatePageRank(noteId);

    // 各维度分数
    const centrality = Math.min(pagerank / DEFAULT_CONFIG.pagerankNormalizeFactor, 1);
    const citation = Math.min(backlinkCount / DEFAULT_CONFIG.citationNormalizeFactor, 1);
    const recency = Math.max(0, 1 - daysSinceUpdated / DEFAULT_CONFIG.recencyWindowDays);
    const decay = Math.min(daysSinceUpdated / DEFAULT_CONFIG.maxDecayDays, DEFAULT_CONFIG.maxDecayRatio);

    // 综合发光度
    const glow =
      (centrality * DEFAULT_CONFIG.centralityWeight +
        citation * DEFAULT_CONFIG.citationWeight +
        recency * DEFAULT_CONFIG.recencyWeight) *
      (1 - decay);

    // 状态分类
    const status = this.determineStatus(glow, daysSinceUpdated, backlinkCount);

    return {
      noteId,
      title,
      pagerank,
      backlinkCount,
      outgoingLinkCount,
      recency,
      decay,
      glow: Math.max(0, Math.min(1, glow)),
      status,
      lastCalculatedAt: new Date().toISOString(),
    };
  }

  /**
   * 计算简化版 PageRank（基于入度加权）
   */
  private calculatePageRank(noteId: string): number {
    const result = this.db
      .prepare(
        `
        WITH RECURSIVE
          backlinks(node_id, depth) AS (
            SELECT ?, 0
            UNION ALL
            SELECT l.from_note_id, b.depth + 1
            FROM backlinks b
            JOIN zettel_links l ON l.to_note_id = b.node_id
            WHERE b.depth < 3
          )
        SELECT SUM(1.0 / (depth + 1)) as score
        FROM backlinks
        WHERE node_id != ?
      `
      )
      .get(noteId, noteId) as { score: number | null };

    // 返回原始 score，让 computeMetrics 负责归一化
    return result?.score ?? 0;
  }

  /**
   * 获取被引用次数
   */
  private getBacklinkCount(noteId: string): number {
    const result = this.db
      .prepare(`SELECT COUNT(*) as count FROM zettel_links WHERE to_note_id = ?`)
      .get(noteId) as { count: number };
    return result.count;
  }

  /**
   * 获取出站链接数
   */
  private getOutgoingLinkCount(noteId: string): number {
    const result = this.db
      .prepare(`SELECT COUNT(*) as count FROM zettel_links WHERE from_note_id = ?`)
      .get(noteId) as { count: number };
    return result.count;
  }

  /**
   * 计算新鲜度
   */
  private calculateRecency(daysSinceUpdated: number): number {
    return Math.max(0, 1 - daysSinceUpdated / DEFAULT_CONFIG.recencyWindowDays);
  }

  /**
   * 状态分类
   */
  private determineStatus(
    glow: number,
    daysSinceUpdated: number,
    backlinkCount: number
  ): GlowMetrics["status"] {
    if (glow > DEFAULT_CONFIG.evergreenGlowThreshold && backlinkCount > DEFAULT_CONFIG.evergreenBacklinkThreshold) {
      return "evergreen";
    }
    if (glow > DEFAULT_CONFIG.activeGlowThreshold) {
      return "active";
    }
    if (daysSinceUpdated > DEFAULT_CONFIG.zombieDaysThreshold && backlinkCount === 0) {
      return "zombie";
    }
    return "stable";
  }

  /**
   * 更新/插入统计表
   */
  private upsertStats(metrics: GlowMetrics): void {
    const daysSinceCreated = Math.max(
      0,
      Math.floor(
        (Date.now() - new Date(metrics.lastCalculatedAt).getTime()) / (1000 * 60 * 60 * 24)
      )
    );

    this.db
      .prepare(
        `
        INSERT INTO zettel_note_stats (
          note_id, pagerank_score, backlink_count, outgoing_link_count,
          days_since_created, days_since_updated, glow_score, decay_factor,
          glow_status, last_calculated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(note_id) DO UPDATE SET
          pagerank_score = excluded.pagerank_score,
          backlink_count = excluded.backlink_count,
          outgoing_link_count = excluded.outgoing_link_count,
          days_since_created = excluded.days_since_created,
          days_since_updated = excluded.days_since_updated,
          glow_score = excluded.glow_score,
          decay_factor = excluded.decay_factor,
          glow_status = excluded.glow_status,
          last_calculated_at = excluded.last_calculated_at
      `
      )
      .run(
        metrics.noteId,
        metrics.pagerank,
        metrics.backlinkCount,
        metrics.outgoingLinkCount,
        daysSinceCreated,
        Math.max(0, Math.floor((Date.now() - new Date(metrics.lastCalculatedAt).getTime()) / (1000 * 60 * 60 * 24))),
        metrics.glow,
        metrics.decay,
        metrics.status,
        metrics.lastCalculatedAt
      );
  }
}
