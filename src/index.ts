/**
 * Zettelkasten 模块主入口
 * 
 * 提供第二记忆系统的核心功能：
 * - 原子卡片管理
 * - 双向链接
 * - 全文搜索
 * - 知识图谱分析
 */

import { DatabaseSync } from "node:sqlite";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NoteRepository } from "./repository/note-repository.js";
import { LinkRepository } from "./repository/link-repository.js";
import type { LinkStats } from "./repository/link-repository.js";
import { TagRepository } from "./repository/tag-repository.js";
import type { TagStats } from "./repository/tag-repository.js";
import { ensureZettelkastenSchema, getDatabaseStats } from "./storage/db-schema.js";
import type {
  CreateNoteParams,
  UpdateNoteParams,
  QueryNotesParams,
  SearchResult,
  ZettelNote,
  LinkType,
} from "./core/types.js";

// 核心类型和常量
export * from "./core/types.js";
export * from "./core/constants.js";
export * from "./core/utils.js";

// 数据库 Schema
export * from "./storage/db-schema.js";

// 模板管理
export * from "./storage/template-manager.js";

// Repository 层
export * from "./repository/note-repository.js";
export * from "./repository/link-repository.js";
export * from "./repository/tag-repository.js";

// Service 层
export * from "./service/note-service.js";
export * from "./service/link-service.js";

// Phase 3: 认知流水线服务
export * from "./service/memory-parser.js";
export * from "./service/dedupe-service.js";
export * from "./service/ceqrc-engine.js";
export * from "./service/distiller-service.js";

// Phase 5: 人机共生与反馈 - 类型定义
export * from "./core/types-phase5.js";

// Phase 5: Repository 层
export * from "./repository/review-repository.js";
export * from "./repository/feedback-repository.js";
export * from "./repository/prompt-version-repository.js";
export * from "./repository/sample-curation-repository.js";
export * from "./repository/system-tuning-repository.js";

// Phase 5: Service 层
export * from "./service/review-service.js";
export * from "./service/feedback-service.js";
export * from "./service/prompt-evolution-service.js";
export * from "./service/sample-curation-service.js";

// Phase 5: MCP 工具
export * from "./mcp/phase5-tools.js";

// Phase 5: 其他 Service
export * from "./service/archive-service.js";
export * from "./service/heatmap-service.js";

// Phase 6: 知识网络增值引擎
export * from "./service/phase6/audit-service.js";
export * from "./service/phase6/moc-service.js";
export * from "./service/phase6/serendipity-service.js";

// Engine 层
export * from "./engine/glow-calculator.js";
export * from "./engine/path-finder.js";
export * from "./engine/phase6/serendipity-engine.js";
export * from "./engine/phase6/community-detector.js";

// Phase 4: 神经中枢集成
// 注意：所有类型已经在 ./core/types.js 中定义，集成文件只导出实现类
export {
  AgentConfigManager,
  CHAT_BRAIN_TOOLS,
  DEFAULT_AGENT_CONFIGS,
  KNOWLEDGE_BRAIN_TOOLS,
  TOOL_PERMISSION_MATRIX,
  createMCPConfigForAgent,
  getAgentConfigManager,
  resetAgentConfigManager,
  validateAgentConfig,
} from "./integration/agent-config.js";
export {
  DEFAULT_NIGHTLY_SCHEDULE,
  DEFAULT_SCHEDULER_CONFIG,
  ZettelkastenCronScheduler,
  createCronScheduler,
} from "./integration/cron-scheduler.js";
export {
  DEFAULT_SESSION_HOOK_CONFIG,
  SessionEndHookManager,
  createSessionEndHook,
  registerGlobalSessionHook,
} from "./integration/session-hook.js";
export {
  DEFAULT_INTEGRATION_CONFIG,
  ZettelkastenIntegration,
  createZettelkastenIntegration,
  getZettelkastenIntegration,
  resetZettelkastenIntegration,
  setZettelkastenIntegration,
} from "./integration/zettelkasten-integration.js";

/**
 * Zettelkasten 客户端
 */
export class ZettelkastenClient {
  private noteRepo: NoteRepository;
  private linkRepo: LinkRepository;
  private tagRepo: TagRepository;
  
  constructor(
    private db: DatabaseSync,
    private notesDir: string
  ) {
    this.noteRepo = new NoteRepository(db);
    this.linkRepo = new LinkRepository(db);
    this.tagRepo = new TagRepository(db);
  }
  
  /**
   * 初始化 Zettelkasten 系统
   */
  async initialize(): Promise<void> {
    const schemaResult = ensureZettelkastenSchema({
      db: this.db,
      ftsEnabled: true,
    });
    
    if (!schemaResult.ftsAvailable) {
      // TODO: replace with structured logger
      // console.warn("Full-text search not available:", schemaResult.ftsError);
    }
    
    await fs.mkdir(this.notesDir, { recursive: true });
    
    // TODO: replace with structured logger
    // console.log(`Zettelkasten initialized at ${this.notesDir}`);
  }
  
  /**
   * 创建卡片
   */
  async createNote(params: CreateNoteParams): Promise<ZettelNote> {
    return this.noteRepo.create(params, this.notesDir);
  }
  
  /**
   * 获取卡片
   */
  getNote(id: string): ZettelNote | null {
    return this.noteRepo.get(id);
  }
  
  /**
   * 更新卡片
   */
  async updateNote(id: string, params: UpdateNoteParams): Promise<ZettelNote | null> {
    return this.noteRepo.update(id, params);
  }
  
  /**
   * 删除卡片
   */
  deleteNote(id: string): boolean {
    return this.noteRepo.delete(id);
  }
  
  /**
   * 查询卡片
   */
  queryNotes(params: QueryNotesParams): ZettelNote[] {
    return this.noteRepo.query(params);
  }
  
  /**
   * 搜索卡片
   */
  searchNotes(query: string, limit: number = 20): SearchResult[] {
    return this.noteRepo.search(query, limit);
  }
  
  /**
   * 创建链接
   */
  createLink(fromNoteId: string, toNoteId: string, type: LinkType, context?: string): void {
    this.linkRepo.create(fromNoteId, toNoteId, type, context);
  }
  
  /**
   * 获取链接统计
   */
  getLinkStats(): LinkStats {
    return this.linkRepo.getStats();
  }
  
  /**
   * 获取标签统计
   */
  getTagStats(): TagStats[] {
    return this.tagRepo.getStats();
  }
  
  /**
   * 获取系统统计
   */
  getStats() {
    const dbStats = getDatabaseStats(this.db);
    const linkStats = this.linkRepo.getStats();
    const tagStats = this.tagRepo.getStats();
    
    return {
      ...dbStats,
      linkStats,
      tagStats: tagStats.slice(0, 10),
    };
  }
}

/**
 * 创建 Zettelkasten 客户端实例
 */
export async function createZettelkasten(
  dbPath: string,
  baseDir: string = process.cwd()
): Promise<ZettelkastenClient> {
  const db = new DatabaseSync(dbPath);
  const notesDir = path.join(baseDir, ".zettelkasten", "notes");
  const client = new ZettelkastenClient(db, notesDir);
  await client.initialize();
  return client;
}

// 默认导出
export default {
  ZettelkastenClient,
  createZettelkasten,
};
