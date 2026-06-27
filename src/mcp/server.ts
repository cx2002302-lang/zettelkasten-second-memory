/**
 * Zettelkasten MCP 服务器
 * 
 * 提供双 Agent 权限的 7 大核心工具：
 * 
 * 前台聊天主脑（只读）：
 * 1. zk_search_notes      - 搜索笔记
 * 2. zk_get_note          - 获取单条笔记
 * 3. zk_get_backlinks     - 获取反向链接
 * 4. zk_find_path         - 路径发现
 * 
 * 后台知识管理子脑（读写）：
 * 5. zk_create_note       - 创建笔记（含置信度路由）
 * 6. zk_update_note       - 更新笔记
 * 7. zk_run_ceqrc_workflow - CEQRC 工作流
 * 
 * 权限通过 OpenClaw Agent 配置控制。
 */

import type { DatabaseSync } from "node:sqlite";
import { NoteService } from "../service/note-service.js";
import { LinkService } from "../service/link-service.js";
import { CEQRCEngine } from "../service/ceqrc-engine.js";
import { DistillerService } from "../service/distiller-service.js";
import { GlowCalculator } from "../engine/glow-calculator.js";
import { PathFinder } from "../engine/path-finder.js";
import { ArchiveService } from "../service/archive-service.js";
import { KnowledgeHeatmapService } from "../service/heatmap-service.js";
import type {
  ZettelNote,
  CreateNoteParams,
  UpdateNoteParams,
  QueryNotesParams,
  NoteFolder,
  SourceType,
  LLMProvider,
} from "../core/types.js";
import { DEFAULT_PAGE_LIMIT, DEFAULT_PAGE_SIZE } from "../core/constants.js";

export interface ZettelkastenMCPConfig {
  /** 数据库文件路径 */
  dbPath: string;
  /** 笔记存储基础目录 */
  notesBaseDir: string;
  /** 启用前台只读工具 */
  enableReadOnlyTools: boolean;
  /** 启用后台读写工具 */
  enableReadWriteTools: boolean;
  /** LLM Provider（用于 CEQRC 和蒸馏服务） */
  llmProvider?: LLMProvider;
  /** Memory 日志文件路径（用于蒸馏服务） */
  memoryLogPath?: string;
}

export class ZettelkastenMCPServer {
  private noteService: NoteService;
  private linkService: LinkService;
  private ceqrcEngine?: CEQRCEngine;
  private distillerService?: DistillerService;
  private glowCalculator: GlowCalculator;
  private pathFinder: PathFinder;
  private archiveService: ArchiveService;
  private heatmapService: KnowledgeHeatmapService;

  constructor(
    private db: DatabaseSync,
    private basePath: string,
    private config: ZettelkastenMCPConfig
  ) {
    this.noteService = new NoteService(db, basePath);
    this.linkService = new LinkService(db);
    this.glowCalculator = new GlowCalculator(db);
    this.pathFinder = new PathFinder(db);
    this.archiveService = new ArchiveService(db);
    this.heatmapService = new KnowledgeHeatmapService(db);
    
    // 如果提供了 LLM Provider，初始化 CEQRC 引擎和蒸馏服务
    if (config.llmProvider) {
      this.ceqrcEngine = new CEQRCEngine(config.llmProvider);
      this.distillerService = new DistillerService(
        config.llmProvider,
        this.noteService,
        this.linkService
      );
    }
  }

  // ========== 工具方法（前台只读） ==========

  /**
   * 搜索笔记（全文搜索）
   */
  async searchNotes(query: string, limit: number = DEFAULT_PAGE_LIMIT, filters?: Partial<QueryNotesParams>) {
    if (!this.config.enableReadOnlyTools) {
      throw new Error("Read-only tools are disabled");
    }
    
    return await this.noteService.searchNotes(query, limit, { filters });
  }

  /**
   * 获取单条笔记
   */
  async getNote(id: string): Promise<ZettelNote | null> {
    if (!this.config.enableReadOnlyTools) {
      throw new Error("Read-only tools are disabled");
    }
    
    return await this.noteService.getNote(id);
  }

  /**
   * 获取反向链接（指向该笔记的链接）
   */
  async getBacklinks(noteId: string) {
    if (!this.config.enableReadOnlyTools) {
      throw new Error("Read-only tools are disabled");
    }
    
    return this.linkService.getLinksTo(noteId);
  }

