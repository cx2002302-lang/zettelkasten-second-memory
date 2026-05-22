import type { DatabaseSync } from "node:sqlite";
import type { Link, LinkType } from "../core/types.js";
import { getReverseLinkType } from "../core/utils.js";

export interface LinkStats {
  total: number;
  byType: Record<LinkType, number>;
  popularSources: Array<{ noteId: string; linkCount: number }>;
  popularTargets: Array<{ noteId: string; linkCount: number }>;
}

export class LinkRepository {
  constructor(private db: DatabaseSync) {}
  
  /**
   * 创建链接
   */
  create(fromNoteId: string, toNoteId: string, type: LinkType, context?: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO zettel_links
        (from_note_id, to_note_id, type, context, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(fromNoteId, toNoteId, type, context ?? null);
  }
  
  /**
   * 删除链接
   */
  delete(fromNoteId: string, toNoteId: string, type: LinkType): boolean {
    const result = this.db.prepare(`
      DELETE FROM zettel_links 
      WHERE from_note_id = ? AND to_note_id = ? AND type = ?
    `).run(fromNoteId, toNoteId, type);
    
    return result.changes > 0;
  }
  
  /**
   * 获取卡片发出的链接
   */
  getLinksFrom(noteId: string): Link[] {
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
   * 获取指向卡片的链接 (反向链接)
   */
  getLinksTo(noteId: string): Link[] {
    const rows = this.db.prepare(`
      SELECT
        from_note_id as "from",
        type,
        context,
        created_at as "createdAt"
      FROM zettel_links
      WHERE to_note_id = ?
      ORDER BY created_at
    `).all(noteId) as any[];
    
    // 转换为 Link 格式，但需要调整类型方向
    return rows.map(row => ({
      to: row.from, // 注意：这里返回的是链接来源
      type: getReverseLinkType(row.type) as LinkType,
      context: row.context,
      createdAt: row.createdAt,
    }));
  }
  
  /**
   * 获取两张卡片之间的所有链接
   */
  getLinksBetween(noteId1: string, noteId2: string): Link[] {
    const rows = this.db.prepare(`
      SELECT 
        from_note_id,
        to_note_id,
        type,
        context,
        created_at as createdAt
      FROM zettel_links
      WHERE (from_note_id = ? AND to_note_id = ?)
         OR (from_note_id = ? AND to_note_id = ?)
      ORDER BY created_at
    `).all(noteId1, noteId2, noteId2, noteId1) as any[];
    
    return rows.map(row => ({
      to: row.to_note_id,
      type: row.type,
      context: row.context,
      createdAt: row.createdAt,
    }));
  }
  
  /**
   * 获取路径 (最短路径算法简化版)
   */
  findPath(fromNoteId: string, toNoteId: string, maxDepth: number = 6): string[] | null {
    // 使用递归 CTE 查找路径
    const rows = this.db.prepare(`
      WITH RECURSIVE path_cte AS (
        -- 起始节点
        SELECT 
          from_note_id, 
          to_note_id, 
          1 as depth,
          from_note_id || ',' || to_note_id as path
        FROM zettel_links
        WHERE from_note_id = ?
        
        UNION ALL
        
        -- 递归查找
        SELECT 
          l.from_note_id,
          l.to_note_id,
          cte.depth + 1,
          cte.path || ',' || l.to_note_id
        FROM zettel_links l
        JOIN path_cte cte ON l.from_note_id = cte.to_note_id
        WHERE cte.depth < ?
          AND l.to_note_id != cte.from_note_id  -- 避免循环
          AND NOT cte.path LIKE '%' || l.to_note_id || '%'  -- 避免重复节点
      )
      SELECT path
      FROM path_cte
      WHERE to_note_id = ?
      LIMIT 1
    `).all(fromNoteId, maxDepth, toNoteId) as Array<{ path: string }>;
    
    if (rows.length === 0) {
      return null;
    }
    
    // 解析路径字符串
    return rows[0].path.split(",");
  }
  
  /**
   * 获取链接统计信息
   */
  getStats(): LinkStats {
    // 总链接数
    const totalResult = this.db.prepare(`
      SELECT COUNT(*) as count FROM zettel_links
    `).get() as { count: number };
    
    // 按类型统计
    const typeResults = this.db.prepare(`
      SELECT type, COUNT(*) as count
      FROM zettel_links
      GROUP BY type
      ORDER BY count DESC
    `).all() as Array<{ type: LinkType; count: number }>;
    
    // 最常链接的源卡片
    const sourceResults = this.db.prepare(`
      SELECT from_note_id as noteId, COUNT(*) as linkCount
      FROM zettel_links
      GROUP BY from_note_id
      ORDER BY linkCount DESC
      LIMIT 10
    `).all() as Array<{ noteId: string; linkCount: number }>;
    
    // 最常链接的目标卡片
    const targetResults = this.db.prepare(`
      SELECT to_note_id as noteId, COUNT(*) as linkCount
      FROM zettel_links
      GROUP BY to_note_id
      ORDER BY linkCount DESC
      LIMIT 10
    `).all() as Array<{ noteId: string; linkCount: number }>;
    
    const byType: Record<LinkType, number> = {} as any;
    typeResults.forEach(row => {
      byType[row.type] = row.count;
    });
    
    return {
      total: totalResult.count,
      byType,
      popularSources: sourceResults,
      popularTargets: targetResults,
    };
  }
  
  /**
   * 删除卡片发出的所有链接
   */
  deleteBySource(fromNoteId: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM zettel_links
      WHERE from_note_id = ?
    `).run(fromNoteId);
    
    return result.changes > 0;
  }
  
  /**
   * 删除指向卡片的所有链接
   */
  deleteByTarget(toNoteId: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM zettel_links
      WHERE to_note_id = ?
    `).run(toNoteId);
    
    return result.changes > 0;
  }
  

}