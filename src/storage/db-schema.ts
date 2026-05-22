import type { DatabaseSync } from "node:sqlite";

function validateIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return name;
}

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
  ensureMetaValue(db, "schema_version", "2.1.0");
  ensureMetaValue(db, "created_at", new Date().toISOString());
  
  // Phase 3: Wave 1 - 知识发光度与归档支持
  ensurePhase3Wave1Schema(db);
  
  // Wave 2: 归档历史记录
  ensureArchiveLogTable(db);
  
  // Phase 5: 人机共生与反馈 - 创建审核和反馈相关表
  ensurePhase5Schema(db);
  
  return { ftsAvailable, ...(ftsError ? { ftsError } : {}) };
}

/**
 * Phase 3 Wave 1: 知识发光度与归档支持
 * - zettel_note_stats 预计算统计表
 * - folder 列支持 archive（兼容旧数据库迁移）
 */
function ensurePhase3Wave1Schema(db: DatabaseSync): void {
  // 1. 兼容旧数据库：检查 zettel_notes 是否支持 archive folder
  const tableInfo = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='zettel_notes'`)
    .get() as { sql: string } | undefined;
  
  if (tableInfo && !tableInfo.sql.includes("'archive'")) {
    // 旧表不含 archive，需要重建
    migrateNotesTableForArchive(db);
  }
  
  // 2. 创建发光度统计表
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_note_stats (
      note_id TEXT PRIMARY KEY REFERENCES zettel_notes(id) ON DELETE CASCADE,
      pagerank_score REAL DEFAULT 0,
      backlink_count INTEGER DEFAULT 0,
      outgoing_link_count INTEGER DEFAULT 0,
      days_since_created INTEGER DEFAULT 0,
      days_since_updated INTEGER DEFAULT 0,
      glow_score REAL DEFAULT 0,
      decay_factor REAL DEFAULT 0,
      glow_status TEXT DEFAULT 'stable' CHECK (glow_status IN ('evergreen', 'active', 'stable', 'zombie')),
      last_calculated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  
  // 3. 创建索引
  db.exec(`CREATE INDEX IF NOT EXISTS idx_note_stats_glow ON zettel_note_stats(glow_score DESC);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_note_stats_status ON zettel_note_stats(glow_status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_folder ON zettel_notes(folder);`);
}

/**
 * 迁移 zettel_notes 表以支持 archive folder
 * SQLite 不支持修改 CHECK 约束，必须重建表
 */
function migrateNotesTableForArchive(db: DatabaseSync): void {
  db.exec(`PRAGMA foreign_keys = OFF;`);
  db.exec(`BEGIN TRANSACTION;`);
  
  try {
    // 1. 创建新表（含 archive）
    db.exec(`
      CREATE TABLE zettel_notes_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        type TEXT NOT NULL CHECK (type IN ('atomic', 'structure', 'source')),
        status TEXT NOT NULL CHECK (status IN ('FLEETING', 'LITERATURE', 'PERMANENT')),
        folder TEXT NOT NULL CHECK (folder IN ('inbox', 'references', 'zettels', 'archive')) DEFAULT 'inbox',
        confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
        source TEXT CHECK (source IN ('manual', 'distilled', 'ceqrc')),
        reviewed BOOLEAN NOT NULL DEFAULT FALSE,
        session_key TEXT,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    
    // 2. 复制数据
    db.exec(`
      INSERT INTO zettel_notes_new
      SELECT id, title, content, summary, type, status, folder, confidence, source, reviewed, session_key, file_path, created_at, updated_at
      FROM zettel_notes;
    `);
    
    // 3. 删除旧表（外键约束会自动处理关联表）
    db.exec(`DROP TABLE zettel_notes;`);
    
    // 4. 重命名新表
    db.exec(`ALTER TABLE zettel_notes_new RENAME TO zettel_notes;`);
    
    // 5. 重建索引
    db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_notes_type ON zettel_notes(type);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_notes_status ON zettel_notes(status);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_notes_session_key ON zettel_notes(session_key);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_notes_created_at ON zettel_notes(created_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_notes_updated_at ON zettel_notes(updated_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_folder ON zettel_notes(folder);`);
    
    db.exec(`COMMIT;`);
  } catch (err) {
    db.exec(`ROLLBACK;`);
    throw err;
  } finally {
    db.exec(`PRAGMA foreign_keys = ON;`);
  }
}

/**
 * Phase 5: 人机共生与反馈 Schema
 * 创建审核、反馈、提示词版本和样本策划相关表
 */
function ensurePhase5Schema(db: DatabaseSync): void {
  // [迁移] Phase 5 旧 Schema 检测与清理
  // 由于此前为"死代码"状态，无实际数据，安全删除重建
  const oldTables = [
    { table: 'zettel_prompt_versions', oldColumn: 'name' },
    { table: 'zettel_sample_curations', oldColumn: 'quality_score' },
    { table: 'zettel_system_tunings', oldColumn: '' },
  ];
  
  for (const { table, oldColumn } of oldTables) {
    const exists = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table) !== undefined;
    if (!exists) continue;
    
    let isOld = false;
    try {
      if (oldColumn) {
        const validatedTable = validateIdentifier(table);
        const cols = db.prepare(`PRAGMA table_info(${validatedTable})`).all() as Array<{ name: string }>;
        isOld = cols.some(c => c.name === oldColumn);
      } else {
        // 旧版 system_tunings 有 parameter_name UNIQUE 约束
        const tblSql = db
          .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
          .get(table) as { sql: string } | undefined;
        isOld = tblSql?.sql?.includes('parameter_name TEXT NOT NULL UNIQUE') ?? false;
      }
    } catch { isOld = false; }
    
    if (isOld) {
      const validatedTable = validateIdentifier(table);
      db.exec(`DROP TABLE IF EXISTS ${validatedTable};`);
    }
  }
  
  // 清理旧索引
  const staleIndexes = [
    'idx_zettel_prompts_name',
    'idx_zettel_prompts_purpose',
    'idx_zettel_samples_featured',
    'idx_zettel_samples_score',
  ];
  for (const idx of staleIndexes) {
    const validatedIdx = validateIdentifier(idx);
    db.exec(`DROP INDEX IF EXISTS ${validatedIdx};`);
  }
  
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
  
  // 提示词版本表（与 prompt-version-repository.ts 对齐）
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_prompt_versions (
      id TEXT PRIMARY KEY,
      prompt_type TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      usage_count INTEGER NOT NULL DEFAULT 0,
      average_score REAL,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      activated_at TEXT,
      UNIQUE(prompt_type, version)
    );
  `);
  
  // 样本策划表（与 sample-curation-repository.ts 对齐）
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_sample_curations (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      quality_relevance REAL,
      quality_clarity REAL,
      quality_atomicity REAL,
      quality_connectivity REAL,
      quality_overall REAL,
      curation_status TEXT NOT NULL DEFAULT 'pending',
      curator_id TEXT,
      curation_notes TEXT,
      export_batch_id TEXT,
      metadata TEXT,
      curated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (note_id) REFERENCES zettel_notes(id) ON DELETE CASCADE
    );
  `);
  
  // 导出批次表（sample-curation-repository.ts 使用）
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_export_batches (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      sample_count INTEGER NOT NULL DEFAULT 0,
      format TEXT,
      file_path TEXT,
      exported_by TEXT,
      exported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  
  // 系统调优参数表（与 system-tuning-repository.ts 对齐；parameter_name 不加 UNIQUE，支持历史记录）
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_system_tunings (
      id TEXT PRIMARY KEY,
      parameter_name TEXT NOT NULL,
      parameter_value TEXT NOT NULL,
      previous_value TEXT,
      change_reason TEXT,
      feedback_id TEXT,
      auto_tuned BOOLEAN NOT NULL DEFAULT FALSE,
      tuning_score REAL CHECK (tuning_score >= 0 AND tuning_score <= 1),
      metadata TEXT,
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
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_prompts_type ON zettel_prompt_versions(prompt_type);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_prompts_active ON zettel_prompt_versions(is_active);`);
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_samples_note ON zettel_sample_curations(note_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_samples_status ON zettel_sample_curations(curation_status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zettel_samples_overall ON zettel_sample_curations(quality_overall);`);
  
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
  validateIdentifier(table);
  validateIdentifier(column);
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

/**
 * Wave 2: 归档历史记录表
 * 记录所有归档/恢复操作，支持审计和撤销
 */
export function ensureArchiveLogTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS zettel_archive_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id TEXT NOT NULL REFERENCES zettel_notes(id) ON DELETE CASCADE,
      note_title TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('archive', 'unarchive', 'auto_archive')),
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_archive_log_note_id ON zettel_archive_log(note_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_archive_log_created_at ON zettel_archive_log(created_at);`);
}