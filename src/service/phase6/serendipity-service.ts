/**
 * SerendipityService — 意外发现服务（Phase 6 P0）
 *
 * 非耦合设计：可独立开关，有自己的数据库表和 MCP 工具。
 */

import type { DatabaseSync } from "node:sqlite";
import { SerendipityEngine, type SerendipityCandidate } from "../../engine/phase6/serendipity-engine.js";

export interface SerendipityServiceConfig {
  enabled: boolean;
  topK: number;
  minScore: number;
  maxPathLength: number;
  autoCreateLinks: boolean; // 是否自动创建链接（默认 false，建议人工审核）
}

const DEFAULT_CONFIG: SerendipityServiceConfig = {
  enabled: true,
  topK: 5,
  minScore: 0.5,
  maxPathLength: 3,
  autoCreateLinks: false,
};

export class SerendipityService {
  private db: DatabaseSync;
  private engine: SerendipityEngine;
  private config: SerendipityServiceConfig;

  constructor(db: DatabaseSync, config?: Partial<SerendipityServiceConfig>) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.engine = new SerendipityEngine(db, {
      topK: this.config.topK,
      minScore: this.config.minScore,
      maxPathLength: this.config.maxPathLength,
    });
    this.ensureSchema();
  }

  /**
   * 创建意外发现记录表（非耦合，独立 Schema）
   */
  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS zettel_serendipity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_note_id TEXT NOT NULL,
        to_note_id TEXT NOT NULL,
        score REAL NOT NULL,
        reason TEXT,
        common_neighbors TEXT,
        path_length INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'ignored')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        UNIQUE(from_note_id, to_note_id)
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_serendipity_score ON zettel_serendipity(score DESC)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_serendipity_status ON zettel_serendipity(status)`);
  }

  /**
   * 运行一次意外发现扫描
   */
  runDiscovery(): { discovered: number; saved: number } {
    if (!this.config.enabled) {
      return { discovered: 0, saved: 0 };
    }

    const candidates = this.engine.discover(this.config.topK);
    let saved = 0;

    for (const c of candidates) {
      // 检查是否已存在
      const existing = this.db
        .prepare(
          `SELECT 1 FROM zettel_serendipity
           WHERE (from_note_id = ? AND to_note_id = ?)
           OR (from_note_id = ? AND to_note_id = ?)`
        )
        .get(c.fromNoteId, c.toNoteId, c.toNoteId, c.fromNoteId);

      if (existing) continue;

      this.db
        .prepare(
          `INSERT INTO zettel_serendipity (from_note_id, to_note_id, score, reason, common_neighbors, path_length)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          c.fromNoteId,
          c.toNoteId,
          c.score,
          c.reason,
          c.commonNeighbors.join(", "),
          c.pathLength
        );

      saved++;

      // 如果配置了自动创建链接，且分数很高
      if (this.config.autoCreateLinks && c.score >= 0.8) {
        this.db
          .prepare(
            `INSERT INTO zettel_links (from_note_id, to_note_id, type, context, created_at)
             VALUES (?, ?, 'related', 'Auto-created by Serendipity Engine', datetime('now'))`
          )
          .run(c.fromNoteId, c.toNoteId);
      }
    }

    return { discovered: candidates.length, saved };
  }

  /**
   * 获取待处理的意外发现列表
   */
  getPendingFindings(limit = 20): Array<{
    id: number;
    fromNoteId: string;
    fromTitle: string;
    toNoteId: string;
    toTitle: string;
    score: number;
    reason: string;
    commonNeighbors: string;
    pathLength: number;
    createdAt: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.from_note_id, n1.title as from_title,
                s.to_note_id, n2.title as to_title,
                s.score, s.reason, s.common_neighbors, s.path_length, s.created_at
         FROM zettel_serendipity s
         JOIN zettel_notes n1 ON s.from_note_id = n1.id
         JOIN zettel_notes n2 ON s.to_note_id = n2.id
         WHERE s.status = 'pending'
         ORDER BY s.score DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
        id: number;
        from_note_id: string;
        from_title: string;
        to_note_id: string;
        to_title: string;
        score: number;
        reason: string;
        common_neighbors: string;
        path_length: number;
        created_at: string;
      }>;

    return rows.map((r) => ({
      id: r.id,
      fromNoteId: r.from_note_id,
      fromTitle: r.from_title,
      toNoteId: r.to_note_id,
      toTitle: r.to_title,
      score: r.score,
      reason: r.reason,
      commonNeighbors: r.common_neighbors,
      pathLength: r.path_length,
      createdAt: r.created_at,
    }));
  }

  /**
   * 接受意外发现（创建链接）
   */
  acceptFinding(id: number): boolean {
    const finding = this.db
      .prepare("SELECT from_note_id, to_note_id FROM zettel_serendipity WHERE id = ?")
      .get(id) as { from_note_id: string; to_note_id: string } | undefined;

    if (!finding) return false;

    // 创建链接
    this.db
      .prepare(
        `INSERT OR IGNORE INTO zettel_links (from_note_id, to_note_id, type, context, created_at)
         VALUES (?, ?, 'related', 'Discovered by Serendipity Engine', datetime('now'))`
      )
      .run(finding.from_note_id, finding.to_note_id);

    // 更新状态
    this.db
      .prepare(
        `UPDATE zettel_serendipity SET status = 'accepted', resolved_at = datetime('now') WHERE id = ?`
      )
      .run(id);

    return true;
  }

  /**
   * 拒绝意外发现
   */
  rejectFinding(id: number): boolean {
    const result = this.db
      .prepare(
        `UPDATE zettel_serendipity SET status = 'rejected', resolved_at = datetime('now') WHERE id = ?`
      )
      .run(id);

    return result.changes > 0;
  }

  /**
   * 获取统计信息
   */
  getStats(): { total: number; pending: number; accepted: number; rejected: number } {
    const total = (this.db.prepare("SELECT COUNT(*) as c FROM zettel_serendipity").get() as { c: number }).c;
    const pending = (this.db.prepare("SELECT COUNT(*) as c FROM zettel_serendipity WHERE status = 'pending'").get() as { c: number }).c;
    const accepted = (this.db.prepare("SELECT COUNT(*) as c FROM zettel_serendipity WHERE status = 'accepted'").get() as { c: number }).c;
    const rejected = (this.db.prepare("SELECT COUNT(*) as c FROM zettel_serendipity WHERE status = 'rejected'").get() as { c: number }).c;

    return { total, pending, accepted, rejected };
  }

  /**
   * 获取当前配置
   */
  getConfig(): SerendipityServiceConfig {
    return { ...this.config };
  }
}
