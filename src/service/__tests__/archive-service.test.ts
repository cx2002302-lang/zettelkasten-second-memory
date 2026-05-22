/**
 * ArchiveService 测试套件
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ArchiveService } from "../archive-service.js";
import { createTestDatabase, createTestNoteData } from "../../repository/__tests__/test-helpers.js";
import { NoteRepository } from "../../repository/note-repository.js";

describe("ArchiveService", () => {
  let db: DatabaseSync;
  let archiveService: ArchiveService;
  let noteRepository: NoteRepository;
  const TEST_DIR = "/tmp/zettelkasten-archive-test";

  beforeEach(() => {
    db = createTestDatabase();
    archiveService = new ArchiveService(db);
    noteRepository = new NoteRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function insertNote(id: string, title: string, folder: string = "zettels", updatedAt?: string) {
    db.prepare(
      `INSERT INTO zettel_notes (id, title, content, summary, type, status, folder, confidence, source, reviewed, file_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, title, "内容", "摘要", "atomic", "PERMANENT", folder,
      0.5, "manual", 1, `${TEST_DIR}/${id}.md`,
      new Date().toISOString(),
      updatedAt ?? new Date().toISOString()
    );
  }

  describe("logAction", () => {
    it("应该记录归档操作", () => {
      insertNote("note-1", "测试笔记");
      archiveService.logAction("note-1", "测试笔记", "archive", "手动归档");

      const logs = archiveService.getArchiveLog();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        noteId: "note-1",
        noteTitle: "测试笔记",
        action: "archive",
        reason: "手动归档",
      });
    });

    it("应该记录恢复操作", () => {
      insertNote("note-1", "测试笔记");
      archiveService.logAction("note-1", "测试笔记", "unarchive");

      const logs = archiveService.getArchiveLog();
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe("unarchive");
      expect(logs[0].reason).toBeUndefined();
    });

    it("应该记录自动归档操作", () => {
      insertNote("note-1", "测试笔记");
      archiveService.logAction("note-1", "测试笔记", "auto_archive", "超过180天未更新");

      const logs = archiveService.getArchiveLog({ action: "auto_archive" });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe("auto_archive");
    });
  });

  describe("getArchiveLog", () => {
    beforeEach(() => {
      insertNote("note-1", "笔记1");
      insertNote("note-2", "笔记2");
      insertNote("note-3", "笔记3");
      archiveService.logAction("note-1", "笔记1", "archive", "归档原因1");
      archiveService.logAction("note-2", "笔记2", "archive", "归档原因2");
      archiveService.logAction("note-1", "笔记1", "unarchive");
      archiveService.logAction("note-3", "笔记3", "auto_archive", "自动归档");
    });

    it("应该返回所有归档日志", () => {
      const logs = archiveService.getArchiveLog();
      expect(logs).toHaveLength(4);
    });

    it("应该按 noteId 过滤", () => {
      const logs = archiveService.getArchiveLog({ noteId: "note-1" });
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => l.noteId === "note-1")).toBe(true);
    });

    it("应该按 action 过滤", () => {
      const logs = archiveService.getArchiveLog({ action: "archive" });
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => l.action === "archive")).toBe(true);
    });

    it("应该支持 limit", () => {
      const logs = archiveService.getArchiveLog({ limit: 2 });
      expect(logs).toHaveLength(2);
    });

    it("应该按 created_at 降序排列", () => {
      const logs = archiveService.getArchiveLog();
      for (let i = 1; i < logs.length; i++) {
        expect(new Date(logs[i - 1].createdAt).getTime()).toBeGreaterThanOrEqual(
          new Date(logs[i].createdAt).getTime()
        );
      }
    });
  });

  describe("getArchiveStats", () => {
    it("应该返回正确的归档统计", () => {
      insertNote("n1", "笔记1");
      insertNote("n2", "笔记2");
      insertNote("n3", "笔记3");
      insertNote("n4", "笔记4");
      insertNote("n5", "笔记5");
      archiveService.logAction("n1", "笔记1", "archive");
      archiveService.logAction("n2", "笔记2", "archive");
      archiveService.logAction("n3", "笔记3", "unarchive");
      archiveService.logAction("n4", "笔记4", "auto_archive");
      archiveService.logAction("n5", "笔记5", "auto_archive");

      const stats = archiveService.getArchiveStats();

      expect(stats.totalArchived).toBe(2);
      expect(stats.totalRestored).toBe(1);
      expect(stats.totalAutoArchived).toBe(2);
    });

    it("应该处理没有记录的情况", () => {
      const stats = archiveService.getArchiveStats();

      expect(stats.totalArchived).toBe(0);
      expect(stats.totalRestored).toBe(0);
      expect(stats.totalAutoArchived).toBe(0);
      expect(stats.recent7Days).toBe(0);
    });
  });

  describe("autoArchiveZombies", () => {
    it("dryRun 模式下不应修改数据", () => {
      // 创建笔记并通过 SQL 直接修改 updated_at 为很久以前
      const note = noteRepository.createSync
        ? noteRepository.createSync(createTestNoteData({ title: "僵尸笔记1", folder: "zettels" }), TEST_DIR)
        : null;

      // NoteRepository.create 是 async 的，测试环境用同步方式创建
      const id = `note-${Date.now()}-1`;
      db.prepare(
        `INSERT INTO zettel_notes (id, title, content, summary, type, status, folder, confidence, source, reviewed, file_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, "僵尸笔记1", "内容", "摘要", "atomic", "PERMANENT", "zettels",
        0.5, "manual", 1, `${TEST_DIR}/${id}.md`,
        new Date(Date.now() - 200 * 86400000).toISOString(),
        new Date(Date.now() - 200 * 86400000).toISOString()
      );

      const result = archiveService.autoArchiveZombies({ dryRun: true });

      // 检查笔记仍然在 zettels
      const row = db.prepare("SELECT folder FROM zettel_notes WHERE id = ?").get(id) as { folder: string };
      expect(row.folder).toBe("zettels");

      // dryRun 不记录日志
      const logs = archiveService.getArchiveLog();
      expect(logs.filter((l) => l.action === "auto_archive")).toHaveLength(0);
    });

    it("应该归档僵尸笔记", () => {
      const id = `note-${Date.now()}-2`;
      db.prepare(
        `INSERT INTO zettel_notes (id, title, content, summary, type, status, folder, confidence, source, reviewed, file_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, "僵尸笔记2", "内容", "摘要", "atomic", "PERMANENT", "zettels",
        0.5, "manual", 1, `${TEST_DIR}/${id}.md`,
        new Date(Date.now() - 200 * 86400000).toISOString(),
        new Date(Date.now() - 200 * 86400000).toISOString()
      );

      const result = archiveService.autoArchiveZombies();

      // 笔记应该被归档
      const row = db.prepare("SELECT folder FROM zettel_notes WHERE id = ?").get(id) as { folder: string };
      expect(row.folder).toBe("archive");

      // 应该记录日志
      const logs = archiveService.getArchiveLog({ action: "auto_archive" });
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });

    it("应该跳过已经在 archive 文件夹的笔记", () => {
      const id = `note-${Date.now()}-3`;
      db.prepare(
        `INSERT INTO zettel_notes (id, title, content, summary, type, status, folder, confidence, source, reviewed, file_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, "已归档笔记", "内容", "摘要", "atomic", "PERMANENT", "archive",
        0.5, "manual", 1, `${TEST_DIR}/${id}.md`,
        new Date(Date.now() - 200 * 86400000).toISOString(),
        new Date(Date.now() - 200 * 86400000).toISOString()
      );

      const result = archiveService.autoArchiveZombies();

      // 已经在 archive 的笔记不应被重复处理
      expect(result.notes.some((n) => n.id === id)).toBe(false);
    });

    it("应该支持 limit 参数", () => {
      for (let i = 0; i < 5; i++) {
        const id = `note-${Date.now()}-z${i}`;
        db.prepare(
          `INSERT INTO zettel_notes (id, title, content, summary, type, status, folder, confidence, source, reviewed, file_path, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id, `僵尸笔记${i}`, "内容", "摘要", "atomic", "PERMANENT", "zettels",
          0.5, "manual", 1, `${TEST_DIR}/${id}.md`,
          new Date(Date.now() - 200 * 86400000).toISOString(),
          new Date(Date.now() - 200 * 86400000).toISOString()
        );
      }

      const result = archiveService.autoArchiveZombies({ limit: 2 });

      // limit 限制处理的笔记数量
      expect(result.archived).toBeLessThanOrEqual(2);
      expect(result.notes.length).toBeLessThanOrEqual(2);
    });
  });
});
