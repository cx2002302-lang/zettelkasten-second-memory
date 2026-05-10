/**
 * Zettelkasten MCP Server 测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ZettelkastenMCPServer } from "../server.js";
import type { DatabaseSync } from "node:sqlite";

// Mock dependencies
const mockDb = {
  prepare: vi.fn(),
  exec: vi.fn(),
} as unknown as DatabaseSync;

const mockLLMProvider = {
  generate: vi.fn(),
};

describe("ZettelkastenMCPServer", () => {
  let server: ZettelkastenMCPServer;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("构造函数和配置", () => {
    it("应该正确初始化只读服务器", () => {
      server = new ZettelkastenMCPServer(mockDb, "/test/path", {
        dbPath: "/test/db.sqlite",
        notesBaseDir: "/test/notes",
        enableReadOnlyTools: true,
        enableReadWriteTools: false,
      });

      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(ZettelkastenMCPServer);
    });

    it("应该正确初始化读写服务器", () => {
      server = new ZettelkastenMCPServer(mockDb, "/test/path", {
        dbPath: "/test/db.sqlite",
        notesBaseDir: "/test/notes",
        enableReadOnlyTools: true,
        enableReadWriteTools: true,
        llmProvider: mockLLMProvider as any,
      });

      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(ZettelkastenMCPServer);
    });

    it("应该正确初始化完全禁用工具的服务器", () => {
      server = new ZettelkastenMCPServer(mockDb, "/test/path", {
        dbPath: "/test/db.sqlite",
        notesBaseDir: "/test/notes",
        enableReadOnlyTools: false,
        enableReadWriteTools: false,
      });

      expect(server).toBeDefined();
    });
  });


  describe("getTools", () => {
    it("只读服务器应该返回7个工具", () => {
      const readonlyServer = new ZettelkastenMCPServer(mockDb, "/test/path", {
        dbPath: "/test/db.sqlite",
        notesBaseDir: "/test/notes",
        enableReadOnlyTools: true,
        enableReadWriteTools: false,
      });

      const tools = readonlyServer.getTools();
      expect(tools).toHaveLength(8);
      expect(tools.map((t: any) => t.name)).toContain("zk_search_notes");
      expect(tools.map((t: any) => t.name)).toContain("zk_get_note");
      expect(tools.map((t: any) => t.name)).toContain("zk_get_backlinks");
      expect(tools.map((t: any) => t.name)).toContain("zk_find_path");
      expect(tools.map((t: any) => t.name)).toContain("zk_glow_ranking");
      expect(tools.map((t: any) => t.name)).toContain("zk_find_zombies");
      expect(tools.map((t: any) => t.name)).toContain("zk_search_archived");
      expect(tools.map((t: any) => t.name)).toContain("zk_get_archive_log");
    });

    it("读写服务器应该返回15个工具", () => {
      const rwServer = new ZettelkastenMCPServer(mockDb, "/test/path", {
        dbPath: "/test/db.sqlite",
        notesBaseDir: "/test/notes",
        enableReadOnlyTools: true,
        enableReadWriteTools: true,
        llmProvider: mockLLMProvider as any,
      });

      const tools = rwServer.getTools();
      expect(tools).toHaveLength(16);
      expect(tools.map((t: any) => t.name)).toContain("zk_search_notes");
      expect(tools.map((t: any) => t.name)).toContain("zk_create_note");
      expect(tools.map((t: any) => t.name)).toContain("zk_update_note");
      expect(tools.map((t: any) => t.name)).toContain("zk_run_ceqrc_workflow");
      expect(tools.map((t: any) => t.name)).toContain("zk_distill_memory");
      expect(tools.map((t: any) => t.name)).toContain("zk_get_inbox_queue");
      expect(tools.map((t: any) => t.name)).toContain("zk_review_note");
      expect(tools.map((t: any) => t.name)).toContain("zk_glow_ranking");
      expect(tools.map((t: any) => t.name)).toContain("zk_find_zombies");
      expect(tools.map((t: any) => t.name)).toContain("zk_search_archived");
      expect(tools.map((t: any) => t.name)).toContain("zk_archive_note");
      expect(tools.map((t: any) => t.name)).toContain("zk_unarchive_note");
    });

    it("完全禁用的服务器应该返回0个工具", () => {
      const disabledServer = new ZettelkastenMCPServer(mockDb, "/test/path", {
        dbPath: "/test/db.sqlite",
        notesBaseDir: "/test/notes",
        enableReadOnlyTools: false,
        enableReadWriteTools: false,
      });

      const tools = disabledServer.getTools();
      expect(tools).toHaveLength(0);
    });

    it("工具应该有正确的描述", () => {
      const descServer = new ZettelkastenMCPServer(mockDb, "/test/path", {
        dbPath: "/test/db.sqlite",
        notesBaseDir: "/test/notes",
        enableReadOnlyTools: true,
        enableReadWriteTools: true,
        llmProvider: mockLLMProvider as any,
      });

      const tools = descServer.getTools();
      const searchTool = tools.find((t: any) => t.name === "zk_search_notes");
      expect(searchTool?.description).toBe("搜索 Zettelkasten 笔记");
    });

    it("工具应该有正确的输入模式", () => {
      const schemaServer = new ZettelkastenMCPServer(mockDb, "/test/path", {
        dbPath: "/test/db.sqlite",
        notesBaseDir: "/test/notes",
        enableReadOnlyTools: true,
        enableReadWriteTools: true,
        llmProvider: mockLLMProvider as any,
      });

      const tools = schemaServer.getTools();
      const createTool = tools.find((t: any) => t.name === "zk_create_note");
      expect(createTool?.inputSchema).toBeDefined();
      expect(createTool?.inputSchema.properties).toHaveProperty("title");
      expect(createTool?.inputSchema.properties).toHaveProperty("content");
      expect(createTool?.inputSchema.required).toContain("title");
      expect(createTool?.inputSchema.required).toContain("content");
    });
  });

  describe("工具调用 - 只读工具", () => {
    let roServer: ZettelkastenMCPServer;

    beforeEach(() => {
      roServer = new ZettelkastenMCPServer(mockDb, "/test/path", {
        dbPath: "/test/db.sqlite",
        notesBaseDir: "/test/notes",
        enableReadOnlyTools: true,
        enableReadWriteTools: false,
      });
    });

    it("zk_search_notes 应该抛出错误当只读工具被禁用", async () => {
      const disabledServer = new ZettelkastenMCPServer(mockDb, "/test/path", {
        dbPath: "/test/db.sqlite",
        notesBaseDir: "/test/notes",
        enableReadOnlyTools: false,
        enableReadWriteTools: false,
      });

      await expect(disabledServer.searchNotes("test")).rejects.toThrow("Read-only tools are disabled");
    });
  });
});
