import type { DatabaseSync } from "node:sqlite";
import { promises as fs } from "node:fs";
import type {
  ZettelNote,
  CreateNoteParams,
  UpdateNoteParams,
  QueryNotesParams,
  SearchResult,
  Link,
} from "../core/types.js";
import {
  generateZettelId,
  toISOString,
  generateSummary,
  getNoteFilePath,
  checkAtomicity,
} from "../core/utils.js";
import { DEFAULT_NOTE_TYPE, DEFAULT_NOTE_STATUS, DEFAULT_NOTE_FOLDER, DEFAULT_CONFIDENCE, DEFAULT_TRUNCATE_LENGTH, DEFAULT_PAGE_LIMIT, FTS_SNIPPET_LENGTH } from "../core/constants.js";
import type { TemplateManager } from "../storage/template-manager.js";

export class NoteRepository {
  constructor(
    private db: DatabaseSync,
    private templateManager?: TemplateManager,
  ) {}
  
  /**
   * 创建新卡片
   */
  async create(params: CreateNoteParams, notesDir: string): Promise<ZettelNote> {
    let id = generateZettelId();
    const now = toISOString();

    // 防御性重试：同一秒内批量创建时，3 位随机后缀可能冲突
    const MAX_ID_RETRIES = 10;
    for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
      const existing = this.db
        .prepare(`SELECT 1 FROM zettel_notes WHERE id = ?`)
        .get(id);
      if (!existing) break;
      id = generateZettelId();
    }
    const type = params.type ?? DEFAULT_NOTE_TYPE;
    const status = params.status ?? DEFAULT_NOTE_STATUS;
    const folder = params.folder ?? DEFAULT_NOTE_FOLDER;
    const confidence = params.confidence ?? DEFAULT_CONFIDENCE;
    const source = params.source;
    const reviewed = source === "manual"; // 手动创建的默认为已审核
    
    // 检查原子化原则
    const atomicityCheck = checkAtomicity(params.content);
    if (!atomicityCheck.isAtomic) {
      // TODO: replace with structured logger
      // console.warn("Atomicity check failed:", atomicityCheck.issues);
      // 这里可以抛出错误或仅记录警告，根据配置决定
    }
    
    // 生成摘要
    const summary = params.generateSummary !== false
      ? generateSummary(params.content)
      : params.content.substring(0, DEFAULT_TRUNCATE_LENGTH);
    
    // 构建卡片对象
    const note: ZettelNote = {
      id,
      title: params.title,
      content: params.content,
      summary,
      type,
      status,
      folder,
      confidence,
      source,
      reviewed,
      tags: params.tags ?? [],
      sessionKey: params.sessionKey,
      filePath: getNoteFilePath(notesDir, id),
      createdAt: now,
      updatedAt: now,
      links: params.links?.map(link => ({
        to: link.to,
        type: link.type,
        context: link.context,
        createdAt: now,
      })) ?? [],
    };
    
