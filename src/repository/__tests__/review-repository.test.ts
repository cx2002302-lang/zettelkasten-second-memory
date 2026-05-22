/**
 * ReviewRepository 测试套件
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ReviewRepository } from "../review-repository.js";
import { createTestDatabase, createTestNoteData } from "./test-helpers.js";
import { NoteRepository } from "../note-repository.js";

describe("ReviewRepository", () => {
  let db: DatabaseSync;
  let repository: ReviewRepository;
  let noteRepository: NoteRepository;

  beforeEach(() => {
    db = createTestDatabase();
    repository = new ReviewRepository(db);
    noteRepository = new NoteRepository(db);
  });

  describe("create", () => {
    it("应该创建基本审核记录", () => {
      const result = repository.create({
        targetType: "note",
        targetId: "note-1",
        action: "approve",
      });

      expect(result).toMatchObject({
        targetType: "note",
        targetId: "note-1",
        action: "approve",
      });
      expect(result.id).toMatch(/^rev_\d+_[a-z0-9]+$/);
      expect(result.createdAt).toBeDefined();
    });

    it("应该创建带所有字段的审核记录", () => {
      const result = repository.create({
        targetType: "note",
        targetId: "note-1",
        reviewerId: "reviewer-1",
        action: "modify",
        previousConfidence: 0.6,
        newConfidence: 0.9,
        previousFolder: "inbox",
        newFolder: "zettels",
        comment: "内容质量高，批准",
        metadata: { reason: "quality_check" },
      });

      expect(result).toMatchObject({
        targetType: "note",
        targetId: "note-1",
        reviewerId: "reviewer-1",
        action: "modify",
        previousConfidence: 0.6,
        newConfidence: 0.9,
        previousFolder: "inbox",
        newFolder: "zettels",
        comment: "内容质量高，批准",
        metadata: { reason: "quality_check" },
      });
    });
  });

  describe("get", () => {
    it("应该通过 ID 获取审核记录", () => {
      const created = repository.create({
        targetType: "note",
        targetId: "note-1",
        action: "approve",
      });

      const result = repository.get(created.id);

      expect(result).toMatchObject({
        id: created.id,
        targetType: "note",
        targetId: "note-1",
        action: "approve",
      });
    });

    it("应该返回 null 当记录不存在时", () => {
      expect(repository.get("non-existent")).toBeNull();
    });

    it("应该正确解析 metadata JSON", () => {
      const created = repository.create({
        targetType: "note",
        targetId: "note-1",
        action: "flag",
        metadata: { issue: "duplicate_content" },
      });

      const result = repository.get(created.id);
      expect(result?.metadata).toEqual({ issue: "duplicate_content" });
    });
  });

  describe("query", () => {
    beforeEach(() => {
      repository.create({ targetType: "note", targetId: "note-1", action: "approve", reviewerId: "r1" });
      repository.create({ targetType: "note", targetId: "note-2", action: "reject", reviewerId: "r1" });
      repository.create({ targetType: "link", targetId: "link-1", action: "approve", reviewerId: "r2" });
      repository.create({ targetType: "system", targetId: "sys-1", action: "flag" });
    });

    it("应该返回所有记录当没有过滤条件时", () => {
      const results = repository.query();
      expect(results).toHaveLength(4);
    });

    it("应该按 targetType 过滤", () => {
      const results = repository.query({ targetType: "note" });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.targetType === "note")).toBe(true);
    });

    it("应该按 targetId 过滤", () => {
      const results = repository.query({ targetId: "note-1" });
      expect(results).toHaveLength(1);
      expect(results[0].targetId).toBe("note-1");
    });

    it("应该按 reviewerId 过滤", () => {
      const results = repository.query({ reviewerId: "r1" });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.reviewerId === "r1")).toBe(true);
    });

    it("应该按 action 过滤", () => {
      const results = repository.query({ action: "approve" });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.action === "approve")).toBe(true);
    });

    it("应该支持 limit 和 offset", () => {
      const limited = repository.query({ limit: 2 });
      expect(limited).toHaveLength(2);

      const offset = repository.query({ limit: 2, offset: 1 });
      expect(offset).toHaveLength(2);
    });

    it("应该支持组合过滤条件", () => {
      const results = repository.query({ targetType: "note", action: "approve" });
      expect(results).toHaveLength(1);
      expect(results[0].targetType).toBe("note");
      expect(results[0].action).toBe("approve");
    });
  });

  describe("getByTarget", () => {
    it("应该获取目标的所有审核记录", () => {
      repository.create({ targetType: "note", targetId: "note-1", action: "approve" });
      repository.create({ targetType: "note", targetId: "note-1", action: "modify" });
      repository.create({ targetType: "note", targetId: "note-2", action: "reject" });

      const results = repository.getByTarget("note", "note-1");
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.targetId === "note-1")).toBe(true);
    });

    it("应该返回空数组当目标没有审核记录时", () => {
      expect(repository.getByTarget("note", "non-existent")).toEqual([]);
    });
  });

  describe("getStats", () => {
    it("应该返回正确的统计信息", () => {
      repository.create({ targetType: "note", targetId: "n1", action: "approve" });
      repository.create({ targetType: "note", targetId: "n2", action: "approve" });
      repository.create({ targetType: "note", targetId: "n3", action: "reject" });
      repository.create({ targetType: "link", targetId: "l1", action: "modify" });
      repository.create({ targetType: "system", targetId: "s1", action: "flag" });

      const stats = repository.getStats();

      expect(stats.totalReviews).toBe(5);
      expect(stats.approvedCount).toBe(2);
      expect(stats.rejectedCount).toBe(1);
      expect(stats.modifiedCount).toBe(1);
      expect(stats.flaggedCount).toBe(1);
      expect(stats.pendingCount).toBe(0);
      expect(stats.byTargetType.note).toBe(3);
      expect(stats.byTargetType.link).toBe(1);
      expect(stats.byTargetType.system).toBe(1);
      expect(stats.byTargetType.tag).toBe(0);
    });

    it("应该处理没有记录的情况", () => {
      const stats = repository.getStats();

      expect(stats.totalReviews).toBe(0);
      expect(stats.approvedCount).toBe(0);
      expect(stats.rejectedCount).toBe(0);
      expect(stats.byTargetType.note).toBe(0);
    });
  });

  describe("delete", () => {
    it("应该删除审核记录", () => {
      const created = repository.create({
        targetType: "note", targetId: "note-1", action: "approve",
      });

      const deleted = repository.delete(created.id);
      expect(deleted).toBe(true);
      expect(repository.get(created.id)).toBeNull();
    });

    it("应该返回 false 当记录不存在时", () => {
      expect(repository.delete("non-existent")).toBe(false);
    });
  });

  describe("getPendingItems", () => {
    it("应该返回未审核的笔记", () => {
      // 直接插入 reviewed=0 的笔记
      db.prepare(
        `INSERT INTO zettel_notes (id, title, content, summary, type, status, folder, confidence, source, reviewed, file_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "pending-note-1", "未审核笔记1", "内容", "摘要", "atomic", "PERMANENT", "inbox",
        0.5, "distilled", 0, "/tmp/pending-1.md",
        new Date().toISOString(), new Date().toISOString()
      );
      db.prepare(
        `INSERT INTO zettel_notes (id, title, content, summary, type, status, folder, confidence, source, reviewed, file_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "pending-note-2", "未审核笔记2", "内容", "摘要", "atomic", "PERMANENT", "inbox",
        0.5, "distilled", 0, "/tmp/pending-2.md",
        new Date().toISOString(), new Date().toISOString()
      );

      const pending = repository.getPendingItems();
      expect(pending.length).toBeGreaterThanOrEqual(2);
      expect(pending.every((p) => p.targetType === "note")).toBe(true);
    });

    it("应该返回空数组当没有未审核笔记时", () => {
      const pending = repository.getPendingItems();
      expect(Array.isArray(pending)).toBe(true);
    });
  });
});
