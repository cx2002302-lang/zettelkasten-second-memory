/**
 * MemoryParser - OpenClaw Memory 日志解析器
 *
 * 职责：
 * 1. 解析 OpenClaw memory 系统导出的日志格式
 * 2. 对话切片与分割
 * 3. 提取有意义的对话片段
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import type {
  MemoryLogEntry,
  MemoryLogEntryType,
  ConversationSlice,
  MemoryParserConfig,
} from "../core/types.js";
import { generateZettelId } from "../core/utils.js";

/** 默认配置 */
const DEFAULT_CONFIG: MemoryParserConfig = {
  timeWindowMinutes: 30,
  minMessages: 3,
  maxMessages: 50,
  maxSliceLength: 4000,
};

/** OpenClaw Memory 日志格式 */
interface OpenClawMemoryLog {
  version: string;
  sessionId: string;
  startTime: string;
  endTime: string;
  entries: Array<{
    id: string;
    type: string;
    content: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
  }>;
}

export class MemoryParser {
  private config: MemoryParserConfig;

  constructor(config: Partial<MemoryParserConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 解析 memory 日志文件（支持 .json 和 .md 格式）
   * @param filePath 日志文件路径
   * @returns 解析后的对话条目列表
   */
  async parseMemoryLog(filePath: string): Promise<MemoryLogEntry[]> {
    // 如果指定的是 .json 但文件不存在，尝试 .md
    if (!existsSync(filePath) && filePath.endsWith(".json")) {
      const mdPath = filePath.replace(/\.json$/, ".md");
      if (existsSync(mdPath)) {
        const content = await readFile(mdPath, "utf-8");
        return this.parseMemoryMarkdownContent(content);
      }
    }

    if (!existsSync(filePath)) {
      throw new Error(`Memory log file not found: ${filePath}`);
    }

    const content = await readFile(filePath, "utf-8");
    const ext = extname(filePath).toLowerCase();

    // 根据文件扩展名选择解析器
    if (ext === ".md") {
      return this.parseMemoryMarkdownContent(content);
    }

    return this.parseMemoryContent(content);
  }

  /**
   * 解析 memory 日志内容
   * @param content 日志内容字符串
   * @returns 解析后的对话条目列表
   */
  parseMemoryContent(content: string): MemoryLogEntry[] {
    try {
      const log = JSON.parse(content) as OpenClawMemoryLog;

      if (!log.entries || !Array.isArray(log.entries)) {
        throw new Error("Invalid memory log format: entries array not found");
      }

      return log.entries
        .map((entry) => this.convertToMemoryLogEntry(entry, log.sessionId))
        .filter((entry): entry is MemoryLogEntry => entry !== null);
    } catch (error) {
      // 尝试按行解析 NDJSON 格式
      return this.parseNDJSON(content);
    }
  }

  /**
   * 将 OpenClaw 条目转换为标准格式
   */
  private convertToMemoryLogEntry(
    entry: OpenClawMemoryLog["entries"][0],
    sessionId: string
  ): MemoryLogEntry | null {
    const validTypes: MemoryLogEntryType[] = ["user", "assistant", "system", "tool"];
    const type = entry.type as MemoryLogEntryType;

    if (!validTypes.includes(type)) {
      return null;
    }

    return {
      id: entry.id || generateZettelId(),
      type,
      content: entry.content,
      timestamp: entry.timestamp,
      sessionId,
      metadata: entry.metadata,
    };
  }

  /**
   * 解析 NDJSON 格式（每行一个JSON对象）
   */
  private parseNDJSON(content: string): MemoryLogEntry[] {
    const entries: MemoryLogEntry[] = [];
    const lines = content.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as OpenClawMemoryLog["entries"][0];
        const converted = this.convertToMemoryLogEntry(entry, "unknown");
        if (converted) {
          entries.push(converted);
        }
      } catch {
        // 跳过无法解析的行
      }
    }

