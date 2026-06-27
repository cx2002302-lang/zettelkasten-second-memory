/**
 * NoteService - 笔记业务逻辑层
 * 
 * 职责：
 * 1. 笔记 CRUD 操作
 * 2. 双向链接自动维护
 * 3. 置信度路由（高分→zettels，低分→inbox）
 * 4. 笔记状态流转管理
 */

import type { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { NoteRepository } from "../repository/note-repository.js";
import { LinkRepository } from "../repository/link-repository.js";
import { TemplateManager } from "../storage/template-manager.js";
import type {
  ZettelNote,
  CreateNoteParams,
  UpdateNoteParams,
  QueryNotesParams,
  NoteStatus,
  NoteFolder,
  SourceType,
  SearchResult,
} from "../core/types.js";
import { generateZettelId, toISOString } from "../core/utils.js";
import { DEFAULT_NOTE_FOLDER, DEFAULT_CONFIDENCE, DEFAULT_CONFIDENCE_THRESHOLD, MIN_CONFIDENCE_THRESHOLD, DEFAULT_PAGE_LIMIT, DEFAULT_PAGE_SIZE } from "../core/constants.js";

export interface CreateNoteOptions {
  /** 置信度评分 0-1，影响存储位置 */
  confidence?: number;
  /** 来源类型 */
  source?: SourceType;
  /** 是否跳过链接解析 */
  skipLinkParsing?: boolean;
}

export interface NoteServiceConfig {
  /** 高置信度阈值，≥此值进入 zettels */
  highConfidenceThreshold: number;
  /** 中置信度阈值，≥此值进入 references，<此值进入 inbox */
  mediumConfidenceThreshold: number;
}

const DEFAULT_CONFIG: NoteServiceConfig = {
  highConfidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
  mediumConfidenceThreshold: MIN_CONFIDENCE_THRESHOLD,
};

export class NoteService {
  private noteRepo: NoteRepository;
  private linkRepo: LinkRepository;
  private templateManager: TemplateManager;
  private config: NoteServiceConfig;

  constructor(
    db: DatabaseSync,
    private basePath: string,
    config: Partial<NoteServiceConfig> = {}
  ) {
    this.templateManager = new TemplateManager(join(basePath, "templates"));
    this.noteRepo = new NoteRepository(db, this.templateManager);
    this.linkRepo = new LinkRepository(db);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 创建笔记（含置信度路由）
   */
  async createNote(
    params: CreateNoteParams,
    options: CreateNoteOptions = {}
  ): Promise<ZettelNote> {
    // 确保模板目录与默认模板存在（失败时不阻塞 DB 写入）
    try {
      await this.templateManager.init();
    } catch {
      // 无写入权限时跳过文件同步
    }

    const { confidence = DEFAULT_CONFIDENCE, source = "manual", skipLinkParsing = false } = options;

    // 输入校验
    if (!params.title || params.title.trim().length === 0) {
      throw new Error("Note title cannot be empty");
    }
    if (!params.content || params.content.trim().length === 0) {
      throw new Error("Note content cannot be empty");
    }
    if (confidence < 0 || confidence > 1) {
      throw new Error("Confidence must be between 0 and 1");
    }

    // 1. 确定目标文件夹（置信度路由，除非用户显式指定了 folder）
    const folder = params.folder ?? this.routeByConfidence(confidence);

    // 2. 构建参数（覆盖 confidence, source）
    const createParams: CreateNoteParams = {
      ...params,
      folder,
      confidence,
      source,
    };

    // 3. 创建笔记
    const note = await this.noteRepo.create(createParams, this.basePath);

    // 4. 解析并创建链接（如果不是跳过）
    if (!skipLinkParsing) {
      await this.parseAndCreateLinks(note);
    }

    return note;
  }

  /**
   * 批量创建笔记（用于蒸馏服务）
   */
  async batchCreateNotes(
    inputs: Array<{ params: CreateNoteParams; confidence: number; source: SourceType }>
  ): Promise<ZettelNote[]> {
    const notes: ZettelNote[] = [];
    
    for (const { params, confidence, source } of inputs) {
      try {
        const note = await this.createNote(params, { confidence, source });
        notes.push(note);
      } catch (error) {
        // TODO: replace with structured logger
        // console.error(`Failed to create note "${params.title}":`, error);
        // 继续处理其他笔记
      }
    }
    
    return notes;
  }

  /**
   * 更新笔记
   */
  async updateNote(
    id: string,
    params: UpdateNoteParams
  ): Promise<ZettelNote | null> {
    // 确保模板目录存在（失败时不阻塞 DB 写入）
    try {
      await this.templateManager.init();
    } catch {
      // 无写入权限时跳过文件同步
    }

    const existing = await this.noteRepo.get(id);
    if (!existing) return null;

    // 输入校验
    if (params.title !== undefined && params.title.trim().length === 0) {
      throw new Error("Note title cannot be empty");
    }
    if (params.content !== undefined && params.content.trim().length === 0) {
      throw new Error("Note content cannot be empty");
    }
    if (params.confidence !== undefined && (params.confidence < 0 || params.confidence > 1)) {
      throw new Error("Confidence must be between 0 and 1");
    }

    // 更新字段
    const updated = await this.noteRepo.update(id, params);
    if (!updated) return null;

    // 如果内容变化，重新解析链接
    if (params.content !== undefined && params.content !== existing.content) {
      // 删除旧链接，创建新链接
      await this.linkRepo.deleteBySource(id);
      await this.parseAndCreateLinks(updated);
    }

    return updated;
  }

  /**
   * 删除笔记（级联删除链接）
   */
  async deleteNote(id: string): Promise<boolean> {
    const existing = await this.noteRepo.get(id);
    if (!existing) return false;

    // 删除所有相关链接
    await this.linkRepo.deleteBySource(id);
    await this.linkRepo.deleteByTarget(id);

    // 删除笔记（含 Markdown 文件）
    const deleted = await this.noteRepo.delete(id);
    return deleted;
  }

  /**
   * 获取单条笔记
   */
  async getNote(id: string): Promise<ZettelNote | null> {
    return await this.noteRepo.get(id);
  }

  /**
   * 搜索笔记（全文搜索）
   */
  async archiveNote(id: string): Promise<ZettelNote | null> {
    return await this.updateNote(id, { folder: "archive", preserveUpdatedAt: true });
  }

  async unarchiveNote(id: string): Promise<ZettelNote | null> {
    return await this.updateNote(id, { folder: "zettels", preserveUpdatedAt: true });
  }

  async searchNotes(query: string, limit: number = DEFAULT_PAGE_LIMIT, options?: { includeArchived?: boolean; filters?: Partial<QueryNotesParams> }): Promise<SearchResult[]> {
    const results = await this.noteRepo.search(query, limit, options?.filters);
    if (!options?.includeArchived) {
      return results.filter(r => r.note.folder !== 'archive');
    }
    return results;
  }

  /**
   * 列出笔记（支持过滤）
   */
  async listNotes(options: {
    folder?: NoteFolder;
    status?: NoteStatus;
    source?: SourceType;
    reviewed?: boolean;
    minConfidence?: number;
    maxConfidence?: number;
    limit?: number;
    offset?: number;
  } = {}): Promise<ZettelNote[]> {
    const { folder, status, source, reviewed, minConfidence, maxConfidence, limit, offset } = options;

    // 构建查询条件，直接委托给 noteRepo.query
    // 注意: NoteRepository.query 接收 QueryNotesParams，但 folder/reviewed 不在该类型中
    // 我们先通过 query 过滤 type/status/confidence，然后在 JS 侧过滤 folder/reviewed/source
    const queryParams: Parameters<typeof this.noteRepo.query>[0] = {};
    if (status) queryParams.status = status;
    if (minConfidence !== undefined) queryParams.minConfidence = minConfidence;
    if (maxConfidence !== undefined) queryParams.maxConfidence = maxConfidence;
    if (limit !== undefined) queryParams.limit = limit;
    if (offset !== undefined) queryParams.offset = offset;

    let notes = this.noteRepo.query(queryParams);

    // 在 JS 侧过滤 folder / reviewed / source（这些字段 repository.query 不支持直接过滤）
    if (folder) {
      notes = notes.filter((n) => n.folder === folder);
    }
    if (reviewed !== undefined) {
      notes = notes.filter((n) => n.reviewed === reviewed);
    }
    if (source) {
      notes = notes.filter((n) => n.source === source);
    }

    return notes;
  }

  /**
   * 状态流转
   */
  async transitionStatus(
    id: string,
    newStatus: NoteStatus
  ): Promise<ZettelNote | null> {
    const note = await this.noteRepo.get(id);
    if (!note) return null;

    // 验证状态流转是否合法
    if (!this.isValidTransition(note.status, newStatus)) {
      throw new Error(
        `Invalid status transition from "${note.status}" to "${newStatus}"`
      );
    }

    return await this.updateNote(id, { status: newStatus });
  }

  /**
   * 获取 Inbox 待审核列表
   */
  async getInboxQueue(limit: number = DEFAULT_PAGE_SIZE): Promise<ZettelNote[]> {
    return this.noteRepo.query({
      limit,
      sortBy: "createdAt",
      sortDirection: "desc",
    }).filter(note => note.folder === "inbox" && !note.reviewed);
  }

  /**
   * 审核笔记（从 inbox 移动到正式区域）
   */
  async reviewNote(
    id: string,
    decision: "approve" | "reject" | "improve",
    improvements?: { title?: string; content?: string; confidence?: number }
  ): Promise<ZettelNote | null> {
    const note = await this.noteRepo.get(id);
    if (!note) return null;

    if (decision === "approve") {
      // 批准：移动到对应置信度区域
      const newConfidence = improvements?.confidence ?? Math.max(DEFAULT_CONFIDENCE_THRESHOLD, note.confidence ?? 0);
      const newFolder = this.routeByConfidence(newConfidence);
      
      return await this.updateNote(id, {
        folder: newFolder,
        confidence: newConfidence,
        status: newFolder === "zettels" ? "PERMANENT" : "LITERATURE",
        reviewed: true,
      });
    } else if (decision === "reject") {
      // 拒绝：标记为已审核但留在 inbox
      return await this.updateNote(id, {
        reviewed: true,
      });
    } else {
      // 改进：更新内容并重新评估
      const updateParams: UpdateNoteParams = {
        reviewed: false, // 需要重新审核
      };
      if (improvements?.title) updateParams.title = improvements.title;
      if (improvements?.content) updateParams.content = improvements.content;
      if (improvements?.confidence) updateParams.confidence = improvements.confidence;
      
      return await this.updateNote(id, updateParams);
    }
  }

  /**
   * 置信度路由
   */
  private routeByConfidence(confidence: number): NoteFolder {
    if (confidence >= this.config.highConfidenceThreshold) {
      return "zettels";
    } else if (confidence >= this.config.mediumConfidenceThreshold) {
      return "references";
    } else {
      return "inbox";
    }
  }

  /**
   * 解析内容中的链接并创建
   */
  private async parseAndCreateLinks(note: ZettelNote): Promise<void> {
    // 正则表达式匹配 [[note-id]] 或 [[note-title]]
    const linkRegex = /\[\[([^\[\]]+)\]\]/g;
    const matches = Array.from(note.content.matchAll(linkRegex));
    
    if (matches.length === 0) return;
    
    // 去重目标笔记
    const uniqueTargets = new Set<string>();
    for (const match of matches) {
      const target = match[1].trim();
      if (target) uniqueTargets.add(target);
    }
    
    // 为每个目标创建链接
    for (const target of uniqueTargets) {
      // 尝试查找目标笔记（按 ID 或标题）
      let targetNote = this.noteRepo.get(target); // 先按 ID 查找
      
      // 如果没找到，可以尝试按标题查找（简化：跳过）
      if (!targetNote) {
        // TODO: replace with structured logger
        // console.warn(`Target note "${target}" not found, skipping link creation`);
        continue;
      }
      
      // 检查是否已存在相同链接
      const existingLinks = this.linkRepo.getLinksBetween(note.id, targetNote.id);
      if (existingLinks.length > 0) continue; // 已存在链接
      
      // 创建链接（类型为 "related"）
      this.linkRepo.create(note.id, targetNote.id, "related", `Auto-linked from "${note.title}"`);
    }
  }

  /**
   * 验证状态流转是否合法
   */
  private isValidTransition(from: NoteStatus, to: NoteStatus): boolean {
    const validTransitions: Record<NoteStatus, NoteStatus[]> = {
      FLEETING: ["LITERATURE", "PERMANENT"],
      LITERATURE: ["PERMANENT"],
      PERMANENT: [],
    };
    return validTransitions[from].includes(to);
  }
}
