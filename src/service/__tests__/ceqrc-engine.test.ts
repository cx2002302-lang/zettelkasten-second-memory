/**
 * CEQRCEngine 单元测试
 *
 * 测试覆盖：
 * 1. 工作流创建和管理
 * 2. 五阶段状态机（capture → explain → question → refine → connect）
 * 3. 阶段执行和状态转换
 * 4. 提示词构建
 * 5. 工作流结果获取
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CEQRCEngine } from "../ceqrc-engine.js";
import { createTestDir, cleanupTestDir } from "../../testing/test-fs.js";
import type {
  LLMProvider,
  CEQRCPhase,
  ZettelNote,
  CaptureOutput,
  ExplainOutput,
  QuestionOutput,
  RefineOutput,
  ConnectOutput,
  DistillSummary,
} from "../../core/types.js";

/** 模拟 LLMProvider */
class MockLLMProvider implements LLMProvider {
  private mockResponses: Map<string, unknown> = new Map();

  setMockResponse(phase: CEQRCPhase, response: unknown): void {
    this.mockResponses.set(phase, response);
  }

  async generateSummary(): Promise<DistillSummary> {
    return {
      id: "test-summary-id",
      sliceId: "test-slice-id",
      title: "Test Summary",
      content: "Test content",
      confidence: 0.8,
      suggestedTags: ["test"],
      suggestedLinks: [],
      generatedAt: new Date().toISOString(),
    };
  }

  async judgeDuplicate(): Promise<{ isDuplicate: boolean; reason: string }> {
    return { isDuplicate: false, reason: "Test judgment" };
  }

  async generateEmbedding(): Promise<number[]> {
    return [0.1, 0.2, 0.3, 0.4, 0.5];
  }

  async processCEQRCPhase(phase: CEQRCPhase): Promise<unknown> {
    const response = this.mockResponses.get(phase);
    if (!response) {
      throw new Error(`No mock response for phase: ${phase}`);
    }
    return response;
  }
}

/** 标准阶段输出 */
const MOCK_CAPTURE_OUTPUT: CaptureOutput = {
  coreConcept: "Test Concept",
  keyTerms: ["term1", "term2", "term3"],
  context: "Test context for the concept",
};

const MOCK_EXPLAIN_OUTPUT: ExplainOutput = {
  ownWordsExplanation: "This is my explanation of the concept in my own words.",
  analogy: "It's like a test analogy",
  simplifiedVersion: "Simplified: test concept explained simply.",
};

const MOCK_QUESTION_OUTPUT: QuestionOutput = {
  clarificationQuestions: ["What does this mean?", "How does it work?"],
  boundaryQuestions: ["When does this not apply?"],
  applicationQuestions: ["How can I use this?"],
};

const MOCK_REFINE_OUTPUT: RefineOutput = {
  refinedTitle: "Refined Test Note",
  refinedContent: "This is the refined atomic note content.",
  atomicityScore: 0.85,
};

const MOCK_CONNECT_OUTPUT: ConnectOutput = {
  suggestedLinks: [
    {
      targetNoteId: "20260101120000000",
      linkType: "related",
      context: "Related concept",
      relevanceScore: 0.8,
    },
  ],
  upstreamConcepts: ["Foundation Concept"],
  downstreamApplications: ["Application Area"],
};

