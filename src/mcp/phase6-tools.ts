/**
 * Phase 6 MCP 工具注册
 *
 * 非耦合设计：每个工具对应一个独立的服务功能，可单独开关。
 */

import { Type } from "@sinclair/typebox";
import type { SerendipityService } from "../service/phase6/serendipity-service.js";
import type { MOCService } from "../service/phase6/moc-service.js";
import type { KnowledgeAuditService } from "../service/phase6/audit-service.js";

/**
 * 注册 Phase 6 MCP 工具
 */
export function registerPhase6Tools(
  serendipityService: SerendipityService | null,
  mocService: MOCService | null,
  auditService: KnowledgeAuditService | null
): Array<{ name: string; schema: any; handler: (args: any) => Promise<any> }> {
  const tools: Array<{ name: string; schema: any; handler: (args: any) => Promise<any> }> = [];

  // === P0: Serendipity 工具 ===
  if (serendipityService) {
    tools.push({
      name: "zk_discover_serendipity",
      schema: {
        description: "发现知识网络中的意外关联（Serendipity Engine）",
        parameters: Type.Object({
          topK: Type.Optional(Type.Number({ description: "返回前 N 条发现", default: 5 })),
        }),
      },
      handler: async (args: { topK?: number }) => {
        const result = serendipityService.runDiscovery();
        const findings = serendipityService.getPendingFindings(args.topK || 5);
        return {
          discovered: result.discovered,
          saved: result.saved,
          findings: findings.map((f) => ({
            from: f.fromTitle,
            to: f.toTitle,
            score: f.score,
            reason: f.reason,
            commonNeighbors: f.commonNeighbors,
            pathLength: f.pathLength,
          })),
        };
      },
    });

    tools.push({
      name: "zk_get_serendipity_stats",
      schema: {
        description: "获取意外发现统计",
        parameters: Type.Object({}),
      },
      handler: async () => {
        return serendipityService.getStats();
      },
    });
  }

  // === P1: MOC 工具 ===
  if (mocService) {
    tools.push({
      name: "zk_scan_moc",
      schema: {
        description: "扫描知识社区并生成结构笔记（MOC）建议",
        parameters: Type.Object({}),
      },
      handler: async () => {
        const result = mocService.scanAndSuggest();
        const suggestions = mocService.getPendingSuggestions(5);
        return {
          communitiesFound: result.communities,
          suggestionsSaved: result.saved,
          suggestions: suggestions.map((s) => ({
            title: s.title,
            noteCount: s.noteCount,
            density: s.density,
            hubNote: s.hubNoteId,
            preview: s.suggestedContent.substring(0, 200) + "...",
          })),
        };
      },
    });

    tools.push({
      name: "zk_get_moc_stats",
      schema: {
        description: "获取 MOC 生成统计",
        parameters: Type.Object({}),
      },
      handler: async () => {
        return mocService.getStats();
      },
    });
  }

  // === P2: Audit 工具 ===
  if (auditService) {
    tools.push({
      name: "zk_knowledge_audit",
      schema: {
        description: "生成知识库健康度审计报告",
        parameters: Type.Object({}),
      },
      handler: async () => {
        const report = auditService.generateReport();
        return {
          totalNotes: report.totalNotes,
          totalLinks: report.totalLinks,
          connectionRate: `${report.connectionRate}%`,
          orphanCount: report.orphanCount,
          zombieCount: report.zombieCount,
          inboxBacklog: report.inboxBacklog,
          avgContentLength: report.avgContentLength,
          hubNotes: report.hubNotes,
          domainDistribution: report.domainDistribution,
          recommendations: report.recommendations,
        };
      },
    });

    tools.push({
      name: "zk_get_audit_history",
      schema: {
        description: "获取历史审计报告列表",
        parameters: Type.Object({
          limit: Type.Optional(Type.Number({ description: "返回数量", default: 5 })),
        }),
      },
      handler: async (args: { limit?: number }) => {
        return auditService.getReportHistory(args.limit || 5);
      },
    });
  }

  return tools;
}
