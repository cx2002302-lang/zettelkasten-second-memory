/**
 * GlowCalculator 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ensureZettelkastenSchema } from "../../storage/db-schema.js";
import { GlowCalculator } from "../glow-calculator.js";
import { NoteRepository } from "../../repository/note-repository.js";
import { LinkRepository } from "../../repository/link-repository.js";

describe("GlowCalculator", () => {
  let db: DatabaseSync;
  let calculator: GlowCalculator;
  let noteRepo: NoteRepository;
  let linkRepo: LinkRepository;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureZettelkastenSchema({ db, ftsEnabled: false });
    calculator = new GlowCalculator(db);
    noteRepo = new NoteRepository(db);
    linkRepo = new LinkRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * 辅助函数：创建测试笔记
   */
  function createNote(
    id: string,
    title: string,
    options: {
      daysAgoCreated?: number;
      daysAgoUpdated?: number;
      backlinks?: number;
    } = {}
  ) {
    const now = new Date();
    const createdAt = new Date(now.getTime() - (options.daysAgoCreated ?? 0) * 86400000).toISOString();
    const updatedAt = new Date(now.getTime() - (options.daysAgoUpdated ?? 0) * 86400000).toISOString();

    db.prepare(
      `INSERT INTO zettel_notes (id, title, content, type, status, folder, file_path, created_at, updated_at)
       VALUES (?, ?, ?, 'atomic', 'PERMANENT', 'zettels', ?, ?, ?)`
    ).run(id, title, `Content of ${title}`, `/notes/${id}.md`, createdAt, updatedAt);

    // 创建 backlinks
    if (options.backlinks) {
      for (let i = 0; i < options.backlinks; i++) {
        const fromId = `backlink-${id}-${i}`;
        // 先创建源笔记
        db.prepare(
          `INSERT OR IGNORE INTO zettel_notes (id, title, content, type, status, folder, file_path, created_at, updated_at)
           VALUES (?, ?, ?, 'atomic', 'PERMANENT', 'zettels', ?, ?, ?)`
        ).run(fromId, `Backlink ${i}`, `Content`, `/notes/${fromId}.md`, createdAt, updatedAt);
        // 创建链接
        db.prepare(
          `INSERT OR IGNORE INTO zettel_links (from_note_id, to_note_id, type) VALUES (?, ?, 'supports')`
        ).run(fromId, id);
      }
    }
  }

  describe("recalculateAll", () => {
    it("空库时返回空数组", () => {
      const results = calculator.recalculateAll();
      expect(results).toEqual([]);
    });

    it("单笔记时 glow 为中等值", () => {
      createNote("note-1", "唯一笔记", { daysAgoUpdated: 0 });
      const results = calculator.recalculateAll();
      expect(results).toHaveLength(1);
      // 无引用笔记 glow 约 0.3（centrality=0, citation=0, recency=1）
      expect(results[0].glow).toBeGreaterThan(0.2);
      expect(results[0].status).toBe("stable");
    });

    it("高引用+近期更新 = evergreen", () => {
      createNote("note-evergreen", "核心笔记", {
        daysAgoUpdated: 5,
        backlinks: 20,
      });
      const results = calculator.recalculateAll();
      const note = results.find(r => r.noteId === "note-evergreen");
      expect(note).toBeDefined();
      expect(note!.status).toBe("evergreen");
      expect(note!.glow).toBeGreaterThan(0.8);
      expect(note!.backlinkCount).toBe(20);
    });

    it("无引用+长期未更新 = zombie", () => {
      createNote("note-zombie", "过期笔记", {
        daysAgoUpdated: 200,
        backlinks: 0,
      });
      const results = calculator.recalculateAll();
      const note = results.find(r => r.noteId === "note-zombie");
      expect(note).toBeDefined();
      expect(note!.status).toBe("zombie");
      expect(note!.glow).toBeLessThan(0.3);
    });

    it("普通笔记 = stable", () => {
      createNote("note-stable", "普通笔记", {
        daysAgoUpdated: 30,
        backlinks: 2,
      });
      const results = calculator.recalculateAll();
      const note = results.find(r => r.noteId === "note-stable");
      expect(note).toBeDefined();
      expect(note!.status).toBe("stable");
    });
  });

  describe("getRanking", () => {
    it("按 glow 分数降序排列", () => {
      createNote("note-high", "高分笔记", { daysAgoUpdated: 0, backlinks: 20 });
      createNote("note-low", "低分笔记", { daysAgoUpdated: 200, backlinks: 0 });
      calculator.recalculateAll();

      // 获取全部结果，确保包含目标笔记
      const ranking = calculator.getRanking({ limit: 100 });
      const highIndex = ranking.findIndex(r => r.noteId === "note-high");
      const lowIndex = ranking.findIndex(r => r.noteId === "note-low");
      expect(highIndex).toBeGreaterThanOrEqual(0);
      expect(lowIndex).toBeGreaterThanOrEqual(0);
      expect(highIndex).toBeLessThan(lowIndex);
    });

    it("支持按状态筛选", () => {
      createNote("note-e", " evergreen", { daysAgoUpdated: 0, backlinks: 10 });
      createNote("note-z", "zombie", { daysAgoUpdated: 200, backlinks: 0 });
      calculator.recalculateAll();

      const zombies = calculator.getRanking({ statusFilter: ["zombie"] });
      expect(zombies).toHaveLength(1);
      expect(zombies[0].status).toBe("zombie");
    });
  });

  describe("findZombies", () => {
    it("只返回 zombie 状态笔记", () => {
      createNote("note-z", "zombie", { daysAgoUpdated: 200, backlinks: 0 });
      createNote("note-a", "active", { daysAgoUpdated: 0, backlinks: 5 });
      calculator.recalculateAll();

      const zombies = calculator.findZombies();
      expect(zombies).toHaveLength(1);
      expect(zombies[0].noteId).toBe("note-z");
    });
  });

  describe("getSummary", () => {
    it("返回正确的统计摘要", () => {
      createNote("note-e", "evergreen", { daysAgoUpdated: 0, backlinks: 20 });
      createNote("note-a", "active", { daysAgoUpdated: 5, backlinks: 3 });
      createNote("note-z", "zombie", { daysAgoUpdated: 200, backlinks: 0 });
      calculator.recalculateAll();

      const summary = calculator.getSummary();
      // 总数包含所有笔记（包括 backlink 创建的笔记）
      expect(summary.totalNotes).toBeGreaterThanOrEqual(3);
      expect(summary.evergreenCount).toBeGreaterThanOrEqual(1);
      expect(summary.zombieCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("循环链接", () => {
    it("循环链接不影响计算", () => {
      // A -> B -> C -> A
      createNote("A", "Note A", { daysAgoUpdated: 0 });
      createNote("B", "Note B", { daysAgoUpdated: 0 });
      createNote("C", "Note C", { daysAgoUpdated: 0 });

      linkRepo.create("A", "B", "supports");
      linkRepo.create("B", "C", "supports");
      linkRepo.create("C", "A", "supports");

      // 不应该死循环或报错
      expect(() => calculator.recalculateAll()).not.toThrow();
      const results = calculator.recalculateAll();
      expect(results).toHaveLength(3);
    });
  });
});
