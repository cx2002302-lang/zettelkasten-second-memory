/**
 * DistillerService - 夜间蒸馏服务
 *
 * 职责：
 * 1. 批量处理 OpenClaw memory 日志
 * 2. 对话切片与摘要生成
 * 3. 两阶段去重流水线
 * 4. 置信度路由（高分→zettels，低分→inbox）
 * 5. 生成原子笔记
 */

import type {
  ConversationSlice,
  DistillSummary,
  DistillJob,
  LLMDedupeDecision,
  DistillerServiceConfig,
  LLMProvider,
  ZettelNote,
  CreateNoteParams,
  SourceType,
} from "../core/types.js";
import { generateZettelId, toISOString } from "../core/utils.js";
import { MemoryParser } from "./memory-parser.js";
import { DEFAULT_CONFIDENCE_THRESHOLD, MIN_CONFIDENCE_THRESHOLD, DEFAULT_SIMILARITY_THRESHOLD } from "../core/constants.js";
import { DedupeService } from "./dedupe-service.js";
import { NoteService } from "./note-service.js";
import { LinkService } from "./link-service.js";

/** 默认配置 */
const DEFAULT_CONFIG: DistillerServiceConfig = {
  highConfidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
  mediumConfidenceThreshold: MIN_CONFIDENCE_THRESHOLD,
  batchSize: 10,
  maxSliceTokens: 2000,
  nightModeEnabled: true,
};

export class DistillerService {
  private config: DistillerServiceConfig;
  private llmProvider: LLMProvider;
  private memoryParser: MemoryParser;
  private dedupeService: DedupeService;
  private noteService: NoteService;
  private linkService: LinkService;
  private jobs: Map<string, DistillJob> = new Map();

  constructor(
    llmProvider: LLMProvider,
    noteService: NoteService,
    linkService: LinkService,
    config: Partial<DistillerServiceConfig> = {}
  ) {
    this.llmProvider = llmProvider;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.memoryParser = new MemoryParser();
    this.dedupeService = new DedupeService(llmProvider);
    this.noteService = noteService;
    this.linkService = linkService;
  }

  /**
   * 执行夜间蒸馏批处理
   * @param memoryFilePath memory 日志文件路径
   * @param existingNotes 现有笔记列表（用于去重）
   * @returns 蒸馏作业结果
   */
  async distillMemoryFile(
    memoryFilePath: string,
    existingNotes: ZettelNote[]
  ): Promise<DistillJob> {
    const date = new Date().toISOString().split("T")[0];
    const job = this.createJob(date, memoryFilePath);

    try {
      job.status = "processing";
      job.startedAt = toISOString();

      // Step 1: 解析 memory 日志
      const entries = await this.memoryParser.parseMemoryLog(memoryFilePath);

      // Step 2: 对话切片
      const slices = this.memoryParser.sliceConversation(entries);
      job.sliceCount = slices.length;

      // Step 3: 生成摘要
      const summaries = await this.generateSummaries(slices);
      job.summaryCount = summaries.length;

      // Step 4: 两阶段去重
      const candidates = await this.dedupeService.deduplicate(summaries, existingNotes);

      // Step 5: 执行决策并创建笔记
      const results = await this.executeDecisions(candidates);

      const validDecisions = candidates
        .filter((c): c is typeof c & { llmDecision: NonNullable<typeof c.llmDecision> } => c.llmDecision != null)
        .map(c => c.llmDecision);
      job.decisions = validDecisions;
      job.createdCount = results.created;
      job.mergedCount = results.merged;
      job.skippedCount = results.skipped;
      job.status = "completed";
      job.completedAt = toISOString();
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    }

    return job;
  }

  /**
   * 蒸馏昨天的 memory 日志
   * @param basePath 基础目录
   * @param existingNotes 现有笔记列表
   * @returns 蒸馏作业结果
   */
  async distillYesterday(existingNotes: ZettelNote[]): Promise<DistillJob> {
    const slices = await this.memoryParser.parseYesterday(".");

    const date = new Date();
    date.setDate(date.getDate() - 1);
    const dateStr = date.toISOString().split("T")[0];

    const job = this.createJob(dateStr);

    try {
      job.status = "processing";
      job.startedAt = toISOString();
      job.sliceCount = slices.length;

      // 生成摘要
      const summaries = await this.generateSummaries(slices);
      job.summaryCount = summaries.length;

      // 两阶段去重
      const candidates = await this.dedupeService.deduplicate(summaries, existingNotes);

      // 执行决策
      const results = await this.executeDecisions(candidates);

      const validDecisions = candidates
        .filter((c): c is typeof c & { llmDecision: NonNullable<typeof c.llmDecision> } => c.llmDecision != null)
        .map(c => c.llmDecision);
      job.decisions = validDecisions;
      job.createdCount = results.created;
      job.mergedCount = results.merged;
      job.skippedCount = results.skipped;
      job.status = "completed";
      job.completedAt = toISOString();
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    }

    return job;
  }