  /**
   * 查找路径（两张卡片之间的最短路径）
   */
  async findPath(fromNoteId: string, toNoteId: string, options?: { maxDepth?: number; linkTypeFilter?: string[] }) {
    if (!this.config.enableReadOnlyTools) {
      throw new Error("Read-only tools are disabled");
    }
    
    return this.pathFinder.findPath(fromNoteId, toNoteId, options);
  }

  /**
   * 获取发光度排行
   */
  async glowRanking(options?: { limit?: number; statusFilter?: string[]; minGlow?: number }) {
    if (!this.config.enableReadOnlyTools) {
      throw new Error("Read-only tools are disabled");
    }
    
    return this.glowCalculator.getRanking(options);
  }

  /**
   * 获取僵尸笔记
   */
  async findZombies(limit?: number) {
    if (!this.config.enableReadOnlyTools) {
      throw new Error("Read-only tools are disabled");
    }
    
    return this.glowCalculator.findZombies(limit);
  }

  /**
   * 搜索已归档笔记
   */
  async searchArchived(query: string, limit: number = DEFAULT_PAGE_LIMIT) {
    if (!this.config.enableReadOnlyTools) {
      throw new Error("Read-only tools are disabled");
    }
    
    return this.noteService.searchNotes(query, limit, { includeArchived: true });
  }

  /**
   * 归档笔记
   */
  async archiveNote(noteId: string) {
    if (!this.config.enableReadWriteTools) {
      throw new Error("Read-write tools are disabled");
    }
    
    const note = await this.noteService.archiveNote(noteId);
    if (note) {
      this.archiveService.logAction(noteId, note.title, "archive", "手动归档");
    }
    return note;
  }

  /**
   * 恢复归档笔记
   */
  async unarchiveNote(noteId: string) {
    if (!this.config.enableReadWriteTools) {
      throw new Error("Read-write tools are disabled");
    }
    
    const note = await this.noteService.unarchiveNote(noteId);
    if (note) {
      this.archiveService.logAction(noteId, note.title, "unarchive", "手动恢复");
    }
    return note;
  }

  /**
   * 获取归档历史
   */
  async getArchiveLog(options?: { noteId?: string; limit?: number; action?: string }) {
    if (!this.config.enableReadOnlyTools) {
      throw new Error("Read-only tools are disabled");
    }
    
    return this.archiveService.getArchiveLog(options);
  }

  /**
   * 知识热力图
   */
  async knowledgeHeatmap(days?: number) {
    if (!this.config.enableReadOnlyTools) {
      throw new Error("Read-only tools are disabled");
    }
    
    return this.heatmapService.generateHeatmap(days);
  }

  /**
   * 知识图谱
   */
  async networkGraph(options?: { limit?: number; folderFilter?: string[]; glowMin?: number }) {
    if (!this.config.enableReadOnlyTools) {
      throw new Error("Read-only tools are disabled");
    }
    
    return this.heatmapService.generateNetworkGraph(options);
  }

  // ========== 工具方法（后台读写） ==========

  /**
   * 创建笔记（含置信度路由）
   */
  async createNote(
    params: CreateNoteParams,
    options: {
      confidence?: number;
      source?: SourceType;
    } = {}
  ): Promise<ZettelNote> {
    if (!this.config.enableReadWriteTools) {
      throw new Error("Read-write tools are disabled");
    }
    
    return await this.noteService.createNote(params, {
      confidence: options.confidence,
      source: options.source,
    });
  }

  /**
   * 更新笔记
   */
  async updateNote(id: string, params: UpdateNoteParams): Promise<ZettelNote | null> {
    if (!this.config.enableReadWriteTools) {
      throw new Error("Read-write tools are disabled");
    }
    
    return await this.noteService.updateNote(id, params);
  }

