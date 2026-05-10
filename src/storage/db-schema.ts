import type { DatabaseSync } from "node:sqlite";

export interface ZettelkastenSchemaParams {
  /** 数据库实例 */
  db: DatabaseSync;
  /** 是否启用全文搜索 */
  ftsEnabled?: boolean;
  /** FTS tokenizer 类型 */
  ftsTokenizer?: "unicode61" | "trigram";
}

/**
 * 确保 Zettelkasten 数据库 Schema 存在
 */
export function ensureZettelkastenSchema(
  params: ZettelkastenSchemaParams
): { ftsAvailable: boolean; ftsError?: string } {
  const { db } = params;
  const ftsEnabled = params.ftsEnabled ?? true;
  const ftsTokenizer = params.ftsTokenizer ?? "unicode61";
  
  // 创建元数据表
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  
  // 创建核心笔记表
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT,
      type TEXT NOT NULL CHECK (type IN ('atomic', 'structure', 'source')),
      status TEXT NOT NULL CHECK (status IN ('FLEETING', 'LITERATURE', 'PERMANENT')),
      folder TEXT NOT NULL CHECK (folder IN ('inbox', 'references', 'zettels')) DEFAULT 'inbox',
      confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
      source TEXT CHECK (source IN ('manual', 'distilled', 'ceqrc')),
      reviewed BOOLEAN NOT NULL DEFAULT FALSE,
      session_key TEXT,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  
  // 创建标签表
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  
  // 创建笔记-标签关联表
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_note_tags (
      note_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (note_id, tag_id),
      FOREIGN KEY (note_id) REFERENCES zettel_notes(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES zettel_tags(id) ON DELETE CASCADE
    );
  `);
  
  // 创建链接表
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_note_id TEXT NOT NULL,
      to_note_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN (
        'supports', 'supported_by',
        'refines', 'refined_by',
        'extends', 'extended_by',
        'contradicts', 'contradicted_by',
        'is_example_of', 'has_example',
        'related'
      )),
      context TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (from_note_id) REFERENCES zettel_notes(id) ON DELETE CASCADE,
      FOREIGN KEY (to_note_id) REFERENCES zettel_notes(id) ON DELETE CASCADE,
      UNIQUE(from_note_id, to_note_id, type)
    );
  `);
  
  // 创建索引
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_notes_type ON zettel_notes(type);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_notes_status ON zettel_notes(status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_notes_session_key ON zettel_notes(session_key);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_notes_created_at ON zettel_notes(created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_notes_updated_at ON zettel_notes(updated_at);`);
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_links_from ON zettel_links(from_note_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_links_to ON zettel_links(to_note_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_links_type ON zettel_links(type);`);
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_note_tags_note ON zettel_note_tags(note_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_note_tags_tag ON zettel_note_tags(tag_id);`);
  
  // 全文搜索表
  let ftsAvailable = false;
  let ftsError: string | undefined;
  
  if (ftsEnabled) {
    try {
      const tokenizeClause = ftsTokenizer === "trigram" 
        ? `, tokenize='trigram case_sensitive 0'` 
        : "";
      
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS zettel_fts USING fts5(
          title,
          content,
          summary,
          id UNINDEXED,
          type UNINDEXED,
          status UNINDEXED,
          ${tokenizeClause}
        );
      `);
      
      ftsAvailable = true;
    } catch (err) {
      ftsAvailable = false;
      ftsError = err instanceof Error ? err.message : String(err);
    }
  }
  
  // 插入初始元数据
  ensureMetaValue(db, "schema_version", "2.0.0");
  ensureMetaValue(db, "created_at", new Date().toISOString());
  
  // Phase 5: 人机共生与反馈 - 创建审核和反馈相关表
  ensurePhase5Schema(db);
  
  return { ftsAvailable, ...(ftsError ? { ftsError } : {}) };
}

/**
 * Phase 5: 人机共生与反馈 Schema
 * 创建审核、反馈、提示词版本和样本策划相关表
 */
