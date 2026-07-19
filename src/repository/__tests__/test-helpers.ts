/**
 * Repository 测试工具函数
 *
 * 提供内存数据库设置和测试数据工厂
 */

import { DatabaseSync } from "node:sqlite";
import { ensureZettelkastenSchema } from "../../storage/db-schema.js";
import type { LinkType, NoteType, NoteFolder, SourceType } from "../../core/types.js";

/**
 * 创建内存测试数据库
 */
export function createTestDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  ensureZettelkastenSchema({ db, ftsEnabled: false });
  return db;
}

/**
 * 关闭测试数据库
 */
export function closeTestDatabase(db: DatabaseSync): void {
  db.close();
}

/**
 * 测试数据工厂 - 创建笔记数据
 */
export function createTestNoteData(overrides: Partial<{
  title: string;
  content: string;
  type: NoteType;
  folder: NoteFolder;
  confidence: number;
  source: SourceType;
  tags: string[];
  links: Array<{ to: string; type: LinkType; context?: string }>;
  sessionKey: string;
  generateSummary?: boolean;
}> = {}) {
  return {
    title: overrides.title ?? "测试笔记标题",
    content: overrides.content ?? "这是测试笔记的内容，包含足够的文字来通过原子化检查。",
    type: overrides.type ?? "atomic",
    folder: overrides.folder,
    confidence: overrides.confidence ?? 0.8,
    source: overrides.source ?? "manual",
    tags: overrides.tags ?? [],
    links: overrides.links ?? [],
    sessionKey: overrides.sessionKey,
    generateSummary: overrides.generateSummary ?? true,
  };
}

/**
 * 测试数据工厂 - 创建链接数据
 */
export function createTestLinkData(overrides: Partial<{
  fromNoteId: string;
  toNoteId: string;
  type: string;
  context: string;
}> = {}) {
  return {
    fromNoteId: overrides.fromNoteId ?? "note-1",
    toNoteId: overrides.toNoteId ?? "note-2",
    type: overrides.type ?? "related",
    context: overrides.context ?? "测试链接上下文",
  };
}

/**
 * 测试数据工厂 - 创建标签数据
 */
export function createTestTagData(name: string, description?: string) {
  return {
    name,
    description,
  };
}

/**
 * 生成唯一 ID
 */
export function generateTestId(prefix: string = "test"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 清理数据库中的所有数据
 */
export function clearDatabase(db: DatabaseSync): void {
  db.exec(`
    DELETE FROM zettel_note_tags;
    DELETE FROM zettel_links;
    DELETE FROM zettel_tags;
    DELETE FROM zettel_notes;
    DELETE FROM zettel_meta;
  `);
}
