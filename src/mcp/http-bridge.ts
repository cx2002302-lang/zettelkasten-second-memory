#!/usr/bin/env node
/**
 * Zettelkasten MCP HTTP Bridge
 *
 * 将 ZettelkastenMCPServer 暴露为 MCP Streamable HTTP 服务，
 * 供 Hermes Agent 等外部 MCP 客户端调用。
 *
 * 环境变量：
 *   ZETTELKASTEN_DB_PATH      必填，SQLite 数据库路径
 *   ZETTELKASTEN_NOTES_DIR    可选，默认取数据库目录下的 notes
 *   ZETTELKASTEN_MCP_PORT     可选，默认 9090
 *   ZETTELKASTEN_READ_ONLY    可选，"1" 表示仅启用只读工具
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ZettelkastenMCPServer } from "./server.js";

const dbPath = process.env.ZETTELKASTEN_DB_PATH;
if (!dbPath) {
  console.error("[zk-mcp-bridge] ZETTELKASTEN_DB_PATH is required");
  process.exit(1);
}

const notesDir = process.env.ZETTELKASTEN_NOTES_DIR ?? join(dirname(dbPath), "notes");
const port = parseInt(process.env.ZETTELKASTEN_MCP_PORT ?? "9090", 10);
const readOnly = process.env.ZETTELKASTEN_READ_ONLY === "1";

// 确保 notes 目录存在
if (!existsSync(notesDir)) {
  mkdirSync(notesDir, { recursive: true });
}

const db = new DatabaseSync(dbPath);
const zkServer = new ZettelkastenMCPServer(db, notesDir, {
  dbPath,
  notesBaseDir: notesDir,
  enableReadOnlyTools: true,
  enableReadWriteTools: !readOnly,
});

const tools = zkServer.getTools();

const mcpServer = new Server(
  { name: "zettelkasten-mcp-bridge", version: "1.0.0-beta.7" },
  { capabilities: { tools: {} } },
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
      isError: true,
    };
  }

  try {
    const result = await tool.handler(args ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(result ?? null) }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        },
      ],
      isError: true,
    };
  }
});

// 使用有状态 Streamable HTTP transport，每个 initialize 请求分配独立 session
// 这样可以在单个 Server 实例上服务多个 Hermes 连接
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});
transport.onerror = (err) => {
  console.error("[zk-mcp-bridge] transport error:", err);
};
await mcpServer.connect(transport);

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url !== "/mcp") {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not Found" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", async () => {
    try {
      const parsedBody = body ? JSON.parse(body) : undefined;
      await transport.handleRequest(req, res, parsedBody);
    } catch (err) {
      console.error("[zk-mcp-bridge] Error handling request:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  });
});

server.listen(port, () => {
  console.log(`[zk-mcp-bridge] Zettelkasten MCP bridge listening on http://0.0.0.0:${port}/mcp`);
  console.log(`[zk-mcp-bridge] DB: ${dbPath}, notes: ${notesDir}, tools: ${tools.length}`);
});

process.on("SIGINT", async () => {
  console.log("[zk-mcp-bridge] Shutting down...");
  await transport.close();
  db.close();
  server.close();
  process.exit(0);
});
