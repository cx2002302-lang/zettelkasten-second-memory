/**
 * SerendipityService 单元测试
 *
 * 测试覆盖：
 * 1. 意外发现扫描
 * 2. 获取待处理发现
 * 3. 接受发现（创建链接）
 * 4. 拒绝发现
 * 5. 统计信息
 * 6. 配置读取
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ensureZettelkastenSchema } from "../../../storage/db-schema.js";
import { SerendipityService } from "../serendipity-service.js";

function createNote(
  db: DatabaseSync,
  id: string,
  title: string,
  content: string = "test content with machine learning algorithms"
): void {
  db.prepare(
    `INSERT INTO zettel_notes (id, title, content, summary, type, status, folder, confidence, source, reviewed, file_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'atomic', 'PERMANENT', 'zettels', 0.8, 'manual', 1, ?, datetime('now'), datetime('now'))`
  ).run(id, title, content, title, `${id}.md`);
}

function createLink(db: DatabaseSync, fromId: string, toId: string): void {
  db.prepare(
    `INSERT INTO zettel_links (from_note_id, to_note_id, type, context, created_at)
     VALUES (?, ?, 'related', 'test', datetime('now'))`
  ).run(fromId, toId);
}

function createTag(db: DatabaseSync, name: string): number {
  const result = db.prepare(
    `INSERT INTO zettel_tags (name, description, created_at) VALUES (?, ?, datetime('now'))`
  ).run(name, `desc for ${name}`);
  return Number(result.lastInsertRowid);
}

function associateTag(db: DatabaseSync, noteId: string, tagId: number): void {
  db.prepare(
    `INSERT INTO zettel_note_tags (note_id, tag_id, created_at) VALUES (?, ?, datetime('now'))`
  ).run(noteId, tagId);
}

describe("SerendipityService", () => {
  let db: DatabaseSync;
  let service: SerendipityService;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureZettelkastenSchema({ db, ftsEnabled: false });
    service = new SerendipityService(db, { topK: 10, minScore: 0.3 });
  });

  afterEach(() => {
    db.close();
  });

  // ============================================================================
  // 发现扫描测试
  // ============================================================================
  describe("runDiscovery", () => {
    it("should return zero results for empty database", () => {
      const result = service.runDiscovery();
      expect(result.discovered).toBe(0);
      expect(result.saved).toBe(0);
    });

    it("should discover potential connections between unlinked notes", () => {
      // Create a graph where n1 and n2 share common neighbors but are not directly linked
      createNote(db, "n1", "Note Alpha", "neural networks and deep learning concepts");
      createNote(db, "n2", "Note Beta", "deep learning and neural networks research");
      createNote(db, "m1", "Middle 1", "bridge content");
      createNote(db, "m2", "Middle 2", "another bridge");

      // n1 and n2 both link to m1 and m2, but not to each other
      createLink(db, "n1", "m1");
      createLink(db, "n1", "m2");
      createLink(db, "n2", "m1");
      createLink(db, "n2", "m2");

      const result = service.runDiscovery();

      // Should discover n1-n2 as a potential connection
      expect(result.discovered).toBeGreaterThan(0);
      expect(result.saved).toBeGreaterThan(0);
    });

    it("should skip already existing serendipity records", () => {
      createNote(db, "n1", "Note A", "shared topic research");
      createNote(db, "n2", "Note B", "shared topic analysis");
      createNote(db, "m1", "Middle", "bridge");

      createLink(db, "n1", "m1");
      createLink(db, "n2", "m1");

      const first = service.runDiscovery();
      expect(first.saved).toBeGreaterThan(0);

      const second = service.runDiscovery();
      expect(second.saved).toBe(0);
    });

    it("should return zero when disabled", () => {
      const disabledService = new SerendipityService(db, { enabled: false });
      createNote(db, "n1", "Note A");
      createNote(db, "n2", "Note B");
      createNote(db, "m1", "Middle");
      createLink(db, "n1", "m1");
      createLink(db, "n2", "m1");

      const result = disabledService.runDiscovery();
      expect(result.discovered).toBe(0);
      expect(result.saved).toBe(0);
    });

    it("should auto-create links for high-score pairs when configured", () => {
      const autoService = new SerendipityService(db, {
        topK: 10,
        minScore: 0.3,
        autoCreateLinks: true,
      });

      // Identical content maximizes contentSimilarity = 1.0
      const sharedContent = "machine learning algorithms neural networks deep learning";
      createNote(db, "n1", "Note A", sharedContent);
      createNote(db, "n2", "Note B", sharedContent);
      createNote(db, "m1", "Middle 1", "bridge");
      createNote(db, "m2", "Middle 2", "bridge");
      createNote(db, "m3", "Middle 3", "bridge");

      createLink(db, "n1", "m1");
      createLink(db, "n1", "m2");
      createLink(db, "n1", "m3");
      createLink(db, "n2", "m1");
      createLink(db, "n2", "m2");
      createLink(db, "n2", "m3");

      // Add shared tags for higher score
      const tagId = createTag(db, "ml");
      associateTag(db, "n1", tagId);
      associateTag(db, "n2", tagId);

      autoService.runDiscovery();

      // Check if a link was auto-created for high-score pair
      const links = db.prepare(
        `SELECT COUNT(*) as c FROM zettel_links WHERE context LIKE '%Serendipity%'`
      ).get() as { c: number };

      expect(links.c).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // 获取待处理发现测试
  // ============================================================================
  describe("getPendingFindings", () => {
    it("should return empty array when no findings exist", () => {
      const findings = service.getPendingFindings();
      expect(findings).toEqual([]);
    });

    it("should return pending findings with titles", () => {
      createNote(db, "n1", "Alpha Note", "topic research");
      createNote(db, "n2", "Beta Note", "topic analysis");
      createNote(db, "m1", "Connector", "bridge content");

      createLink(db, "n1", "m1");
      createLink(db, "n2", "m1");

      service.runDiscovery();
      const findings = service.getPendingFindings();

      expect(findings.length).toBeGreaterThan(0);
      const f = findings[0];
      expect(f.fromNoteId).toBeDefined();
      expect(f.toNoteId).toBeDefined();
      expect(f.fromTitle).toBeDefined();
      expect(f.toTitle).toBeDefined();
      expect(typeof f.score).toBe("number");
      expect(f.reason).toBeDefined();
      expect(typeof f.pathLength).toBe("number");
      expect(f.createdAt).toBeDefined();
    });

    it("should respect limit parameter", () => {
      // Create multiple pairs with shared neighbors
      for (let i = 1; i <= 4; i++) {
        createNote(db, `a${i}`, `Alpha ${i}`, "common topic");
      }
      createNote(db, "hub", "Hub Note", "central concept");

      for (let i = 1; i <= 4; i++) {
        createLink(db, `a${i}`, "hub");
      }

      service.runDiscovery();
      const findings = service.getPendingFindings(2);

      expect(findings.length).toBeLessThanOrEqual(2);
    });
  });

  // ============================================================================
  // 接受发现测试
  // ============================================================================
  describe("acceptFinding", () => {
    it("should accept a finding and create a link", () => {
      createNote(db, "n1", "Source Note", "research content");
      createNote(db, "n2", "Target Note", "analysis content");
      createNote(db, "m1", "Bridge", "connection");

      createLink(db, "n1", "m1");
      createLink(db, "n2", "m1");

      service.runDiscovery();
      const findings = service.getPendingFindings();
      expect(findings.length).toBeGreaterThan(0);

      const findingId = findings[0].id;
      const result = service.acceptFinding(findingId);
      expect(result).toBe(true);

      // Verify link was created
      const linkCount = db.prepare(
        `SELECT COUNT(*) as c FROM zettel_links WHERE context LIKE '%Discovered by Serendipity%'`
      ).get() as { c: number };
      expect(linkCount.c).toBeGreaterThan(0);

      // Verify status updated
      const pending = service.getPendingFindings();
      expect(pending.find((f) => f.id === findingId)).toBeUndefined();
    });

    it("should return false for non-existent finding", () => {
      const result = service.acceptFinding(99999);
      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // 拒绝发现测试
  // ============================================================================
  describe("rejectFinding", () => {
    it("should reject a finding", () => {
      createNote(db, "n1", "Note A", "content");
      createNote(db, "n2", "Note B", "content");
      createNote(db, "m1", "Bridge", "content");

      createLink(db, "n1", "m1");
      createLink(db, "n2", "m1");

      service.runDiscovery();
      const findings = service.getPendingFindings();
      expect(findings.length).toBeGreaterThan(0);

      const findingId = findings[0].id;
      const result = service.rejectFinding(findingId);
      expect(result).toBe(true);

      const pending = service.getPendingFindings();
      expect(pending.find((f) => f.id === findingId)).toBeUndefined();
    });

    it("should return false for non-existent finding", () => {
      const result = service.rejectFinding(99999);
      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // 统计信息测试
  // ============================================================================
  describe("getStats", () => {
    it("should return zero stats for empty database", () => {
      const stats = service.getStats();
      expect(stats.total).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.accepted).toBe(0);
      expect(stats.rejected).toBe(0);
    });

    it("should reflect correct counts after operations", () => {
      createNote(db, "n1", "Note A", "topic");
      createNote(db, "n2", "Note B", "topic");
      createNote(db, "n3", "Note C", "topic");
      createNote(db, "m1", "Bridge", "topic");

      createLink(db, "n1", "m1");
      createLink(db, "n2", "m1");
      createLink(db, "n3", "m1");

      service.runDiscovery();
      let stats = service.getStats();
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.pending).toBe(stats.total);
      expect(stats.accepted).toBe(0);
      expect(stats.rejected).toBe(0);

      const findings = service.getPendingFindings();
      service.acceptFinding(findings[0].id);
      if (findings.length > 1) {
        service.rejectFinding(findings[1].id);
      }

      stats = service.getStats();
      expect(stats.accepted).toBe(1);
      if (findings.length > 1) {
        expect(stats.rejected).toBe(1);
      }
      expect(stats.pending).toBe(stats.total - stats.accepted - stats.rejected);
    });
  });

  // ============================================================================
  // 配置测试
  // ============================================================================
  describe("getConfig", () => {
    it("should return default config", () => {
      const config = service.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.topK).toBe(10);
      expect(config.minScore).toBe(0.3);
      expect(config.maxPathLength).toBe(3);
      expect(config.autoCreateLinks).toBe(false);
    });

    it("should return overridden config values", () => {
      const customService = new SerendipityService(db, {
        topK: 5,
        minScore: 0.6,
        autoCreateLinks: true,
      });
      const config = customService.getConfig();
      expect(config.topK).toBe(5);
      expect(config.minScore).toBe(0.6);
      expect(config.autoCreateLinks).toBe(true);
    });
  });
});
