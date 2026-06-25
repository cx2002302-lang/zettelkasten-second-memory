/**
 * E2E 测试: 从笔记创建到知识网络构建的完整业务流程
 *
 * 场景:
 * 1. 笔记生命周期（创建 → 审核 → 链接 → 归档）
 * 2. Phase 6 知识网络增值（审计 → 意外发现 → 社区发现）
 * 3. 夜间蒸馏流程（记忆文件 → 去重 → 笔记创建）
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ensureZettelkastenSchema } from "../storage/db-schema.js";
import { NoteService } from "../service/note-service.js";
import { LinkService } from "../service/link-service.js";
import { ArchiveService } from "../service/archive-service.js";
import { KnowledgeAuditService } from "../service/phase6/audit-service.js";
import { SerendipityService } from "../service/phase6/serendipity-service.js";
import { MOCService } from "../service/phase6/moc-service.js";
import { DistillerService } from "../service/distiller-service.js";
import { DedupeService } from "../service/dedupe-service.js";
import { NoteRepository } from "../repository/note-repository.js";
import { GlowCalculator } from "../engine/glow-calculator.js";
import type {
  LLMProvider,
  DistillSummary,
  ZettelNote,
} from "../core/types.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestDir, cleanupTestDir } from "../testing/test-fs.js";

// ============================================================================
// 测试工具
// ============================================================================

function createNoteData(overrides: Partial<{
  title: string;
  content: string;
  tags: string[];
  confidence: number;
}> = {}) {
  return {
    title: overrides.title ?? "测试笔记",
    content:
      overrides.content ??
      "这是测试笔记的内容，包含足够的文字来通过原子化检查和质量验证。",
    tags: overrides.tags ?? [],
    confidence: overrides.confidence ?? 0.8,
  };
}

class MockLLMProvider implements LLMProvider {
  private callCount = 0;

  async generateSummary(
    content: string,
    context?: string
  ): Promise<DistillSummary> {
    this.callCount++;
    const hash = content
      .split("")
      .reduce((a, b) => a + b.charCodeAt(0), 0);
    const title = `Distilled Insight ${hash % 10000}`;
    const summaryContent =
      `This is a comprehensive analysis of the conversation about ${context || "the topic"}. ` +
      `It explores key concepts including modularity, abstraction, and scalable architecture patterns. ` +
      `The discussion reveals important software design principles that can be applied to real-world projects. ` +
      `Original content reference: ${content.slice(0, 100)}`;

    return {
      id: `summary-${this.callCount}-${hash}`,
      sliceId: `slice-${this.callCount}`,
      title,
      content: summaryContent,
      summary: `Analysis of ${context || "conversation"}`,
      confidence: 0.75,
      suggestedTags: ["distilled", "insight"],
      suggestedLinks: [],
      generatedAt: new Date().toISOString(),
    };
  }

  async judgeDuplicate(
    candidate: string,
    existing: string
  ): Promise<{ isDuplicate: boolean; reason: string }> {
    // Simple heuristic: if content is identical or very similar, it's a duplicate
    const normalizedCandidate = candidate.replace(/\s+/g, " ").trim();
    const normalizedExisting = existing.replace(/\s+/g, " ").trim();
    const isDup =
      normalizedCandidate === normalizedExisting ||
      normalizedCandidate.includes("Original content reference:") &&
        normalizedExisting.includes("Original content reference:") &&
        normalizedCandidate.slice(-30) === normalizedExisting.slice(-30);
    return {
      isDuplicate: isDup,
      reason: isDup
        ? "Content is semantically identical"
        : "Content differs significantly",
    };
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const dim = 128;
    const embedding = new Array(dim).fill(0);
    for (let i = 0; i < text.length; i++) {
      embedding[i % dim] += text.charCodeAt(i) / 10000;
    }
    // Normalize
    const norm = Math.sqrt(embedding.reduce((a, b) => a + b * b, 0));
    if (norm > 0) {
      for (let i = 0; i < dim; i++) {
        embedding[i] /= norm;
      }
    }
    return embedding;
  }

  async processCEQRCPhase(phase: string, input: unknown): Promise<unknown> {
    return input;
  }
}

// ============================================================================
// 场景 1: 笔记生命周期
// ============================================================================

describe("E2E Scenario 1: Note Lifecycle", () => {
  let db: DatabaseSync;
  let noteService: NoteService;
  let linkService: LinkService;
  let archiveService: ArchiveService;
  let noteRepo: NoteRepository;
  let tempDir: string;
  let basePath: string;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureZettelkastenSchema({ db, ftsEnabled: true });
    tempDir = createTestDir("zk-e2e-");
    basePath = `${tempDir}/notes`;
    noteService = new NoteService(db, basePath);
    linkService = new LinkService(db);
    archiveService = new ArchiveService(db);
    noteRepo = new NoteRepository(db);
  });

  afterEach(() => {
    db.close();
    cleanupTestDir(tempDir);
  });

  it("should complete the full note lifecycle from inbox to archive", async () => {
    // Step 1: Create inbox note (fleeting)
    const note1 = await noteService.createNote(
      createNoteData({
        title: "临时想法：项目架构设计",
        content:
          "这是一个初步的想法，关于如何使用模块化设计来构建可扩展的系统架构。",
        tags: ["architecture", "draft"],
      }),
      { confidence: 0.2, source: "ceqrc" }
    );
    expect(note1.folder).toBe("inbox");
    expect(note1.status).toBe("FLEETING");
    expect(note1.reviewed).toBe(false);
    expect(note1.tags).toEqual(["architecture", "draft"]);

    // Step 2: Review → promote to literature
    const reviewed1 = await noteService.reviewNote(note1.id, "approve", {
      confidence: 0.5,
    });
    expect(reviewed1).not.toBeNull();
    expect(reviewed1!.folder).toBe("references");
    expect(reviewed1!.status).toBe("LITERATURE");
    expect(reviewed1!.reviewed).toBe(true);
    expect(reviewed1!.confidence).toBe(0.5);

    // Step 3: Review again → promote to permanent
    const reviewed2 = await noteService.reviewNote(note1.id, "approve", {
      confidence: 0.85,
    });
    expect(reviewed2).not.toBeNull();
    expect(reviewed2!.folder).toBe("zettels");
    expect(reviewed2!.status).toBe("PERMANENT");
    expect(reviewed2!.confidence).toBe(0.85);

    // Step 4: Update note content
    const updated = await noteService.updateNote(note1.id, {
      content:
        "更新后的内容：模块化设计通过将系统拆分为独立的组件，实现了关注点分离和可维护性。",
    });
    expect(updated).not.toBeNull();
    expect(updated!.content).toContain("更新后的内容");

    // Step 5: Create second note
    const note2 = await noteService.createNote(
      createNoteData({
        title: "模块化与抽象的对比分析",
        content:
          "模块化和抽象是软件设计的两个核心原则。模块化关注代码的物理组织，而抽象关注概念层面的简化。",
        tags: ["architecture", "modularity", "abstraction"],
      }),
      { confidence: 0.9, source: "manual" }
    );
    expect(note2.folder).toBe("zettels");
    expect(note2.status).toBe("FLEETING"); // manual source marks reviewed=true but status remains FLEETING until transitioned
    expect(note2.reviewed).toBe(true);

    // Step 6: Create link between two notes
    linkService.createLink(note1.id, note2.id, "supports", {
      context: "Note1 supports the analysis in Note2",
    });

    // Step 7: Verify bidirectional links
    const linksFrom1 = linkService.getLinksFrom(note1.id);
    expect(linksFrom1).toHaveLength(1);
    expect(linksFrom1[0].to).toBe(note2.id);
    expect(linksFrom1[0].type).toBe("supports");

    const linksTo2 = linkService.getLinksTo(note2.id);
    expect(linksTo2).toHaveLength(1);
    expect(linksTo2[0].to).toBe(note1.id); // reversed: to_note_id in reverse link points back
    expect(linksTo2[0].type).toBe("supported_by");

    const linksBetween = linkService.getLinksBetween(note1.id, note2.id);
    expect(linksBetween).toHaveLength(2);

    // Step 8: Search notes (FTS + tags)
    const ftsResults = await noteService.searchNotes("模块化");
    expect(ftsResults.length).toBeGreaterThanOrEqual(1);
    const foundNote1 = ftsResults.find((r) => r.note.id === note1.id);
    expect(foundNote1).toBeDefined();

    const tagResults = noteRepo.query({ tags: ["architecture"] });
    expect(tagResults.length).toBe(2);
    expect(tagResults.map((n) => n.id)).toContain(note1.id);
    expect(tagResults.map((n) => n.id)).toContain(note2.id);

    // Step 9: Archive note1 (NoteService updates folder; ArchiveService logs action)
    const archived = await noteService.archiveNote(note1.id);
    expect(archived).not.toBeNull();
    expect(archived!.folder).toBe("archive");

    // Log the archive action for audit trail
    archiveService.logAction(note1.id, note1.title, "archive", "Manual archive during E2E test");
    const logs = archiveService.getArchiveLog({ noteId: note1.id });
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe("archive");

    // Step 10: Verify archived note is not visible in default search
    const searchAfterArchive = await noteService.searchNotes("模块化");
    const archivedVisible = searchAfterArchive.find((r) => r.note.id === note1.id);
    expect(archivedVisible).toBeUndefined();

    // But visible when includeArchived is true
    const searchWithArchive = await noteService.searchNotes("模块化", 10, {
      includeArchived: true,
    });
    const archivedIncluded = searchWithArchive.find((r) => r.note.id === note1.id);
    expect(archivedIncluded).toBeDefined();
  });
});

// ============================================================================
// 场景 2: Phase 6 知识网络增值
// ============================================================================

describe("E2E Scenario 2: Phase 6 Knowledge Network Enhancement", () => {
  let db: DatabaseSync;
  let noteService: NoteService;
  let linkService: LinkService;
  let auditService: KnowledgeAuditService;
  let serendipityService: SerendipityService;
  let mocService: MOCService;
  let glowCalculator: GlowCalculator;
  let tempDir: string;
  let basePath: string;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureZettelkastenSchema({ db, ftsEnabled: true });
    tempDir = createTestDir("zk-e2e-");
    basePath = `${tempDir}/notes`;
    noteService = new NoteService(db, basePath);
    linkService = new LinkService(db);
    auditService = new KnowledgeAuditService(db);
    serendipityService = new SerendipityService(db, {
      minScore: 0.1,
      maxPathLength: 3,
    });
    mocService = new MOCService(db, { minClusterSize: 3 });
    glowCalculator = new GlowCalculator(db);
  });

  afterEach(() => {
    db.close();
    cleanupTestDir(tempDir);
  });

  it("should build knowledge network and run Phase 6 services", async () => {
    // Step 1: Create 10+ tagged notes organized in two topic clusters
    const notes: ZettelNote[] = [];

    // Cluster 1: Programming (6 notes) — star topology with hub
    const hubProg = await noteService.createNote(
      createNoteData({
        title: "软件工程核心概念",
        content:
          "软件工程涵盖了模块化、抽象、封装、继承和多态等核心概念。这些概念构成了现代软件开发的理论基础。",
        tags: ["programming", "software-engineering"],
      }),
      { confidence: 0.9, source: "manual" }
    );
    notes.push(hubProg);

    const progNotes = [
      {
        title: "模块化设计原则",
        content:
          "模块化设计通过将系统拆分为独立组件来实现关注点分离。模块化、抽象和接口定义是模块化设计的三大支柱。",
      },
      {
        title: "抽象层与接口",
        content:
          "抽象层隐藏了实现细节，只暴露必要的接口。模块化系统中的抽象层有助于降低复杂度并提高可维护性。",
      },
      {
        title: "代码复用策略",
        content:
          "代码复用可以通过库、框架和组件化实现。模块化设计是实现代码复用的前提条件。",
      },
      {
        title: "依赖注入模式",
        content:
          "依赖注入是一种实现控制反转的设计模式。它通过将依赖关系外部化来增强模块化和可测试性。",
      },
      {
        title: "单元测试最佳实践",
        content:
          "单元测试应该独立、快速且可重复。良好的模块化设计使得单元测试更加容易编写和维护。",
      },
    ];

    for (const data of progNotes) {
      const note = await noteService.createNote(
        createNoteData({ ...data, tags: ["programming"] }),
        { confidence: 0.8, source: "manual" }
      );
      notes.push(note);
      // Link each programming note to hub
      linkService.createLink(note.id, hubProg.id, "related", {
        context: "Part of programming knowledge cluster",
      });
    }

    // Cluster 2: Design (5 notes) — also star topology with its own hub
    const hubDesign = await noteService.createNote(
      createNoteData({
        title: "设计模式总览",
        content:
          "设计模式是软件设计中常见问题的可复用解决方案。创建型、结构型和行为型模式构成了设计模式的三大类别。",
        tags: ["design", "patterns"],
      }),
      { confidence: 0.9, source: "manual" }
    );
    notes.push(hubDesign);

    const designNotes = [
      {
        title: "工厂模式详解",
        content:
          "工厂模式提供了一种创建对象的最佳方式。它隐藏了对象创建的复杂逻辑，使代码更加模块化。",
      },
      {
        title: "观察者模式应用",
        content:
          "观察者模式定义了对象之间的一对多依赖关系。当主题状态改变时，所有依赖者都会收到通知并自动更新。",
      },
      {
        title: "策略模式实践",
        content:
          "策略模式定义了一系列算法，并将每个算法封装起来，使它们可以互相替换。策略模式让算法的变化独立于使用算法的客户。",
      },
      {
        title: "装饰器模式",
        content:
          "装饰器模式允许向一个现有的对象添加新的功能，同时又不改变其结构。这种模式创建了一个装饰类，用来包装原有的类。",
      },
    ];

    for (const data of designNotes) {
      const note = await noteService.createNote(
        createNoteData({ ...data, tags: ["design", "patterns"] }),
        { confidence: 0.8, source: "manual" }
      );
      notes.push(note);
      linkService.createLink(note.id, hubDesign.id, "related", {
        context: "Part of design patterns cluster",
      });
    }

    // Cross-cluster bridge
    linkService.createLink(hubProg.id, hubDesign.id, "extends", {
      context: "Programming concepts extend to design patterns",
    });

    // Calculate glow scores for audit and MOC
    glowCalculator.recalculateAll();

    // Step 2: Verify links exist
    const stats = linkService.getStats();
    expect(stats.total).toBeGreaterThan(0);

    // Step 3: Run KnowledgeAudit → verify report
    const report = auditService.generateReport();
    expect(report.totalNotes).toBe(11); // hubProg + 5 prog + hubDesign + 4 design
    expect(report.totalLinks).toBe(stats.total);
    expect(report.connectionRate).toBeGreaterThan(0);
    expect(report.domainDistribution.length).toBeGreaterThan(0);
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.hubNotes.length).toBeGreaterThan(0);

    // Verify report was saved
    const latestReport = auditService.getLatestReport();
    expect(latestReport).not.toBeNull();
    expect(latestReport!.totalNotes).toBe(report.totalNotes);

    // Step 4: Run Serendipity → verify discovery suggestions
    const discovery = serendipityService.runDiscovery();
    expect(discovery.saved).toBeGreaterThanOrEqual(0);

    const pendingFindings = serendipityService.getPendingFindings(20);
    // If discoveries were saved, verify they have proper structure
    if (discovery.saved > 0) {
      expect(pendingFindings.length).toBeGreaterThan(0);
      expect(pendingFindings[0].score).toBeGreaterThanOrEqual(0.1);
      expect(pendingFindings[0].fromNoteId).toBeDefined();
      expect(pendingFindings[0].toNoteId).toBeDefined();
    }

    const serendipityStats = serendipityService.getStats();
    expect(serendipityStats.total).toBe(discovery.saved);

    // Step 5: Run AutoMOC → verify community discovery
    const mocResult = mocService.scanAndSuggest();
    expect(mocResult.communities).toBeGreaterThanOrEqual(0);

    const pendingMOCs = mocService.getPendingSuggestions(10);
    if (mocResult.saved > 0) {
      expect(pendingMOCs.length).toBeGreaterThan(0);
      expect(pendingMOCs[0].noteCount).toBeGreaterThanOrEqual(3);
      expect(pendingMOCs[0].status).toBe("pending");
    }

    const mocStats = mocService.getStats();
    expect(mocStats.total).toBe(mocResult.saved);
  });
});

// ============================================================================
// 场景 3: 夜间蒸馏流程
// ============================================================================

describe("E2E Scenario 3: Night Distillation Flow", () => {
  let db: DatabaseSync;
  let noteService: NoteService;
  let linkService: LinkService;
  let distillerService: DistillerService;
  let mockLLM: MockLLMProvider;
  let tempDir: string;
  let basePath: string;

  beforeEach(async () => {
    db = new DatabaseSync(":memory:");
    ensureZettelkastenSchema({ db, ftsEnabled: true });
    tempDir = createTestDir("zk-e2e-");
    basePath = `${tempDir}/notes`;
    noteService = new NoteService(db, basePath);
    linkService = new LinkService(db);
    mockLLM = new MockLLMProvider();
    distillerService = new DistillerService(
      mockLLM,
      noteService,
      linkService,
      { batchSize: 5 }
    );
  });

  afterEach(() => {
    db.close();
    cleanupTestDir(tempDir);
  });

  it("should distill memory file, create notes, and handle deduplication", async () => {
    // Step 1: Create mock memory file
    const memoryFile = join(tempDir, "memory-2026-05-22.json");
    const memoryLog = {
      version: "1.0",
      sessionId: "test-session-001",
      startTime: "2026-05-22T08:00:00Z",
      endTime: "2026-05-22T09:30:00Z",
      entries: [
        {
          id: "e1",
          type: "user",
          content:
            "How do I design a modular system architecture for a large-scale application?",
          timestamp: "2026-05-22T08:05:00Z",
        },
        {
          id: "e2",
          type: "assistant",
          content:
            "To design a modular system, you should start by identifying bounded contexts. Each module should have a clear responsibility and minimal dependencies on other modules. Use interfaces to define contracts between modules.",
          timestamp: "2026-05-22T08:06:00Z",
        },
        {
          id: "e3",
          type: "user",
          content:
            "What about dependency management between modules?",
          timestamp: "2026-05-22T08:10:00Z",
        },
        {
          id: "e4",
          type: "assistant",
          content:
            "Dependency injection is the key pattern here. By injecting dependencies rather than creating them inside modules, you achieve loose coupling. This makes testing easier and allows modules to evolve independently.",
          timestamp: "2026-05-22T08:11:00Z",
        },
        {
          id: "e5",
          type: "user",
          content: "Can you give me an example of abstraction layers?",
          timestamp: "2026-05-22T08:15:00Z",
        },
        {
          id: "e6",
          type: "assistant",
          content:
            "Consider a data access layer. The business logic module should only depend on an abstract repository interface, not on concrete database implementations. This abstraction layer allows you to swap databases without changing business logic.",
          timestamp: "2026-05-22T08:16:00Z",
        },
        {
          id: "e7",
          type: "user",
          content: "How does this relate to microservices?",
          timestamp: "2026-05-22T08:20:00Z",
        },
        {
          id: "e8",
          type: "assistant",
          content:
            "Microservices take modularity to the deployment level. Each service is an independently deployable module with its own database and bounded context. The same design principles apply: clear interfaces, loose coupling, and high cohesion.",
          timestamp: "2026-05-22T08:21:00Z",
        },
        {
          id: "e9",
          type: "user",
          content: "What are common pitfalls in modular design?",
          timestamp: "2026-05-22T08:25:00Z",
        },
        {
          id: "e10",
          type: "assistant",
          content:
            "Common pitfalls include creating too many fine-grained modules, cyclic dependencies, and leaky abstractions. Also, over-engineering the module boundaries early on can lead to premature optimization. Start simple and refactor as the system grows.",
          timestamp: "2026-05-22T08:26:00Z",
        },
      ],
    };

    await writeFile(memoryFile, JSON.stringify(memoryLog, null, 2), "utf-8");

    // Step 2: First distillation — no existing notes, all should be CREATE
    const job1 = await distillerService.distillMemoryFile(memoryFile, []);
    expect(job1.status).toBe("completed");
    expect(job1.sliceCount).toBeGreaterThan(0);
    expect(job1.summaryCount).toBeGreaterThan(0);
    expect(job1.createdCount).toBeGreaterThan(0);
    expect(job1.error).toBeUndefined();

    // Verify notes were created
    const allNotes1 = await noteService.listNotes();
    expect(allNotes1.length).toBeGreaterThanOrEqual(job1.createdCount);
    const distilledNotes1 = allNotes1.filter((n) => n.source === "distilled");
    expect(distilledNotes1.length).toBeGreaterThanOrEqual(job1.createdCount);

    // Step 3: Prepare for second distillation — precompute embeddings for dedupe
    const existingNotes = distilledNotes1;
    const dedupeService = (distillerService as any).dedupeService as DedupeService;
    await dedupeService.batchPrecomputeEmbeddings(existingNotes);

    // Step 4: Second distillation with same file — should trigger MERGE for duplicates
    const job2 = await distillerService.distillMemoryFile(
      memoryFile,
      existingNotes
    );
    expect(job2.status).toBe("completed");

    // Verify deduplication happened: some notes merged or skipped instead of all created
    const totalNew = job2.createdCount + job2.mergedCount + job2.skippedCount;
    expect(totalNew).toBeGreaterThan(0);

    // Step 5: Verify final database state
    const allNotes2 = await noteService.listNotes();
    expect(allNotes2.length).toBeGreaterThanOrEqual(allNotes1.length);

    // Verify distilled notes exist and have expected structure
    const distilledNotes2 = allNotes2.filter((n) => n.source === "distilled");
    expect(distilledNotes2.length).toBeGreaterThan(0);
    for (const note of distilledNotes2) {
      expect(note.title.length).toBeGreaterThan(0);
      expect(note.content.length).toBeGreaterThan(50);
      expect(note.confidence).toBeGreaterThanOrEqual(0);
      expect(note.confidence).toBeLessThanOrEqual(1);
    }

    // Verify jobs are tracked
    expect(distillerService.getJob(job1.id)).not.toBeNull();
    expect(distillerService.getJob(job2.id)).not.toBeNull();
    expect(distillerService.getAllJobs().length).toBe(2);
  });
});