function ensurePhase5Schema(db: DatabaseSync): void {
  // 审核记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_reviews (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL CHECK (target_type IN ('note', 'link', 'tag', 'system')),
      target_id TEXT NOT NULL,
      reviewer_id TEXT,
      action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'modify', 'flag')),
      previous_confidence REAL CHECK (previous_confidence >= 0 AND previous_confidence <= 1),
      new_confidence REAL CHECK (new_confidence >= 0 AND new_confidence <= 1),
      previous_folder TEXT,
      new_folder TEXT,
      comment TEXT,
      metadata TEXT, -- JSON 存储额外信息
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  
  // 用户反馈表
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_feedback (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL CHECK (target_type IN ('note', 'link', 'tag', 'system', 'prompt')),
      target_id TEXT NOT NULL,
      feedback_type TEXT NOT NULL CHECK (feedback_type IN ('thumbs_up', 'thumbs_down', 'comment', 'correction', 'suggestion')),
      source TEXT CHECK (source IN ('user', 'agent', 'system')),
      source_id TEXT,
      content TEXT,
      rating INTEGER CHECK (rating >= 1 AND rating <= 5),
      user_id TEXT,
      session_id TEXT,
      metadata TEXT, -- JSON 存储额外信息
      processed BOOLEAN NOT NULL DEFAULT FALSE,
      processed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  
  // 提示词版本表
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_prompt_versions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      content TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose IN ('ceqrc', 'distill', 'dedupe', 'confidence', 'link_suggestion', 'custom')),
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      effectiveness_score REAL DEFAULT 0 CHECK (effectiveness_score >= 0 AND effectiveness_score <= 1),
      usage_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      metadata TEXT, -- JSON 存储额外信息
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(name, version)
    );
  `);
  
  // 样本策划表
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_sample_curations (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      quality_score REAL NOT NULL CHECK (quality_score >= 0 AND quality_score <= 1),
      feedback_count INTEGER NOT NULL DEFAULT 0,
      positive_feedback_count INTEGER NOT NULL DEFAULT 0,
      is_featured BOOLEAN NOT NULL DEFAULT FALSE,
      curation_tags TEXT, -- JSON 数组
      curation_reason TEXT,
      curated_by TEXT,
      curated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (note_id) REFERENCES zettel_notes(id) ON DELETE CASCADE
    );
  `);
  
  // 系统调优参数表
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_system_tunings (
      id TEXT PRIMARY KEY,
      parameter_name TEXT NOT NULL UNIQUE,
      parameter_value TEXT NOT NULL,
      previous_value TEXT,
      change_reason TEXT,
      feedback_id TEXT,
      auto_tuned BOOLEAN NOT NULL DEFAULT FALSE,
      tuning_score REAL CHECK (tuning_score >= 0 AND tuning_score <= 1),
      metadata TEXT, -- JSON 存储额外信息
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (feedback_id) REFERENCES zettel_feedback(id) ON DELETE SET NULL
    );
  `);
  
  // 反馈统计表（预计算以提高查询性能）
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_feedback_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      total_feedback INTEGER NOT NULL DEFAULT 0,
      positive_count INTEGER NOT NULL DEFAULT 0,
      negative_count INTEGER NOT NULL DEFAULT 0,
      average_rating REAL,
      last_feedback_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(target_type, target_id)
    );
  `);
  
  // 创建索引
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_reviews_target ON zettel_reviews(target_type, target_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_reviews_reviewer ON zettel_reviews(reviewer_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_reviews_created ON zettel_reviews(created_at);`);
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_feedback_target ON zettel_feedback(target_type, target_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_feedback_user ON zettel_feedback(user_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_feedback_type ON zettel_feedback(feedback_type);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_feedback_processed ON zettel_feedback(processed);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_feedback_created ON zettel_feedback(created_at);`);
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_prompts_name ON zettel_prompt_versions(name);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_prompts_active ON zettel_prompt_versions(is_active);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_prompts_purpose ON zettel_prompt_versions(purpose);`);
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_samples_note ON zettel_sample_curations(note_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_samples_featured ON zettel_sample_curations(is_featured);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_samples_score ON zettel_sample_curations(quality_score);`);
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_tunings_name ON zettel_system_tunings(parameter_name);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_tunings_auto ON zettel_system_tunings(auto_tuned);`);
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_feedback_stats_target ON zettel_feedback_stats(target_type, target_id);`);
}

/**
 * 确保元数据表中的值存在
 */
function ensureMetaValue(db: DatabaseSync, key: string, value: string): void {
  const existing = db
    .prepare(`SELECT value FROM zettel_meta WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  
  if (!existing) {
    db
      .prepare(`INSERT INTO zettel_meta (key, value) VALUES (?, ?)`)
      .run(key, value);
  }
}

/**
 * 检查并更新数据库列
 */
export function ensureColumn(
  db: DatabaseSync,
  table: string,
  column: string,
  definition: string
): void {
  const rows = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  
  if (!rows.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * 获取数据库 Schema 版本
 */
export function getSchemaVersion(db: DatabaseSync): string | null {
  const row = db
    .prepare(`SELECT value FROM zettel_meta WHERE key = ?`)
    .get("schema_version") as { value: string } | undefined;
  
  return row?.value ?? null;
}

/**
 * 获取数据库统计信息
 */
export function getDatabaseStats(db: DatabaseSync): {
  notes: number;
  links: number;
  tags: number;
  noteTags: number;
} {
  const notes = db
    .prepare(`SELECT COUNT(*) as count FROM zettel_notes`)
    .get() as { count: number };
  
  const links = db
    .prepare(`SELECT COUNT(*) as count FROM zettel_links`)
    .get() as { count: number };
  
  const tags = db
    .prepare(`SELECT COUNT(*) as count FROM zettel_tags`)
    .get() as { count: number };
  
  const noteTags = db
    .prepare(`SELECT COUNT(*) as count FROM zettel_note_tags`)
    .get() as { count: number };
  
  return {
    notes: notes.count,
    links: links.count,
    tags: tags.count,
    noteTags: noteTags.count,
  };
}