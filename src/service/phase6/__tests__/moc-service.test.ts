/**
 * MOCService 单元测试
 *
 * 测试覆盖：
 * 1. MOC 建议扫描与生成
 * 2. 获取待处理建议
 * 3. 从建议创建 MOC 笔记
 * 4. 拒绝建议
 * 5. 统计信息
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ensureZettelkastenSchema } from "../../../storage/db-schema.js";
import { MOCService } from "../moc-service.js";

function createNote(
  db: DatabaseSync,
  id: string,
  title: string,
  content: string = "test content",
  folder: string = "zettels"
): void {
  db.prepare(
    `INSERT INTO zettel_notes (id, title, content, summary, type, status, folder, confidence, source, reviewed, file_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'atomic', 'PERMANENT', ?, 0.8, 'manual', 1, ?, datetime('now'), datetime('now'))`
  ).run(id, title, content, title, folder, `${id}.md`);
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

function createNoteStats(
  db: DatabaseSync,
  noteId: string,
  glowScore: number = 0.5
): void {
  db.prepare(
    `INSERT INTO zettel_note_stats (note_id, pagerank_score, backlink_count, outgoing_link_count, days_since_created, days_since_updated, glow_score, decay_factor, glow_status, last_calculated_at)
     VALUES (?, 0.1, 0, 0, 0, 0, ?, 1.0, 'stable', datetime('now'))`
  ).run(noteId, glowScore);
}

describe("MOCService", () => {
  let db: DatabaseSync;
  let service: MOCService;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureZettelkastenSchema({ db, ftsEnabled: false });
    service = new MOCService(db, { minClusterSize: 3, maxClusters: 5 });
  });

  afterEach(() => {
    db.close();
  });

  // ============================================================================
  // 扫描与建议测试
  // ============================================================================
  describe("scanAndSuggest", () => {
    it("should return zero results for empty database", () => {
      const result = service.scanAndSuggest();
      expect(result.communities).toBe(0);
      expect(result.saved).toBe(0);
    });

    it("should detect communities and save suggestions", () => {
      // Create a community of 5 notes sharing the same tag
      const tagId = createTag(db, "machine-learning");
      for (let i = 1; i <= 5; i++) {
        const id = `ml-${i}`;
        createNote(db, id, `ML Note ${i}`, `Machine learning concept ${i}`);
        associateTag(db, id, tagId);
        createNoteStats(db, id, 0.5 + i * 0.05);
      }
      // Add some links to increase density
      createLink(db, "ml-1", "ml-2");
      createLink(db, "ml-2", "ml-3");
      createLink(db, "ml-3", "ml-4");
      createLink(db, "ml-4", "ml-5");
      createLink(db, "ml-1", "ml-5");

      const result = service.scanAndSuggest();

      expect(result.communities).toBeGreaterThan(0);
      expect(result.saved).toBeGreaterThan(0);
    });

    it("should skip existing suggestions for same community", () => {
      const tagId = createTag(db, "ai");
      for (let i = 1; i <= 5; i++) {
        const id = `ai-${i}`;
        createNote(db, id, `AI Note ${i}`);
        associateTag(db, id, tagId);
        createNoteStats(db, id);
      }
      createLink(db, "ai-1", "ai-2");
      createLink(db, "ai-2", "ai-3");
      createLink(db, "ai-3", "ai-4");
      createLink(db, "ai-4", "ai-5");

      const first = service.scanAndSuggest();
      expect(first.saved).toBeGreaterThan(0);

      const second = service.scanAndSuggest();
      expect(second.saved).toBe(0); // Already exists
    });

    it("should return zero when disabled", () => {
      const disabledService = new MOCService(db, { enabled: false });
      const result = disabledService.scanAndSuggest();
      expect(result.communities).toBe(0);
      expect(result.saved).toBe(0);
    });

    it("should auto-create MOC notes when autoCreate is enabled", () => {
      const autoService = new MOCService(db, { minClusterSize: 3, maxClusters: 5, autoCreate: true });
      const tagId = createTag(db, "programming");
      for (let i = 1; i <= 5; i++) {
        const id = `prog-${i}`;
        createNote(db, id, `Prog Note ${i}`);
        associateTag(db, id, tagId);
        createNoteStats(db, id);
      }
      createLink(db, "prog-1", "prog-2");
      createLink(db, "prog-2", "prog-3");
      createLink(db, "prog-3", "prog-4");
      createLink(db, "prog-4", "prog-5");

      const result = autoService.scanAndSuggest();
      expect(result.saved).toBeGreaterThan(0);

      // Verify MOC note was created
      const notes = db.prepare("SELECT COUNT(*) as c FROM zettel_notes WHERE type = 'structure'").get() as { c: number };
      expect(notes.c).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // 获取建议测试
  // ============================================================================
  describe("getPendingSuggestions", () => {
    it("should return empty array when no suggestions exist", () => {
      const suggestions = service.getPendingSuggestions();
      expect(suggestions).toEqual([]);
    });

    it("should return pending suggestions with correct structure", () => {
      const tagId = createTag(db, "design");
      for (let i = 1; i <= 5; i++) {
        const id = `design-${i}`;
        createNote(db, id, `Design Note ${i}`);
        associateTag(db, id, tagId);
        createNoteStats(db, id);
      }
      createLink(db, "design-1", "design-2");
      createLink(db, "design-2", "design-3");
      createLink(db, "design-3", "design-4");
      createLink(db, "design-4", "design-5");

      service.scanAndSuggest();
      const suggestions = service.getPendingSuggestions();

      expect(suggestions.length).toBeGreaterThan(0);
      const s = suggestions[0];
      expect(s.id).toBeDefined();
      expect(s.title).toBeDefined();
      expect(typeof s.noteCount).toBe("number");
      expect(typeof s.density).toBe("number");
      expect(Array.isArray(s.noteTitles)).toBe(true);
      expect(s.status).toBe("pending");
      expect(s.suggestedContent).toBeDefined();
      expect(s.suggestedContent.length).toBeGreaterThan(0);
    });

    it("should respect limit parameter", () => {
      const tagId1 = createTag(db, "tag-a");
      const tagId2 = createTag(db, "tag-b");

      // First community
      for (let i = 1; i <= 5; i++) {
        const id = `a-${i}`;
        createNote(db, id, `A Note ${i}`);
        associateTag(db, id, tagId1);
        createNoteStats(db, id);
      }
      for (let i = 1; i < 5; i++) {
        createLink(db, `a-${i}`, `a-${i + 1}`);
      }

      // Second community
      for (let i = 1; i <= 5; i++) {
        const id = `b-${i}`;
        createNote(db, id, `B Note ${i}`);
        associateTag(db, id, tagId2);
        createNoteStats(db, id);
      }
      for (let i = 1; i < 5; i++) {
        createLink(db, `b-${i}`, `b-${i + 1}`);
      }

      service.scanAndSuggest();
      const suggestions = service.getPendingSuggestions(1);

      expect(suggestions.length).toBeLessThanOrEqual(1);
    });
  });

  // ============================================================================
  // 创建 MOC 笔记测试
  // ============================================================================
  describe("createMOCFromSuggestion", () => {
    it("should create a MOC note from suggestion", () => {
      const tagId = createTag(db, "philosophy");
      for (let i = 1; i <= 5; i++) {
        const id = `philo-${i}`;
        createNote(db, id, `Philo Note ${i}`);
        associateTag(db, id, tagId);
        createNoteStats(db, id);
      }
      createLink(db, "philo-1", "philo-2");
      createLink(db, "philo-2", "philo-3");
      createLink(db, "philo-3", "philo-4");
      createLink(db, "philo-4", "philo-5");

      service.scanAndSuggest();
      const suggestions = service.getPendingSuggestions();
      expect(suggestions.length).toBeGreaterThan(0);

      const suggestionId = suggestions[0].id;
      const result = service.createMOCFromSuggestion(suggestionId);

      expect(result.success).toBe(true);
      expect(result.noteId).toBeDefined();
      expect(result.noteId!.startsWith("moc-")).toBe(true);

      // Verify note was created in database
      const note = db.prepare("SELECT * FROM zettel_notes WHERE id = ?").get(result.noteId!) as { title: string; type: string; folder: string } | undefined;
      expect(note).toBeDefined();
      expect(note!.type).toBe("structure");
      expect(note!.folder).toBe("zettels");

      // Verify suggestion status updated
      const updated = service.getPendingSuggestions();
      expect(updated.find((s) => s.id === suggestionId)).toBeUndefined();
    });

    it("should return failure for non-existent suggestion", () => {
      const result = service.createMOCFromSuggestion(99999);
      expect(result.success).toBe(false);
      expect(result.noteId).toBeUndefined();
    });
  });

  // ============================================================================
  // 拒绝建议测试
  // ============================================================================
  describe("rejectSuggestion", () => {
    it("should reject a suggestion", () => {
      const tagId = createTag(db, "psychology");
      for (let i = 1; i <= 5; i++) {
        const id = `psy-${i}`;
        createNote(db, id, `Psy Note ${i}`);
        associateTag(db, id, tagId);
        createNoteStats(db, id);
      }
      createLink(db, "psy-1", "psy-2");
      createLink(db, "psy-2", "psy-3");
      createLink(db, "psy-3", "psy-4");
      createLink(db, "psy-4", "psy-5");

      service.scanAndSuggest();
      const suggestions = service.getPendingSuggestions();
      expect(suggestions.length).toBeGreaterThan(0);

      const suggestionId = suggestions[0].id;
      const result = service.rejectSuggestion(suggestionId);
      expect(result).toBe(true);

      const pending = service.getPendingSuggestions();
      expect(pending.find((s) => s.id === suggestionId)).toBeUndefined();
    });

    it("should return false for non-existent suggestion", () => {
      const result = service.rejectSuggestion(99999);
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
      expect(stats.created).toBe(0);
    });

    it("should reflect correct counts after operations", () => {
      const tagId = createTag(db, "economics");
      for (let i = 1; i <= 5; i++) {
        const id = `eco-${i}`;
        createNote(db, id, `Eco Note ${i}`);
        associateTag(db, id, tagId);
        createNoteStats(db, id);
      }
      createLink(db, "eco-1", "eco-2");
      createLink(db, "eco-2", "eco-3");
      createLink(db, "eco-3", "eco-4");
      createLink(db, "eco-4", "eco-5");

      service.scanAndSuggest();
      let stats = service.getStats();
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.pending).toBeGreaterThan(0);
      expect(stats.created).toBe(0);

      // Create one MOC
      const suggestions = service.getPendingSuggestions();
      service.createMOCFromSuggestion(suggestions[0].id);

      stats = service.getStats();
      expect(stats.created).toBe(1);
      expect(stats.pending).toBe(stats.total - 1);
    });
  });
});