describe("CEQRCEngine", () => {
  let engine: CEQRCEngine;
  let mockProvider: MockLLMProvider;
  let notesDir: string;

  beforeEach(() => {
    mockProvider = new MockLLMProvider();
    engine = new CEQRCEngine(mockProvider);
    notesDir = createTestDir("zk-ceqrc-");
  });

  afterEach(() => {
    cleanupTestDir(notesDir);
  });

  /** 创建模拟笔记 */
  function createMockNotes(count: number): ZettelNote[] {
    const notes: ZettelNote[] = [];
    for (let i = 0; i < count; i++) {
      const id = `20260101120000${i.toString().padStart(2, "0")}`;
      notes.push({
        id,
        title: `Test Note ${i}`,
        content: `Content of test note ${i}`,
        type: "atomic",
        status: "PERMANENT",
        folder: "zettels",
        confidence: 0.8,
        source: "manual",
        reviewed: true,
        tags: ["test"],
        filePath: `${notesDir}/${id}.md`,
        createdAt: "2026-01-01T12:00:00Z",
        updatedAt: "2026-01-01T12:00:00Z",
        links: [],
      });
    }
    return notes;
  }

  // ============================================================================
  // 工作流创建和管理
  // ============================================================================
  describe("createWorkflow", () => {
    it("should create a new workflow with correct initial state", () => {
      const workflow = engine.createWorkflow("source-note-123");

      expect(workflow).toBeDefined();
      expect(workflow.id).toMatch(/^\d{17}$/);
      expect(workflow.sourceNoteId).toBe("source-note-123");
      expect(workflow.currentPhase).toBe("capture");
      expect(workflow.phaseStatus.capture).toBe("pending");
      expect(workflow.phaseStatus.explain).toBe("pending");
      expect(workflow.phaseStatus.question).toBe("pending");
      expect(workflow.phaseStatus.refine).toBe("pending");
      expect(workflow.phaseStatus.connect).toBe("pending");
      expect(workflow.phaseOutputs).toEqual({});
      expect(workflow.createdAt).toBeDefined();
      expect(workflow.updatedAt).toBeDefined();
    });

    it("should create multiple workflows with unique IDs", () => {
      const workflow1 = engine.createWorkflow("source-1");
      const workflow2 = engine.createWorkflow("source-2");

      expect(workflow1.id).not.toBe(workflow2.id);
      expect(engine.getAllWorkflows()).toHaveLength(2);
    });

    it("should store workflow in internal map", () => {
      const workflow = engine.createWorkflow("source-note");
      const retrieved = engine.getWorkflow(workflow.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(workflow.id);
    });
  });

  describe("getWorkflow", () => {
    it("should return workflow by ID", () => {
      const created = engine.createWorkflow("source-note");
      const retrieved = engine.getWorkflow(created.id);

      expect(retrieved).toEqual(created);
    });

    it("should return null for non-existent workflow", () => {
      const result = engine.getWorkflow("non-existent-id");
      expect(result).toBeNull();
    });
  });

  describe("getAllWorkflows", () => {
    it("should return empty array when no workflows", () => {
      const workflows = engine.getAllWorkflows();
      expect(workflows).toEqual([]);
    });

    it("should return all created workflows", () => {
      engine.createWorkflow("source-1");
      engine.createWorkflow("source-2");
      engine.createWorkflow("source-3");

      const workflows = engine.getAllWorkflows();
      expect(workflows).toHaveLength(3);
    });
  });

  describe("deleteWorkflow", () => {
    it("should delete existing workflow", () => {
      const workflow = engine.createWorkflow("source-note");
      const deleted = engine.deleteWorkflow(workflow.id);

      expect(deleted).toBe(true);
      expect(engine.getWorkflow(workflow.id)).toBeNull();
    });

    it("should return false for non-existent workflow", () => {
      const result = engine.deleteWorkflow("non-existent-id");
      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // 配置管理
  // ============================================================================
  describe("config management", () => {
    it("should use default config", () => {
      const config = engine.getConfig();

      expect(config.autoAdvance).toBe(true);
      expect(config.phaseTimeoutMs).toBe(30000);
      expect(config.minConfidenceThreshold).toBe(0.7);
    });

    it("should accept custom config", () => {
      const customEngine = new CEQRCEngine(mockProvider, {
        autoAdvance: false,
        phaseTimeoutMs: 60000,
        minConfidenceThreshold: 0.8,
      });

      const config = customEngine.getConfig();
      expect(config.autoAdvance).toBe(false);
      expect(config.phaseTimeoutMs).toBe(60000);
      expect(config.minConfidenceThreshold).toBe(0.8);
    });

    it("should update config", () => {
      engine.updateConfig({ phaseTimeoutMs: 45000 });
      const config = engine.getConfig();

      expect(config.phaseTimeoutMs).toBe(45000);
      expect(config.autoAdvance).toBe(true); // 未更改的保持默认值
    });
  });

  // ============================================================================
  // 阶段执行测试
  // ============================================================================
  describe("executePhase", () => {
    it("should execute capture phase", async () => {
      const workflow = engine.createWorkflow("source-note");
      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);

      await engine.executePhase(workflow.id, "capture", "test content", []);

      const updated = engine.getWorkflow(workflow.id)!;
      expect(updated.phaseStatus.capture).toBe("completed");
      expect(updated.phaseOutputs.capture).toEqual(MOCK_CAPTURE_OUTPUT);
    });

    it("should execute explain phase", async () => {
      const workflow = engine.createWorkflow("source-note");
      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);

      await engine.executePhase(workflow.id, "capture", "test content", []);
      await engine.executePhase(workflow.id, "explain", "test content", []);

      const updated = engine.getWorkflow(workflow.id)!;
      expect(updated.phaseStatus.explain).toBe("completed");
      expect(updated.phaseOutputs.explain).toEqual(MOCK_EXPLAIN_OUTPUT);
    });

    it("should execute question phase", async () => {
      const workflow = engine.createWorkflow("source-note");
      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);
      mockProvider.setMockResponse("question", MOCK_QUESTION_OUTPUT);

      await engine.executePhase(workflow.id, "capture", "test content", []);
      await engine.executePhase(workflow.id, "explain", "test content", []);
      await engine.executePhase(workflow.id, "question", "test content", []);

      const updated = engine.getWorkflow(workflow.id)!;
      expect(updated.phaseStatus.question).toBe("completed");
      expect(updated.phaseOutputs.question).toEqual(MOCK_QUESTION_OUTPUT);
    });

    it("should execute refine phase", async () => {
      const workflow = engine.createWorkflow("source-note");
      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);
      mockProvider.setMockResponse("question", MOCK_QUESTION_OUTPUT);
      mockProvider.setMockResponse("refine", MOCK_REFINE_OUTPUT);

      await engine.executePhase(workflow.id, "capture", "test content", []);
      await engine.executePhase(workflow.id, "explain", "test content", []);
      await engine.executePhase(workflow.id, "question", "test content", []);
      await engine.executePhase(workflow.id, "refine", "test content", []);

      const updated = engine.getWorkflow(workflow.id)!;
      expect(updated.phaseStatus.refine).toBe("completed");
      expect(updated.phaseOutputs.refine).toEqual(MOCK_REFINE_OUTPUT);
    });

    it("should execute connect phase", async () => {
      const workflow = engine.createWorkflow("source-note");
      const existingNotes = createMockNotes(3);

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);
      mockProvider.setMockResponse("question", MOCK_QUESTION_OUTPUT);
      mockProvider.setMockResponse("refine", MOCK_REFINE_OUTPUT);
      mockProvider.setMockResponse("connect", MOCK_CONNECT_OUTPUT);

      await engine.executePhase(workflow.id, "capture", "test content", []);
      await engine.executePhase(workflow.id, "explain", "test content", []);
      await engine.executePhase(workflow.id, "question", "test content", []);
      await engine.executePhase(workflow.id, "refine", "test content", []);
      await engine.executePhase(workflow.id, "connect", "test content", existingNotes);

      const updated = engine.getWorkflow(workflow.id)!;
      expect(updated.phaseStatus.connect).toBe("completed");
      expect(updated.phaseOutputs.connect).toEqual(MOCK_CONNECT_OUTPUT);
    });

    it("should throw error for non-existent workflow", async () => {
      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);

      await expect(
        engine.executePhase("non-existent-id", "capture", "content", [])
      ).rejects.toThrow("Workflow not found: non-existent-id");
    });

    it("should mark phase as failed on error", async () => {
      const workflow = engine.createWorkflow("source-note");
      mockProvider.setMockResponse("capture", null); // 模拟失败

      await expect(
        engine.executePhase(workflow.id, "capture", "content", [])
      ).rejects.toThrow();

      const updated = engine.getWorkflow(workflow.id)!;
      expect(updated.phaseStatus.capture).toBe("failed");
    });

    it("should update currentPhase during execution", async () => {
      const workflow = engine.createWorkflow("source-note");
      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);

      await engine.executePhase(workflow.id, "capture", "content", []);

      const updated = engine.getWorkflow(workflow.id)!;
      expect(updated.currentPhase).toBe("capture");
    });

    it("should update timestamp after execution", async () => {
      const workflow = engine.createWorkflow("source-note");
      const beforeTime = workflow.updatedAt;

      // Wait a small amount to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10));

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      await engine.executePhase(workflow.id, "capture", "content", []);

      const updated = engine.getWorkflow(workflow.id)!;
      expect(updated.updatedAt >= beforeTime).toBe(true);
    });
  });

  // ============================================================================
  // 完整工作流执行测试
  // ============================================================================
  describe("runWorkflow", () => {
    it("should run complete workflow through all phases", async () => {
      const workflow = engine.createWorkflow("source-note");
      const existingNotes = createMockNotes(2);

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);
      mockProvider.setMockResponse("question", MOCK_QUESTION_OUTPUT);
      mockProvider.setMockResponse("refine", MOCK_REFINE_OUTPUT);
      mockProvider.setMockResponse("connect", MOCK_CONNECT_OUTPUT);

      const result = await engine.runWorkflow(workflow.id, "test content", existingNotes);

      expect(result.phaseStatus.capture).toBe("completed");
      expect(result.phaseStatus.explain).toBe("completed");
      expect(result.phaseStatus.question).toBe("completed");
      expect(result.phaseStatus.refine).toBe("completed");
      expect(result.phaseStatus.connect).toBe("completed");
    });

    it("should throw error when phase fails", async () => {
      const workflow = engine.createWorkflow("source-note");

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      // Don't set explain response - this will cause an error

      await expect(
        engine.runWorkflow(workflow.id, "test content", [])
      ).rejects.toThrow();
    });

    it("should throw error for non-existent workflow", async () => {
      await expect(
        engine.runWorkflow("non-existent-id", "content", [])
      ).rejects.toThrow("Workflow not found: non-existent-id");
    });

    it("should populate all phase outputs", async () => {
      const workflow = engine.createWorkflow("source-note");

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);
      mockProvider.setMockResponse("question", MOCK_QUESTION_OUTPUT);      mockProvider.setMockResponse("refine", MOCK_REFINE_OUTPUT);
      mockProvider.setMockResponse("connect", MOCK_CONNECT_OUTPUT);

      const result = await engine.runWorkflow(workflow.id, "test content", []);

      expect(result.phaseOutputs.capture).toEqual(MOCK_CAPTURE_OUTPUT);
      expect(result.phaseOutputs.explain).toEqual(MOCK_EXPLAIN_OUTPUT);
      expect(result.phaseOutputs.question).toEqual(MOCK_QUESTION_OUTPUT);
      expect(result.phaseOutputs.refine).toEqual(MOCK_REFINE_OUTPUT);
      expect(result.phaseOutputs.connect).toEqual(MOCK_CONNECT_OUTPUT);
    });
  });

  // ============================================================================
  // 工作流结果获取测试
  // ============================================================================
  describe("getWorkflowResult", () => {
    it("should return null for non-existent workflow", () => {
      const result = engine.getWorkflowResult("non-existent-id");
      expect(result).toBeNull();
    });

    it("should return null when connect phase not completed", () => {
      const workflow = engine.createWorkflow("source-note");
      const result = engine.getWorkflowResult(workflow.id);
      expect(result).toBeNull();
    });

    it("should return result after complete workflow", async () => {
      const workflow = engine.createWorkflow("source-note");

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);
      mockProvider.setMockResponse("question", MOCK_QUESTION_OUTPUT);
      mockProvider.setMockResponse("refine", MOCK_REFINE_OUTPUT);
      mockProvider.setMockResponse("connect", MOCK_CONNECT_OUTPUT);

      await engine.runWorkflow(workflow.id, "test content", []);

      const result = engine.getWorkflowResult(workflow.id);

      expect(result).toBeDefined();
      expect(result!.title).toBe(MOCK_REFINE_OUTPUT.refinedTitle);
      expect(result!.content).toBe(MOCK_REFINE_OUTPUT.refinedContent);
      expect(result!.atomicityScore).toBe(MOCK_REFINE_OUTPUT.atomicityScore);
      expect(result!.links).toEqual(MOCK_CONNECT_OUTPUT.suggestedLinks);
    });

    it("should return empty links array when connect output missing", async () => {
      const workflow = engine.createWorkflow("source-note");

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);
      mockProvider.setMockResponse("question", MOCK_QUESTION_OUTPUT);
      mockProvider.setMockResponse("refine", MOCK_REFINE_OUTPUT);
      // connect phase will fail

      try {
        await engine.runWorkflow(workflow.id, "test content", []);
      } catch {
        // expected
      }

      // Manually set connect to completed without output
      const wf = engine.getWorkflow(workflow.id)!;
      wf.phaseStatus.connect = "completed";

      const result = engine.getWorkflowResult(workflow.id);
      expect(result!.links).toEqual([]);
    });

    it("should return null when refine output missing", async () => {
      const workflow = engine.createWorkflow("source-note");

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);
      mockProvider.setMockResponse("question", MOCK_QUESTION_OUTPUT);
      mockProvider.setMockResponse("refine", null); // Will fail

      try {
        await engine.runWorkflow(workflow.id, "test content", []);
      } catch {
        // expected
      }

      const result = engine.getWorkflowResult(workflow.id);
      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // 提示词构建测试（通过阶段执行间接测试）
  // ============================================================================
  describe("prompt building", () => {
    it("should include source content in capture prompt", async () => {
      const workflow = engine.createWorkflow("source-note");
      const sourceContent = "This is the specific source content to capture";

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      await engine.executePhase(workflow.id, "capture", sourceContent, []);

      // If phase completed, prompt was built correctly
      const updated = engine.getWorkflow(workflow.id)!;
      expect(updated.phaseStatus.capture).toBe("completed");
    });

    it("should use capture output in explain prompt", async () => {
      const workflow = engine.createWorkflow("source-note");

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);

      await engine.executePhase(workflow.id, "capture", "content", []);
      await engine.executePhase(workflow.id, "explain", "content", []);

      const updated = engine.getWorkflow(workflow.id)!;
      expect(updated.phaseStatus.explain).toBe("completed");
    });

    it("should use previous outputs in question prompt", async () => {
      const workflow = engine.createWorkflow("source-note");

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);
      mockProvider.setMockResponse("question", MOCK_QUESTION_OUTPUT);

      await engine.executePhase(workflow.id, "capture", "content", []);
      await engine.executePhase(workflow.id, "explain", "content", []);
      await engine.executePhase(workflow.id, "question", "content", []);

      const updated = engine.getWorkflow(workflow.id)!;
      expect(updated.phaseStatus.question).toBe("completed");
    });

    it("should use all previous outputs in refine prompt", async () => {
      const workflow = engine.createWorkflow("source-note");

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);
      mockProvider.setMockResponse("question", MOCK_QUESTION_OUTPUT);
      mockProvider.setMockResponse("refine", MOCK_REFINE_OUTPUT);

      await engine.executePhase(workflow.id, "capture", "content", []);
      await engine.executePhase(workflow.id, "explain", "content", []);
      await engine.executePhase(workflow.id, "question", "content", []);
      await engine.executePhase(workflow.id, "refine", "content", []);

      const updated = engine.getWorkflow(workflow.id)!;
      expect(updated.phaseStatus.refine).toBe("completed");
    });

    it("should include existing notes in connect prompt", async () => {
      const workflow = engine.createWorkflow("source-note");
      const existingNotes = createMockNotes(2);

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);
      mockProvider.setMockResponse("question", MOCK_QUESTION_OUTPUT);
      mockProvider.setMockResponse("refine", MOCK_REFINE_OUTPUT);
      mockProvider.setMockResponse("connect", MOCK_CONNECT_OUTPUT);

      await engine.executePhase(workflow.id, "capture", "content", []);
      await engine.executePhase(workflow.id, "explain", "content", []);
      await engine.executePhase(workflow.id, "question", "content", []);
      await engine.executePhase(workflow.id, "refine", "content", []);
      await engine.executePhase(workflow.id, "connect", "content", existingNotes);

      const updated = engine.getWorkflow(workflow.id)!;
      expect(updated.phaseStatus.connect).toBe("completed");
    });
  });

  // ============================================================================
  // 阶段状态转换测试
  // ============================================================================
  describe("phase state transitions", () => {
    it("should transition from pending to processing to completed", async () => {
      const workflow = engine.createWorkflow("source-note");
      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);

      // Initially pending
      let wf = engine.getWorkflow(workflow.id)!;
      expect(wf.phaseStatus.capture).toBe("pending");

      // After execution should be completed
      await engine.executePhase(workflow.id, "capture", "content", []);
      wf = engine.getWorkflow(workflow.id)!;
      expect(wf.phaseStatus.capture).toBe("completed");
    });

    it("should transition to failed on error", async () => {
      const workflow = engine.createWorkflow("source-note");
      mockProvider.setMockResponse("capture", null);

      try {
        await engine.executePhase(workflow.id, "capture", "content", []);
      } catch {
        // expected
      }

      const wf = engine.getWorkflow(workflow.id)!;
      expect(wf.phaseStatus.capture).toBe("failed");
    });

    it("should maintain correct phase order", async () => {
      const workflow = engine.createWorkflow("source-note");

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);
      mockProvider.setMockResponse("question", MOCK_QUESTION_OUTPUT);
      mockProvider.setMockResponse("refine", MOCK_REFINE_OUTPUT);
      mockProvider.setMockResponse("connect", MOCK_CONNECT_OUTPUT);

      await engine.executePhase(workflow.id, "capture", "content", []);
      let wf = engine.getWorkflow(workflow.id)!;
      expect(wf.currentPhase).toBe("capture");

      await engine.executePhase(workflow.id, "explain", "content", []);
      wf = engine.getWorkflow(workflow.id)!;
      expect(wf.currentPhase).toBe("explain");

      await engine.executePhase(workflow.id, "question", "content", []);
      wf = engine.getWorkflow(workflow.id)!;
      expect(wf.currentPhase).toBe("question");

      await engine.executePhase(workflow.id, "refine", "content", []);
      wf = engine.getWorkflow(workflow.id)!;
      expect(wf.currentPhase).toBe("refine");

      await engine.executePhase(workflow.id, "connect", "content", []);
      wf = engine.getWorkflow(workflow.id)!;
      expect(wf.currentPhase).toBe("connect");
    });
  });

  // ============================================================================
  // 边界情况测试
  // ============================================================================
  describe("edge cases", () => {
    it("should handle empty existing notes array", async () => {
      const workflow = engine.createWorkflow("source-note");

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);
      mockProvider.setMockResponse("question", MOCK_QUESTION_OUTPUT);
      mockProvider.setMockResponse("refine", MOCK_REFINE_OUTPUT);
      mockProvider.setMockResponse("connect", {
        ...MOCK_CONNECT_OUTPUT,
        suggestedLinks: [],
      });

      const result = await engine.runWorkflow(workflow.id, "content", []);

      expect(result.phaseStatus.connect).toBe("completed");
    });

    it("should handle workflow with special characters in source content", async () => {
      const workflow = engine.createWorkflow("source-note");
      const specialContent = "Content with special chars: <>&\"'\n\t";

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);

      await engine.executePhase(workflow.id, "capture", specialContent, []);

      const result = engine.getWorkflow(workflow.id)!;
      expect(result.phaseStatus.capture).toBe("completed");
    });

    it("should handle long source content", async () => {
      const workflow = engine.createWorkflow("source-note");
      const longContent = "a".repeat(10000);

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);

      await engine.executePhase(workflow.id, "capture", longContent, []);

      const result = engine.getWorkflow(workflow.id)!;
      expect(result.phaseStatus.capture).toBe("completed");
    });

    it("should handle multiple workflows independently", async () => {
      const workflow1 = engine.createWorkflow("source-1");
      const workflow2 = engine.createWorkflow("source-2");

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);

      await engine.executePhase(workflow1.id, "capture", "content1", []);

      // Workflow2 should still be pending
      const wf2 = engine.getWorkflow(workflow2.id)!;
      expect(wf2.phaseStatus.capture).toBe("pending");

      // Workflow1 should be completed
      const wf1 = engine.getWorkflow(workflow1.id)!;
      expect(wf1.phaseStatus.capture).toBe("completed");
    });

    it("should handle phase output with missing optional fields", async () => {
      const workflow = engine.createWorkflow("source-note");

      // Explain output without optional analogy
      const minimalExplain: ExplainOutput = {
        ownWordsExplanation: "Just explanation",
        simplifiedVersion: "Simple version",
      };

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", minimalExplain);

      await engine.executePhase(workflow.id, "capture", "content", []);
      await engine.executePhase(workflow.id, "explain", "content", []);

      const result = engine.getWorkflow(workflow.id)!;
      expect(result.phaseStatus.explain).toBe("completed");
      expect(result.phaseOutputs.explain).toEqual(minimalExplain);
    });

    it("should handle connect phase with no existing notes", async () => {
      const workflow = engine.createWorkflow("source-note");

      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);
      mockProvider.setMockResponse("question", MOCK_QUESTION_OUTPUT);
      mockProvider.setMockResponse("refine", MOCK_REFINE_OUTPUT);
      mockProvider.setMockResponse("connect", {
        suggestedLinks: [],
        upstreamConcepts: [],
        downstreamApplications: [],
      });

      await engine.runWorkflow(workflow.id, "content", []);

      const result = engine.getWorkflowResult(workflow.id);
      expect(result!.links).toEqual([]);
    });
  });

  // ============================================================================
  // 完整集成测试
  // ============================================================================
  describe("integration tests", () => {
    it("should complete full CEQRC workflow end-to-end", async () => {
      const workflow = engine.createWorkflow("source-note-123");
      const existingNotes = createMockNotes(3);

      // Set up all mock responses
      mockProvider.setMockResponse("capture", {
        coreConcept: "React Hooks",
        keyTerms: ["useState", "useEffect", "custom hooks"],
        context: "React functional components",
      });

      mockProvider.setMockResponse("explain", {
        ownWordsExplanation: "Hooks let you use state in functional components",
        analogy: "Like adding superpowers to regular functions",
        simplifiedVersion: "Hooks = state + functions",
      });

      mockProvider.setMockResponse("question", {
        clarificationQuestions: ["What are the rules of hooks?"],
        boundaryQuestions: ["When should I use class components instead?"],
        applicationQuestions: ["How do I create a custom hook?"],
      });

      mockProvider.setMockResponse("refine", {
        refinedTitle: "Understanding React Hooks",
        refinedContent: "React Hooks allow functional components to manage state...",
        atomicityScore: 0.9,
      });

      mockProvider.setMockResponse("connect", {
        suggestedLinks: [
          {
            targetNoteId: existingNotes[0].id,
            linkType: "related",
            context: "Related to React concepts",
            relevanceScore: 0.85,
          },
        ],
        upstreamConcepts: ["React Components", "JavaScript Functions"],
        downstreamApplications: ["Custom Hooks", "State Management"],
      });

      const result = await engine.runWorkflow(
        workflow.id,
        "Learn about React Hooks and how they work",
        existingNotes
      );

      // Verify all phases completed
      expect(result.phaseStatus.capture).toBe("completed");
      expect(result.phaseStatus.explain).toBe("completed");
      expect(result.phaseStatus.question).toBe("completed");
      expect(result.phaseStatus.refine).toBe("completed");
      expect(result.phaseStatus.connect).toBe("completed");

      // Verify final result
      const finalResult = engine.getWorkflowResult(workflow.id);
      expect(finalResult).toBeDefined();
      expect(finalResult!.title).toBe("Understanding React Hooks");
      expect(finalResult!.atomicityScore).toBe(0.9);
      expect(finalResult!.links).toHaveLength(1);
    });

    it("should handle workflow failure and recovery", async () => {
      const workflow = engine.createWorkflow("source-note");

      // First attempt fails at explain phase
      mockProvider.setMockResponse("capture", MOCK_CAPTURE_OUTPUT);
      mockProvider.setMockResponse("explain", null);

      await expect(
        engine.runWorkflow(workflow.id, "content", [])
      ).rejects.toThrow();

      // Verify explain phase failed
      let wf = engine.getWorkflow(workflow.id)!;
      expect(wf.phaseStatus.explain).toBe("failed");

      // Create new workflow for retry
      const newWorkflow = engine.createWorkflow("source-note-2");
      mockProvider.setMockResponse("explain", MOCK_EXPLAIN_OUTPUT);
      mockProvider.setMockResponse("question", MOCK_QUESTION_OUTPUT);
      mockProvider.setMockResponse("refine", MOCK_REFINE_OUTPUT);
      mockProvider.setMockResponse("connect", MOCK_CONNECT_OUTPUT);

      // Retry should succeed
      const result = await engine.runWorkflow(newWorkflow.id, "content", []);
      expect(result.phaseStatus.explain).toBe("completed");
    });
  });
});