  /**
   * 批量生成摘要
   * @param slices 对话切片列表
   * @returns 摘要列表
   */
  private async generateSummaries(slices: ConversationSlice[]): Promise<DistillSummary[]> {
    const summaries: DistillSummary[] = [];

    // 分批处理以避免过载
    for (let i = 0; i < slices.length; i += this.config.batchSize) {
      const batch = slices.slice(i, i + this.config.batchSize);
      const batchSummaries = await Promise.all(
        batch.map((slice) => this.generateSliceSummary(slice))
      );
      summaries.push(...batchSummaries);
    }

    return summaries;
  }

  /**
   * 为单个切片生成摘要
   * @param slice 对话切片
   * @returns 摘要结果
   */
  private async generateSliceSummary(slice: ConversationSlice): Promise<DistillSummary> {
    const summary = await this.llmProvider.generateSummary(
      slice.content,
      `Conversation from ${slice.timeRange.start} to ${slice.timeRange.end}`
    );

    return {
      ...summary,
      sliceId: slice.id,
    };
  }

  /**
   * 执行去重决策
   * @param candidates 去重候选列表
   * @returns 执行统计
   */
  private async executeDecisions(candidates: import("../core/types.js").DedupeCandidate[]): Promise<{
    created: number;
    merged: number;
    skipped: number;
    notes: ZettelNote[];
  }> {
    let created = 0;
    let merged = 0;
    let skipped = 0;
    const notes: ZettelNote[] = [];

    for (const candidate of candidates) {
      const decision = candidate.llmDecision;
      if (!decision) continue;

      switch (decision.decision) {
        case "CREATE": {
          const note = await this.createNoteFromSummary(candidate.summary);
          if (note) {
            notes.push(note);
            created++;
          }
          break;
        }
        case "MERGE": {
          if (decision.matchedNoteId) {
            await this.mergeWithExisting(candidate.summary, decision.matchedNoteId);
            merged++;
          }
          break;
        }
        case "SKIP": {
          skipped++;
          break;
        }
      }
    }

    return { created, merged, skipped, notes };
  }

  /**
   * 从摘要创建笔记
   * @param summary 摘要
   * @returns 创建的笔记
   */
  /**
   * 校验摘要内容质量，防止 LLM 返回占位符/空内容
   */
  private validateSummary(summary: DistillSummary): { valid: boolean; reason?: string } {
    const title = summary.title?.trim() || "";
    const content = summary.content?.trim() || "";

    // 1. 标题不能为空
    if (title.length === 0) {
      return { valid: false, reason: "Empty title" };
    }

    // 2. 内容不能为空或太短（至少50个字符的实质内容）
    if (content.length < 50) {
      return { valid: false, reason: `Content too short (${content.length} chars, min 50)` };
    }

    // 3. 检测占位符标题模式
    const placeholderPatterns = [
      /^Memory entry\s+\d+/i,
      /^Entry\s+\d+/i,
      /^Note\s+\d+/i,
      /^Untitled/i,
      /^No title/i,
      /^\d+$/,
      /^Item\s+\d+/i,
      /^Log entry/i,
      /^Record \d+/i,
    ];
    for (const pattern of placeholderPatterns) {
      if (pattern.test(title)) {
        return { valid: false, reason: `Placeholder title detected: "${title}"` };
      }
    }

    // 4. 检测内容是否只是元数据描述（无实质信息）
    const metadataOnlyPatterns = [
      /^Memory entry \d+ regarding/i,
      /^This is a memory entry/i,
      /^Conversation from .+ to/i,
      /^Session \d+ /i,
      /^A summary of/i,
    ];
    for (const pattern of metadataOnlyPatterns) {
      if (pattern.test(content)) {
        return { valid: false, reason: `Metadata-only content: "${content.substring(0, 60)}..."` };
      }
    }

    // 5. 标题和内容不能相同（防止 LLM 偷懒只返回标题）
    if (content === title) {
      return { valid: false, reason: "Content identical to title" };
    }

    // 6. 内容中实质性词汇比例检查（不能全是 "the", "a", "is" 等虚词）
    const words = content.split(/\s+/).filter((w) => w.length > 2);
    if (words.length < 5) {
      return { valid: false, reason: `Too few meaningful words (${words.length})` };
    }

    return { valid: true };
  }

