/**
 * ReviewService 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ReviewService } from "../review-service.js";
import { NoteRepository } from "../../repository/note-repository.js";
import { ensureZettelkastenSchema } from "../../storage/db-schema.js";
import type { CreateReviewParams } from "../../core/types-phase5.js";
import type { NoteFolder } from "../../core/types.js";

describe("ReviewService", () => {
  let db: DatabaseSync;
  let reviewService: ReviewService;
  let noteRepo: NoteRepository;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureZettelkastenSchema({ db, ftsEnabled: false });
    reviewService = new ReviewService(db);
    noteRepo = new NoteRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("createReview", () => {
    it("should create a review record", () => {
      const review = reviewService.createReview({
        targetType: "note",
        targetId: "note-123",
        reviewerId: "user-1",
        action: "approve",
        comment: "Good note",
      });

      expect(review.targetType).toBe("note");
      expect(review.targetId).toBe("note-123");
      expect(review.action).toBe("approve");
    });

    it("should update note folder when approving", async () => {
      const note = await noteRepo.create({
        title: "Test Note",
        content: "Test content with enough text to pass atomicity check for the review service testing.",
        folder: "inbox",
        confidence: 0.5,
      }, "/tmp/notes");

      reviewService.createReview({
        targetType: "note",
        targetId: note.id,
        reviewerId: "user-1",
        action: "approve",
        newFolder: "zettels" as NoteFolder,
        newConfidence: 0.85,
      });

      const updatedNote = noteRepo.get(note.id);
      expect(updatedNote?.folder).toBe("zettels");
      expect(updatedNote?.reviewed).toBe(true);
    });
  });

  describe("batchReview", () => {
    it("should process multiple reviews", async () => {
      const note1 = await noteRepo.create({
        title: "Note 1",
        content: "Content for note 1 with enough text to pass atomicity check.",
        folder: "inbox",
      }, "/tmp/notes");

      const note2 = await noteRepo.create({
        title: "Note 2",
        content: "Content for note 2 with enough text to pass atomicity check.",
        folder: "inbox",
      }, "/tmp/notes");

      const reviews = reviewService.batchReview({
        reviewerId: "user-1",
        items: [
          { targetType: "note", targetId: note1.id, action: "approve", newFolder: "zettels" },
          { targetType: "note", targetId: note2.id, action: "reject" },
        ],
      });

      expect(reviews).toHaveLength(2);
    });
  });

  describe("getPendingItems", () => {
    it("should return unreviewed notes", async () => {
      await noteRepo.create({
        title: "Unreviewed Note",
        content: "Content with enough text to pass atomicity check.",
        folder: "inbox",
      }, "/tmp/notes");

      const pendingItems = reviewService.getPendingItems();
      expect(pendingItems.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getReviewPanelState", () => {
    it("should return panel state", async () => {
      const state = reviewService.getReviewPanelState();
      expect(state).toBeDefined();
      expect(typeof state.pendingCount).toBe("number");
    });
  });

  describe("autoReview", () => {
    it("should auto-approve high confidence items", () => {
      const review = reviewService.autoReview("note", "note-1", 0.95);
      expect(review).toBeDefined();
      expect(review?.action).toBe("approve");
    });

    it("should auto-flag low confidence items", () => {
      const review = reviewService.autoReview("note", "note-1", 0.3);
      expect(review).toBeDefined();
      expect(review?.action).toBe("flag");
    });

    it("should return null for medium confidence", () => {
      const review = reviewService.autoReview("note", "note-1", 0.7);
      expect(review).toBeNull();
    });
  });

  describe("config management", () => {
    it("should update and get config", () => {
      reviewService.updateConfig({ autoReviewThreshold: 0.85 });
      const config = reviewService.getConfig();
      expect(config.autoReviewThreshold).toBe(0.85);
    });
  });
});
