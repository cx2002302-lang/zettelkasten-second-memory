/**
 * NoteRepository 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NoteRepository } from "../note-repository.js";
import {
  createTestDatabase,
  closeTestDatabase,
  createTestNoteData,
} from "./test-helpers.js";
import { createTestDir, cleanupTestDir } from "../../testing/test-fs.js";
import type { DatabaseSync } from "node:sqlite";
import type { NoteType, NoteFolder, LinkType } from "../../core/types.js";

describe("NoteRepository", () => {
  let db: DatabaseSync;
  let repository: NoteRepository;
  let notesDir: string;

  beforeEach(() => {
    db = createTestDatabase();
    repository = new NoteRepository(db);
    notesDir = createTestDir("zk-note-repo-");
  });

  afterEach(() => {
    closeTestDatabase(db);
    cleanupTestDir(notesDir);
  });

  describe("create", () => {
    it("should create a basic note", async () => {
      const params = createTestNoteData({
        title: "Test Note",
        content: "This is test content for the note.",
      });

      const note = await repository.create(params, notesDir);

      expect(note).toBeDefined();
      expect(note.id).toMatch(/^\d{17}$/); // 14位时间 + 3位随机数
      expect(note.title).toBe(params.title);
      expect(note.content).toBe(params.content);
      expect(note.type).toBe("atomic");
      expect(note.status).toBe("FLEETING");
      expect(note.folder).toBe("inbox");
      expect(note.reviewed).toBe(true);
    });

    it("should support custom type", async () => {
      const params = createTestNoteData({ type: "structure" as NoteType });
      const note = await repository.create(params, notesDir);
      expect(note.type).toBe("structure");
    });

    it("should support custom folder", async () => {
      const params = createTestNoteData({ folder: "zettels" as NoteFolder });
      const note = await repository.create(params, notesDir);
      expect(note.folder).toBe("zettels");
    });

    it("should support distilled source", async () => {
      const params = createTestNoteData({ source: "distilled" });
      const note = await repository.create(params, notesDir);
      expect(note.source).toBe("distilled");
      expect(note.reviewed).toBe(false);
    });

    it("should support tags", async () => {
      const params = createTestNoteData({ tags: ["test", "important"] });
      const note = await repository.create(params, notesDir);
      expect(note.tags).toEqual(["test", "important"]);
    });

    it("should support links", async () => {
      // 先创建目标笔记
      const targetNote = await repository.create(createTestNoteData({ title: "Target" }), notesDir);
      
      const params = createTestNoteData({
        links: [{ to: targetNote.id, type: "supports" as LinkType, context: "test context" }],
      });
      const note = await repository.create(params, notesDir);
      expect(note.links).toHaveLength(1);
      expect(note.links[0].to).toBe(targetNote.id);
      expect(note.links[0].type).toBe("supports");
    });

    it("should support sessionKey", async () => {
      const params = createTestNoteData({ sessionKey: "session-123" });
      const note = await repository.create(params, notesDir);
      expect(note.sessionKey).toBe("session-123");
    });

    it("should generate summary", async () => {
      const params = createTestNoteData({
        content: "This is a very long content that needs summarization. ".repeat(20),
      });
      const note = await repository.create(params, notesDir);
      expect(note.summary).toBeDefined();
      expect(note.summary!.length).toBeGreaterThan(0);
    });
  });

  describe("get", () => {
    it("should retrieve an existing note", async () => {
      const params = createTestNoteData({ title: "Get Test" });
      const created = await repository.create(params, notesDir);
      const note = repository.get(created.id);
      expect(note).toBeDefined();
      expect(note!.id).toBe(created.id);
      expect(note!.title).toBe("Get Test");
    });

    it("should return null for non-existent note", () => {
      const note = repository.get("non-existent-id");
      expect(note).toBeNull();
    });

    it("should retrieve note with tags", async () => {
      const params = createTestNoteData({ tags: ["tag1", "tag2"] });
      const created = await repository.create(params, notesDir);
      const note = repository.get(created.id);
      expect(note!.tags).toEqual(["tag1", "tag2"]);
    });

    it("should retrieve note with links", async () => {
      // 先创建目标笔记
      const targetNote = await repository.create(createTestNoteData({ title: "Target" }), notesDir);
      // 再创建带链接的笔记
      const params = createTestNoteData({
        links: [{ to: targetNote.id, type: "related" as LinkType }],
      });
      const created = await repository.create(params, notesDir);
      const note = repository.get(created.id);
      expect(note!.links).toHaveLength(1);
      expect(note!.links[0].to).toBe(targetNote.id);
    });
  });

  describe("update", () => {
    it("should update note title", async () => {
      const params = createTestNoteData({ title: "Original" });
      const created = await repository.create(params, notesDir);
      const updated = await repository.update(created.id, { title: "Updated" });
      expect(updated).toBeDefined();
      expect(updated!.title).toBe("Updated");
    });

    it("should update note content", async () => {
      const params = createTestNoteData({ content: "Original content" });
      const created = await repository.create(params, notesDir);
      const updated = await repository.update(created.id, { content: "New content" });
      expect(updated!.content).toBe("New content");
    });

    it("should update note status", async () => {
      const params = createTestNoteData({});
      const created = await repository.create(params, notesDir);
      const updated = await repository.update(created.id, { status: "PERMANENT" });
      expect(updated!.status).toBe("PERMANENT");
    });

    it("should update note folder", async () => {
      const params = createTestNoteData({});
      const created = await repository.create(params, notesDir);
      const updated = await repository.update(created.id, { folder: "zettels" as NoteFolder });
      expect(updated!.folder).toBe("zettels");
    });

    it("should update note confidence", async () => {
      const params = createTestNoteData({ confidence: 0.5 });
      const created = await repository.create(params, notesDir);
      const updated = await repository.update(created.id, { confidence: 0.9 });
      expect(updated!.confidence).toBe(0.9);
    });

    it("should update note reviewed status", async () => {
      const params = createTestNoteData({ source: "distilled" });
      const created = await repository.create(params, notesDir);
      expect(created.reviewed).toBe(false);
      const updated = await repository.update(created.id, { reviewed: true });
      expect(updated!.reviewed).toBe(true);
    });

    it("should update note tags", async () => {
      const params = createTestNoteData({ tags: ["old"] });
      const created = await repository.create(params, notesDir);
      const updated = await repository.update(created.id, { tags: ["new1", "new2"] });
      expect(updated!.tags).toEqual(["new1", "new2"]);
    });

    it("should update note links", async () => {
      // 先创建目标笔记
      const oldTarget = await repository.create(createTestNoteData({ title: "Old Target" }), notesDir);
      const newTarget = await repository.create(createTestNoteData({ title: "New Target" }), notesDir);
      
      const params = createTestNoteData({
        links: [{ to: oldTarget.id, type: "related" as LinkType }],
      });
      const created = await repository.create(params, notesDir);
      const updated = await repository.update(created.id, {
        links: [{ to: newTarget.id, type: "supports" as LinkType }],
      });
      expect(updated!.links).toHaveLength(1);
      expect(updated!.links[0].to).toBe(newTarget.id);
    });

    it("should return null for non-existent note", async () => {
      const result = await repository.update("non-existent", { title: "New Title" });
      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("should delete an existing note", async () => {
      const params = createTestNoteData({});
      const created = await repository.create(params, notesDir);
      const result = await repository.delete(created.id);
      expect(result).toBe(true);
      const note = repository.get(created.id);
      expect(note).toBeNull();
    });

    it("should return false for non-existent note", async () => {
      const result = await repository.delete("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("query", () => {
    beforeEach(async () => {
      await repository.create(createTestNoteData({ title: "Note 1", type: "atomic" as NoteType }), notesDir);
      await repository.create(createTestNoteData({ title: "Note 2", type: "structure" as NoteType }), notesDir);
      await repository.create(createTestNoteData({ title: "Note 3", type: "atomic" as NoteType, confidence: 0.9 }), notesDir);
    });

    it("should query all notes", () => {
      const notes = repository.query({});
      expect(notes).toHaveLength(3);
    });

    it("should filter by type", () => {
      const notes = repository.query({ type: "atomic" as NoteType });
      expect(notes).toHaveLength(2);
    });

    it("should filter by status", async () => {
      const params = createTestNoteData({});
      const created = await repository.create(params, notesDir);
      await repository.update(created.id, { status: "PERMANENT" });
      const notes = repository.query({ status: "PERMANENT" });
      expect(notes).toHaveLength(1);
    });

    it("should filter by confidence range", () => {
      const notes = repository.query({ minConfidence: 0.85 });
      expect(notes.length).toBeGreaterThanOrEqual(1);
    });

    it("should support pagination", () => {
      const notes = repository.query({ limit: 2, offset: 0 });
      expect(notes).toHaveLength(2);
    });

    it("should support sorting", () => {
      const notes = repository.query({ sortBy: "title", sortDirection: "asc" });
      expect(notes[0].title).toBe("Note 1");
    });

    it("should filter by tags", async () => {
      await repository.create(createTestNoteData({ tags: ["important", "urgent"] }), notesDir);
      const notes = repository.query({ tags: ["important"] });
      expect(notes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      await repository.create(createTestNoteData({ title: "JavaScript Basics", content: "JavaScript is dynamic" }), notesDir);
      await repository.create(createTestNoteData({ title: "TypeScript Advanced", content: "TypeScript is a superset" }), notesDir);
      await repository.create(createTestNoteData({ title: "Python Intro", content: "Python is simple" }), notesDir);
    });

    it("should search notes by content", () => {
      const results = repository.search("JavaScript");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("should return search results with score", () => {
      const results = repository.search("JavaScript");
      expect(results[0].score).toBeDefined();
    });

    it("should support search limit", () => {
      const results = repository.search("content", 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("getAll", () => {
    it("should return all notes", async () => {
      await repository.create(createTestNoteData({ title: "Note A" }), notesDir);
      await repository.create(createTestNoteData({ title: "Note B" }), notesDir);
      const notes = repository.getAll();
      expect(notes).toHaveLength(2);
    });

    it("should return empty array when no notes", () => {
      const notes = repository.getAll();
      expect(notes).toEqual([]);
    });
  });
});
