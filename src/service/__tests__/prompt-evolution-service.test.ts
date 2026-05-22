/**
 * PromptEvolutionService 测试套件
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { PromptEvolutionService } from "../prompt-evolution-service.js";
import type {
  CreatePromptVersionParams,
  PromptType,
} from "../../core/types-phase5.js";

describe("PromptEvolutionService", () => {
  let db: DatabaseSync;
  let service: PromptEvolutionService;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");

    db.exec(`
      CREATE TABLE zettel_prompt_versions (
        id TEXT PRIMARY KEY,
        prompt_type TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        description TEXT,
        is_active INTEGER DEFAULT 0,
        usage_count INTEGER DEFAULT 0,
        average_score REAL,
        created_at TEXT NOT NULL,
        activated_at TEXT,
        metadata TEXT
      )
    `);

    db.exec(`
      CREATE TABLE zettel_feedback (
        id TEXT PRIMARY KEY,
        feedback_type TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        content TEXT,
        rating INTEGER,
        metadata TEXT,
        processed INTEGER DEFAULT 0,
        processed_at TEXT,
        created_at TEXT NOT NULL
      )
    `);

    service = new PromptEvolutionService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("constructor", () => {
    it("should initialize with default config", () => {
      const defaultService = new PromptEvolutionService(db);
      expect(defaultService).toBeDefined();
    });

    it("should initialize with custom config", () => {
      const customService = new PromptEvolutionService(db, {
        autoEvolution: true,
        minFeedbackSamples: 5,
        suggestionThreshold: 0.8,
        maxVersions: 20,
      });
      expect(customService).toBeDefined();
    });
  });

  describe("createVersion", () => {
    it("should create prompt version", () => {
      const params: CreatePromptVersionParams = {
        promptType: "capture" as PromptType,
        content: "Test prompt content",
        description: "Test description",
      };

      const result = service.createVersion(params);

      expect(result).toMatchObject({
        promptType: "capture",
        content: "Test prompt content",
        description: "Test description",
        version: 1,
        isActive: false,
        usageCount: 0,
      });
      expect(result.id).toMatch(/^prompt_\d+_[a-z0-9]+$/);
    });

    it("should auto increment version number", () => {
      service.createVersion({
        promptType: "capture" as PromptType,
        content: "Version 1",
      });

      const version2 = service.createVersion({
        promptType: "capture" as PromptType,
        content: "Version 2",
      });

      expect(version2.version).toBe(2);
    });

    it("should support different prompt types", () => {
      const types: PromptType[] = [
        "capture",
        "explain",
        "question",
        "refine",
        "connect",
        "distill",
        "dedupe",
      ];

      for (const type of types) {
        const result = service.createVersion({
          promptType: type,
          content: `Content for ${type}`,
        });
        expect(result.promptType).toBe(type);
      }
    });
  });

  describe("getActivePrompt", () => {
    it("should get active prompt", () => {
      const created = service.createVersion({
        promptType: "capture" as PromptType,
        content: "Active prompt",
      });

      service.activateVersion(created.id);

      const active = service.getActivePrompt("capture" as PromptType);

      expect(active).not.toBeNull();
      expect(active?.id).toBe(created.id);
      expect(active?.isActive).toBe(true);
    });

    it("should return null when no active prompt", () => {
      const active = service.getActivePrompt("explain" as PromptType);
      expect(active).toBeNull();
    });
  });

  describe("getVersion", () => {
    it("should get version by ID", () => {
      const created = service.createVersion({
        promptType: "capture" as PromptType,
        content: "Test content",
      });

      const result = service.getVersion(created.id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(created.id);
      expect(result?.content).toBe("Test content");
    });

    it("should return null when version not exists", () => {
      const result = service.getVersion("non_existent_id");
      expect(result).toBeNull();
    });
  });

  describe("getVersionsByType", () => {
    it("should get all versions by type", () => {
      service.createVersion({
        promptType: "capture" as PromptType,
        content: "Capture 1",
      });
      service.createVersion({
        promptType: "capture" as PromptType,
        content: "Capture 2",
      });
      service.createVersion({
        promptType: "explain" as PromptType,
        content: "Explain 1",
      });

      const captureVersions = service.getVersionsByType("capture" as PromptType);

      expect(captureVersions).toHaveLength(2);
      expect(captureVersions.every((v) => v.promptType === "capture")).toBe(true);
    });

    it("should return empty array when type has no versions", () => {
      const versions = service.getVersionsByType("dedupe" as PromptType);
      expect(versions).toEqual([]);
    });
  });

  describe("activateVersion", () => {
    it("should activate version", () => {
      const created = service.createVersion({
        promptType: "capture" as PromptType,
        content: "Test content",
      });

      const activated = service.activateVersion(created.id);

      expect(activated).toBe(true);

      const version = service.getVersion(created.id);
      expect(version?.isActive).toBe(true);
    });

    it("should return false when version not exists", () => {
      const result = service.activateVersion("non_existent_id");
      expect(result).toBe(false);
    });

    it("should deactivate old version when activating new", () => {
      const version1 = service.createVersion({
        promptType: "capture" as PromptType,
        content: "Version 1",
      });
      service.activateVersion(version1.id);

      const version2 = service.createVersion({
        promptType: "capture" as PromptType,
        content: "Version 2",
      });
      service.activateVersion(version2.id);

      const oldVersion = service.getVersion(version1.id);
      expect(oldVersion?.isActive).toBe(false);

      const newVersion = service.getVersion(version2.id);
      expect(newVersion?.isActive).toBe(true);
    });
  });

  describe("deleteVersion", () => {
    it("should delete version", () => {
      const created = service.createVersion({
        promptType: "capture" as PromptType,
        content: "Test content",
      });

      const deleted = service.deleteVersion(created.id);

      expect(deleted).toBe(true);
      expect(service.getVersion(created.id)).toBeNull();
    });

    it("should return false when version not exists", () => {
      const result = service.deleteVersion("non_existent_id");
      expect(result).toBe(false);
    });
  });

  describe("recordUsage", () => {
    it("should record usage", () => {
      const created = service.createVersion({
        promptType: "capture" as PromptType,
        content: "Test content",
      });

      const result = service.recordUsage(created.id);

      expect(result).toBe(true);
    });

    it("should record usage with score", () => {
      const created = service.createVersion({
        promptType: "capture" as PromptType,
        content: "Test content",
      });

      const result = service.recordUsage(created.id, 0.85);

      expect(result).toBe(true);
    });
  });

  describe("getEffectivenessStats", () => {
    it("should get effectiveness stats", () => {
      service.createVersion({
        promptType: "capture" as PromptType,
        content: "Test content",
      });

      const stats = service.getEffectivenessStats();

      expect(Array.isArray(stats)).toBe(true);
    });
  });

  describe("getEvolutionStats", () => {
    it("should get evolution stats", () => {
      service.createVersion({
        promptType: "capture" as PromptType,
        content: "Capture content",
      });
      service.createVersion({
        promptType: "explain" as PromptType,
        content: "Explain content",
      });

      const stats = service.getEvolutionStats();

      expect(stats).toMatchObject({
        totalSuggestions: 0,
        appliedSuggestions: 0,
        pendingSuggestions: 0,
        rejectedSuggestions: 0,
      });
      expect(stats.byPromptType).toBeDefined();
    });
  });

  describe("analyzeAndSuggest", () => {
    it("should return null when no active prompt", () => {
      const result = service.analyzeAndSuggest("capture" as PromptType);
      expect(result).toBeNull();
    });

    it("should return null when insufficient feedback", () => {
      const created = service.createVersion({
        promptType: "capture" as PromptType,
        content: "Test content",
      });
      service.activateVersion(created.id);

      const result = service.analyzeAndSuggest("capture" as PromptType);
      expect(result).toBeNull();
    });
  });

  describe("createEvolutionSuggestion", () => {
    it("should create evolution suggestion", () => {
      const suggestion = service.createEvolutionSuggestion({
        promptType: "capture" as PromptType,
        currentVersionId: "prompt_123",
        suggestedContent: "Improved content",
        suggestionReason: "Based on feedback",
        confidence: 0.85,
        basedOnFeedbackIds: ["feedback_1", "feedback_2"],
      });

      expect(suggestion).toMatchObject({
        promptType: "capture",
        currentVersionId: "prompt_123",
        suggestedContent: "Improved content",
        suggestionReason: "Based on feedback",
        confidence: 0.85,
        basedOnFeedbackIds: ["feedback_1", "feedback_2"],
        applied: false,
      });
      expect(suggestion.id).toMatch(/^evo_\d+_[a-z0-9]+$/);
      expect(suggestion.createdAt).toBeDefined();
    });
  });

  describe("applyEvolutionSuggestion", () => {
    it("should return null for now", () => {
      const result = service.applyEvolutionSuggestion("suggestion_123");
      expect(result).toBeNull();
    });
  });

  describe("runAutoEvolution", () => {
    it("should return empty array when autoEvolution is disabled", () => {
      const results = service.runAutoEvolution();
      expect(results).toEqual([]);
    });

    it("should run auto evolution when enabled", () => {
      const autoService = new PromptEvolutionService(db, {
        autoEvolution: true,
        minFeedbackSamples: 5,
      });

      const results = autoService.runAutoEvolution();
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("updateConfig", () => {
    it("should update config", () => {
      service.updateConfig({
        autoEvolution: true,
        minFeedbackSamples: 20,
      });

      const autoService = new PromptEvolutionService(db, {
        autoEvolution: true,
      });
      autoService.updateConfig({ suggestionThreshold: 0.9 });

      expect(autoService).toBeDefined();
    });
  });
});