    return entries;
  }

  /**
   * 对话切片 - 将连续的对话切分成有意义的片段
   * @param entries 对话条目列表
   * @returns 对话切片列表
   */
  sliceConversation(entries: MemoryLogEntry[]): ConversationSlice[] {
    if (entries.length === 0) {
      return [];
    }

    // 按时间排序
    const sorted = [...entries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const slices: ConversationSlice[] = [];
    let currentSlice: MemoryLogEntry[] = [];
    let lastTimestamp: Date | null = null;

    const timeWindowMs = this.config.timeWindowMinutes * 60 * 1000;

    for (const entry of sorted) {
      const entryTime = new Date(entry.timestamp);

      // 检查是否需要开始新的切片
      const shouldStartNewSlice =
        lastTimestamp !== null &&
        (entryTime.getTime() - lastTimestamp.getTime() > timeWindowMs ||
          currentSlice.length >= this.config.maxMessages);

      if (shouldStartNewSlice && currentSlice.length >= this.config.minMessages) {
        slices.push(this.createSlice(currentSlice));
        currentSlice = [];
      }

      currentSlice.push(entry);
      lastTimestamp = entryTime;
    }

    // 处理最后一个切片
    if (currentSlice.length >= this.config.minMessages) {
      slices.push(this.createSlice(currentSlice));
    }

    return this.mergeSmallSlices(slices);
  }

  /**
   * 创建切片对象
   */
  private createSlice(entries: MemoryLogEntry[]): ConversationSlice {
    const content = entries
      .map((e) => `[${e.type}] ${e.content}`)
      .join("\n\n");

    const timestamps = entries.map((e) => new Date(e.timestamp).getTime());
    const startTime = new Date(Math.min(...timestamps)).toISOString();
    const endTime = new Date(Math.max(...timestamps)).toISOString();

    // 简单估算token数量（约4字符=1token）
    const tokenCount = Math.ceil(content.length / 4);

    return {
      id: generateZettelId(),
      entryIds: entries.map((e) => e.id),
      content: content.slice(0, this.config.maxSliceLength),
      timeRange: { start: startTime, end: endTime },
      tokenCount,
    };
  }

  /**
   * 合并过小的切片
   */
  private mergeSmallSlices(slices: ConversationSlice[]): ConversationSlice[] {
    if (slices.length <= 1) {
      return slices;
    }

    const merged: ConversationSlice[] = [];
    let current = slices[0];

    for (let i = 1; i < slices.length; i++) {
      const next = slices[i];
      const currentTokens = current.tokenCount || 0;
      const nextTokens = next.tokenCount || 0;

      // 如果当前切片太小，尝试合并
      if (currentTokens < 100 && currentTokens + nextTokens < this.config.maxSliceLength / 4) {
        current = this.mergeTwoSlices(current, next);
      } else {
        merged.push(current);
        current = next;
      }
    }

    merged.push(current);
    return merged;
  }

  /**
   * 合并两个切片
   */
  private mergeTwoSlices(a: ConversationSlice, b: ConversationSlice): ConversationSlice {
    return {
      id: generateZettelId(),
      entryIds: [...a.entryIds, ...b.entryIds],
      content: `${a.content}\n\n${b.content}`.slice(0, this.config.maxSliceLength),
      timeRange: {
        start: a.timeRange.start,
        end: b.timeRange.end,
      },
      tokenCount: ((a.tokenCount || 0) + (b.tokenCount || 0)),
    };
  }

  /**
   * 获取指定日期的 memory 日志文件路径
   * @param basePath 基础目录
   * @param date 日期字符串 (YYYY-MM-DD)
   * @returns 文件路径（优先 .json，回退 .md）
   */
  getMemoryFilePath(basePath: string, date: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD.`);
    }
    const jsonPath = join(basePath, "memory", `${date}.json`);
    if (existsSync(jsonPath)) return jsonPath;
    const mdPath = join(basePath, "memory", `${date}.md`);
    if (existsSync(mdPath)) return mdPath;
    return jsonPath; // 默认返回 .json，让调用方处理不存在的情况
  }

  /**
   * 解析 Markdown 格式的 memory 日志
   * 格式示例：
   * # Memory Log 2026-05-13
   * ## Entry 1
   * **Type**: user
   * **Time**: 2026-05-13T10:00:00Z
   * **Content**: ...
   *
   * ## Entry 2
   * ...
   */
  parseMemoryMarkdownContent(content: string): MemoryLogEntry[] {
    const entries: MemoryLogEntry[] = [];
    const sessionId = "md-" + generateZettelId();

    // 按二级标题分割条目
    const sections = content.split(/\n## /);

    for (const section of sections) {
      const lines = section.trim().split("\n");
      if (lines.length === 0) continue;

      // 第一个 section 可能是标题（不含 ##）
      let title = lines[0].trim();
      if (title.startsWith("# ")) {
        // 这是文档主标题，跳过
        continue;
      }
      // 去掉开头的 #
      title = title.replace(/^#+\s*/, "").trim();

      // 解析字段
      let entryType: MemoryLogEntryType = "user";
      let timestamp = new Date().toISOString();
      let entryContent = "";
      const metadata: Record<string, unknown> = {};

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("**Type**:") || line.startsWith("Type:")) {
          const t = line.split(":")[1]?.trim().toLowerCase() || "user";
          if (["user", "assistant", "system", "tool"].includes(t)) {
            entryType = t as MemoryLogEntryType;
          }
        } else if (line.startsWith("**Time**:") || line.startsWith("Time:")) {
          const t = line.split(":")[1]?.trim();
          if (t) timestamp = t;
        } else if (line.startsWith("**Content**:") || line.startsWith("Content:")) {
          entryContent = line.split(":")[1]?.trim() || "";
          // 收集后续行直到下一个字段或空行
          for (let j = i + 1; j < lines.length; j++) {
            const nextLine = lines[j];
            if (nextLine.trim().startsWith("**") || nextLine.trim().startsWith("## ")) break;
            entryContent += "\n" + nextLine;
          }
        } else if (line.startsWith("**")) {
          const match = line.match(/^\*\*(.+?)\*\*:\s*(.*)$/);
          if (match) {
            metadata[match[1].toLowerCase()] = match[2];
          }
        }
      }

      // 如果没有显式 Content 字段，将剩余文本作为内容
      if (!entryContent && lines.length > 1) {
        const bodyLines = lines.slice(1).filter((l) => !l.trim().startsWith("**"));
        entryContent = bodyLines.join("\n").trim();
      }

      // 跳过空条目
      if (!entryContent.trim() && title === "Memory Log") continue;

      entries.push({
        id: generateZettelId(),
        type: entryType,
        content: entryContent || title,
        timestamp,
        sessionId,
        metadata,
      });
    }

    // 如果按二级标题没解析出条目，尝试按段落分割
    if (entries.length === 0 && content.length > 0) {
      const paragraphs = content
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 20 && !p.startsWith("#"));

      for (const para of paragraphs) {
        entries.push({
          id: generateZettelId(),
          type: "user",
          content: para,
          timestamp: new Date().toISOString(),
          sessionId,
          metadata: {},
        });
      }
    }

    return entries;
  }

  /**
   * 解析昨天的 memory 日志
   * @param basePath 基础目录
   * @returns 对话切片列表
   */
  async parseYesterday(basePath: string): Promise<ConversationSlice[]> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];
    const filePath = this.getMemoryFilePath(basePath, dateStr);

    const entries = await this.parseMemoryLog(filePath);
    return this.sliceConversation(entries);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<MemoryParserConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): MemoryParserConfig {
    return { ...this.config };
  }
}