    // 插入数据库
    this.db.prepare(`
      INSERT OR REPLACE INTO zettel_notes (
        id, title, content, summary, type, status, folder, confidence,
        source, reviewed, session_key, file_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      note.id,
      note.title,
      note.content,
      note.summary,
      note.type,
      note.status,
      note.folder,
      note.confidence,
      note.source ?? null,
      note.reviewed ? 1 : 0,
      note.sessionKey ?? null,
      note.filePath,
      note.createdAt,
      note.updatedAt,
    );
    
    // 插入标签
    if (note.tags.length > 0) {
      await this.insertTags(note.id, note.tags);
    }
    
    // 插入链接
    if (note.links.length > 0) {
      await this.insertLinks(note.id, note.links);
    }
    
    // 更新全文搜索索引
    this.updateFtsIndex(note);
    
    // 同步写入 Markdown 文件
    await this.writeNoteFile(note);
    
    return note;
  }
  
  /**
   * 获取卡片
   */
  get(id: string): ZettelNote | null {
    const noteRow = this.db.prepare(`
      SELECT
        id, title, content, summary, type, status, folder, confidence,
        source, reviewed, session_key as "sessionKey", file_path as "filePath",
        created_at as "createdAt", updated_at as "updatedAt"
      FROM zettel_notes
      WHERE id = ?
    `).get(id) as any;
    
    if (!noteRow) {
      return null;
    }
    
    // 转换 SQLite 整数为布尔值
    const reviewed = noteRow.reviewed === 1 || noteRow.reviewed === true;
    
    // 获取标签
    const tags = this.getTags(id);
    
    // 获取链接
    const links = this.getLinksFrom(id);
    
    return {
      ...noteRow,
      reviewed,
      tags,
      links,
    };
  }
  
  /**
   * 更新卡片
   */
  async update(id: string, params: UpdateNoteParams): Promise<ZettelNote | null> {
    const existing = this.get(id);
    if (!existing) {
      return null;
    }
    
    const now = toISOString();
    const updates: Record<string, any> = {};
    
    if (!params.preserveUpdatedAt) {
      updates.updated_at = now;
    }
    
    if (params.title !== undefined) updates.title = params.title;
    if (params.content !== undefined) {
      updates.content = params.content;
      
      // 如果内容变更且需要生成摘要，重新生成摘要
      if (params.generateSummary !== false) {
        updates.summary = generateSummary(params.content);
      }
    }
    if (params.status !== undefined) updates.status = params.status;
    if (params.folder !== undefined) updates.folder = params.folder;
    if (params.confidence !== undefined) updates.confidence = params.confidence;
    if (params.source !== undefined) updates.source = params.source;
    if (params.reviewed !== undefined) updates.reviewed = params.reviewed ? 1 : 0;
    
    // 构建 SET 子句
    const setClause = Object.keys(updates)
      .map(key => `${key} = ?`)
      .join(", ");
    const values = Object.values(updates);
    values.push(id); // WHERE 条件
    
    this.db.prepare(`
      UPDATE zettel_notes 
      SET ${setClause}
      WHERE id = ?
    `).run(...values);
    
    // 更新标签
    if (params.tags !== undefined) {
      await this.updateTags(id, params.tags);
    }
    
    // 更新链接
    if (params.links !== undefined) {
      await this.updateLinks(id, params.links.map(link => ({
        to: link.to,
        type: link.type,
        context: link.context,
        createdAt: now,
      })));
    }
    
    // 更新全文搜索索引
    const updatedNote = this.get(id);
    if (updatedNote) {
      this.updateFtsIndex(updatedNote);
      await this.writeNoteFile(updatedNote);
    }
    
    return updatedNote;
  }
  
  /**
   * 删除卡片
   */
  async delete(id: string): Promise<boolean> {
    // 先获取文件路径并删除 Markdown 文件
    const note = this.get(id);
    if (note) {
      try {
        await fs.unlink(note.filePath);
      } catch {
        // 文件可能不存在，忽略错误
      }
    }

    // 删除相关记录 (外键级联删除会处理大部分)
    const result = this.db.prepare(`DELETE FROM zettel_notes WHERE id = ?`).run(id);
    
    // 从全文搜索索引中删除（如果表存在）
    try {
      this.db.prepare(`DELETE FROM zettel_fts WHERE id = ?`).run(id);
    } catch {
      // FTS 表可能不存在，忽略错误
    }
    
    return result.changes > 0;
  }
  
  /**
   * 查询卡片列表
   */
  query(params: QueryNotesParams): ZettelNote[] {
    const conditions: string[] = [];
    const values: any[] = [];
    
    // 构建查询条件
    if (params.type) {
      conditions.push("type = ?");
      values.push(params.type);
    }
    
    if (params.status) {
      conditions.push("status = ?");
      values.push(params.status);
    }
    
    if (params.folder) {
      conditions.push("folder = ?");
      values.push(params.folder);
    }
    
    if (params.sessionKey) {
      conditions.push("session_key = ?");
      values.push(params.sessionKey);
    }
    
    if (params.minConfidence !== undefined) {
      conditions.push("confidence >= ?");
      values.push(params.minConfidence);
    }
    
    if (params.maxConfidence !== undefined) {
      conditions.push("confidence <= ?");
      values.push(params.maxConfidence);
    }
    
    if (params.createdAfter) {
      conditions.push("created_at >= ?");
      values.push(params.createdAfter);
    }
    
    if (params.createdBefore) {
      conditions.push("created_at <= ?");
      values.push(params.createdBefore);
    }
    
    if (params.updatedAfter) {
      conditions.push("updated_at >= ?");
      values.push(params.updatedAfter);
    }
    
    if (params.updatedBefore) {
      conditions.push("updated_at <= ?");
      values.push(params.updatedBefore);
    }
    
    // 链接过滤 (需要子查询)
    if (params.linkedTo) {
      conditions.push(`
        id IN (
          SELECT from_note_id 
          FROM zettel_links 
          WHERE to_note_id = ?
        )
      `);
      values.push(params.linkedTo);
    }
    
    if (params.linkedFrom) {
      conditions.push(`
        id IN (
          SELECT to_note_id 
          FROM zettel_links 
          WHERE from_note_id = ?
        )
      `);
      values.push(params.linkedFrom);
    }
    
    // 标签过滤 (需要子查询)
    if (params.tags && params.tags.length > 0) {
      const placeholders = params.tags.map(() => "?").join(", ");
      conditions.push(`
        id IN (
          SELECT note_id 
          FROM zettel_note_tags 
          WHERE tag_id IN (
            SELECT id FROM zettel_tags WHERE name IN (${placeholders})
          )
        )
      `);
      values.push(...params.tags);
    }
    
    // 构建查询语句
    let query = `
      SELECT
        id, title, content, summary, type, status, folder, reviewed,
        confidence, source, session_key as sessionKey, file_path as filePath,
        created_at as createdAt, updated_at as updatedAt
      FROM zettel_notes
    `;
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }
    
    // 排序
    const ALLOWED_SORT_COLUMNS: Record<string, string> = {
      createdAt: "created_at",
      updatedAt: "updated_at",
      title: "title",
      confidence: "confidence"
    };
    const sortCol = ALLOWED_SORT_COLUMNS[params.sortBy ?? "createdAt"] ?? "created_at";
    const sortDir = params.sortDirection?.toUpperCase() === "ASC" ? "ASC" : "DESC";
    query += ` ORDER BY ${sortCol} ${sortDir}`;
    
    // 分页
    if (params.limit !== undefined) {
      query += ` LIMIT ?`;
      values.push(params.limit);
      
      if (params.offset !== undefined) {
        query += ` OFFSET ?`;
        values.push(params.offset);
      }
    }
    
    // 执行查询
    const rows = this.db.prepare(query).all(...values) as any[];
    
    // 获取每个卡片的标签和链接
    return rows.map(row => {
      const tags = this.getTags(row.id);
      const links = this.getLinksFrom(row.id);
      
      return {
        ...row,
        tags,
        links,
      };
    });
  }
  
  /**
   * 全文搜索（FTS + LIKE 双引擎，支持中文）
   */
  search(query: string, limit: number = DEFAULT_PAGE_LIMIT, filters?: QueryNotesParams): SearchResult[] {
    // 始终执行 LIKE fallback（确保中文也能搜到）
    const fallbackResults = this.fallbackSearch(query, limit, filters);

    // 尝试 FTS 搜索
    let ftsResults: SearchResult[] = [];
    try {
      this.db.prepare("SELECT 1 FROM zettel_fts LIMIT 1").get();

      let whereClause = "WHERE zettel_fts MATCH ?";
      const filterValues: any[] = [query];
      if (filters) {
        if (filters.folder) { whereClause += " AND z.folder = ?"; filterValues.push(filters.folder); }
        if (filters.minConfidence !== undefined) { whereClause += " AND z.confidence >= ?"; filterValues.push(filters.minConfidence); }
        if (filters.maxConfidence !== undefined) { whereClause += " AND z.confidence <= ?"; filterValues.push(filters.maxConfidence); }
        if (filters.createdAfter) { whereClause += " AND z.created_at >= ?"; filterValues.push(filters.createdAfter); }
        if (filters.createdBefore) { whereClause += " AND z.created_at <= ?"; filterValues.push(filters.createdBefore); }
        if (filters.updatedAfter) { whereClause += " AND z.updated_at >= ?"; filterValues.push(filters.updatedAfter); }
        if (filters.updatedBefore) { whereClause += " AND z.updated_at <= ?"; filterValues.push(filters.updatedBefore); }
        if (filters.tags && filters.tags.length > 0) {
          const placeholders = filters.tags.map(() => "?").join(", ");
          whereClause += ` AND z.id IN (SELECT note_id FROM zettel_note_tags WHERE tag_id IN (SELECT id FROM zettel_tags WHERE name IN (${placeholders})))`;
          filterValues.push(...filters.tags);
        }
      }

      const rows = this.db.prepare(`
        SELECT
          z.id, z.title, z.content, z.summary, z.type, z.status, z.folder, z.reviewed,
          z.confidence, z.source, z.session_key as "sessionKey", z.file_path as "filePath",
          z.created_at as "createdAt", z.updated_at as "updatedAt",
          snippet(zettel_fts, 0, '<mark>', '</mark>', '…', FTS_SNIPPET_LENGTH) as snippet,
          rank
        FROM zettel_notes z
        JOIN zettel_fts ON z.id = zettel_fts.id
        ${whereClause}
        ORDER BY rank
        LIMIT ?
      `).all(...filterValues, limit) as any[];

      ftsResults = rows.map(row => {
        const tags = this.getTags(row.id);
        const links = this.getLinksFrom(row.id);
        return {
          note: {
            id: row.id,
            title: row.title,
            content: row.content,
            summary: row.summary,
            type: row.type,
            status: row.status,
            folder: row.folder,
            confidence: row.confidence,
            source: row.source,
            reviewed: row.reviewed,
            sessionKey: row.sessionKey,
            filePath: row.filePath,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            tags,
            links,
          },
          score: 1.0 / (row.rank + 1),
          snippet: row.snippet,
        };
      });
    } catch {
      // FTS 表不存在或查询错误，仅使用 fallback
    }

    // 合并结果并去重（FTS 结果优先）
    const seen = new Set<string>();
    const merged: SearchResult[] = [];

    for (const r of ftsResults) {
      if (!seen.has(r.note.id)) {
        seen.add(r.note.id);
        merged.push(r);
      }
    }

    for (const r of fallbackResults) {
      if (!seen.has(r.note.id)) {
        seen.add(r.note.id);
        merged.push(r);
      }
    }

    return merged.slice(0, limit);
  }
  
  /**
   * 降级搜索（当 FTS 不可用时使用 LIKE 查询）
   */
  private fallbackSearch(query: string, limit: number = DEFAULT_PAGE_LIMIT, filters?: QueryNotesParams): SearchResult[] {
    const searchPattern = `%${query}%`;
    let whereClause = "WHERE (z.title LIKE ? OR z.content LIKE ?)";
    const filterValues: any[] = [searchPattern, searchPattern];
    if (filters) {
      if (filters.folder) { whereClause += " AND z.folder = ?"; filterValues.push(filters.folder); }
      if (filters.minConfidence !== undefined) { whereClause += " AND z.confidence >= ?"; filterValues.push(filters.minConfidence); }
      if (filters.maxConfidence !== undefined) { whereClause += " AND z.confidence <= ?"; filterValues.push(filters.maxConfidence); }
      if (filters.createdAfter) { whereClause += " AND z.created_at >= ?"; filterValues.push(filters.createdAfter); }
      if (filters.createdBefore) { whereClause += " AND z.created_at <= ?"; filterValues.push(filters.createdBefore); }
      if (filters.updatedAfter) { whereClause += " AND z.updated_at >= ?"; filterValues.push(filters.updatedAfter); }
      if (filters.updatedBefore) { whereClause += " AND z.updated_at <= ?"; filterValues.push(filters.updatedBefore); }
      if (filters.tags && filters.tags.length > 0) {
        const placeholders = filters.tags.map(() => "?").join(", ");
        whereClause += ` AND z.id IN (SELECT note_id FROM zettel_note_tags WHERE tag_id IN (SELECT id FROM zettel_tags WHERE name IN (${placeholders})))`;
        filterValues.push(...filters.tags);
      }
    }
    const rows = this.db.prepare(`
      SELECT
        z.id, z.title, z.content, z.summary, z.type, z.status, z.folder, z.reviewed,
        z.confidence, z.source, z.session_key as "sessionKey", z.file_path as "filePath",
        z.created_at as "createdAt", z.updated_at as "updatedAt"
      FROM zettel_notes z
      ${whereClause}
      ORDER BY z.updated_at DESC
      LIMIT ?
    `).all(...filterValues, limit) as any[];
    
    return rows.map(row => {
      const tags = this.getTags(row.id);
      const links = this.getLinksFrom(row.id);
      
      // 生成简单摘要
      const snippet = row.content.substring(0, 100) + (row.content.length > 100 ? '…' : '');
      
      return {
        note: {
          id: row.id,
          title: row.title,
          content: row.content,
          summary: row.summary,
          type: row.type,
          status: row.status,
          folder: row.folder,
          confidence: row.confidence,
          source: row.source,
          reviewed: row.reviewed,
          sessionKey: row.sessionKey,
          filePath: row.filePath,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          tags,
          links,
        },
        score: 0.5, // 降级搜索使用固定得分
        snippet,
      };
    });
  }

  /**
   * 获取所有卡片（无过滤条件）
   */
  getAll(): ZettelNote[] {
    return this.query({});
  }

  /**
   * 获取卡片的标签
   */
  private getTags(noteId: string): string[] {
    const rows = this.db.prepare(`
      SELECT t.name
      FROM zettel_tags t
      JOIN zettel_note_tags nt ON t.id = nt.tag_id
      WHERE nt.note_id = ?
      ORDER BY t.name
    `).all(noteId) as Array<{ name: string }>;
    
    return rows.map(row => row.name);
  }
  
  /**
   * 获取卡片发出的链接
   */
  private getLinksFrom(noteId: string): Link[] {
    const rows = this.db.prepare(`
      SELECT
        to_note_id as "to",
        type,
        context,
        created_at as "createdAt"
      FROM zettel_links
      WHERE from_note_id = ?
      ORDER BY created_at
    `).all(noteId) as any[];
    
    return rows;
  }
  
  /**
   * 插入标签
   */
  private async insertTags(noteId: string, tags: string[]): Promise<void> {
    const insertTag = this.db.prepare(`
      INSERT OR IGNORE INTO zettel_tags (name) VALUES (?)
    `);
    
    const getTagId = this.db.prepare(`
      SELECT id FROM zettel_tags WHERE name = ?
    `);
    
    const insertNoteTag = this.db.prepare(`
      INSERT OR IGNORE INTO zettel_note_tags (note_id, tag_id) VALUES (?, ?)
    `);
    
    for (const tag of tags) {
      insertTag.run(tag);
      const tagRow = getTagId.get(tag) as { id: number } | undefined;
      if (tagRow) {
        insertNoteTag.run(noteId, tagRow.id);
      }
    }
  }
  
  /**
   * 更新标签
   */
  private async updateTags(noteId: string, tags: string[]): Promise<void> {
    // 删除现有标签关联
    this.db.prepare(`DELETE FROM zettel_note_tags WHERE note_id = ?`).run(noteId);
    
    // 插入新标签
    if (tags.length > 0) {
      await this.insertTags(noteId, tags);
    }
  }
  
  /**
   * 插入链接
   */
  private async insertLinks(fromNoteId: string, links: Link[]): Promise<void> {
    const insertLink = this.db.prepare(`
      INSERT OR REPLACE INTO zettel_links
        (from_note_id, to_note_id, type, context, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    for (const link of links) {
      insertLink.run(
        fromNoteId,
        link.to,
        link.type,
        link.context ?? null,
        link.createdAt ?? new Date().toISOString(),
      );
    }
  }
  
  /**
   * 更新链接
   */
  private async updateLinks(fromNoteId: string, links: Link[]): Promise<void> {
    // 删除现有链接
    this.db.prepare(`DELETE FROM zettel_links WHERE from_note_id = ?`).run(fromNoteId);
    
    // 插入新链接
    if (links.length > 0) {
      await this.insertLinks(fromNoteId, links);
    }
  }
  
  /**
   * 更新全文搜索索引
   */
  private updateFtsIndex(note: ZettelNote): void {
    try {
      // 删除现有记录
      this.db.prepare(`DELETE FROM zettel_fts WHERE id = ?`).run(note.id);
      
      // 插入新记录
      this.db.prepare(`
        INSERT INTO zettel_fts (id, title, content, summary)
        VALUES (?, ?, ?, ?)
      `).run(
        note.id,
        note.title,
        note.content,
        note.summary || "",
      );
    } catch {
      // FTS 表可能不存在，忽略错误
    }
  }

  /**
   * 将笔记持久化为 Markdown 文件
   */
  private async writeNoteFile(note: ZettelNote): Promise<void> {
    if (!this.templateManager) return;

    try {
      await this.templateManager.createNoteFile(note.filePath, note.type, {
        id: note.id,
        title: note.title,
        content: note.content,
        summary: note.summary,
        tags: note.tags,
        created_at: note.createdAt,
        updated_at: note.updatedAt,
      });
    } catch (err) {
      console.warn(
        `[NoteRepository] Failed to write note file ${note.filePath}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}