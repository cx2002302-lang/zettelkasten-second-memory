import { jsonResult } from "openclaw/plugin-sdk/core";
import type { SerendipityService } from "../../service/phase6/serendipity-service.js";
import type { MOCService } from "../../service/phase6/moc-service.js";
import type { KnowledgeAuditService } from "../../service/phase6/audit-service.js";
import { registerPhase6Tools } from "../../mcp/phase6-tools.js";

interface MinimalApi {
  registerTool: (tool: unknown, options: { name: string }) => void;
}

export function registerPhase6ToolsWithApi(
  api: MinimalApi,
  serendipityService: SerendipityService | null,
  mocService: MOCService | null,
  auditService: KnowledgeAuditService | null,
) {
  const phase6Tools = registerPhase6Tools(serendipityService, mocService, auditService);
  for (const tool of phase6Tools) {
    api.registerTool(
      {
        name: tool.name,
        label: tool.name,
        description: tool.schema.description,
        parameters: tool.schema.parameters,
        execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
          const result = await tool.handler(rawParams);
          return jsonResult(result);
        },
      },
      { name: tool.name },
    );
  }
}
