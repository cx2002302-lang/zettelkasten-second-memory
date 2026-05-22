/**
 * FeedbackService 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { FeedbackService } from "../feedback-service.js";
import { ensureZettelkastenSchema } from "../../storage/db-schema.js";

describe("FeedbackService", () => {
  let db: DatabaseSync;
  let feedbackService: FeedbackService;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureZettelkastenSchema({ db, ftsEnabled: false });
    feedbackService = new FeedbackService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("submitFeedback", () => {
    it("should create feedback", () => {
      // 使用 correction 类型，不会自动处理
      const feedback = feedbackService.submitFeedback({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "correction",
        source: "user",
        content: "Fix this!",
      });

      expect(feedback.targetType).toBe("note");
      expect(feedback.targetId).toBe("note-1");
      expect(feedback.feedbackType).toBe("correction");
      expect(feedback.processed).toBe(false);
    });

    it("should auto-process system feedback with high rating", () => {
      const feedback = feedbackService.submitFeedback({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "thumbs_up",
        source: "system",
        rating: 0.9,
      });

      expect(feedback.processed).toBe(true);
    });

    it("should auto-process thumbs_up feedback", () => {
      const feedback = feedbackService.submitFeedback({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "thumbs_up",
        source: "user",
      });

      expect(feedback.processed).toBe(true);
    });
  });

  describe("batchSubmitFeedback", () => {
    it("should submit multiple feedbacks", () => {
      const feedbacks = feedbackService.batchSubmitFeedback([
        { targetType: "note", targetId: "note-1", feedbackType: "thumbs_up", source: "user" },
        { targetType: "note", targetId: "note-2", feedbackType: "thumbs_down", source: "user" },
      ]);

      expect(feedbacks).toHaveLength(2);
      expect(feedbacks[0].feedbackType).toBe("thumbs_up");
      expect(feedbacks[1].feedbackType).toBe("thumbs_down");
    });
  });

  describe("processFeedback", () => {
    it("should process unprocessed feedback", () => {
      const feedback = feedbackService.submitFeedback({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "correction",
        source: "user",
        content: "Fix this",
      });

      expect(feedback.processed).toBe(false);

      const result = feedbackService.processFeedback(feedback.id);
      expect(result).toBe(true);
    });

    it("should return false for already processed feedback", () => {
      const feedback = feedbackService.submitFeedback({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "thumbs_up",
        source: "user",
      });

      // Already auto-processed
      expect(feedback.processed).toBe(true);

      const result = feedbackService.processFeedback(feedback.id);
      expect(result).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should return feedback statistics", () => {
      feedbackService.submitFeedback({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "thumbs_up",
        source: "user",
      });

      const stats = feedbackService.getStats();
      expect(stats).toBeDefined();
      expect(typeof stats.totalFeedback).toBe("number");
      expect(typeof stats.thumbsUpCount).toBe("number");
    });
  });

  describe("queryFeedback", () => {
    it("should filter by target type", () => {
      feedbackService.submitFeedback({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "thumbs_up",
        source: "user",
      });

      const results = feedbackService.queryFeedback({ targetType: "note" });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("should filter by feedback type", () => {
      feedbackService.submitFeedback({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "thumbs_up",
        source: "user",
      });

      const results = feedbackService.queryFeedback({ feedbackType: "thumbs_up" });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getUnprocessedFeedback", () => {
    it("should return unprocessed feedback", () => {
      feedbackService.submitFeedback({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "suggestion",
        source: "user",
        content: "Add more details",
      });

      const unprocessed = feedbackService.getUnprocessedFeedback();
      expect(unprocessed.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("analyzeTrends", () => {
    it("should analyze feedback trends", () => {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      feedbackService.submitFeedback({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "thumbs_up",
        source: "user",
        rating: 0.9,
      });

      const trends = feedbackService.analyzeTrends({
        start: oneWeekAgo.toISOString(),
        end: tomorrow.toISOString(),
      });

      expect(trends.totalFeedback).toBeGreaterThanOrEqual(1);
      expect(typeof trends.positiveRate).toBe("number");
      expect(typeof trends.averageRating).toBe("number");
      expect(Array.isArray(trends.topIssues)).toBe(true);
    });
  });

  describe("generateTuningSuggestions", () => {
    it("should generate tuning suggestions based on feedback", () => {
      // Submit negative feedback to trigger suggestion
      feedbackService.submitFeedback({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "thumbs_down",
        source: "user",
        rating: 0.2,
      });

      const suggestions = feedbackService.generateTuningSuggestions();
      expect(Array.isArray(suggestions)).toBe(true);
    });
  });

  describe("config management", () => {
    it("should update config", () => {
      feedbackService.updateConfig({ autoProcessThreshold: 0.9 });
      // Config is private, test via behavior
      const feedback = feedbackService.submitFeedback({
        targetType: "note",
        targetId: "note-1",
        feedbackType: "thumbs_up",
        source: "system",
        rating: 0.85, // Below new threshold
      });
      expect(feedback.processed).toBe(false);
    });
  });
});
