/**
 * KnowledgeAuditService — 知识健康度审计服务（Phase 6 P2）
 *
 * 非耦合设计：可独立开关，定期生成知识库健康报告。
 */

import type { DatabaseSync } from "node:sqlite";

export interface AuditServiceConfig {
  enabled: boolean;
  schedule: "daily" | "weekly" | "monthly";
}

const DEFAULT_CONFIG: AuditServiceConfig = {
  enabled: true,
  schedule: "weekly",
};

export interface KnowledgeHealthReport {
  generatedAt: string;
  totalNotes: number;
  totalLinks: number;
  connectionRate: number; // 有链接的笔记占比
  orphanCount: number; // 孤岛笔记（0 链接）
  hubNotes: Array<{ id: string; title: string; linkCount: number; glowScore: number }>;
  zombieCount: number;
  inboxBacklog: number;
  avgContentLength: number;
  growthTrend: Array<{ date: string; count: number }>;
  domainDistribution: Array<{ folder: string; count: number; percentage: number }>;
  recommendations: string[];
}

export class KnowledgeAuditService {
  private db: DatabaseSync;
  private config: AuditServiceConfig;

  constructor(db: DatabaseSync, config?: Partial<AuditServiceConfig>) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureSchema();
  }

  /**
   * 创建审计报告表（非耦合，独立 Schema）
   */
  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS zettel_audit_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_json TEXT NOT NULL,
        schedule TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_created ON zettel_audit_reports(created_at DESC)`);
  }

  /**
   * 生成知识健康度报告
   */
  generateReport(): KnowledgeHealthReport {
    if (!this.config.enabled) {
      return this.getEmptyReport();
    }

    const totalNotes = (this.db.prepare("SELECT COUNT(*) as c FROM zettel_notes WHERE folder != 'archive'").get() as { c: number }).c;
    const totalLinks = (this.db.prepare("SELECT COUNT(*) as c FROM zettel_links").get() as { c: number }).c;

    // 连接率：有至少一条链接的笔记占比
    const linkedNotes = this.db
      .prepare(
        `SELECT COUNT(DISTINCT note_id) as c FROM (
          SELECT from_note_id as note_id FROM zettel_links
          UNION
          SELECT to_note_id as note_id FROM zettel_links
        )`
      )
      .get() as { c: number };
    const connectionRate = totalNotes > 0 ? linkedNotes.c / totalNotes : 0;

    // 孤岛笔记：没有任何链接的笔记
    const orphanCount = totalNotes - linkedNotes.c;

    // 知识热点（Hub）：连接数最多的笔记
    const hubNotes = this.db
      .prepare(
        `SELECT n.id, n.title, COUNT(*) as link_count, COALESCE(s.glow_score, 0) as glow_score
         FROM zettel_notes n
         LEFT JOIN zettel_links l ON n.id = l.from_note_id OR n.id = l.to_note_id
         LEFT JOIN zettel_note_stats s ON n.id = s.note_id
         WHERE n.folder != 'archive'
         GROUP BY n.id
         HAVING link_count > 0
         ORDER BY link_count DESC
         LIMIT 5`
      )
      .all() as Array<{ id: string; title: string; link_count: number; glow_score: number }>;

    // 僵尸笔记
    const zombieCount = (this.db
      .prepare(
        `SELECT COUNT(*) as c FROM zettel_notes n
         JOIN zettel_note_stats s ON n.id = s.note_id
         WHERE s.glow_status = 'zombie' AND n.folder != 'archive'`
      )
      .get() as { c: number }).c;

    // Inbox 积压
    const inboxBacklog = (this.db.prepare("SELECT COUNT(*) as c FROM zettel_notes WHERE reviewed = 0").get() as { c: number }).c;

    // 平均内容长度
    const avgLength = (this.db
      .prepare("SELECT AVG(LENGTH(content)) as avg FROM zettel_notes WHERE folder != 'archive'")
      .get() as { avg: number }).avg || 0;

    // 增长趋势（最近 7 天）
    const growthTrend = this.db
      .prepare(
        `SELECT date(created_at) as date, COUNT(*) as count
         FROM zettel_notes
         WHERE created_at >= date('now', '-7 days')
         GROUP BY date(created_at)
         ORDER BY date`
      )
      .all() as Array<{ date: string; count: number }>;

    // 领域分布
    const domainDistribution = this.db
      .prepare(
        `SELECT folder, COUNT(*) as count
         FROM zettel_notes
         WHERE folder != 'archive'
         GROUP BY folder
         ORDER BY count DESC`
      )
      .all() as Array<{ folder: string; count: number }>;

    const total = domainDistribution.reduce((sum, d) => sum + d.count, 0);
    const distribution = domainDistribution.map((d) => ({
      folder: d.folder,
      count: d.count,
      percentage: total > 0 ? Math.round((d.count / total) * 1000) / 10 : 0,
    }));

    // 生成建议
    const recommendations = this.generateRecommendations({
      connectionRate,
      orphanCount,
      zombieCount,
      inboxBacklog,
      avgContentLength: avgLength,
    });

    const report: KnowledgeHealthReport = {
      generatedAt: new Date().toISOString(),
      totalNotes,
      totalLinks,
      connectionRate: Math.round(connectionRate * 1000) / 10,
      orphanCount,
      hubNotes: hubNotes.map((h) => ({
        id: h.id,
        title: h.title,
        linkCount: h.link_count,
        glowScore: Math.round((h.glow_score || 0) * 100) / 100,
      })),
      zombieCount,
      inboxBacklog,
      avgContentLength: Math.round(avgLength),
      growthTrend,
      domainDistribution: distribution,
      recommendations,
    };

    // 保存报告
    this.db
      .prepare("INSERT INTO zettel_audit_reports (report_json, schedule) VALUES (?, ?)")
      .run(JSON.stringify(report), this.config.schedule);

    return report;
  }

  /**
   * 获取最新报告
   */
  getLatestReport(): KnowledgeHealthReport | null {
    const row = this.db
      .prepare("SELECT report_json FROM zettel_audit_reports ORDER BY created_at DESC LIMIT 1")
      .get() as { report_json: string } | undefined;

    if (!row) return null;
    try {
      return JSON.parse(row.report_json) as KnowledgeHealthReport;
    } catch {
      return null;
    }
  }

  /**
   * 获取历史报告列表
   */
  getReportHistory(limit = 10): Array<{ id: number; createdAt: string; schedule: string }> {
    const rows = this.db
      .prepare("SELECT id, created_at, schedule FROM zettel_audit_reports ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<{ id: number; created_at: string; schedule: string }>;

    return rows.map((r) => ({ id: r.id, createdAt: r.created_at, schedule: r.schedule }));
  }

  /**
   * 生成优化建议
   */
  private generateRecommendations(metrics: {
    connectionRate: number;
    orphanCount: number;
    zombieCount: number;
    inboxBacklog: number;
    avgContentLength: number;
  }): string[] {
    const recs: string[] = [];

    if (metrics.connectionRate < 0.5) {
      recs.push(`连接率仅 ${(metrics.connectionRate * 100).toFixed(1)}%，建议为孤儿笔记建立链接`);
    }

    if (metrics.orphanCount > 5) {
      recs.push(`发现 ${metrics.orphanCount} 条孤岛笔记，建议使用 Serendipity Engine 发现潜在关联`);
    }

    if (metrics.zombieCount > 3) {
      recs.push(`有 ${metrics.zombieCount} 条僵尸笔记，建议归档或更新`);
    }

    if (metrics.inboxBacklog > 10) {
      recs.push(`Inbox 积压 ${metrics.inboxBacklog} 条笔记，建议审核或启用自动审核`);
    }

    if (metrics.avgContentLength < 100) {
      recs.push(`平均内容长度仅 ${Math.round(metrics.avgContentLength)} 字符，建议充实笔记内容`);
    }

    if (recs.length === 0) {
      recs.push("知识库健康状况良好！继续保持链接和内容的充实。");
    }

    return recs;
  }

  private getEmptyReport(): KnowledgeHealthReport {
    return {
      generatedAt: new Date().toISOString(),
      totalNotes: 0,
      totalLinks: 0,
      connectionRate: 0,
      orphanCount: 0,
      hubNotes: [],
      zombieCount: 0,
      inboxBacklog: 0,
      avgContentLength: 0,
      growthTrend: [],
      domainDistribution: [],
      recommendations: ["审计功能已关闭"],
    };
  }
}
