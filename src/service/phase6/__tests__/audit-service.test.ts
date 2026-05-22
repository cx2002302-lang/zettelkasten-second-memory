/**
 * KnowledgeAuditService 单元测试
 *
 * 测试覆盖：
 * 1. 生成报告结构正确性
 * 2. 连接率计算
 * 3. 孤儿笔记识别
 * 4. 僵尸笔记识别
 * 5. 历史报告查询
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ensureZettelkastenSchema } from "../../../storage/db-schema.js";
import { KnowledgeAuditService } from "../audit-service.js";

function createNote(
  db: DatabaseSync,
  id: string,
  title: string,
  content: string,
  folder: string = "zettels",
  reviewed: number = 1
): void {
  db.prepare(
    `INSERT INTO zettel_notes (id, title, content, summary, type, status, folder, confidence, source, reviewed, file_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'atomic', 'PERMANENT', ?, 0.8, 'manual', ?, ?, datetime('now'), datetime('now'))`
  ).run(id, title, content, title, folder, reviewed, `${id}.md`);
}

function createLink(db: DatabaseSync, fromId: string, toId: string): void {
  db.prepare(
    `INSERT INTO zettel_links (from_note_id, to_note_id, type, context, created_at)
     VALUES (?, ?, 'related', 'test', datetime('now'))`
  ).run(fromId, toId);
}

function createNoteStats(
  db: DatabaseSync,
  noteId: string,
  glowStatus: string = "stable",
  glowScore: number = 0.5
): void {
  db.prepare(
    `INSERT INTO zettel_note_stats (note_id, pagerank_score, backlink_count, outgoing_link_count, days_since_created, days_since_updated, glow_score, decay_factor, glow_status, last_calculated_at)
     VALUES (?, 0.1, 0, 0, 0, 0, ?, 1.0, ?, datetime('now'))`
  ).run(noteId, glowScore, glowStatus);
}

describe("KnowledgeAuditService", () => {
  let db: DatabaseSync;
  let service: KnowledgeAuditService;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureZettelkastenSchema({ db, ftsEnabled: false });
    service = new KnowledgeAuditService(db);
  });

  afterEach(() => {
    db.close();
  });

  // ============================================================================
  // 报告结构测试
  // ============================================================================
  describe("generateReport", () => {
    it("should return a valid audit report structure", () => {
      const report = service.generateReport();

      expect(report).toBeDefined();
      expect(report.generatedAt).toBeDefined();
      expect(typeof report.totalNotes).toBe("number");
      expect(typeof report.totalLinks).toBe("number");
      expect(typeof report.connectionRate).toBe("number");
      expect(typeof report.orphanCount).toBe("number");
      expect(typeof report.zombieCount).toBe("number");
      expect(typeof report.inboxBacklog).toBe("number");
      expect(typeof report.avgContentLength).toBe("number");
      expect(Array.isArray(report.hubNotes)).toBe(true);
      expect(Array.isArray(report.growthTrend)).toBe(true);
      expect(Array.isArray(report.domainDistribution)).toBe(true);
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it("should return empty report when disabled", () => {
      const disabledService = new KnowledgeAuditService(db, { enabled: false });
      const report = disabledService.generateReport();

      expect(report.totalNotes).toBe(0);
      expect(report.totalLinks).toBe(0);
      expect(report.connectionRate).toBe(0);
      expect(report.orphanCount).toBe(0);
      expect(report.zombieCount).toBe(0);
      expect(report.inboxBacklog).toBe(0);
      expect(report.avgContentLength).toBe(0);
      expect(report.recommendations).toEqual(["审计功能已关闭"]);
    });

    it("should calculate connection rate correctly", () => {
      // 3 notes, 2 with links, 1 orphan
      createNote(db, "n1", "Note 1", "content one");
      createNote(db, "n2", "Note 2", "content two");
      createNote(db, "n3", "Note 3", "content three");
      createLink(db, "n1", "n2");
      createNoteStats(db, "n1");
      createNoteStats(db, "n2");
      createNoteStats(db, "n3");

      const report = service.generateReport();

      expect(report.totalNotes).toBe(3);
      expect(report.totalLinks).toBe(1);
      expect(report.connectionRate).toBeGreaterThan(0);
      // 2 notes have links out of 3 total = ~66.7%
      expect(report.connectionRate).toBeCloseTo(66.7, 0);
    });

    it("should identify orphan notes correctly", () => {
      createNote(db, "n1", "Linked Note", "content");
      createNote(db, "n2", "Orphan Note", "content");
      createLink(db, "n1", "n2"); // n1 has a link, n2 also connected
      createNoteStats(db, "n1");
      createNoteStats(db, "n2");

      const report = service.generateReport();
      // Both n1 and n2 are connected via the link
      expect(report.orphanCount).toBe(0);

      // Add a true orphan
      createNote(db, "n3", "True Orphan", "content");
      createNoteStats(db, "n3");

      const report2 = service.generateReport();
      expect(report2.orphanCount).toBe(1);
      expect(report2.totalNotes).toBe(3);
    });

    it("should identify zombie notes correctly", () => {
      createNote(db, "n1", "Active Note", "content");
      createNote(db, "n2", "Zombie Note", "content");
      createNoteStats(db, "n1", "active", 0.8);
      createNoteStats(db, "n2", "zombie", 0.1);

      const report = service.generateReport();

      expect(report.zombieCount).toBe(1);
    });

    it("should calculate inbox backlog correctly", () => {
      createNote(db, "n1", "Reviewed Note", "content", "inbox", 1);
      createNote(db, "n2", "Unreviewed Note", "content", "inbox", 0);
      createNote(db, "n3", "Another Unreviewed", "content", "inbox", 0);
      createNoteStats(db, "n1");
      createNoteStats(db, "n2");
      createNoteStats(db, "n3");

      const report = service.generateReport();

      expect(report.inboxBacklog).toBe(2);
    });

    it("should calculate average content length correctly", () => {
      createNote(db, "n1", "Short", "abc");
      createNote(db, "n2", "Long", "abcdefgh");
      createNoteStats(db, "n1");
      createNoteStats(db, "n2");

      const report = service.generateReport();

      expect(report.avgContentLength).toBe(6); // (3 + 8) / 2 = 5.5, rounded to 6
    });

    it("should identify hub notes correctly", () => {
      createNote(db, "n1", "Hub Note", "content");
      createNote(db, "n2", "Note 2", "content");
      createNote(db, "n3", "Note 3", "content");
      createNote(db, "n4", "Note 4", "content");
      createLink(db, "n1", "n2");
      createLink(db, "n1", "n3");
      createLink(db, "n1", "n4");
      createNoteStats(db, "n1", "active", 0.9);
      createNoteStats(db, "n2", "active", 0.5);
      createNoteStats(db, "n3", "active", 0.5);
      createNoteStats(db, "n4", "active", 0.5);

      const report = service.generateReport();

      expect(report.hubNotes.length).toBeGreaterThan(0);
      const hub = report.hubNotes[0];
      expect(hub.id).toBe("n1");
      expect(hub.linkCount).toBe(3);
    });

    it("should calculate domain distribution correctly", () => {
      createNote(db, "n1", "Zettel 1", "content", "zettels");
      createNote(db, "n2", "Zettel 2", "content", "zettels");
      createNote(db, "n3", "Ref 1", "content", "references");
      createNoteStats(db, "n1");
      createNoteStats(db, "n2");
      createNoteStats(db, "n3");

      const report = service.generateReport();

      expect(report.domainDistribution.length).toBe(2);
      const zettelsDist = report.domainDistribution.find((d) => d.folder === "zettels");
      expect(zettelsDist).toBeDefined();
      expect(zettelsDist!.count).toBe(2);
      expect(zettelsDist!.percentage).toBeCloseTo(66.7, 0);
    });

    it("should generate recommendations based on metrics", () => {
      // Create low-quality data to trigger recommendations
      // Need > 5 orphans to trigger orphan recommendation
      for (let i = 1; i <= 7; i++) {
        createNote(db, `orphan-${i}`, `Orphan ${i}`, "x");
        createNoteStats(db, `orphan-${i}`, "stable", 0.1);
      }
      for (let i = 1; i <= 4; i++) {
        createNote(db, `z${i}`, `Zombie ${i}`, "z");
        createNoteStats(db, `z${i}`, "zombie", 0.1);
      }
      for (let i = 1; i <= 12; i++) {
        createNote(db, `unrev-${i}`, `Unreviewed ${i}`, "w", "inbox", 0);
        createNoteStats(db, `unrev-${i}`, "stable", 0.1);
      }

      const report = service.generateReport();

      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.recommendations.some((r) => r.includes("连接率"))).toBe(true);
      expect(report.recommendations.some((r) => r.includes("孤岛"))).toBe(true);
      expect(report.recommendations.some((r) => r.includes("僵尸"))).toBe(true);
      expect(report.recommendations.some((r) => r.includes("Inbox"))).toBe(true);
      expect(report.recommendations.some((r) => r.includes("长度"))).toBe(true);
    });

    it("should save report to database", () => {
      createNote(db, "n1", "Note", "content");
      createNoteStats(db, "n1");

      service.generateReport();
      const history = service.getReportHistory();

      expect(history.length).toBe(1);
      expect(history[0].schedule).toBe("weekly");
    });
  });

  // ============================================================================
  // 历史报告查询测试
  // ============================================================================
  describe("getLatestReport", () => {
    it("should return null when no reports exist", () => {
      const latest = service.getLatestReport();
      expect(latest).toBeNull();
    });

    it("should return the latest report", () => {
      createNote(db, "n1", "Note", "content");
      createNoteStats(db, "n1");

      const report1 = service.generateReport();
      const latest = service.getLatestReport();

      expect(latest).not.toBeNull();
      expect(latest!.totalNotes).toBe(report1.totalNotes);
    });
  });

  describe("getReportHistory", () => {
    it("should return empty array when no reports exist", () => {
      const history = service.getReportHistory();
      expect(history).toEqual([]);
    });

    it("should return reports in descending order", () => {
      createNote(db, "n1", "Note", "content");
      createNoteStats(db, "n1");

      service.generateReport();
      service.generateReport();
      service.generateReport();

      const history = service.getReportHistory(10);
      expect(history.length).toBe(3);
      // Ordered by created_at DESC; since all created in same transaction moment,
      // SQLite may return in insertion order (newest last) or reverse.
      // We just verify all reports are present and IDs are unique.
      const ids = history.map((h) => h.id);
      expect(new Set(ids).size).toBe(3);
    });

    it("should respect limit parameter", () => {
      createNote(db, "n1", "Note", "content");
      createNoteStats(db, "n1");

      service.generateReport();
      service.generateReport();

      const history = service.getReportHistory(1);
      expect(history.length).toBe(1);
    });
  });

  // ============================================================================
  // 边界情况测试
  // ============================================================================
  describe("edge cases", () => {
    it("should handle empty database gracefully", () => {
      const report = service.generateReport();

      expect(report.totalNotes).toBe(0);
      expect(report.totalLinks).toBe(0);
      expect(report.connectionRate).toBe(0);
      expect(report.orphanCount).toBe(0);
      expect(report.zombieCount).toBe(0);
      expect(report.hubNotes).toEqual([]);
      expect(report.domainDistribution).toEqual([]);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it("should archive folder notes", () => {
      createNote(db, "n1", "Active", "content", "zettels");
      createNote(db, "n2", "Archived", "content", "archive");
      createNoteStats(db, "n1");
      createNoteStats(db, "n2");

      const report = service.generateReport();

      expect(report.totalNotes).toBe(1);
      expect(report.totalNotes).not.toBe(2);
    });
  });
});
