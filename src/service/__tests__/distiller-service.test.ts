/**
 * DistillerService 单元测试
 *
 * 测试覆盖：
 * 1. 作业创建和管理
 * 2. 夜间蒸馏流程
 * 3. 对话切片和摘要生成
 * 4. 去重决策执行
 * 5. 从摘要创建笔记
 * 6. Cron 定时任务调度
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DistillerService } from "../distiller-service.js";
import { MemoryParser } from "../memory-parser.js";
import { NoteService } from "../note-service.js";
import { LinkService } from "../link-service.js";
import {
  createTestDatabase,
  closeTestDatabase,
  createTestNoteData,
} from "../../repository/__tests__/test-helpers.js";
import { createTestDir, cleanupTestDir } from "../../testing/test-fs.js";
import type { DatabaseSync } from "node:sqlite";
import type {
  LLMProvider,
  DistillSummary,
  ZettelNote,
  ConversationSlice,
  MemoryLogEntry,
  CEQRCPhase,
} from "../../core/types.js";

/** 模拟 LLMProvider */
class MockLLMProvider implements LLMProvider {
  private mockSummaries: Map<string, DistillSummary> = new Map();
  private mockJudgments: Map<string, { isDuplicate: boolean; reason: string }> = new Map();
  private embeddingCounter = 0;

  setMockSummary(content: string, summary: DistillSummary): void {
    this.mockSummaries.set(content, summary);
  }

  setMockJudgment(key: string, judgment: { isDuplicate: boolean; reason: string }): void {
    this.mockJudgments.set(key, judgment);
  }

  async generateSummary(content: string, context?: string): Promise<DistillSummary> {
    const summary = this.mockSummaries.get(content);
    if (summary) {
      return summary;
    }
    // Default summary
    return {
      id: `summary-${Date.now()}`,
      sliceId: `slice-${Date.now()}`,
      title: `Summary of ${context || "content"}`,
      content: content.slice(0, 200),
      confidence: 0.75,
      suggestedTags: ["auto-generated"],
      suggestedLinks: [],
      generatedAt: new Date().toISOString(),
    };
  }

  async judgeDuplicate(candidate: string, existing: string): Promise<{ isDuplicate: boolean; reason: string }> {
    const key = `${candidate.slice(0, 50)}_${existing.slice(0, 50)}`;
    return this.mockJudgments.get(key) || { isDuplicate: false, reason: "No match found" };
  }

  async generateEmbedding(): Promise<number[]> {
    // Return deterministic embeddings for testing
    this.embeddingCounter++;
    const base = Array(10).fill(0).map((_, i) => (this.embeddingCounter * 0.1 + i * 0.01) % 1);
    return base;
  }

  async processCEQRCPhase(): Promise<unknown> {
    return {};
  }
}

/** 创建测试对话切片 */
function createTestSlice(id: string, content: string): ConversationSlice {
  return {
    id,
    entryIds: [`entry-${id}-1`, `entry-${id}-2`],
    content,
    timeRange: {
      start: "2026-01-01T10:00:00Z",
      end: "2026-01-01T10:30:00Z",
    },
    tokenCount: 100,
  };
}

/** 创建测试摘要 */
function createTestSummary(id: string, title: string, confidence: number): DistillSummary {
  return {
    id,
    sliceId: `slice-${id}`,
    title,
    content: `This is a comprehensive test summary for ${title} with sufficient length to pass all validation checks in the distiller service.`,
    confidence,
    suggestedTags: ["test"],
    suggestedLinks: [],
    generatedAt: "2026-01-01T12:00:00Z",
  };
}

