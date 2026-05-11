/**
 * PromptVersionRepository 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { promises as fs } from "node:fs";
import { PromptVersionRepository } from "../prompt-version-repository.js";
import type { PromptType } from "../../core/types-phase5.js";

describe("PromptVersionRepository", () => {
  let db: DatabaseSync;
  let repository: PromptVersionRepository;
  let TEST_DB_DIR: string;
  let TEST_DB_PATH: string;

  beforeEach(async () => {
    TEST_DB_DIR = "/tmp/zettelkasten-test-prompt-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9);
    TEST_DB_PATH = join(TEST_DB_DIR, "test.db");
    await fs.mkdir(TEST_DB_DIR, { recursive: true });
    db = new DatabaseSync(TEST_DB_PATH);
    
    // 创建测试表
    db.exec(`
      CREATE TABLE IF NOT EXISTS zettel_prompt_versions (
        id TEXT PRIMARY KEY,
        prompt_type TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        description TEXT,
        is_active INTEGER DEFAULT 0,
        usage_count INTEGER DEFAULT 0,
        average_score REAL,
        metadata TEXT,
        created_at TEXT NOT NULL,
        activated_at TEXT
      )
    `);
    
    repository = new PromptVersionRepository(db);
  });

  afterEach(async () => {
    db.close();
    try {
      await fs.rm(TEST_DB_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("create", () => {
    it("should create a new prompt version", () => {
      const params = {
        promptType: "capture" as PromptType,
        content: "Test prompt content",
        description: "Test description",
      };

      const result = repository.create(params);

      expect(result).toBeDefined();
      expect(result.promptType).toBe("capture");
      expect(result.content).toBe("Test prompt content");
      expect(result.description).toBe("Test description");
      expect(result.version).toBe(1);
      expect(result.isActive).toBe(false);
      expect(result.usageCount).toBe(0);
    });

    it("should auto-increment version for same type", () => {
      const params = {
        promptType: "capture" as PromptType,
        content: "Test content",
      };

      const v1 = repository.create(params);
      const v2 = repository.create(params);
      const v3 = repository.create(params);

      expect(v1.version).toBe(1);
      expect(v2.version).toBe(2);
      expect(v3.version).toBe(3);
    });

    it("should handle different types independently", () => {
      const capture = repository.create({
        promptType: "capture" as PromptType,
        content: "Capture content",
      });
      const explain = repository.create({
        promptType: "explain" as PromptType,
        content: "Explain content",
      });

      expect(capture.version).toBe(1);
      expect(explain.version).toBe(1);
    });
  });

  describe("get", () => {
    it("should get prompt version by id", () => {
      const created = repository.create({
        promptType: "capture" as PromptType,
        content: "Test content",
      });

      const result = repository.get(created.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(created.id);
      expect(result?.content).toBe("Test content");
    });

    it("should return null for non-existent id", () => {
      const result = repository.get("non-existent-id");
      expect(result).toBeNull();
    });
  });

  describe("getActiveByType", () => {
    it("should return active prompt for type", () => {
      const created = repository.create({
        promptType: "capture" as PromptType,
        content: "Test content",
      });
      repository.activate(created.id);

      const result = repository.getActiveByType("capture" as PromptType);

      expect(result).toBeDefined();
      expect(result?.id).toBe(created.id);
      expect(result?.isActive).toBe(true);
    });

    it("should return null when no active prompt", () => {
      const result = repository.getActiveByType("capture" as PromptType);
      expect(result).toBeNull();
    });
  });

  describe("getByType", () => {
    it("should return all versions for type", () => {
      repository.create({ promptType: "capture" as PromptType, content: "v1" });
      repository.create({ promptType: "capture" as PromptType, content: "v2" });
      repository.create({ promptType: "explain" as PromptType, content: "other" });

      const results = repository.getByType("capture" as PromptType);

      expect(results).toHaveLength(2);
      expect(results[0].version).toBe(2); // DESC order
      expect(results[1].version).toBe(1);
    });
  });

  describe("getAll", () => {
    it("should return all prompt versions", () => {
      repository.create({ promptType: "capture" as PromptType, content: "c1" });
      repository.create({ promptType: "explain" as PromptType, content: "e1" });

      const results = repository.getAll();

      expect(results).toHaveLength(2);
    });
  });

  describe("activate", () => {
    it("should activate a prompt version", () => {
      const created = repository.create({
        promptType: "capture" as PromptType,
        content: "Test content",
      });

      const activated = repository.activate(created.id);

      expect(activated).toBe(true);
      const result = repository.get(created.id);
      expect(result?.isActive).toBe(true);
      expect(result?.activatedAt).toBeDefined();
    });

    it("should deactivate other versions of same type", () => {
      const v1 = repository.create({
        promptType: "capture" as PromptType,
        content: "v1",
      });
      const v2 = repository.create({
        promptType: "capture" as PromptType,
        content: "v2",
      });

      repository.activate(v1.id);
      repository.activate(v2.id);

      expect(repository.get(v1.id)?.isActive).toBe(false);
      expect(repository.get(v2.id)?.isActive).toBe(true);
    });

    it("should return false for non-existent id", () => {
      const result = repository.activate("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("incrementUsage", () => {
    it("should increment usage count", () => {
      const created = repository.create({
        promptType: "capture" as PromptType,
        content: "Test content",
      });

      repository.incrementUsage(created.id);
      repository.incrementUsage(created.id);

      const result = repository.get(created.id);
      expect(result?.usageCount).toBe(2);
    });
  });

  describe("updateScore", () => {
    it("should update average score", () => {
      const created = repository.create({
        promptType: "capture" as PromptType,
        content: "Test content",
      });

      repository.incrementUsage(created.id);
      repository.updateScore(created.id, 0.8);

      const result = repository.get(created.id);
      expect(result?.averageScore).toBe(0.8);
    });
  });

  describe("delete", () => {
    it("should delete prompt version", () => {
      const created = repository.create({
        promptType: "capture" as PromptType,
        content: "Test content",
      });

      const deleted = repository.delete(created.id);

      expect(deleted).toBe(true);
      expect(repository.get(created.id)).toBeNull();
    });
  });

  describe("getEffectivenessStats", () => {
    it("should return effectiveness stats for active or used prompts", () => {
      const created = repository.create({
        promptType: "capture" as PromptType,
        content: "Test content",
      });
      repository.activate(created.id);
      repository.incrementUsage(created.id);
      repository.updateScore(created.id, 0.9);

      const stats = repository.getEffectivenessStats();

      expect(stats).toHaveLength(1);
      expect(stats[0].promptId).toBe(created.id);
      expect(stats[0].usageCount).toBe(1);
      expect(stats[0].averageScore).toBe(0.9);
    });
  });
});