  /**
   * 运行 CEQRC 工作流（深度内化）
   */
  async runCEQRCWorkflow(
    content: string,
    options: {
      confidence?: number;
      source?: SourceType;
    } = {}
  ): Promise<ZettelNote> {
    if (!this.config.enableReadWriteTools) {
      throw new Error("Read-write tools are disabled");
    }
    
    if (!this.ceqrcEngine) {
      throw new Error("CEQRC engine not initialized. Please provide llmProvider in config.");
    }
    
    // 使用 CEQRC 引擎处理内容
    const workflow = await this.ceqrcEngine.startWorkflow(content);
    const result = await this.ceqrcEngine.processToCompletion(workflow.id);
    
    if (!result.success || !result.note) {
      throw new Error(`CEQRC workflow failed: ${result.error || "Unknown error"}`);
    }
    
    return result.note;
  }

  /**
   * 批量蒸馏记忆（夜间批处理）
   */
  async distillMemoryLog(date: string): Promise<{ created: number; merged: number; skipped: number }> {
    if (!this.config.enableReadWriteTools) {
      throw new Error("Read-write tools are disabled");
    }
    
    if (!this.distillerService) {
      throw new Error("Distiller service not initialized. Please provide llmProvider in config.");
    }
    
    if (!this.config.memoryLogPath) {
      throw new Error("Memory log path not configured.");
    }
    
    // 构建 memory 日志文件路径
    const memoryFilePath = `${this.config.memoryLogPath}/${date}.json`;
    
    // 获取现有笔记用于去重
    const existingNotes = await this.noteService.listNotes({});
    
    // 执行蒸馏
    const job = await this.distillerService.distillMemoryFile(memoryFilePath, existingNotes);
    
    return {
      created: job.createdCount,
      merged: job.mergedCount,
      skipped: job.skippedCount,
    };
  }

  /**
   * 获取 Inbox 待审核队列
   */
  async getInboxQueue(limit: number = DEFAULT_PAGE_SIZE): Promise<ZettelNote[]> {
    if (!this.config.enableReadWriteTools) {
      throw new Error("Read-write tools are disabled");
    }
    
    // NoteService 已实现
    return await this.noteService.getInboxQueue(limit);
  }

  /**
   * 审核笔记（批准/拒绝/改进）
   */
  async reviewNote(
    id: string,
    decision: "approve" | "reject" | "improve",
    improvements?: { title?: string; content?: string; confidence?: number }
  ): Promise<ZettelNote | null> {
    if (!this.config.enableReadWriteTools) {
      throw new Error("Read-write tools are disabled");
    }
    
    return await this.noteService.reviewNote(id, decision, improvements);
  }

  // ========== 工具导出 ==========

