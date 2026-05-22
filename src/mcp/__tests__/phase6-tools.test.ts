/**
 * Phase 6 MCP 工具注册单元测试
 *
 * 测试覆盖：
 * 1. 工具注册数量与名称
 * 2. 各工具 handler 返回值结构
 * 3. 空服务处理
 * 4. Schema 基本验证
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registerPhase6Tools } from "../phase6-tools.js";

describe("registerPhase6Tools", () => {
  let mockSerendipityService: any;
  let mockMOCService: any;
  let mockAuditService: any;

  beforeEach(() => {
    mockSerendipityService = {
      runDiscovery: () => ({ discovered: 3, saved: 2 }),
      getPendingFindings: (limit: number) => [
        {
          id: 1,
          fromNoteId: "n1",
          fromTitle: "Note A",
          toNoteId: "n2",
          toTitle: "Note B",
          score: 0.85,
          reason: "Common neighbors",
          commonNeighbors: "Hub 1",
          pathLength: 2,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
      getStats: () => ({ total: 5, pending: 3, accepted: 1, rejected: 1 }),
    };

    mockMOCService = {
      scanAndSuggest: () => ({ communities: 2, saved: 1 }),
      getPendingSuggestions: (limit: number) => [
        {
          id: 1,
          title: "ML Knowledge Map",
          suggestedContent: "# ML Knowledge Map\n\nSome content here",
          communityId: 1,
          hubNoteId: "hub-1",
          noteCount: 5,
          density: 0.6,
          noteTitles: ["Note A", "Note B", "Note C"],
          status: "pending" as const,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
      getStats: () => ({ total: 3, pending: 2, created: 1 }),
    };

    mockAuditService = {
      generateReport: () => ({
        generatedAt: "2026-01-01T00:00:00Z",
        totalNotes: 100,
        totalLinks: 50,
        connectionRate: 66.7,
        orphanCount: 5,
        hubNotes: [
          { id: "hub-1", title: "Hub Note", linkCount: 10, glowScore: 0.9 },
        ],
        zombieCount: 2,
        inboxBacklog: 3,
        avgContentLength: 250,
        growthTrend: [{ date: "2026-01-01", count: 5 }],
        domainDistribution: [
          { folder: "zettels", count: 80, percentage: 80 },
        ],
        recommendations: ["Knowledge base is healthy"],
      }),
      getReportHistory: (limit: number) => [
        { id: 1, createdAt: "2026-01-01T00:00:00Z", schedule: "weekly" },
      ],
    };
  });

  // ============================================================================
  // 工具注册测试
  // ============================================================================
  describe("tool registration", () => {
    it("should register all 6 tools when all services provided", () => {
      const tools = registerPhase6Tools(
        mockSerendipityService,
        mockMOCService,
        mockAuditService
      );

      expect(tools).toHaveLength(6);
      const names = tools.map((t) => t.name);
      expect(names).toContain("zk_discover_serendipity");
      expect(names).toContain("zk_get_serendipity_stats");
      expect(names).toContain("zk_scan_moc");
      expect(names).toContain("zk_get_moc_stats");
      expect(names).toContain("zk_knowledge_audit");
      expect(names).toContain("zk_get_audit_history");
    });

    it("should skip serendipity tools when service is null", () => {
      const tools = registerPhase6Tools(
        null,
        mockMOCService,
        mockAuditService
      );

      expect(tools).toHaveLength(4);
      const names = tools.map((t) => t.name);
      expect(names).not.toContain("zk_discover_serendipity");
      expect(names).not.toContain("zk_get_serendipity_stats");
    });

    it("should skip moc tools when service is null", () => {
      const tools = registerPhase6Tools(
        mockSerendipityService,
        null,
        mockAuditService
      );

      expect(tools).toHaveLength(4);
      const names = tools.map((t) => t.name);
      expect(names).not.toContain("zk_scan_moc");
      expect(names).not.toContain("zk_get_moc_stats");
    });

    it("should skip audit tools when service is null", () => {
      const tools = registerPhase6Tools(
        mockSerendipityService,
        mockMOCService,
        null
      );

      expect(tools).toHaveLength(4);
      const names = tools.map((t) => t.name);
      expect(names).not.toContain("zk_knowledge_audit");
      expect(names).not.toContain("zk_get_audit_history");
    });

    it("should return empty array when all services are null", () => {
      const tools = registerPhase6Tools(null, null, null);
      expect(tools).toHaveLength(0);
    });
  });

  // ============================================================================
  // Serendipity 工具测试
  // ============================================================================
  describe("zk_discover_serendipity", () => {
    it("should return discovery result with findings", async () => {
      const tools = registerPhase6Tools(
        mockSerendipityService,
        mockMOCService,
        mockAuditService
      );
      const tool = tools.find((t) => t.name === "zk_discover_serendipity")!;

      const result = await tool.handler({ topK: 5 });

      expect(result.discovered).toBe(3);
      expect(result.saved).toBe(2);
      expect(Array.isArray(result.findings)).toBe(true);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].from).toBe("Note A");
      expect(result.findings[0].to).toBe("Note B");
      expect(result.findings[0].score).toBe(0.85);
    });

    it("should use default topK when not provided", async () => {
      const tools = registerPhase6Tools(
        mockSerendipityService,
        mockMOCService,
        mockAuditService
      );
      const tool = tools.find((t) => t.name === "zk_discover_serendipity")!;

      const result = await tool.handler({});
      expect(result.findings).toBeDefined();
    });
  });

  describe("zk_get_serendipity_stats", () => {
    it("should return stats object", async () => {
      const tools = registerPhase6Tools(
        mockSerendipityService,
        mockMOCService,
        mockAuditService
      );
      const tool = tools.find((t) => t.name === "zk_get_serendipity_stats")!;

      const result = await tool.handler({});

      expect(result.total).toBe(5);
      expect(result.pending).toBe(3);
      expect(result.accepted).toBe(1);
      expect(result.rejected).toBe(1);
    });
  });

  // ============================================================================
  // MOC 工具测试
  // ============================================================================
  describe("zk_scan_moc", () => {
    it("should return scan result with suggestions", async () => {
      const tools = registerPhase6Tools(
        mockSerendipityService,
        mockMOCService,
        mockAuditService
      );
      const tool = tools.find((t) => t.name === "zk_scan_moc")!;

      const result = await tool.handler({});

      expect(result.communitiesFound).toBe(2);
      expect(result.suggestionsSaved).toBe(1);
      expect(Array.isArray(result.suggestions)).toBe(true);
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].title).toBe("ML Knowledge Map");
      expect(result.suggestions[0].noteCount).toBe(5);
      expect(result.suggestions[0].preview).toContain("...");
    });
  });

  describe("zk_get_moc_stats", () => {
    it("should return stats object", async () => {
      const tools = registerPhase6Tools(
        mockSerendipityService,
        mockMOCService,
        mockAuditService
      );
      const tool = tools.find((t) => t.name === "zk_get_moc_stats")!;

      const result = await tool.handler({});

      expect(result.total).toBe(3);
      expect(result.pending).toBe(2);
      expect(result.created).toBe(1);
    });
  });

  // ============================================================================
  // Audit 工具测试
  // ============================================================================
  describe("zk_knowledge_audit", () => {
    it("should return formatted audit report", async () => {
      const tools = registerPhase6Tools(
        mockSerendipityService,
        mockMOCService,
        mockAuditService
      );
      const tool = tools.find((t) => t.name === "zk_knowledge_audit")!;

      const result = await tool.handler({});

      expect(result.totalNotes).toBe(100);
      expect(result.totalLinks).toBe(50);
      expect(result.connectionRate).toBe("66.7%");
      expect(result.orphanCount).toBe(5);
      expect(result.zombieCount).toBe(2);
      expect(result.inboxBacklog).toBe(3);
      expect(result.avgContentLength).toBe(250);
      expect(Array.isArray(result.hubNotes)).toBe(true);
      expect(Array.isArray(result.domainDistribution)).toBe(true);
      expect(Array.isArray(result.recommendations)).toBe(true);
    });
  });

  describe("zk_get_audit_history", () => {
    it("should return history with limit", async () => {
      const tools = registerPhase6Tools(
        mockSerendipityService,
        mockMOCService,
        mockAuditService
      );
      const tool = tools.find((t) => t.name === "zk_get_audit_history")!;

      const result = await tool.handler({ limit: 5 });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
      expect(result[0].schedule).toBe("weekly");
    });

    it("should use default limit when not provided", async () => {
      const tools = registerPhase6Tools(
        mockSerendipityService,
        mockMOCService,
        mockAuditService
      );
      const tool = tools.find((t) => t.name === "zk_get_audit_history")!;

      const result = await tool.handler({});
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ============================================================================
  // Schema 测试
  // ============================================================================
  describe("tool schemas", () => {
    it("should have description for each tool", () => {
      const tools = registerPhase6Tools(
        mockSerendipityService,
        mockMOCService,
        mockAuditService
      );

      for (const tool of tools) {
        expect(tool.schema.description).toBeDefined();
        expect(tool.schema.description.length).toBeGreaterThan(0);
      }
    });

    it("should have parameters schema for each tool", () => {
      const tools = registerPhase6Tools(
        mockSerendipityService,
        mockMOCService,
        mockAuditService
      );

      for (const tool of tools) {
        expect(tool.schema.parameters).toBeDefined();
        expect(tool.schema.parameters.type).toBe("object");
      }
    });
  });
});
