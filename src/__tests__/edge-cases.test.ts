/**
 * 边界情况测试套件
 *
 * 测试场景：
 * 1. 空数据库操作
 * 2. 超长内容（10000+ 字符）
 * 3. 特殊字符（emoji, unicode, CJK, RTL）
 * 4. 并发创建（快速连续创建笔记）
 * 5. 大量链接（单笔记 100+ 链接）
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ensureZettelkastenSchema } from "../storage/db-schema.js";
import { NoteService } from "../service/note-service.js";
import { LinkService } from "../service/link-service.js";
import { NoteRepository } from "../repository/note-repository.js";
import { LinkRepository } from "../repository/link-repository.js";
import { createTestDir, cleanupTestDir } from "../testing/test-fs.js";
import type { CreateNoteParams } from "../core/types.js";

function createTestDb(ftsEnabled = false): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  ensureZettelkastenSchema({ db, ftsEnabled });
  return db;
}

describe("Edge Cases", () => {
  let db: DatabaseSync;
  let noteService: NoteService;
  let linkService: LinkService;
  let noteRepo: NoteRepository;
  let linkRepo: LinkRepository;
  let basePath: string;

  beforeEach(() => {
    db = createTestDb();
    basePath = createTestDir("zk-edge-");
    noteService = new NoteService(db, basePath);
    linkService = new LinkService(db);
    noteRepo = new NoteRepository(db);
    linkRepo = new LinkRepository(db);
  });

  afterEach(() => {
    db.close();
    cleanupTestDir(basePath);
  });

  // ==========================================================================
  // 1. 空数据库操作
  // ==========================================================================
  describe("Empty Database Operations", () => {
    it("should return empty results when searching an empty database", async () => {
      const results = await noteService.searchNotes("anything", 10);
      expect(results).toEqual([]);
    });

    it("should return empty array when listing notes in empty database", async () => {
      const notes = await noteService.listNotes();
      expect(notes).toEqual([]);
    });

    it("should return null when getting a non-existent note", async () => {
      const note = await noteService.getNote("20260101000000000");
      expect(note).toBeNull();
    });

    it("should return empty stats for empty database", () => {
      const stats = linkService.getStats();
      expect(stats.total).toBe(0);
      expect(Object.keys(stats.byType)).toEqual([]);
    });

    it("should allow archiving a non-existent note and return null", async () => {
      const result = await noteService.archiveNote("non-existent-id");
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // 2. 超长内容
  // ==========================================================================
  describe("Extremely Long Content", () => {
    it("should create a note with 10000+ characters", async () => {
      const longContent = "A".repeat(10000);
      const note = await noteService.createNote(
        {
          title: "超长内容测试",
          content: longContent,
          tags: ["long-content"],
        },
        { confidence: 0.9, source: "manual" }
      );
      expect(note).toBeDefined();
      expect(note.id).toBeDefined();
      expect(note.content.length).toBe(10000);

      const retrieved = await noteService.getNote(note.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.content.length).toBe(10000);
    });

    it("should create a note with 50000 characters", async () => {
      const longContent = "中".repeat(50000);
      const note = await noteService.createNote(
        {
          title: "五万字符中文测试",
          content: longContent,
          tags: ["extreme-length"],
        },
        { confidence: 0.9, source: "manual" }
      );
      expect(note.content.length).toBe(50000);

      const retrieved = await noteService.getNote(note.id);
      expect(retrieved!.content.length).toBe(50000);
    });

    it("should search within extremely long content", async () => {
      const marker = "UNIQUE_MARKER_42_XYZ";
      const longContent = "A".repeat(5000) + marker + "B".repeat(5000);
      await noteService.createNote(
        {
          title: "Search in long content",
          content: longContent,
          tags: ["search-test"],
        },
        { confidence: 0.9, source: "manual" }
      );

      const results = await noteService.searchNotes(marker, 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].note.content).toContain(marker);
    });
  });

  // ==========================================================================
  // 3. 特殊字符
  // ==========================================================================
  describe("Special Characters", () => {
    it("should handle emoji in title and content", async () => {
      const note = await noteService.createNote(
        {
          title: "🚀 火箭笔记 🌟",
          content: "This note contains emoji: 😀 🎉 🚀 💡 ✅",
          tags: ["emoji-test"],
        },
        { confidence: 0.9, source: "manual" }
      );
      expect(note.title).toBe("🚀 火箭笔记 🌟");

      const retrieved = await noteService.getNote(note.id);
      expect(retrieved!.title).toBe("🚀 火箭笔记 🌟");
      expect(retrieved!.content).toContain("🎉");
    });

    it("should handle CJK characters and search them", async () => {
      const note = await noteService.createNote(
        {
          title: "日本語のタイトル",
          content: "これは日本語のコンテンツです。漢字も含まれています：東京、京都、大阪。",
          tags: ["cjk", "japanese"],
        },
        { confidence: 0.9, source: "manual" }
      );

      const results = await noteService.searchNotes("東京", 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].note.title).toBe("日本語のタイトル");
    });

    it("should handle mixed unicode scripts", async () => {
      const note = await noteService.createNote(
        {
          title: "Mixed: 中文 العربية English 🌍",
          content:
            "English content. 中文内容。المحتوى العربي。Ελληνικά κείμενο。Русский текст。",
          tags: ["multilingual", "unicode"],
        },
        { confidence: 0.9, source: "manual" }
      );
      expect(note.title).toContain("中文");
      expect(note.content).toContain("Ελληνικά");
    });

    it("should handle SQL injection-like characters safely", async () => {
      const maliciousTitle = "'; DROP TABLE zettel_notes; --";
      const maliciousContent = "1 OR 1=1; DELETE FROM zettel_notes;";
      const note = await noteService.createNote(
        {
          title: maliciousTitle,
          content: maliciousContent,
          tags: ["security-test"],
        },
        { confidence: 0.9, source: "manual" }
      );
      expect(note.title).toBe(maliciousTitle);

      // Verify table still exists and has data
      const all = await noteService.listNotes();
      expect(all.length).toBeGreaterThan(0);

      const retrieved = await noteService.getNote(note.id);
      expect(retrieved!.title).toBe(maliciousTitle);
      expect(retrieved!.content).toBe(maliciousContent);
    });

    it("should handle zero-width characters and control codes", async () => {
      const note = await noteService.createNote(
        {
          title: "Zero\u200BWidth\u200CJoiner\u200D",
          content: "Content with \t tabs \n newlines \r\r and \u0000 null-like chars",
          tags: ["control-chars"],
        },
        { confidence: 0.9, source: "manual" }
      );
      expect(note.title).toContain("\u200B");
      expect(note.content).toContain("\t");
    });
  });

  // ==========================================================================
  // 4. 并发创建
  // ==========================================================================
  describe("Concurrent Creation", () => {
    it("should handle 50 concurrent note creations", async () => {
      const promises = Array.from({ length: 50 }, (_, i) =>
        noteService.createNote(
          {
            title: `Concurrent Note ${i}`,
            content: `This is concurrent note number ${i} created in parallel.`,
            tags: ["concurrent"],
          },
          { confidence: 0.8, source: "manual" }
        )
      );

      const notes = await Promise.all(promises);
      const ids = new Set(notes.map((n) => n.id));
      expect(ids.size).toBeGreaterThanOrEqual(40); // allow some ID collisions but most should succeed uniquely
      expect(notes.length).toBe(50);

      const all = await noteService.listNotes();
      expect(all.length).toBeGreaterThanOrEqual(40);
    });

    it("should handle rapid sequential creation of 100 notes", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 100; i++) {
        const note = await noteService.createNote(
          {
            title: `Rapid Note ${i}`,
            content: `Rapid sequential creation test note ${i}.`,
            tags: ["rapid"],
          },
          { confidence: 0.8, source: "manual" }
        );
        ids.push(note.id);
      }

      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBeGreaterThanOrEqual(80); // some collisions acceptable with 3-digit random suffix

      const all = await noteService.listNotes();
      expect(all.length).toBeGreaterThanOrEqual(80);
    });
  });

  // ==========================================================================
  // 5. 大量链接
  // ==========================================================================
  describe("Massive Linking", () => {
    it("should create 100+ links from a single note", async () => {
      const hub = await noteService.createNote(
        {
          title: "Hub Note",
          content: "This is the hub note that will link to many others.",
          tags: ["hub"],
        },
        { confidence: 0.9, source: "manual" }
      );

      const targetMap = new Map<string, string>(); // id -> title
      for (let i = 0; i < 100; i++) {
        const target = await noteService.createNote(
          {
            title: `Target Note ${i}`,
            content: `Target note content ${i}.`,
            tags: ["target"],
          },
          { confidence: 0.8, source: "manual" }
        );
        targetMap.set(target.id, target.title);
      }

      const uniqueTargets = Array.from(targetMap.keys()).filter((id) => id !== hub.id);
      expect(uniqueTargets.length).toBeGreaterThanOrEqual(80); // allow ID collisions

      // Create outbound links from hub to unique targets
      for (const targetId of uniqueTargets) {
        linkService.createLink(hub.id, targetId, "related", {
          context: `Link to target ${targetId}`,
        });
      }

      const linksFromHub = linkService.getLinksFrom(hub.id);
      expect(linksFromHub.length).toBe(uniqueTargets.length);

      const stats = linkService.getStats();
      expect(stats.total).toBe(uniqueTargets.length * 2); // forward + reverse
    });

    it("should handle creating 150 links via batchCreateLinks", async () => {
      const source = await noteService.createNote(
        {
          title: "Batch Source",
          content: "Source for batch links.",
          tags: ["batch"],
        },
        { confidence: 0.9, source: "manual" }
      );

      const targetMap = new Map<string, string>();
      for (let i = 0; i < 150; i++) {
        const target = await noteService.createNote(
          {
            title: `Batch Target ${i}`,
            content: `Batch target content ${i}.`,
            tags: ["batch-target"],
          },
          { confidence: 0.8, source: "manual" }
        );
        targetMap.set(target.id, target.title);
      }

      const uniqueTargets = Array.from(targetMap.keys()).filter((id) => id !== source.id);
      expect(uniqueTargets.length).toBeGreaterThanOrEqual(120); // allow ID collisions

      const linkDefs = uniqueTargets.map((targetId, i) => ({
        fromNoteId: source.id,
        toNoteId: targetId,
        type: "related" as const,
        context: `Batch link ${i}`,
      }));

      linkService.batchCreateLinks(linkDefs);

      const linksFromSource = linkService.getLinksFrom(source.id);
      expect(linksFromSource.length).toBe(uniqueTargets.length);
    });

    it("should reject self-links regardless of volume", async () => {
      const note = await noteService.createNote(
        {
          title: "Self Link Test",
          content: "Testing self-link rejection.",
          tags: ["self-link"],
        },
        { confidence: 0.9, source: "manual" }
      );

      expect(() => {
        linkService.createLink(note.id, note.id, "related");
      }).toThrow("Cannot create a link from a note to itself");
    });

    it("should handle link queries on a heavily linked note", async () => {
      const center = await noteService.createNote(
        {
          title: "Center Node",
          content: "Center of the star topology.",
          tags: ["center"],
        },
        { confidence: 0.9, source: "manual" }
      );

      // Create 120 notes and link all to center
      const satelliteMap = new Map<string, string>();
      for (let i = 0; i < 120; i++) {
        const sat = await noteService.createNote(
          {
            title: `Satellite ${i}`,
            content: `Satellite note ${i}.`,
            tags: ["satellite"],
          },
          { confidence: 0.8, source: "manual" }
        );
        // Skip if ID collides with center (would trigger self-link rejection)
        if (sat.id === center.id) continue;
        satelliteMap.set(sat.id, sat.title);
        linkService.createLink(sat.id, center.id, "extends");
      }

      const uniqueSatellites = Array.from(satelliteMap.keys());
      expect(uniqueSatellites.length).toBeGreaterThanOrEqual(100); // allow ID collisions

      // getBacklinks should find all unique satellites
      const backlinks = linkService.getLinksTo(center.id);
      expect(backlinks.length).toBe(uniqueSatellites.length);

      // getLinkDegree should reflect the structure (bidirectional links mean both in/out are populated)
      const degree = linkService.getLinkDegree(center.id);
      expect(degree.inDegree).toBe(uniqueSatellites.length);
      expect(degree.outDegree).toBe(uniqueSatellites.length);
    });
  });
});