  private async createNoteFromSummary(summary: DistillSummary): Promise<ZettelNote | null> {
    // 质量校验
    const validation = this.validateSummary(summary);
    if (!validation.valid) {
      // TODO: replace with structured logger
      // console.warn(`[Distiller] Skipping low-quality summary: ${validation.reason}`);
      return null;
    }

    try {
      const params: CreateNoteParams = {
        title: summary.title,
        content: summary.content,
        tags: summary.suggestedTags,
        confidence: summary.confidence,
        source: "distilled",
      };

      const note = await this.noteService.createNote(params, {
        confidence: summary.confidence,
        source: "distilled",
      });

      // 创建建议的链接
      for (const targetId of summary.suggestedLinks) {
        try {
          this.linkService.createLink(note.id, targetId, "related", {
            context: "Auto-suggested by distiller",
          });
        } catch {
          // 忽略链接创建错误
        }
      }

      return note;
    } catch (error) {
      // TODO: replace with structured logger
      // console.error("Failed to create note from summary:", error);
      return null;
    }
  }

  /**
   * 合并到现有笔记
   * @param summary 摘要
   * @param existingNoteId 现有笔记ID
   */
  private async mergeWithExisting(
    summary: DistillSummary,
    existingNoteId: string
  ): Promise<void> {
    const existingNote = await this.noteService.getNote(existingNoteId);
    if (!existingNote) return;

    // 更新现有笔记内容（追加新信息）
    const updatedContent = `${existingNote.content}\n\n---\n\n**Additional Context (from ${summary.sliceId}):**\n${summary.content}`;

    await this.noteService.updateNote(existingNoteId, {
      content: updatedContent,
    });
  }

  /**
   * 创建蒸馏作业
   */
  private createJob(date: string, memoryFilePath?: string): DistillJob {
    const job: DistillJob = {
      id: generateZettelId(),
      date,
      status: "pending",
      memoryFilePath,
      sliceCount: 0,
      summaryCount: 0,
      decisions: [],
      createdCount: 0,
      mergedCount: 0,
      skippedCount: 0,
    };

    this.jobs.set(job.id, job);
    return job;
  }

  /**
   * 获取作业
   */
  getJob(jobId: string): DistillJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * 获取所有作业
   */
  getAllJobs(): DistillJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * 获取指定日期的作业
   */
  getJobsByDate(date: string): DistillJob[] {
    return this.getAllJobs().filter((job) => job.date === date);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<DistillerServiceConfig>): void {
    this.config = { ...this.config, ...config };
    this.dedupeService.updateConfig({
      vectorSimilarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
    });
  }

  /**
   * 获取当前配置
   */
  getConfig(): DistillerServiceConfig {
    return { ...this.config };
  }

  /**
   * 设置 MemoryParser（测试专用注入点）
   */
  setMemoryParser(parser: MemoryParser): void {
    this.memoryParser = parser;
  }

  /**
   * 设置夜间模式 Cron 任务
   * @param cronExpression Cron 表达式（默认每天凌晨2点）
   * @param callback 回调函数
   */
  scheduleNightDistillation(
    cronExpression: string = "0 2 * * *",
    callback?: (job: DistillJob) => void
  ): { stop: () => void } {
    // 简化的定时任务实现
    // 实际应用中应使用 node-cron 或类似库
    const interval = this.parseCronExpression(cronExpression);

    const timer = setInterval(async () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();

      // 检查是否到达执行时间
      if (hours === 2 && minutes === 0) {
        try {
          // 这里需要传入现有笔记
          const existingNotes: ZettelNote[] = [];
          const job = await this.distillYesterday(existingNotes);
          if (callback) {
            callback(job);
          }
        } catch (error) {
          // TODO: replace with structured logger
          // console.error("Night distillation failed:", error);
        }
      }
    }, interval);

    return {
      stop: () => clearInterval(timer),
    };
  }

  /**
   * 解析 Cron 表达式为毫秒间隔
   * 简化实现，仅支持简单的每日执行
   */
  private parseCronExpression(cron: string): number {
    // 默认每小时检查一次
    return 60 * 60 * 1000;
  }
}
