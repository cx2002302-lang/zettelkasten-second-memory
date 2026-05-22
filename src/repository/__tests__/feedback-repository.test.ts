/**
 * FeedbackRepository 测试套件
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { FeedbackRepository } from "../feedback-repository.js";
import { createTestDatabase } from "./test-helpers.js";

describe("FeedbackRepository", () => {
  let db: DatabaseSync;
  let repository: FeedbackRepository;

  beforeEach(() => {
    db = createTestDatabase();
    repository = new FeedbackRepository(db);
  });

  describe("create", () => {
    it("应该创建基本反馈记录", () => {
      const result = repository.create({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "thumbs_up",
        source: "user",
      });

      expect(result).toMatchObject({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "thumbs_up",
        source: "user",
        processed: false,
      });
      expect(result.id).toMatch(/^fb_\d+_[a-z0-9]+$/);
      expect(result.createdAt).toBeDefined();
    });

    it("应该创建带所有字段的反馈记录", () => {
      const result = repository.create({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "comment",
        source: "agent",
        sourceId: "agent-123",
        content: "这个笔记很好",
        rating: 0.9,
        metadata: { sentiment: "positive" },
      });

      expect(result).toMatchObject({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "comment",
        source: "agent",
        sourceId: "agent-123",
        content: "这个笔记很好",
        metadata: { sentiment: "positive" },
        processed: false,
      });
    });

    it("应该将 0-1 范围的 rating 转换为 1-5 整数存储", () => {
      const low = repository.create({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "thumbs_up",
        rating: 0.1,
      });
      const mid = repository.create({
        targetType: "note",
        targetId: "note-2",
        feedbackType: "thumbs_up",
        rating: 0.5,
      });
      const high = repository.create({
        targetType: "note",
        targetId: "note-3",
        feedbackType: "thumbs_up",
        rating: 0.9,
      });
      const zero = repository.create({
        targetType: "note",
        targetId: "note-4",
        feedbackType: "thumbs_up",
        rating: 0,
      });
      const one = repository.create({
        targetType: "note",
        targetId: "note-5",
        feedbackType: "thumbs_up",
        rating: 1,
      });

      // 重新读取以验证存储转换
      expect(repository.get(low.id)?.rating).toBe(1);
      expect(repository.get(mid.id)?.rating).toBe(3);
      expect(repository.get(high.id)?.rating).toBe(5);
      expect(repository.get(zero.id)?.rating).toBe(1);
      expect(repository.get(one.id)?.rating).toBe(5);
    });

    it("应该处理没有 rating 的情况", () => {
      const result = repository.create({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "suggestion",
      });

      const fetched = repository.get(result.id);
      expect(fetched?.rating).toBeUndefined();
    });
  });

  describe("get", () => {
    it("应该通过 ID 获取反馈记录", () => {
      const created = repository.create({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "correction",
        content: "修正内容",
      });

      const result = repository.get(created.id);

      expect(result).toMatchObject({
        id: created.id,
        targetType: "note",
        targetId: "note-1",
        feedbackType: "correction",
        content: "修正内容",
      });
    });

    it("应该返回 null 当记录不存在时", () => {
      expect(repository.get("non-existent")).toBeNull();
    });

    it("应该正确解析 metadata JSON", () => {
      const created = repository.create({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "comment",
        metadata: { key: "value", num: 42 },
      });

      const result = repository.get(created.id);
      expect(result?.metadata).toEqual({ key: "value", num: 42 });
    });
  });

  describe("query", () => {
    beforeEach(() => {
      repository.create({ targetType: "note", targetId: "note-1", feedbackType: "thumbs_up", source: "user" });
      repository.create({ targetType: "note", targetId: "note-2", feedbackType: "thumbs_down", source: "agent" });
      repository.create({ targetType: "link", targetId: "link-1", feedbackType: "comment", source: "system" });
    });

    it("应该返回所有记录当没有过滤条件时", () => {
      const results = repository.query();
      expect(results).toHaveLength(3);
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

    it("应该按 feedbackType 过滤", () => {
      const results = repository.query({ feedbackType: "thumbs_up" });
      expect(results).toHaveLength(1);
      expect(results[0].feedbackType).toBe("thumbs_up");
    });

    it("应该按 source 过滤", () => {
      const results = repository.query({ source: "user" });
      expect(results).toHaveLength(1);
      expect(results[0].source).toBe("user");
    });

    it("应该按 processed 状态过滤", () => {
      const unprocessed = repository.query({ processed: false });
      expect(unprocessed).toHaveLength(3);

      const created = repository.create({
        targetType: "note", targetId: "note-3", feedbackType: "suggestion", source: "user",
      });
      repository.markAsProcessed(created.id);

      const processed = repository.query({ processed: true });
      expect(processed).toHaveLength(1);
      expect(processed[0].id).toBe(created.id);
    });

    it("应该支持 limit 和 offset", () => {
      const limited = repository.query({ limit: 2 });
      expect(limited).toHaveLength(2);

      const offset = repository.query({ limit: 2, offset: 1 });
      expect(offset).toHaveLength(2);
    });

    it("应该支持组合过滤条件", () => {
      const results = repository.query({ targetType: "note", feedbackType: "thumbs_up" });
      expect(results).toHaveLength(1);
      expect(results[0].targetType).toBe("note");
      expect(results[0].feedbackType).toBe("thumbs_up");
    });
  });

  describe("getByTarget", () => {
    it("应该获取目标的所有反馈", () => {
      repository.create({ targetType: "note", targetId: "note-1", feedbackType: "thumbs_up" });
      repository.create({ targetType: "note", targetId: "note-1", feedbackType: "comment" });
      repository.create({ targetType: "note", targetId: "note-2", feedbackType: "thumbs_down" });

      const results = repository.getByTarget("note", "note-1");
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.targetId === "note-1")).toBe(true);
    });

    it("应该返回空数组当目标没有反馈时", () => {
      expect(repository.getByTarget("note", "non-existent")).toEqual([]);
    });
  });

  describe("markAsProcessed", () => {
    it("应该标记反馈为已处理", () => {
      const created = repository.create({
        targetType: "note", targetId: "note-1", feedbackType: "suggestion",
      });

      const result = repository.markAsProcessed(created.id);
      expect(result).toBe(true);

      const fetched = repository.get(created.id);
      expect(fetched?.processed).toBe(true);
      expect(fetched?.processedAt).toBeDefined();
    });

    it("应该返回 false 当记录不存在时", () => {
      expect(repository.markAsProcessed("non-existent")).toBe(false);
    });
  });

  describe("getStats", () => {
    it("应该返回正确的统计信息", () => {
      repository.create({ targetType: "note", targetId: "n1", feedbackType: "thumbs_up", rating: 0.8 });
      repository.create({ targetType: "note", targetId: "n2", feedbackType: "thumbs_up", rating: 0.6 });
      repository.create({ targetType: "link", targetId: "l1", feedbackType: "thumbs_down", rating: 0.3 });
      repository.create({ targetType: "system", targetId: "s1", feedbackType: "comment" });
      repository.create({ targetType: "note", targetId: "n3", feedbackType: "correction" });

      const stats = repository.getStats();

      expect(stats.totalFeedback).toBe(5);
      expect(stats.thumbsUpCount).toBe(2);
      expect(stats.thumbsDownCount).toBe(1);
      expect(stats.commentCount).toBe(1);
      expect(stats.correctionCount).toBe(1);
      expect(stats.suggestionCount).toBe(0);
      expect(stats.processedCount).toBe(0);
      expect(stats.unprocessedCount).toBe(5);
      expect(stats.byTargetType.note).toBe(3);
      expect(stats.byTargetType.link).toBe(1);
      expect(stats.byTargetType.system).toBe(1);
      expect(stats.byTargetType.tag).toBe(0);
      expect(stats.averageRating).toBeDefined();
    });

    it("应该处理没有记录的情况", () => {
      const stats = repository.getStats();

      expect(stats.totalFeedback).toBe(0);
      expect(stats.thumbsUpCount).toBe(0);
      expect(stats.unprocessedCount).toBe(0);
      expect(stats.averageRating).toBeUndefined();
    });
  });

  describe("delete", () => {
    it("应该删除反馈记录", () => {
      const created = repository.create({
        targetType: "note", targetId: "note-1", feedbackType: "thumbs_up",
      });

      const deleted = repository.delete(created.id);
      expect(deleted).toBe(true);
      expect(repository.get(created.id)).toBeNull();
    });

    it("应该返回 false 当记录不存在时", () => {
      expect(repository.delete("non-existent")).toBe(false);
    });
  });

  describe("getUnprocessed", () => {
    it("应该获取未处理的反馈", () => {
      const fb1 = repository.create({ targetType: "note", targetId: "n1", feedbackType: "suggestion" });
      const fb2 = repository.create({ targetType: "note", targetId: "n2", feedbackType: "comment" });
      repository.create({ targetType: "note", targetId: "n3", feedbackType: "thumbs_up" });

      repository.markAsProcessed(fb1.id);

      const unprocessed = repository.getUnprocessed();
      expect(unprocessed).toHaveLength(2);
      expect(unprocessed.some((u) => u.id === fb2.id)).toBe(true);
      expect(unprocessed.some((u) => u.id === fb1.id)).toBe(false);
    });

    it("应该支持 limit 参数", () => {
      for (let i = 0; i < 5; i++) {
        repository.create({ targetType: "note", targetId: `n${i}`, feedbackType: "comment" });
      }

      const limited = repository.getUnprocessed(3);
      expect(limited).toHaveLength(3);
    });
  });
});
