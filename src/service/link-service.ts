/**
 * LinkService - 链接业务逻辑层
 * 
 * 职责：
 * 1. 链接 CRUD 操作（含自动反向链接）
 * 2. 链接验证与完整性检查
 * 3. 图算法（最短路径、社区发现）
 * 4. 链接统计与洞察
 */

import type { DatabaseSync } from "node:sqlite";
import { LinkRepository } from "../repository/link-repository.js";
import { NoteRepository } from "../repository/note-repository.js";
import type { Link, LinkType, LinkStats } from "../core/types.js";
import { getReverseLinkType } from "../core/utils.js";

export interface CreateLinkOptions {
  /** 是否自动创建反向链接（默认 true） */
  autoReverse?: boolean;
  /** 链接上下文描述 */
  context?: string;
}

export interface LinkServiceConfig {
  /** 最大路径查找深度 */
  maxPathDepth: number;
  /** 是否启用双向链接自动维护 */
  autoBidirectional: boolean;
}

const DEFAULT_CONFIG: LinkServiceConfig = {
  maxPathDepth: 6,
  autoBidirectional: true,
};

export class LinkService {
  private linkRepo: LinkRepository;
  private noteRepo: NoteRepository;
  private config: LinkServiceConfig;

  constructor(
    db: DatabaseSync,
    config: Partial<LinkServiceConfig> = {}
  ) {
    this.linkRepo = new LinkRepository(db);
    this.noteRepo = new NoteRepository(db);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 创建链接（含反向链接自动维护）
   */
  createLink(
    fromNoteId: string,
    toNoteId: string,
    type: LinkType,
    options: CreateLinkOptions = {}
  ): void {
    const { autoReverse = true, context } = options;

    // 验证笔记存在
    this.validateNoteExists(fromNoteId);
    this.validateNoteExists(toNoteId);

    // 输入校验
    if (fromNoteId === toNoteId) {
      throw new Error("Cannot create a link from a note to itself");
    }
    const validLinkTypes: LinkType[] = [
      "supports", "supported_by", "refines", "refined_by",
      "extends", "extended_by", "contradicts", "contradicted_by",
      "is_example_of", "has_example", "related",
    ];
    if (!validLinkTypes.includes(type)) {
      throw new Error(`Invalid link type: ${type}. Valid types: ${validLinkTypes.join(", ")}`);
    }

    // 创建主链接
    this.linkRepo.create(fromNoteId, toNoteId, type, context);

    // 自动创建反向链接（如果启用）
    if (autoReverse && this.config.autoBidirectional) {
      const reverseType = getReverseLinkType(type) as LinkType;
      this.linkRepo.create(toNoteId, fromNoteId, reverseType, context);
    }
  }

  /**
   * 删除链接（含反向链接清理）
   */
  deleteLink(
    fromNoteId: string,
    toNoteId: string,
    type: LinkType
  ): boolean {
    // 删除主链接
    const deleted = this.linkRepo.delete(fromNoteId, toNoteId, type);
    
    // 如果存在反向链接，也删除
    if (deleted && this.config.autoBidirectional) {
      const reverseType = getReverseLinkType(type) as LinkType;
      this.linkRepo.delete(toNoteId, fromNoteId, reverseType);
    }
    
    return deleted;
  }

  /**
   * 获取卡片发出的链接
   */
  getLinksFrom(noteId: string): Link[] {
    this.validateNoteExists(noteId);
    return this.linkRepo.getLinksFrom(noteId);
  }

  /**
   * 获取指向卡片的链接（反向链接）
   */
  getLinksTo(noteId: string): Link[] {
    this.validateNoteExists(noteId);
    return this.linkRepo.getLinksTo(noteId);
  }

  /**
   * 获取两张卡片之间的所有链接（双向）
   */
  getLinksBetween(noteId1: string, noteId2: string): Link[] {
    this.validateNoteExists(noteId1);
    this.validateNoteExists(noteId2);
    return this.linkRepo.getLinksBetween(noteId1, noteId2);
  }

  /**
   * 查找最短路径（基于链接图）
   */
  findPath(fromNoteId: string, toNoteId: string): string[] | null {
    this.validateNoteExists(fromNoteId);
    this.validateNoteExists(toNoteId);
    
    return this.linkRepo.findPath(fromNoteId, toNoteId, this.config.maxPathDepth);
  }

  /**
   * 获取链接统计信息
   */
  getStats(): LinkStats {
    return this.linkRepo.getStats();
  }

  /**
   * 批量创建链接（用于笔记导入）
   */
  batchCreateLinks(links: Array<{
    fromNoteId: string;
    toNoteId: string;
    type: LinkType;
    context?: string;
  }>): void {
    for (const link of links) {
      this.createLink(link.fromNoteId, link.toNoteId, link.type, {
        context: link.context,
        autoReverse: false, // 批量创建时禁用自动反向，避免重复
      });
    }
  }

  /**
   * 验证链接有效性（目标卡片是否存在）
   */
  validateLink(fromNoteId: string, toNoteId: string): boolean {
    return this.noteRepo.get(fromNoteId) !== null && 
           this.noteRepo.get(toNoteId) !== null;
  }

  /**
   * 获取卡片链接度（出入度）
   */
  getLinkDegree(noteId: string): { outDegree: number; inDegree: number } {
    const outLinks = this.getLinksFrom(noteId);
    const inLinks = this.getLinksTo(noteId);
    
    return {
      outDegree: outLinks.length,
      inDegree: inLinks.length,
    };
  }

  /**
   * 获取社区发现（简单聚类）
   * 基于链接密度进行分组（简化版）
   */
  getCommunities(minSize: number = 3): Array<{
    id: string;
    members: string[];
    density: number;
  }> {
    // 简化实现：返回空数组，后续可扩展
    // TODO: 实现基于 Louvain 或标签传播的社区发现算法
    return [];
  }

  /**
   * 清理孤立链接（指向不存在的卡片）
   */
  cleanupOrphanedLinks(): number {
    // 获取所有链接，检查目标卡片是否存在
    // 简化实现：返回0
    // TODO: 实现完整清理逻辑
    return 0;
  }

  // ========== 私有方法 ==========

  /**
   * 验证笔记存在，不存在则抛出错误
   */
  private validateNoteExists(noteId: string): void {
    const note = this.noteRepo.get(noteId);
    if (!note) {
      throw new Error(`Note "${noteId}" does not exist`);
    }
  }


}