  /**
   * 获取所有工具（根据权限配置过滤）
   */
  getTools(): any[] {
    const tools: any[] = [];

    if (this.config.enableReadOnlyTools) {
      tools.push(
        {
          name: "zk_search_notes",
          description: "搜索 Zettelkasten 笔记",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "搜索关键词" },
              limit: { type: "number", description: "返回数量", default: DEFAULT_PAGE_LIMIT },
              tags: { type: "array", items: { type: "string" }, description: "标签过滤（交集）" },
              folder: { type: "string", enum: ["inbox", "references", "zettels", "archive"], description: "文件夹过滤" },
              minConfidence: { type: "number", description: "最小置信度", minimum: 0, maximum: 1 },
              maxConfidence: { type: "number", description: "最大置信度", minimum: 0, maximum: 1 },
              createdAfter: { type: "string", description: "创建时间 >= (ISO 8601)" },
              createdBefore: { type: "string", description: "创建时间 <= (ISO 8601)" },
              updatedAfter: { type: "string", description: "更新时间 >= (ISO 8601)" },
              updatedBefore: { type: "string", description: "更新时间 <= (ISO 8601)" },
            },
            required: ["query"],
          },
          handler: async (args: any) => {
            const filters: Partial<QueryNotesParams> = {};
            if (args.tags) filters.tags = args.tags;
            if (args.folder) filters.folder = args.folder as QueryNotesParams["folder"];
            if (args.minConfidence !== undefined) filters.minConfidence = args.minConfidence;
            if (args.maxConfidence !== undefined) filters.maxConfidence = args.maxConfidence;
            if (args.createdAfter) filters.createdAfter = args.createdAfter;
            if (args.createdBefore) filters.createdBefore = args.createdBefore;
            if (args.updatedAfter) filters.updatedAfter = args.updatedAfter;
            if (args.updatedBefore) filters.updatedBefore = args.updatedBefore;
            return await this.searchNotes(args.query, args.limit, Object.keys(filters).length > 0 ? filters : undefined);
          },
        },
        {
          name: "zk_get_note",
          description: "获取单条 Zettelkasten 笔记",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "笔记 ID" },
            },
            required: ["id"],
          },
          handler: async (args: any) => await this.getNote(args.id),
        },
        {
          name: "zk_get_backlinks",
          description: "获取笔记的反向链接",
          inputSchema: {
            type: "object",
            properties: {
              noteId: { type: "string", description: "笔记 ID" },
            },
            required: ["noteId"],
          },
          handler: async (args: any) => await this.getBacklinks(args.noteId),
        },
        {
          name: "zk_find_path",
          description: "查找两张卡片之间的最短路径",
          inputSchema: {
            type: "object",
            properties: {
              fromNoteId: { type: "string", description: "起始笔记 ID" },
              toNoteId: { type: "string", description: "目标笔记 ID" },
              maxDepth: { type: "number", description: "最大搜索深度", default: 6 },
              linkTypeFilter: { type: "array", items: { type: "string" }, description: "链接类型过滤" },
            },
            required: ["fromNoteId", "toNoteId"],
          },
          handler: async (args: any) => await this.findPath(args.fromNoteId, args.toNoteId, {
            maxDepth: args.maxDepth,
            linkTypeFilter: args.linkTypeFilter,
          }),
        },
        {
          name: "zk_glow_ranking",
          description: "按发光度排序展示笔记，支持分类筛选",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", description: "返回数量", default: DEFAULT_PAGE_LIMIT },
              statusFilter: { type: "array", items: { type: "string", enum: ["evergreen", "active", "stable", "zombie"] }, description: "状态筛选" },
              minGlow: { type: "number", description: "最小发光度", default: 0 },
            },
          },
          handler: async (args: any) => await this.glowRanking({
            limit: args.limit,
            statusFilter: args.statusFilter,
            minGlow: args.minGlow,
          }),
        },
        {
          name: "zk_find_zombies",
          description: "找出过期僵尸笔记（半年未更新且无引用）",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", description: "返回数量", default: DEFAULT_PAGE_LIMIT },
            },
          },
          handler: async (args: any) => await this.findZombies(args.limit),
        },
        {
          name: "zk_search_archived",
          description: "搜索已归档的笔记（默认搜索不包含归档）",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "搜索关键词" },
              limit: { type: "number", description: "返回数量", default: DEFAULT_PAGE_LIMIT },
            },
            required: ["query"],
          },
          handler: async (args: any) => await this.searchArchived(args.query, args.limit),
        },
        {
          name: "zk_get_archive_log",
          description: "获取归档/恢复操作历史记录",
          inputSchema: {
            type: "object",
            properties: {
              noteId: { type: "string", description: "指定笔记 ID 筛选" },
              action: { type: "string", enum: ["archive", "unarchive", "auto_archive"], description: "操作类型筛选" },
              limit: { type: "number", description: "返回数量", default: DEFAULT_PAGE_SIZE },
            },
          },
          handler: async (args: any) => await this.getArchiveLog({
            noteId: args.noteId,
            action: args.action,
            limit: args.limit,
          }),
        },
        {
          name: "zk_knowledge_heatmap",
          description: "生成知识库热力图数据（活跃度、分布、连接密度）",
          inputSchema: {
            type: "object",
            properties: {
              days: { type: "number", description: "统计天数", default: 30 },
            },
          },
          handler: async (args: any) => await this.knowledgeHeatmap(args.days),
        },
        {
          name: "zk_network_graph",
          description: "生成知识图谱数据（节点+边，可导出可视化）",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", description: "最大节点数", default: 200 },
              folderFilter: { type: "array", items: { type: "string" }, description: "文件夹过滤" },
              glowMin: { type: "number", description: "最小发光度", default: 0 },
            },
          },
          handler: async (args: any) => await this.networkGraph({
            limit: args.limit,
            folderFilter: args.folderFilter,
            glowMin: args.glowMin,
          }),
        }
      );
    }

    if (this.config.enableReadWriteTools) {
      tools.push(
        {
          name: "zk_create_note",
          description: "创建新笔记（含置信度路由）",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string", description: "笔记标题" },
              content: { type: "string", description: "Markdown 内容" },
              type: { type: "string", enum: ["atomic", "structure", "source"], default: "atomic" },
              confidence: { type: "number", description: "置信度评分 0-1", default: 0.5 },
              source: { type: "string", enum: ["manual", "distilled", "ceqrc"], default: "manual" },
              folder: { type: "string", enum: ["inbox", "references", "zettels", "archive"], description: "覆盖置信度路由" },
              status: { type: "string", enum: ["FLEETING", "LITERATURE", "PERMANENT"], description: "生命周期状态" },
            },
            required: ["title", "content"],
          },
          handler: async (args: any) => {
            const note = await this.createNote(args, {
              confidence: args.confidence,
              source: args.source,
            });
            const hasHotTag = note.tags.includes("svm:hot");
            return hasHotTag ? { ...note, hot: true } : note;
          },
        },
        {
          name: "zk_update_note",
          description: "更新现有笔记",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "笔记 ID" },
              title: { type: "string", description: "新标题" },
              content: { type: "string", description: "新内容" },
              folder: { type: "string", enum: ["inbox", "references", "zettels", "archive"] },
              status: { type: "string", enum: ["FLEETING", "LITERATURE", "PERMANENT"], description: "生命周期状态" },
              reviewed: { type: "boolean", description: "是否已审核" },
            },
            required: ["id"],
          },
          handler: async (args: any) => {
            const updated = await this.updateNote(args.id, args);
            if (updated && updated.tags.includes("svm:hot")) {
              return { ...updated, hot: true };
            }
            return updated;
          },
        },
        {
          name: "zk_archive_note",
          description: "归档笔记（移到 archive 文件夹）",
          inputSchema: {
            type: "object",
            properties: {
              noteId: { type: "string", description: "笔记 ID" },
            },
            required: ["noteId"],
          },
          handler: async (args: any) => await this.archiveNote(args.noteId),
        },
        {
          name: "zk_unarchive_note",
          description: "恢复归档笔记（回到 references）",
          inputSchema: {
            type: "object",
            properties: {
              noteId: { type: "string", description: "笔记 ID" },
            },
            required: ["noteId"],
          },
          handler: async (args: any) => await this.unarchiveNote(args.noteId),
        },
        {
          name: "zk_run_ceqrc_workflow",
          description: "运行 CEQRC 深度内化工作流",
          inputSchema: {
            type: "object",
            properties: {
              content: { type: "string", description: "原始内容" },
              confidence: { type: "number", description: "置信度评分 0-1", default: 0.5 },
              source: { type: "string", enum: ["manual", "distilled", "ceqrc"], default: "ceqrc" },
            },
            required: ["content"],
          },
          handler: async (args: any) => await this.runCEQRCWorkflow(args.content, {
            confidence: args.confidence,
            source: args.source,
          }),
        },
        {
          name: "zk_distill_memory",
          description: "蒸馏 OpenClaw memory 日志",
          inputSchema: {
            type: "object",
            properties: {
              date: { type: "string", description: "日志日期 (YYYY-MM-DD)" },
            },
            required: ["date"],
          },
          handler: async (args: any) => await this.distillMemoryLog(args.date),
        },
        {
          name: "zk_get_inbox_queue",
          description: "获取 Inbox 待审核队列",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", description: "返回数量", default: DEFAULT_PAGE_SIZE },
            },
          },
          handler: async (args: any) => await this.getInboxQueue(args.limit),
        },
        {
          name: "zk_review_note",
          description: "审核 Inbox 笔记",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "笔记 ID" },
              decision: { type: "string", enum: ["approve", "reject", "improve"] },
              improvements: { 
                type: "object",
                properties: {
                  title: { type: "string" },
                  content: { type: "string" },
                  confidence: { type: "number" },
                },
              },
            },
            required: ["id", "decision"],
          },
          handler: async (args: any) => await this.reviewNote(args.id, args.decision, args.improvements),
        }
      );
    }

    return tools;
  }

  /**
   * 启动 MCP 服务器（集成到 OpenClaw）
   */
  start(): void {
    // TODO: replace with structured logger
    // console.log("Zettelkasten MCP server started");
    // TODO: 注册到 OpenClaw MCP 管理器
  }

  /**
   * 停止 MCP 服务器
   */
  stop(): void {
    // TODO: replace with structured logger
    // console.log("Zettelkasten MCP server stopped");
  }
}