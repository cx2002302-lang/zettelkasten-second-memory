/**
 * db-schema 单元测试
 *
 * 测试覆盖：
 * 1. 全新数据库创建全部核心表（含 Phase 6）
 * 2. schema_version 初始化为当前版本
 * 3. 2.0.0 → 2.1.0 迁移：补齐 Phase 6 表并推进版本
 * 4. 未知版本回退：幂等应用迁移并对齐版本
 * 5. 幂等性：重复调用不产生错误
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  ensureZettelkastenSchema,
  getSchemaVersion,
  SCHEMA_VERSION,
} from "../db-schema.js";

const CORE_TABLES = [
  "zettel_meta",
  "zettel_notes",
  "zettel_tags",
  "zettel_note_tags",
  "zettel_links",
  "zettel_note_stats",
  "zettel_archive_log",
  "zettel_reviews",
  "zettel_feedback",
  "zettel_prompt_versions",
  "zettel_sample_curations",
  "zettel_system_tunings",
  "zettel_feedback_stats",
  "zettel_export_batches",
];

const PHASE6_TABLES = [
  "zettel_serendipity",
  "zettel_moc_suggestions",
  "zettel_audit_reports",
];

const PHASE6_INDEXES = [
  "idx_serendipity_score",
  "idx_serendipity_status",
  "idx_moc_status",
  "idx_audit_created",
];

function tableExists(db: DatabaseSync, name: string): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name) !== undefined
  );
}

function indexExists(db: DatabaseSync, name: string): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?`)
      .get(name) !== undefined
  );
}

describe("db-schema", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  describe("ensureZettelkastenSchema (fresh database)", () => {
    it("should create all core tables including Phase 6", () => {
      ensureZettelkastenSchema({ db, ftsEnabled: false });

      for (const table of [...CORE_TABLES, ...PHASE6_TABLES]) {
        expect(tableExists(db, table), `missing table: ${table}`).toBe(true);
      }
    });

    it("should create Phase 6 indexes", () => {
      ensureZettelkastenSchema({ db, ftsEnabled: false });

      for (const index of PHASE6_INDEXES) {
        expect(indexExists(db, index), `missing index: ${index}`).toBe(true);
      }
    });

    it("should initialize schema_version to current version", () => {
      ensureZettelkastenSchema({ db, ftsEnabled: false });
      expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    });

    it("should be idempotent", () => {
      ensureZettelkastenSchema({ db, ftsEnabled: false });
      expect(() => ensureZettelkastenSchema({ db, ftsEnabled: false })).not.toThrow();
      expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    });
  });

  describe("schema migrations", () => {
    function downgradeTo200(): void {
      // 模拟 2.0.0 数据库：无 Phase 6 表，版本标记为 2.0.0
      for (const table of PHASE6_TABLES) {
        db.exec(`DROP TABLE IF EXISTS ${table}`);
      }
      db.prepare(`UPDATE zettel_meta SET value = ? WHERE key = 'schema_version'`).run("2.0.0");
    }

    it("should migrate 2.0.0 → 2.1.0 by adding Phase 6 tables", () => {
      ensureZettelkastenSchema({ db, ftsEnabled: false });
      downgradeTo200();
      expect(getSchemaVersion(db)).toBe("2.0.0");
      for (const table of PHASE6_TABLES) {
        expect(tableExists(db, table)).toBe(false);
      }

      ensureZettelkastenSchema({ db, ftsEnabled: false });

      expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
      for (const table of PHASE6_TABLES) {
        expect(tableExists(db, table), `missing table: ${table}`).toBe(true);
      }
      for (const index of PHASE6_INDEXES) {
        expect(indexExists(db, index), `missing index: ${index}`).toBe(true);
      }
    });

    it("should preserve Phase 6 data across repeated ensure calls", () => {
      ensureZettelkastenSchema({ db, ftsEnabled: false });
      db.prepare(
        `INSERT INTO zettel_audit_reports (report_json, schedule) VALUES (?, ?)`
      ).run(JSON.stringify({ totalNotes: 1 }), "weekly");

      ensureZettelkastenSchema({ db, ftsEnabled: false });

      const row = db
        .prepare(`SELECT COUNT(*) as c FROM zettel_audit_reports`)
        .get() as { c: number };
      expect(row.c).toBe(1);
    });

    it("should fall back gracefully for unknown versions", () => {
      ensureZettelkastenSchema({ db, ftsEnabled: false });
      db.prepare(`UPDATE zettel_meta SET value = ? WHERE key = 'schema_version'`).run("1.0.0");

      expect(() => ensureZettelkastenSchema({ db, ftsEnabled: false })).not.toThrow();
      expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
      for (const table of PHASE6_TABLES) {
        expect(tableExists(db, table), `missing table: ${table}`).toBe(true);
      }
    });
  });
});