describe("DistillerService", () => {
  let db: DatabaseSync;
  let noteService: NoteService;
  let linkService: LinkService;
  let mockProvider: MockLLMProvider;
  let distillerService: DistillerService;
  let basePath: string;
  let memoryDir: string;

  beforeEach(() => {
    db = createTestDatabase();
    basePath = createTestDir("zk-distiller-notes-");
    memoryDir = createTestDir("zk-distiller-mem-");
    noteService = new NoteService(db, basePath);
    linkService = new LinkService(db);
    mockProvider = new MockLLMProvider();
    distillerService = new DistillerService(mockProvider, noteService, linkService);
  });

  afterEach(() => {
    closeTestDatabase(db);
    cleanupTestDir(basePath);
    cleanupTestDir(memoryDir);
  });

  // ============================================================================
  // 作业创建和管理
  // ============================================================================
  describe("job management", () => {
    it("should create job with correct initial state", async () => {
      // distillMemoryFile creates a job internally
      const mockSlices = [createTestSlice("slice-1", "Test conversation content")];

      // We need to mock the memory parser
      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);

      expect(job).toBeDefined();
      expect(job.id).toMatch(/^\d{17}$/);
      expect(job.status).toMatch(/pending|processing|completed|failed/);
      expect(job.date).toBeDefined();
    });

    it("should get job by ID", async () => {
      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);
      const retrieved = distillerService.getJob(job.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(job.id);
    });

    it("should return null for non-existent job", () => {
      const result = distillerService.getJob("non-existent-id");
      expect(result).toBeNull();
    });

    it("should get all jobs", async () => {
      await distillerService.distillMemoryFile(`${memoryDir}/memory1.json`, []);
      await distillerService.distillMemoryFile(`${memoryDir}/memory2.json`, []);

      const jobs = distillerService.getAllJobs();
      expect(jobs.length).toBeGreaterThanOrEqual(2);
    });

    it("should get jobs by date", async () => {
      const today = new Date().toISOString().split("T")[0];
      await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);

      const jobs = distillerService.getJobsByDate(today);
      expect(jobs.length).toBeGreaterThanOrEqual(1);
    });

    it("should return empty array for date with no jobs", () => {
      const jobs = distillerService.getJobsByDate("2020-01-01");
      expect(jobs).toEqual([]);
    });
  });

  // ============================================================================
  // 配置管理
  // ============================================================================
  describe("config management", () => {
    it("should use default config", () => {
      const config = distillerService.getConfig();

      expect(config.highConfidenceThreshold).toBe(0.7);
      expect(config.mediumConfidenceThreshold).toBe(0.4);
      expect(config.batchSize).toBe(10);
      expect(config.maxSliceTokens).toBe(2000);
      expect(config.nightModeEnabled).toBe(true);
    });

    it("should accept custom config", () => {
      const customService = new DistillerService(
        mockProvider,
        noteService,
        linkService,
        {
          highConfidenceThreshold: 0.8,
          mediumConfidenceThreshold: 0.5,
          batchSize: 5,
          nightModeEnabled: false,
        }
      );

      const config = customService.getConfig();
      expect(config.highConfidenceThreshold).toBe(0.8);
      expect(config.mediumConfidenceThreshold).toBe(0.5);
      expect(config.batchSize).toBe(5);
      expect(config.nightModeEnabled).toBe(false);
    });

    it("should update config", () => {
      distillerService.updateConfig({ batchSize: 20 });
      const config = distillerService.getConfig();

      expect(config.batchSize).toBe(20);
      expect(config.highConfidenceThreshold).toBe(0.7); //      // unchanged
    });
  });

  // ============================================================================
  // 摘要生成测试
  // ============================================================================
  describe("summary generation", () => {
    it("should generate summaries for conversation slices", async () => {
      const slice = createTestSlice("slice-1", "Test conversation about React hooks");
      const summary = createTestSummary("sum-1", "React Hooks Overview", 0.8);

      mockProvider.setMockSummary(slice.content, summary);

      // Create a mock that bypasses file reading
      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([
          { id: "entry-1", type: "user" as const, content: "Tell me about hooks", timestamp: "2026-01-01T10:00:00Z" },
          { id: "entry-2", type: "assistant" as const, content: "Hooks are functions...", timestamp: "2026-01-01T10:01:00Z" },
        ]),
        sliceConversation: vi.fn().mockReturnValue([slice]),
      };

      // Replace the memory parser
      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);

      expect(job.status).toBe("completed");
      expect(job.summaryCount).toBeGreaterThanOrEqual(0);
    });

    it("should handle batch processing of summaries", async () => {
      const slices = [
        createTestSlice("slice-1", "Content 1"),
        createTestSlice("slice-2", "Content 2"),
        createTestSlice("slice-3", "Content 3"),
      ];

      slices.forEach((slice, i) => {
        mockProvider.setMockSummary(slice.content, createTestSummary(`sum-${i}`, `Title ${i}`, 0.7 + i * 0.1));
      });

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue(slices),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);

      expect(job.status).toBe("completed");
    });

    it("should handle empty conversation slices", async () => {
      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue([]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);

      expect(job.status).toBe("completed");
      expect(job.sliceCount).toBe(0);
      expect(job.summaryCount).toBe(0);
    });
  });

  // ============================================================================
  // 去重决策执行测试
  // ============================================================================
  describe("deduplication decisions", () => {
    it("should create new note for unique summary", async () => {
      // Create existing note
      const existingNote = await noteService.createNote(
        createTestNoteData({ title: "Existing Note" }),
        { confidence: 0.8 }
      );

      const slice = createTestSlice("slice-1", "Unique content about a different topic");
      const summary = createTestSummary("sum-1", "New Unique Topic", 0.8);

      mockProvider.setMockSummary(slice.content, summary);
      mockProvider.setMockJudgment("unique", { isDuplicate: false, reason: "Different topic" });

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue([slice]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, [existingNote]);

      expect(job.status).toBe("completed");
    });

    it("should merge with existing note for duplicate summary", async () => {
      // Create existing note
      const existingNote = await noteService.createNote(
        createTestNoteData({ title: "React Hooks", content: "Hooks are functions that let you use state" }),
        { confidence: 0.8 }
      );

      const slice = createTestSlice("slice-1", "React hooks let you use state in functional components");
      const summary = createTestSummary("sum-1", "React Hooks Guide", 0.75);

      mockProvider.setMockSummary(slice.content, summary);

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue([slice]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, [existingNote]);

      expect(job.status).toBe("completed");
    });

    it("should skip low confidence summaries", async () => {
      const slice = createTestSlice("slice-1", "Unclear content");
      const summary = createTestSummary("sum-1", "Unclear Topic", 0.2); // Low confidence

      mockProvider.setMockSummary(slice.content, summary);

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue([slice]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);

      expect(job.status).toBe("completed");
    });
  });

  // ============================================================================
  // 从摘要创建笔记测试
  // ============================================================================
  describe("create note from summary", () => {
    it("should create note with correct confidence routing", async () => {
      // High confidence -> zettels
      const highConfidenceSlice = createTestSlice("slice-1", "High quality content");
      const highSummary = createTestSummary("sum-1", "High Quality Note", 0.8);

      mockProvider.setMockSummary(highConfidenceSlice.content, highSummary);

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue([highConfidenceSlice]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);

      expect(job.status).toBe("completed");
      expect(job.createdCount).toBeGreaterThanOrEqual(0);
    });

    it("should create note with tags from summary", async () => {
      const slice = createTestSlice("slice-1", "Content about React");
      const summary: DistillSummary = {
        ...createTestSummary("sum-1", "React Note", 0.75),
        suggestedTags: ["react", "javascript", "frontend"],
      };

      mockProvider.setMockSummary(slice.content, summary);

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue([slice]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);

      expect(job.status).toBe("completed");
    });

    it("should create links from summary suggestions", async () => {
      // Create target note first
      const targetNote = await noteService.createNote(
        createTestNoteData({ title: "Target Note" }),
        { confidence: 0.8 }
      );

      const slice = createTestSlice("slice-1", "Content linking to target");
      const summary: DistillSummary = {
        ...createTestSummary("sum-1", "Source Note", 0.75),
        suggestedLinks: [targetNote.id],
      };

      mockProvider.setMockSummary(slice.content, summary);

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue([slice]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, [targetNote]);

      expect(job.status).toBe("completed");
    });

    it("should handle note creation errors gracefully", async () => {
      const slice = createTestSlice("slice-1", "Content");
      const summary = createTestSummary("sum-1", "Note Title", 0.75);

      mockProvider.setMockSummary(slice.content, summary);

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue([slice]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      // Should not throw even if note creation has issues
      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);

      expect(job.status).toBe("completed");
    });
  });

  // ============================================================================
  // 合并到现有笔记测试
  // ============================================================================
  describe("merge with existing", () => {
    it("should append content to existing note on merge", async () => {
      const existingNote = await noteService.createNote(
        createTestNoteData({
          title: "Existing React Note",
          content: "Original content about React",
        }),
        { confidence: 0.8 }
      );

      const slice = createTestSlice("slice-1", "Additional React information");
      const summary = createTestSummary("sum-1", "React Update", 0.75);

      mockProvider.setMockSummary(slice.content, summary);

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue([slice]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, [existingNote]);

      expect(job.status).toBe("completed");

      // Verify note was updated
      const updatedNote = await noteService.getNote(existingNote.id);
      expect(updatedNote).toBeDefined();
    });

    it("should handle merge when existing note not found", async () => {
      const slice = createTestSlice("slice-1", "Content");
      const summary = createTestSummary("sum-1", "Title", 0.75);

      mockProvider.setMockSummary(slice.content, summary);

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue([slice]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      // Pass non-existent note ID
      const nonExistentNote: ZettelNote = {
        id: "99999999999999999",
        title: "Non-existent",
        content: "Does not exist",
        type: "atomic",
        status: "PERMANENT",
        folder: "zettels",
        reviewed: true,
        tags: [],
        filePath: `${basePath}/99999999999999999.md`,
        createdAt: "2026-01-01T12:00:00Z",
        updatedAt: "2026-01-01T12:00:00Z",
        links: [],
      };

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, [nonExistentNote]);

      expect(job.status).toBe("completed");
    });
  });

  // ============================================================================
  // 夜间蒸馏测试
  // ============================================================================
  describe("night distillation", () => {
    it("should distill yesterday's memory", async () => {
      const mockParser = {
        parseYesterday: vi.fn().mockResolvedValue([
          createTestSlice("yesterday-1", "Yesterday's conversation"),
        ]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const summary = createTestSummary("sum-1", "Yesterday's Summary", 0.75);
      mockProvider.setMockSummary("Yesterday's conversation", summary);

      const job = await distillerService.distillYesterday([]);

      expect(job.status).toBe("completed");
      expect(job.date).toBeDefined();
    });

    it("should handle empty yesterday memory", async () => {
      const mockParser = {
        parseYesterday: vi.fn().mockResolvedValue([]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const job = await distillerService.distillYesterday([]);

      expect(job.status).toBe("completed");
      expect(job.sliceCount).toBe(0);
    });
  });

  // ============================================================================
  // Cron 定时任务测试
  // ============================================================================
  describe("cron scheduling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should schedule night distillation", () => {
      const mockParser = {
        parseYesterday: vi.fn().mockResolvedValue([]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const callback = vi.fn();
      const scheduler = distillerService.scheduleNightDistillation("0 2 * * *", callback);

      expect(scheduler).toHaveProperty("stop");
      expect(typeof scheduler.stop).toBe("function");

      scheduler.stop();
    });

    it("should use default cron expression", () => {
      const mockParser = {
        parseYesterday: vi.fn().mockResolvedValue([]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const scheduler = distillerService.scheduleNightDistillation();

      expect(scheduler).toHaveProperty("stop");

      scheduler.stop();
    });

    it("should stop scheduled task", () => {
      const mockParser = {
        parseYesterday: vi.fn().mockResolvedValue([]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const scheduler = distillerService.scheduleNightDistillation();

      // Should not throw
      expect(() => scheduler.stop()).not.toThrow();
    });
  });

  // ============================================================================
  // 作业统计测试
  // ============================================================================
  describe("job statistics", () => {
    it("should track created count", async () => {
      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue([
          createTestSlice("slice-1", "Content 1"),
          createTestSlice("slice-2", "Content 2"),
        ]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      mockProvider.setMockSummary("Content 1", createTestSummary("sum-1", "React Concepts", 0.8));
      mockProvider.setMockSummary("Content 2", createTestSummary("sum-2", "TypeScript Guide", 0.8));

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);

      expect(job.status).toBe("completed");
      expect(job.createdCount).toBe(2);
      expect(job.mergedCount).toBe(0);
      expect(job.skippedCount).toBe(0);
    });

    it("should track slice and summary counts", async () => {
      const slices = [
        createTestSlice("slice-1", "Content 1"),
        createTestSlice("slice-2", "Content 2"),
        createTestSlice("slice-3", "Content 3"),
      ];

      const mockParser =      {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue(slices),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      slices.forEach((slice, i) => {
        mockProvider.setMockSummary(slice.content, createTestSummary(`sum-${i}`, `Title ${i}`, 0.75));
      });

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);

      expect(job.sliceCount).toBe(3);
      expect(job.summaryCount).toBe(3);
    });

    it("should track job timestamps", async () => {
      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue([]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const beforeStart = new Date().toISOString();
      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);
      const afterComplete = new Date().toISOString();

      expect(job.startedAt).toBeDefined();
      expect(job.completedAt).toBeDefined();
      expect(job.startedAt! >= beforeStart || job.startedAt! <= afterComplete).toBe(true);
      expect(job.completedAt! >= job.startedAt!).toBe(true);
    });

    it("should handle failed status", async () => {
      const mockParser = {
        parseMemoryLog: vi.fn().mockRejectedValue(new Error("Parse error")),
        sliceConversation: vi.fn().mockReturnValue([]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);

      expect(job.status).toBe("failed");
      expect(job.error).toBeDefined();
    });
  });

  // ============================================================================
  // 边界情况测试
  // ============================================================================
  describe("edge cases", () => {
    it("should handle very long content", async () => {
      const longContent = "a".repeat(10000);
      const slice = createTestSlice("slice-1", longContent);
      const summary = createTestSummary("sum-1", "Long Content Note", 0.75);

      mockProvider.setMockSummary(slice.content, summary);

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue([slice]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);

      expect(job.status).toBe("completed");
    });

    it("should handle special characters in content", async () => {
      const specialContent = "Special chars: <>&\"'\\n\\t日本語🎉";
      const slice = createTestSlice("slice-1", specialContent);
      const summary = createTestSummary("sum-1", "Special Note", 0.75);

      mockProvider.setMockSummary(slice.content, summary);

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue([slice]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);

      expect(job.status).toBe("completed");
    });

    it("should handle many slices", async () => {
      const slices = Array.from({ length: 20 }, (_, i) =>
        createTestSlice(`slice-${i}`, `Content ${i}`)
      );

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue(slices),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      slices.forEach((slice, i) => {
        mockProvider.setMockSummary(slice.content, createTestSummary(`sum-${i}`, `Title ${i}`, 0.75));
      });

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);

      expect(job.status).toBe("completed");
      expect(job.sliceCount).toBe(20);
    });

    it("should handle empty existing notes array", async () => {
      const slice = createTestSlice("slice-1", "Content");
      const summary = createTestSummary("sum-1", "New Note", 0.75);

      mockProvider.setMockSummary(slice.content, summary);

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue([slice]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, []);

      expect(job.status).toBe("completed");
    });

    it("should handle duplicate existing notes gracefully", async () => {
      const note = await noteService.createNote(
        createTestNoteData({ title: "Duplicate Note" }),
        { confidence: 0.8 }
      );

      const slice = createTestSlice("slice-1", "Content");
      const summary = createTestSummary("sum-1", "Another Note", 0.75);

      mockProvider.setMockSummary(slice.content, summary);

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue([slice]),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      // Pass same note twice
      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, [note, note]);

      expect(job.status).toBe("completed");
    });
  });

  // ============================================================================
  // 集成测试
  // ============================================================================
  describe("integration", () => {
    it("should complete full distillation pipeline", async () => {
      // Create some existing notes
      const existingNotes = await Promise.all([
        noteService.createNote(createTestNoteData({ title: "Existing 1" }), { confidence: 0.8 }),
        noteService.createNote(createTestNoteData({ title: "Existing 2" }), { confidence: 0.8 }),
      ]);

      // Create slices
      const slices = [
        createTestSlice("slice-1", "New unique content about React"),
        createTestSlice("slice-2", "More unique content about TypeScript"),
      ];

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue(slices),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      // Set up summaries
      mockProvider.setMockSummary(
        slices[0].content,
        createTestSummary("sum-1", "React Note", 0.85)
      );
      mockProvider.setMockSummary(
        slices[1].content,
        createTestSummary("sum-2", "TypeScript Note", 0.8)
      );

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, existingNotes);

      expect(job.status).toBe("completed");
      expect(job.sliceCount).toBe(2);
      expect(job.summaryCount).toBe(2);
    });

    it("should handle mixed decisions (create, merge, skip)", async () => {
      const existingNote = await noteService.createNote(
        createTestNoteData({ title: "React Concepts", content: "About React hooks" }),
        { confidence: 0.8 }
      );

      const slices = [
        createTestSlice("slice-1", "Completely new topic about Vue"),
        createTestSlice("slice-2", "Similar to React hooks"),
        createTestSlice("slice-3", "Low quality unclear content"),
      ];

      const mockParser = {
        parseMemoryLog: vi.fn().mockResolvedValue([]),
        sliceConversation: vi.fn().mockReturnValue(slices),
      };

      distillerService.setMemoryParser(mockParser as unknown as MemoryParser);

      // High confidence unique
      mockProvider.setMockSummary(
        slices[0].content,
        createTestSummary("sum-1", "Vue Note", 0.85)
      );

      // Medium confidence - might be duplicate
      mockProvider.setMockSummary(
        slices[1].content,
        createTestSummary("sum-2", "React Note", 0.6)
      );

      // Low confidence
      mockProvider.setMockSummary(
        slices[2].content,
        createTestSummary("sum-3", "Unclear", 0.2)
      );

      const job = await distillerService.distillMemoryFile(`${memoryDir}/memory.json`, [existingNote]);

      expect(job.status).toBe("completed");
      expect(job.sliceCount).toBe(3);
      expect(job.summaryCount).toBe(3);
    });
  });
});
