import type { DatabaseSync } from "node:sqlite";

export interface TagStats {
  name: string;
  count: number;
  firstUsed: string;
  lastUsed: string;
}

export class TagRepository {
  constructor(private db: DatabaseSync) {}
  
  /**
   * 获取所有标签
   */
  getAll(): Array<{ name: string; description?: string; count: number }> {
    const rows = this.db.prepare(`
      SELECT 
        t.name,
        t.description,
        COUNT(nt.note_id) as count,
        MIN(z.created_at) as first_used,
        MAX(z.created_at) as last_used
      FROM zettel_tags t
      LEFT JOIN zettel_note_tags nt ON t.id = nt.tag_id
      LEFT JOIN zettel_notes z ON nt.note_id = z.id
      GROUP BY t.id, t.name, t.description
      ORDER BY count DESC, t.name
    `).all() as any[];
    
    return rows.map(row => ({
      name: row.name,
      description: row.description || undefined,
      count: row.count,
      firstUsed: row.first_used,
      lastUsed: row.last_used,
    }));
  }
  
  /**
   * 按标签查询卡片 ID
   */
  getNotesByTag(tagName: string): string[] {
    const rows = this.db.prepare(`
      SELECT nt.note_id
      FROM zettel_note_tags nt
      JOIN zettel_tags t ON nt.tag_id = t.id
      WHERE t.name = ?
      ORDER BY nt.created_at DESC
    `).all(tagName) as Array<{ note_id: string }>;
    
    return rows.map(row => row.note_id);
  }
  
  /**
   * 获取卡片的所有标签
   */
  getTagsByNote(noteId: string): string[] {
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
   * 获取标签统计信息
   */
  getStats(): TagStats[] {
    const rows = this.db.prepare(`
      SELECT 
        t.name,
        COUNT(nt.note_id) as count,
        MIN(z.created_at) as first_used,
        MAX(z.created_at) as last_used
      FROM zettel_tags t
      LEFT JOIN zettel_note_tags nt ON t.id = nt.tag_id
      LEFT JOIN zettel_notes z ON nt.note_id = z.id
      GROUP BY t.id, t.name
      ORDER BY count DESC
    `).all() as any[];
    
    return rows.map(row => ({
      name: row.name,
      count: row.count,
      firstUsed: row.first_used,
      lastUsed: row.last_used,
    }));
  }
  
  /**
   * 创建或获取标签
   */
  ensureTag(name: string, description?: string): number {
    // 尝试插入，如果已存在则忽略
    this.db.prepare(`
      INSERT OR IGNORE INTO zettel_tags (name, description)
      VALUES (?, ?)
    `).run(name, description ?? null);
    
    // 获取标签ID
    const row = this.db.prepare(`
      SELECT id FROM zettel_tags WHERE name = ?
    `).get(name) as { id: number } | undefined;
    
    return row?.id ?? -1;
  }
  
  /**
   * 更新标签描述
   */
  updateTag(name: string, description: string): boolean {
    const result = this.db.prepare(`
      UPDATE zettel_tags 
      SET description = ? 
      WHERE name = ?
    `).run(description, name);
    
    return result.changes > 0;
  }
  
  /**
   * 删除标签 (如果未被使用)
   */
  deleteTag(name: string): boolean {
    // 检查是否被使用
    const usage = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM zettel_note_tags nt
      JOIN zettel_tags t ON nt.tag_id = t.id
      WHERE t.name = ?
    `).get(name) as { count: number };
    
    if (usage.count > 0) {
      return false; // 标签正在使用中，不能删除
    }
    
    const result = this.db.prepare(`
      DELETE FROM zettel_tags WHERE name = ?
    `).run(name);
    
    return result.changes > 0;
  }
  
  /**
   * 批量更新卡片的标签
   */
  updateNoteTags(noteId: string, tags: string[]): void {
    // node:sqlite 不支持 transaction() 方法，手动执行事务
    this.db.exec('BEGIN TRANSACTION');
    try {
      // 删除现有标签关联
      this.db.prepare(`
        DELETE FROM zettel_note_tags WHERE note_id = ?
      `).run(noteId);
      
      // 添加新标签关联
      for (const tagName of tags) {
        const tagId = this.ensureTag(tagName);
        if (tagId > 0) {
          this.db.prepare(`
            INSERT OR IGNORE INTO zettel_note_tags (note_id, tag_id)
            VALUES (?, ?)
          `).run(noteId, tagId);
        }
      }
      
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  
  /**
   * 搜索标签 (前缀匹配)
   */
  searchTags(query: string, limit: number = 20): Array<{ name: string; count: number }> {
    const rows = this.db.prepare(`
      SELECT 
        t.name,
        COUNT(nt.note_id) as count
      FROM zettel_tags t
      LEFT JOIN zettel_note_tags nt ON t.id = nt.tag_id
      WHERE t.name LIKE ? || '%'
      GROUP BY t.id, t.name
      ORDER BY count DESC, t.name
      LIMIT ?
    `).all(query, limit) as any[];
    
    return rows;
  }
  
  /**
   * 获取热门标签
   */
  getPopularTags(limit: number = 20): Array<{ name: string; count: number }> {
    const rows = this.db.prepare(`
      SELECT 
        t.name,
        COUNT(nt.note_id) as count
      FROM zettel_tags t
      LEFT JOIN zettel_note_tags nt ON t.id = nt.tag_id
      GROUP BY t.id, t.name
      ORDER BY count DESC
      LIMIT ?
    `).all(limit) as any[];
    
    return rows;
  }
}