/**
 * MOCService — 结构笔记自动生成服务（Phase 6 P1）
 *
 * 非耦合设计：可独立开关，基于 CommunityDetector 发现知识社区并生成 MOC。
 */

import type { DatabaseSync } from "node:sqlite";
import { CommunityDetector, type Community } from "../../engine/phase6/community-detector.js";

export interface MOCServiceConfig {
  enabled: boolean;
  minClusterSize: number;
  maxClusters: number;
  autoCreate: boolean; // 是否自动生成 MOC 笔记（默认 false，建议人工审核）
}

const DEFAULT_CONFIG: MOCServiceConfig = {
  enabled: true,
  minClusterSize: 5,
  maxClusters: 10,
  autoCreate: false,
};

export interface MOCSuggestion {
  id: number;
  title: string;
  suggestedContent: string;
  communityId: number;
  hubNoteId: string;
  noteCount: number;
  density: number;
  noteTitles: string[];
  status: "pending" | "created" | "rejected";
  createdAt: string;
}

export class MOCService {
  private db: DatabaseSync;
  private detector: CommunityDetector;
  private config: MOCServiceConfig;

  constructor(db: DatabaseSync, config?: Partial<MOCServiceConfig>) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.detector = new CommunityDetector(db, {
      minClusterSize: this.config.minClusterSize,
      maxClusters: this.config.maxClusters,
    });
    this.ensureSchema();
  }

  /**
   * 创建 MOC 建议表（非耦合，独立 Schema）
   */
  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS zettel_moc_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        suggested_content TEXT,
        community_id INTEGER,
        hub_note_id TEXT,
        note_count INTEGER,
        density REAL,
        note_titles TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'created', 'rejected')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_moc_status ON zettel_moc_suggestions(status)`);
  }

  /**
   * 扫描并生成 MOC 建议
   */
  scanAndSuggest(): { communities: number; saved: number } {
    if (!this.config.enabled) {
      return { communities: 0, saved: 0 };
    }

    const communities = this.detector.detectCommunities();
    let saved = 0;

    for (const comm of communities) {
      // 检查是否已有该社区的 MOC 建议
      const existing = this.db
        .prepare("SELECT 1 FROM zettel_moc_suggestions WHERE community_id = ? AND status != 'rejected'")
        .get(comm.id);

      if (existing) continue;

      const title = this.generateMOCTitle(comm);
      const content = this.generateMOCContent(comm);
      const noteTitles = comm.notes.map((n) => n.title).join(", ");

      this.db
        .prepare(
          `INSERT INTO zettel_moc_suggestions (title, suggested_content, community_id, hub_note_id, note_count, density, note_titles)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(title, content, comm.id, comm.hubNoteId, comm.size, comm.density, noteTitles);

      saved++;

      // 如果配置了自动生成
      if (this.config.autoCreate) {
        this.createMOCFromSuggestion(
          (this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id
        );
      }
    }

    return { communities: communities.length, saved };
  }

  /**
   * 获取待处理的 MOC 建议
   */
  getPendingSuggestions(limit = 10): MOCSuggestion[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, suggested_content, community_id, hub_note_id, note_count, density, note_titles, status, created_at
         FROM zettel_moc_suggestions
         WHERE status = 'pending'
         ORDER BY note_count DESC, density DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
        id: number;
        title: string;
        suggested_content: string;
        community_id: number;
        hub_note_id: string;
        note_count: number;
        density: number;
        note_titles: string;
        status: string;
        created_at: string;
      }>;

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      suggestedContent: r.suggested_content,
      communityId: r.community_id,
      hubNoteId: r.hub_note_id,
      noteCount: r.note_count,
      density: r.density,
      noteTitles: r.note_titles.split(", "),
      status: r.status as "pending" | "created" | "rejected",
      createdAt: r.created_at,
    }));
  }

  /**
   * 根据建议创建实际的 MOC 笔记
   */
  createMOCFromSuggestion(suggestionId: number): { success: boolean; noteId?: string } {
    const suggestion = this.db
      .prepare(
        `SELECT title, suggested_content, hub_note_id FROM zettel_moc_suggestions WHERE id = ?`
      )
      .get(suggestionId) as { title: string; suggested_content: string; hub_note_id: string } | undefined;

    if (!suggestion) return { success: false };

    const noteId = `moc-${Date.now()}`;

    // 创建 MOC 笔记（类型为 structure，文件夹为 zettels）
    this.db
      .prepare(
        `INSERT INTO zettel_notes (id, title, content, summary, type, status, folder, confidence, source, reviewed, file_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'structure', 'PERMANENT', 'zettels', 0.9, 'distilled', 1, ?, datetime('now'), datetime('now'))`
      )
      .run(noteId, suggestion.title, suggestion.suggested_content, suggestion.title, `${noteId}.md`);

    // 更新建议状态
    this.db
      .prepare(
        `UPDATE zettel_moc_suggestions SET status = 'created', resolved_at = datetime('now') WHERE id = ?`
      )
      .run(suggestionId);

    return { success: true, noteId };
  }

  /**
   * 拒绝 MOC 建议
   */
  rejectSuggestion(id: number): boolean {
    const result = this.db
      .prepare(
        `UPDATE zettel_moc_suggestions SET status = 'rejected', resolved_at = datetime('now') WHERE id = ?`
      )
      .run(id);

    return result.changes > 0;
  }

  /**
   * 生成 MOC 标题
   */
  private generateMOCTitle(community: Community): string {
    // 基于 hub 笔记标题生成
    const hubTitle = community.hubNoteTitle;
    // 如果标题已经很短，直接作为主题
    if (hubTitle.length <= 20) {
      return `${hubTitle} 知识地图`;
    }
    // 否则取前 15 个字符
    return `${hubTitle.substring(0, 15)}... 知识地图`;
  }

  /**
   * 生成 MOC 内容
   */
  private generateMOCContent(community: Community): string {
    const lines: string[] = [
      `# ${this.generateMOCTitle(community)}`,
      "",
      `> 自动生成于 ${new Date().toISOString().split("T")[0]}`,
      `> 包含 ${community.size} 条笔记，连接密度 ${community.density}`,
      "",
      "## 核心概念",
      "",
    ];

    // 添加前 5 个最重要的笔记
    for (let i = 0; i < Math.min(5, community.notes.length); i++) {
      const note = community.notes[i];
      lines.push(`- [[${note.title}]] ${note.glowScore > 0.7 ? "🔥" : ""}`);
    }

    if (community.notes.length > 5) {
      lines.push("", `... 以及 ${community.notes.length - 5} 条相关笔记`);
    }

    lines.push(
      "",
      "## 中心笔记",
      "",
      `[[${community.hubNoteTitle}]] 是这一知识领域的核心节点。`,
      "",
      "## 待探索",
      "",
      "- 这个主题还有哪些方面可以补充？",
      "- 与其他知识领域有什么联系？",
      ""
    );

    return lines.join("\n");
  }

  /**
   * 获取统计
   */
  getStats(): { total: number; pending: number; created: number } {
    const total = (this.db.prepare("SELECT COUNT(*) as c FROM zettel_moc_suggestions").get() as { c: number }).c;
    const pending = (this.db.prepare("SELECT COUNT(*) as c FROM zettel_moc_suggestions WHERE status = 'pending'").get() as { c: number }).c;
    const created = (this.db.prepare("SELECT COUNT(*) as c FROM zettel_moc_suggestions WHERE status = 'created'").get() as { c: number }).c;

    return { total, pending, created };
  }
}
