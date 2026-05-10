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
import { join } from "node:path";
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
   * 解析 memory 日志文件
   * @param filePath 日志文件路径
   * @returns 解析后的对话条目列表
   */
  async parseMemoryLog(filePath: string): Promise<MemoryLogEntry[]> {
    if (!existsSync(filePath)) {
      throw new Error(`Memory log file not found: ${filePath}`);
    }

    const content = await readFile(filePath, "utf-8");
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
   * @returns 文件路径
   */
  getMemoryFilePath(basePath: string, date: string): string {
    return join(basePath, "memory", `${date}.json`);
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