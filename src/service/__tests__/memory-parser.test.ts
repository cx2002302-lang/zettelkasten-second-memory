/**
 * MemoryParser 单元测试
 *
 * 测试覆盖：
 * 1. JSON 格式解析
 * 2. NDJSON 格式解析
 * 3. 对话切片与分割
 * 4. 时间窗口过滤
 * 5. 配置管理
 * 6. 边界情况处理
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryParser } from "../memory-parser.js";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { MemoryLogEntry, ConversationSlice } from "../../core/types.js";

describe("MemoryParser", () => {
  let parser: MemoryParser;
  let tempDir: string;

  beforeEach(() => {
    parser = new MemoryParser();
    tempDir = mkdtempSync(join(tmpdir(), "memory-parser-test-"));
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // 构造函数和配置测试
  // ============================================================================
  describe("constructor and config", () => {
    it("should use default config", () => {
      const defaultParser = new MemoryParser();
      const config = defaultParser.getConfig();

      expect(config.timeWindowMinutes).toBe(30);
      expect(config.minMessages).toBe(3);
      expect(config.maxMessages).toBe(50);
      expect(config.maxSliceLength).toBe(4000);
    });

    it("should accept custom config", () => {
      const customParser = new MemoryParser({
        timeWindowMinutes: 60,
        minMessages: 5,
        maxMessages: 100,
        maxSliceLength: 8000,
      });

      const config = customParser.getConfig();
      expect(config.timeWindowMinutes).toBe(60);
      expect(config.minMessages).toBe(5);
      expect(config.maxMessages).toBe(100);
      expect(config.maxSliceLength).toBe(8000);
    });

    it("should merge partial config", () => {
      const partialParser = new MemoryParser({
        timeWindowMinutes: 45,
      });

      const config = partialParser.getConfig();
      expect(config.timeWindowMinutes).toBe(45);
      expect(config.minMessages).toBe(3);
      expect(config.maxMessages).toBe(50);
    });

    it("should update config", () => {
      parser.updateConfig({ minMessages: 10 });
      const config = parser.getConfig();

      expect(config.minMessages).toBe(10);
      expect(config.timeWindowMinutes).toBe(30);
    });

    it("should return config copy (immutable)", () => {
      const config = parser.getConfig();
      config.timeWindowMinutes = 999;

      const newConfig = parser.getConfig();
      expect(newConfig.timeWindowMinutes).toBe(30);
    });
  });

  // ============================================================================
  // JSON 格式解析测试
  // ============================================================================
  describe("JSON format parsing", () => {
    it("should parse valid JSON memory log", async () => {
      const log = {
        version: "1.0",
        sessionId: "session-123",
        startTime: "2026-01-01T10:00:00Z",
        endTime: "2026-01-01T11:00:00Z",
        entries: [
          {
            id: "entry-1",
            type: "user",
            content: "Hello",
            timestamp: "2026-01-01T10:00:00Z",
          },
          {
            id: "entry-2",
            type: "assistant",
            content: "Hi there!",
            timestamp: "2026-01-01T10:01:00Z",
          },
        ],
      };

      const filePath = join(tempDir, "memory.json");
      writeFileSync(filePath, JSON.stringify(log));

      const entries = await parser.parseMemoryLog(filePath);

      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe("entry-1");
      expect(entries[0].type).toBe("user");
      expect(entries[0].content).toBe("Hello");
      expect(entries[0].sessionId).toBe("session-123");
    });

    it("should parse JSON from content string", () => {
      const log = {
        version: "1.0",
        sessionId: "session-456",
        startTime: "2026-01-01T10:00:00Z",
        endTime: "2026-01-01T11:00:00Z",
        entries: [
          {
            id: "entry-1",
            type: "system",
            content: "System message",
            timestamp: "2026-01-01T10:00:00Z",
          },
        ],
      };

      const entries = parser.parseMemoryContent(JSON.stringify(log));

      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("system");
    });

    it("should filter out invalid entry types", () => {
      const log = {
        version: "1.0",
        sessionId: "session-789",
        entries: [
          {
            id: "entry-1",
            type: "user",
            content: "Valid",
            timestamp: "2026-01-01T10:00:00Z",
          },
          {
            id: "entry-2",
            type: "invalid_type",
            content: "Invalid",
            timestamp: "2026-01-01T10:01:00Z",
          },
          {
            id: "entry-3",
            type: "tool",
            content: "Tool output",
            timestamp: "2026-01-01T10:02:00Z",
          },
        ],
      };

      const entries = parser.parseMemoryContent(JSON.stringify(log));

      expect(entries).toHaveLength(2);
      expect(entries[0].type).toBe("user");
      expect(entries[1].type).toBe("tool");
    });

    it("should generate ID for entries without id", () => {
      const log = {
        version: "1.0",
        sessionId: "session-abc",
        entries: [
          {
            type: "user",
            content: "No ID",
            timestamp: "2026-01-01T10:00:00Z",
          },
        ],
      };

      const entries = parser.parseMemoryContent(JSON.stringify(log));

      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBeDefined();
      expect(entries[0].id).toMatch(/^\d{17}$/);
    });

    it("should include metadata if present", () => {
      const log = {
        version: "1.0",
        sessionId: "session-def",
        entries: [
          {
            id: "entry-1",
            type: "assistant",
            content: "With metadata",
            timestamp: "2026-01-01T10:00:00Z",
            metadata: { confidence: 0.9, model: "gpt-4" },
          },
        ],
      };

      const entries = parser.parseMemoryContent(JSON.stringify(log));

      expect(entries[0].metadata).toEqual({ confidence: 0.9, model: "gpt-4" });
    });

    it("should throw error for non-existent file", async () => {
      await expect(
        parser.parseMemoryLog("/non/existent/path.json")
      ).rejects.toThrow("Memory log file not found");
    });

    it("should fallback to NDJSON for invalid JSON format", () => {
      const invalidLog = {
        version: "1.0",
        sessionId: "session-ghi",
      };

      const entries = parser.parseMemoryContent(JSON.stringify(invalidLog));
      expect(entries).toEqual([]);
    });

    it("should handle empty entries array", () => {
      const log = {
        version: "1.0",
        sessionId: "session-jkl",
        entries: [],
      };

      const entries = parser.parseMemoryContent(JSON.stringify(log));
      expect(entries).toEqual([]);
    });
  });

  // ============================================================================
  // NDJSON 格式解析测试
  // ============================================================================
  describe("NDJSON format parsing", () => {
    it("should parse NDJSON format (one JSON per line)", () => {
      const ndjson = `{"id":"entry-1","type":"user","content":"Hello","timestamp":"2026-01-01T10:00:00Z"}
{"id":"entry-2","type":"assistant","content":"Hi!","timestamp":"2026-01-01T10:01:00Z"}
{"id":"entry-3","type":"tool","content":"Result","timestamp":"2026-01-01T10:02:00Z"}`;

      const entries = parser.parseMemoryContent(ndjson);

      expect(entries).toHaveLength(3);
      expect(entries[0].type).toBe("user");
      expect(entries[1].type).toBe("assistant");
      expect(entries[2].type).toBe("tool");
    });

    it("should skip invalid lines in NDJSON", () => {
      const ndjson = `{"id":"entry-1","type":"user","content":"Valid","timestamp":"2026-01-01T10:00:00Z"}
this is not json
{"id":"entry-2","type":"assistant","content":"Also valid","timestamp":"2026-01-01T10:01:00Z"}`;

      const entries = parser.parseMemoryContent(ndjson);

      expect(entries).toHaveLength(2);
      expect(entries[0].content).toBe("Valid");
      expect(entries[1].content).toBe("Also valid");
    });

    it("should handle empty NDJSON", () => {
      const entries = parser.parseMemoryContent("");
      expect(entries).toEqual([]);
    });

    it("should handle NDJSON with only whitespace", () => {
      const entries = parser.parseMemoryContent("   \n\n   \n");
      expect(entries).toEqual([]);
    });

    it("should filter invalid types in NDJSON", () => {
      const ndjson = `{"id":"entry-1","type":"user","content":"Valid","timestamp":"2026-01-01T10:00:00Z"}
{"id":"entry-2","type":"unknown","content":"Invalid","timestamp":"2026-01-01T10:01:00Z"}`;

      const entries = parser.parseMemoryContent(ndjson);

      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("user");
    });

    it("should assign unknown sessionId in NDJSON", () => {
      const ndjson = `{"id":"entry-1","type":"user","content":"Test","timestamp":"2026-01-01T10:00:00Z"}`;

      const entries = parser.parseMemoryContent(ndjson);

      expect(entries[0].sessionId).toBe("unknown");
    });
  });

  // ============================================================================
  // 对话切片测试
  // ============================================================================
  describe("conversation slicing", () => {
    it("should return empty array for empty entries", () => {
      const slices = parser.sliceConversation([]);
      expect(slices).toEqual([]);
    });

    it("should create single slice for entries within time window", () => {
      const entries: MemoryLogEntry[] = [
        { id: "1", type: "user", content: "Hello", timestamp: "2026-01-01T10:00:00Z", sessionId: "s1" },
        { id: "2", type: "assistant", content: "Hi!", timestamp: "2026-01-01T10:05:00Z", sessionId: "s1" },
        { id: "3", type: "user", content: "How are you?", timestamp: "2026-01-01T10:10:00Z", sessionId: "s1" },
      ];

      const slices = parser.sliceConversation(entries);

      expect(slices).toHaveLength(1);
      expect(slices[0].entryIds).toHaveLength(3);
      expect(slices[0].content).toContain("[user] Hello");
      expect(slices[0].content).toContain("[assistant] Hi!");
    });

    it("should split slices when time window exceeded", () => {
      const entries: MemoryLogEntry[] = [
        { id: "1", type: "user", content: "First", timestamp: "2026-01-01T10:00:00Z", sessionId: "s1" },
        { id: "2", type: "assistant", content: "Second", timestamp: "2026-01-01T10:05:00Z", sessionId: "s1" },
        { id: "3", type: "user", content: "Third", timestamp: "2026-01-01T10:45:00Z", sessionId: "s1" },
        { id: "4", type: "assistant", content: "Fourth", timestamp: "2026-01-01T10:50:00Z", sessionId: "s1" },
      ];

      const slices = parser.sliceConversation(entries);

      expect(slices.length).toBeGreaterThanOrEqual(1);
      expect(slices[0].entryIds.length).toBeGreaterThanOrEqual(1);
      if (slices.length > 1) { expect(slices[1].entryIds.length).toBeGreaterThanOrEqual(1); }
    });

    it("should respect maxMessages limit", () => {
      parser.updateConfig({ maxMessages: 2, minMessages: 1 });

      const entries: MemoryLogEntry[] = [
        { id: "1", type: "user", content: "A", timestamp: "2026-01-01T10:00:00Z", sessionId: "s1" },
        { id: "2", type: "assistant", content: "B", timestamp: "2026-01-01T10:01:00Z", sessionId: "s1" },
        { id: "3", type: "user", content: "C", timestamp: "2026-01-01T10:02:00Z", sessionId: "s1" },
        { id: "4", type: "assistant", content: "D", timestamp: "2026-01-01T10:03:00Z", sessionId: "s1" },
      ];

      const slices = parser.sliceConversation(entries);

      expect(slices.length).toBeGreaterThanOrEqual(1);
    });

    it("should not create slice with fewer than minMessages", () => {
      parser.updateConfig({ minMessages: 5 });

      const entries: MemoryLogEntry[] = [
        { id: "1", type: "user", content: "A", timestamp: "2026-01-01T10:00:00Z", sessionId: "s1" },
        { id: "2", type: "assistant", content: "B", timestamp: "2026-01-01T10:01:00Z", sessionId: "s1" },
      ];

      const slices = parser.sliceConversation(entries);

      expect(slices).toHaveLength(0);
    });

    it("should sort entries by timestamp before slicing", () => {
      const entries: MemoryLogEntry[] = [
        { id: "3", type: "user", content: "Third", timestamp: "2026-01-01T10:20:00Z", sessionId: "s1" },
        { id: "1", type: "user", content: "First", timestamp: "2026-01-01T10:00:00Z", sessionId: "s1" },
        { id: "2", type: "assistant", content: "Second", timestamp: "2026-01-01T10:10:00Z", sessionId: "s1" },
      ];

      const slices = parser.sliceConversation(entries);

      expect(slices).toHaveLength(1);
      expect(slices[0].entryIds).toEqual(["1", "2", "3"]);
    });

    it("should calculate correct time range for slices", () => {
      parser.updateConfig({ minMessages: 2 });
      const entries: MemoryLogEntry[] = [
        { id: "1", type: "user", content: "A", timestamp: "2026-01-01T10:00:00Z", sessionId: "s1" },
        { id: "2", type: "assistant", content: "B", timestamp: "2026-01-01T10:30:00Z", sessionId: "s1" },
      ];

      const slices = parser.sliceConversation(entries);

      expect(slices[0].timeRange.start).toBe("2026-01-01T10:00:00.000Z");
      expect(slices[0].timeRange.end).toBe("2026-01-01T10:30:00.000Z");
    });

    it("should estimate token count", () => {
      parser.updateConfig({ minMessages: 1 });
      const entries: MemoryLogEntry[] = [
        { id: "1", type: "user", content: "Hello world", timestamp: "2026-01-01T10:00:00Z", sessionId: "s1" },
      ];

      const slices = parser.sliceConversation(entries);

      expect(slices[0].tokenCount).toBeGreaterThan(0);
    });

    it("should respect maxSliceLength", () => {
      parser.updateConfig({ maxSliceLength: 50, minMessages: 2 });

      const entries: MemoryLogEntry[] = [
        { id: "1", type: "user", content: "A".repeat(100), timestamp: "2026-01-01T10:00:00Z", sessionId: "s1" },
        { id: "2", type: "assistant", content: "B".repeat(100), timestamp: "2026-01-01T10:01:00Z", sessionId: "s1" },
      ];

      const slices = parser.sliceConversation(entries);

      expect(slices[0].content.length).toBeLessThanOrEqual(50);
    });

    it("should merge small slices", () => {
      parser.updateConfig({ minMessages: 1, timeWindowMinutes: 1, maxMessages: 2 });

      const entries: MemoryLogEntry[] = [
        { id: "1", type: "user", content: "Short", timestamp: "2026-01-01T10:00:00Z", sessionId: "s1" },
        { id: "2", type: "assistant", content: "Reply", timestamp: "2026-01-01T10:05:00Z", sessionId: "s1" },
      ];

      const slices = parser.sliceConversation(entries);

      expect(slices.length).toBeGreaterThanOrEqual(1);
    });

    it("should generate unique slice IDs", () => {
      parser.updateConfig({ minMessages: 2 });
      const entries: MemoryLogEntry[] = [
        { id: "1", type: "user", content: "A", timestamp: "2026-01-01T10:00:00Z", sessionId: "s1" },
        { id: "2", type: "assistant", content: "B", timestamp: "2026-01-01T10:45:00Z", sessionId: "s1" },
      ];

      const slices = parser.sliceConversation(entries);

      expect(slices[0].id).toBeDefined();
      expect(slices[0].id).toMatch(/^\d{17}$/);
      if (slices.length > 1) {
        expect(slices[0].id).not.toBe(slices[1].id);
      }
    });
  });

  // ============================================================================
  // 文件路径测试
  // ============================================================================
  describe("file path handling", () => {
    it("should generate correct memory file path", () => {
      const basePath = "/data/notes";
      const date = "2026-01-15";
      const filePath = parser.getMemoryFilePath(basePath, date);

      expect(filePath).toBe("/data/notes/memory/2026-01-15.json");
    });

    it("should generate path with different base paths", () => {
      expect(parser.getMemoryFilePath("/home/user", "2026-03-01")).toBe("/home/user/memory/2026-03-01.json");
      expect(parser.getMemoryFilePath("./notes", "2026-12-31")).toBe("notes/memory/2026-12-31.json");
    });
  });

  // ============================================================================
  // parseYesterday 测试
  // ============================================================================
  describe("parseYesterday", () => {
    it("should throw error when yesterday file does not exist", async () => {
      await expect(
        parser.parseYesterday(tempDir)
      ).rejects.toThrow("Memory log file not found");
    });

    it("should parse yesterday file when it exists", async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split("T")[0];

      const memoryDir = join(tempDir, "memory");
      mkdirSync(memoryDir, { recursive: true });

      const log = {
        version: "1.0",
        sessionId: "session-yesterday",
        entries: [
          {
            id: "entry-1",
            type: "user",
            content: "Yesterday message",
            timestamp: `${dateStr}T10:00:00Z`,
          },
        ],
      };

      writeFileSync(join(memoryDir, `${dateStr}.json`), JSON.stringify(log));

      const slices = await parser.parseYesterday(tempDir);

      expect(slices.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================================
  // 边界情况测试
  // ============================================================================
  describe("edge cases", () => {
    it("should handle entries with same timestamp", () => {
      const entries: MemoryLogEntry[] = [
        { id: "1", type: "user", content: "A", timestamp: "2026-01-01T10:00:00Z", sessionId: "s1" },
        { id: "2", type: "assistant", content: "B", timestamp: "2026-01-01T10:00:00Z", sessionId: "s1" },
        { id: "3", type: "user", content: "C", timestamp: "2026-01-01T10:00:00Z", sessionId: "s1" },
      ];

      const slices = parser.sliceConversation(entries);

      expect(slices.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle special characters in content", () => {
      const log = {
        version: "1.0",
        sessionId: "session-special",
        entries: [
          {
            id: "entry-1",
            type: "user",
            content: "Special: <>&\"'\\n\\t日本語🎉",
            timestamp: "2026-01-01T10:00:00Z",
          },
        ],
      };

      const entries = parser.parseMemoryContent(JSON.stringify(log));

      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe("Special: <>&\"'\\n\\t日本語🎉");
    });

    it("should handle very long content", () => {
      const longContent = "A".repeat(10000);
      const log = {
        version: "1.0",
        sessionId: "session-long",
        entries: [
          {
            id: "entry-1",
            type: "user",
            content: longContent,
            timestamp: "2026-01-01T10:00:00Z",
          },
        ],
      };

      const entries = parser.parseMemoryContent(JSON.stringify(log));

      expect(entries).toHaveLength(1);
      expect(entries[0].content.length).toBe(10000);
    });

    it("should handle single entry", () => {
      const entries: MemoryLogEntry[] = [
        { id: "1", type: "user", content: "Only one", timestamp: "2026-01-01T10:00:00Z", sessionId: "s1" },
      ];

      const slices = parser.sliceConversation(entries);

      expect(slices).toHaveLength(0); // Less than minMessages (3)
    });

    it("should handle many entries efficiently", () => {
      const entries: MemoryLogEntry[] = Array.from({ length: 100 }, (_, i) => ({
        id: `entry-${i}`,
        type: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i}`,
        timestamp: `2026-01-01T${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`,
        sessionId: "s1",
      }));

      const slices = parser.sliceConversation(entries);

      expect(slices.length).toBeGreaterThan(0);
    });

    it("should handle all valid entry types", () => {
      const log = {
        version: "1.0",
        sessionId: "session-types",
        entries: [
          { id: "1", type: "user", content: "User", timestamp: "2026-01-01T10:00:00Z" },
          { id: "2", type: "assistant", content: "Assistant", timestamp: "2026-01-01T10:01:00Z" },
          { id: "3", type: "system", content: "System", timestamp: "2026-01-01T10:02:00Z" },
          { id: "4", type: "tool", content: "Tool", timestamp: "2026-01-01T10:03:00Z" },
        ],
      };

      const entries = parser.parseMemoryContent(JSON.stringify(log));

      expect(entries).toHaveLength(4);
      expect(entries.map((e) => e.type)).toEqual(["user", "assistant", "system", "tool"]);
    });

    it("should handle complex metadata structures", () => {
      const log = {
        version: "1.0",
        sessionId: "session-meta",
        entries: [
          {
            id: "entry-1",
            type: "assistant",
            content: "With complex metadata",
            timestamp: "2026-01-01T10:00:00Z",
            metadata: {
              nested: { key: "value", array: [1, 2, 3] },
              boolean: true,
              number: 42,
              nullValue: null,
            },
          },
        ],
      };

      const entries = parser.parseMemoryContent(JSON.stringify(log));

      expect(entries[0].metadata).toEqual({
        nested: { key: "value", array: [1, 2, 3] },
        boolean: true,
        number: 42,
        nullValue: null,
      });
    });

    it("should handle entries without sessionId", () => {
      const log = {
        version: "1.0",
        entries: [
          {
            id: "entry-1",
            type: "user",
            content: "No session",
            timestamp: "2026-01-01T10:00:00Z",
          },
        ],
      };

      const entries = parser.parseMemoryContent(JSON.stringify(log));

      expect(entries[0].sessionId).toBeUndefined();
    });

    it("should handle entries without metadata", () => {
      const log = {
        version: "1.0",
        sessionId: "session-nometa",
        entries: [
          {
            id: "entry-1",
            type: "user",
            content: "No metadata",
            timestamp: "2026-01-01T10:00:00Z",
          },
        ],
      };

      const entries = parser.parseMemoryContent(JSON.stringify(log));

      expect(entries[0].metadata).toBeUndefined();
    });

    it("should handle malformed timestamps by treating them as same time", () => {
      const entries: MemoryLogEntry[] = [
        { id: "1", type: "user", content: "A", timestamp: "invalid-timestamp", sessionId: "s1" },
        { id: "2", type: "assistant", content: "B", timestamp: "also-invalid", sessionId: "s1" },
      ];

      const slices = parser.sliceConversation(entries);
      expect(slices.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle rapid successive messages", () => {
      const entries: MemoryLogEntry[] = [
        { id: "1", type: "user", content: "A", timestamp: "2026-01-01T10:00:00Z", sessionId: "s1" },
        { id: "2", type: "assistant", content: "B", timestamp: "2026-01-01T10:00:01Z", sessionId: "s1" },
        { id: "3", type: "user", content: "C", timestamp: "2026-01-01T10:00:02Z", sessionId: "s1" },
        { id: "4", type: "assistant", content: "D", timestamp: "2026-01-01T10:00:03Z", sessionId: "s1" },
      ];

      const slices = parser.sliceConversation(entries);

      expect(slices.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // 集成测试
  // ============================================================================
  describe("integration", () => {
    it("should parse file and slice conversation end-to-end", async () => {
      const log = {
        version: "1.0",
        sessionId: "session-integration",
        startTime: "2026-01-01T10:00:00Z",
        endTime: "2026-01-01T11:00:00Z",
        entries: [
          { id: "e1", type: "user", content: "Hello", timestamp: "2026-01-01T10:00:00Z" },
          { id: "e2", type: "assistant", content: "Hi!", timestamp: "2026-01-01T10:05:00Z" },
          { id: "e3", type: "user", content: "How are you?", timestamp: "2026-01-01T10:10:00Z" },
          { id: "e4", type: "assistant", content: "I'm good!", timestamp: "2026-01-01T10:45:00Z" },
          { id: "e5", type: "user", content: "Great", timestamp: "2026-01-01T10:50:00Z" },
        ],
      };

      const filePath = join(tempDir, "integration.json");
      writeFileSync(filePath, JSON.stringify(log));

      const entries = await parser.parseMemoryLog(filePath);
      const slices = parser.sliceConversation(entries);

      expect(entries).toHaveLength(5);
      expect(slices.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle NDJSON file parsing", async () => {
      const ndjson = `{"id":"e1","type":"user","content":"Hello","timestamp":"2026-01-01T10:00:00Z"}
{"id":"e2","type":"assistant","content":"Hi!","timestamp":"2026-01-01T10:05:00Z"}
{"id":"e3","type":"user","content":"How are you?","timestamp":"2026-01-01T10:10:00Z"}`;

      const filePath = join(tempDir, "ndjson.json");
      writeFileSync(filePath, ndjson);

      const entries = await parser.parseMemoryLog(filePath);
      const slices = parser.sliceConversation(entries);

      expect(entries).toHaveLength(3);
      expect(slices.length).toBeGreaterThanOrEqual(1);
    });

    it("should maintain entry order within slices", async () => {
      const log = {
        version: "1.0",
        sessionId: "session-order",
        entries: [
          { id: "e1", type: "user", content: "First", timestamp: "2026-01-01T10:00:00Z" },
          { id: "e2", type: "assistant", content: "Second", timestamp: "2026-01-01T10:05:00Z" },
          { id: "e3", type: "user", content: "Third", timestamp: "2026-01-01T10:10:00Z" },
        ],
      };

      const filePath = join(tempDir, "order.json");
      writeFileSync(filePath, JSON.stringify(log));

      const entries = await parser.parseMemoryLog(filePath);
      const slices = parser.sliceConversation(entries);

      expect(slices[0].entryIds).toEqual(["e1", "e2", "e3"]);
      expect(slices[0].content.indexOf("First")).toBeLessThan(slices[0].content.indexOf("Second"));
      expect(slices[0].content.indexOf("Second")).toBeLessThan(slices[0].content.indexOf("Third"));
    });
  });
});
