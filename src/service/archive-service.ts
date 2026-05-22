import type { DatabaseSync } from "node:sqlite";
import type { ZettelNote, GlowMetrics } from "../core/types.js";
import { GlowCalculator } from "../engine/glow-calculator.js";

export interface ArchiveLogEntry {
  id: number;
  noteId: string;
  noteTitle: string;
  action: "archive" | "unarchive" | "auto_archive";
  reason?: string;
  createdAt: string;
}

export interface AutoArchiveResult {
  archived: number;
  notes: Array<{ id: string; title: string; reason: string }>;
}

export class ArchiveService {
  private glowCalculator: GlowCalculator;

  constructor(private db: DatabaseSync) {
    this.glowCalculator = new GlowCalculator(db);
  }

  /**
   * 记录归档/恢复日志
   */
  logAction(
    noteId: string,
    noteTitle: string,
    action: "archive" | "unarchive" | "auto_archive",
    reason?: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO zettel_archive_log (note_id, note_title, action, reason, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      )
      .run(noteId, noteTitle, action, reason ?? null);
  }

  /**
   * 获取归档历史
   */
  getArchiveLog(options?: {
    noteId?: string;
    limit?: number;
    action?: string;
  }): ArchiveLogEntry[] {
    const conditions: string[] = [];
    const values: (string | number)[] = [];

    if (options?.noteId) {
      conditions.push("note_id = ?");
      values.push(options.noteId);
    }
    if (options?.action) {
      conditions.push("action = ?");
      values.push(options.action);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options?.limit ?? 50;

    const rows = this.db
      .prepare(
        `SELECT id, note_id, note_title, action, reason, created_at
         FROM zettel_archive_log
         ${where}
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(...values, limit) as Array<{
        id: number;
        note_id: string;
        note_title: string;
        action: string;
        reason: string | null;
        created_at: string;
      }>;

    return rows.map((r) => ({
      id: r.id,
      noteId: r.note_id,
      noteTitle: r.note_title,
      action: r.action as ArchiveLogEntry["action"],
      reason: r.reason ?? undefined,
      createdAt: r.created_at,
    }));
  }

  /**
   * 自动归档僵尸笔记
   * 扫描所有 zombie 状态的笔记，归档到 archive folder
   */
  autoArchiveZombies(options?: {
    dryRun?: boolean;
    limit?: number;
  }): AutoArchiveResult {
    // 先重新计算发光度
    this.glowCalculator.recalculateAll();

    const zombies = this.glowCalculator.findZombies(options?.limit ?? 50);
    const result: AutoArchiveResult = { archived: 0, notes: [] };

    for (const zombie of zombies) {
      const folderRow = this.db
        .prepare("SELECT folder FROM zettel_notes WHERE id = ?")
        .get(zombie.noteId) as { folder: string } | undefined;
      if (folderRow?.folder === "archive") continue;

      const reason = `自动归档：${zombie.status} 状态，发光度 ${zombie.glow.toFixed(3)}，${zombie.decay ? "衰减因子 " + zombie.decay.toFixed(3) : ""}`;

      if (!options?.dryRun) {
        // 归档
        this.db
          .prepare("UPDATE zettel_notes SET folder = 'archive' WHERE id = ?")
          .run(zombie.noteId);

        // 记录日志
        this.logAction(
          zombie.noteId,
          zombie.title,
          "auto_archive",
          reason
        );
      }

      result.archived++;
      result.notes.push({
        id: zombie.noteId,
        title: zombie.title,
        reason,
      });
    }

    return result;
  }

  /**
   * 获取归档统计
   */
  getArchiveStats(): {
    totalArchived: number;
    totalRestored: number;
    totalAutoArchived: number;
    recent7Days: number;
  } {
    const archived = this.db
      .prepare("SELECT COUNT(*) as cnt FROM zettel_archive_log WHERE action = 'archive'")
      .get() as { cnt: number };
    const restored = this.db
      .prepare("SELECT COUNT(*) as cnt FROM zettel_archive_log WHERE action = 'unarchive'")
      .get() as { cnt: number };
    const autoArchived = this.db
      .prepare("SELECT COUNT(*) as cnt FROM zettel_archive_log WHERE action = 'auto_archive'")
      .get() as { cnt: number };
    const recent7 = this.db
      .prepare("SELECT COUNT(*) as cnt FROM zettel_archive_log WHERE created_at > datetime('now', '-7 days')")
      .get() as { cnt: number };

    return {
      totalArchived: archived.cnt,
      totalRestored: restored.cnt,
      totalAutoArchived: autoArchived.cnt,
      recent7Days: recent7.cnt,
    };
  }
}
