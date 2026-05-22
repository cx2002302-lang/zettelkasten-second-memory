/**
 * SampleCurationRepository 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { promises as fs } from "node:fs";
import { SampleCurationRepository } from "../sample-curation-repository.js";
import type { QualityScores } from "../../core/types-phase5.js";

describe("SampleCurationRepository", () => {
  let db: DatabaseSync;
  let repository: SampleCurationRepository;
  let TEST_DB_DIR: string;
  let TEST_DB_PATH: string;

  beforeEach(async () => {
    TEST_DB_DIR = "/tmp/zettelkasten-test-curation-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9);
    TEST_DB_PATH = join(TEST_DB_DIR, "test.db");
    await fs.mkdir(TEST_DB_DIR, { recursive: true });
    db = new DatabaseSync(TEST_DB_PATH);
    
    // 创建测试表
    db.exec(`
      CREATE TABLE IF NOT EXISTS zettel_sample_curations (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        quality_relevance REAL,
        quality_clarity REAL,
        quality_atomicity REAL,
        quality_connectivity REAL,
        quality_overall REAL,
        curation_status TEXT DEFAULT 'pending',
        curator_id TEXT,
        curation_notes TEXT,
        export_batch_id TEXT,
        metadata TEXT,
        curated_at TEXT,
        created_at TEXT NOT NULL
      )
    `);
    
    repository = new SampleCurationRepository(db);
  });

  afterEach(async () => {
    db.close();
    try {
      await fs.rm(TEST_DB_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("create", () => {
    it("should create a new sample curation", () => {
      const qualityScores: QualityScores = {
        relevance: 0.9,
        clarity: 0.8,
        atomicity: 0.85,
        connectivity: 0.75,
        overall: 0.82,
      };

      const result = repository.create({
        noteId: "20240115103045123",
        qualityScores,
      });

      expect(result).toBeDefined();
      expect(result.noteId).toBe("20240115103045123");
      expect(result.qualityScores.overall).toBe(0.82);
      expect(result.curationStatus).toBe("pending");
    });

    it("should create with curator info", () => {
      const qualityScores: QualityScores = {
        relevance: 0.9,
        clarity: 0.8,
        atomicity: 0.85,
        connectivity: 0.75,
        overall: 0.82,
      };

      const result = repository.create({
        noteId: "20240115103045123",
        qualityScores,
        curatorId: "curator-1",
        curationNotes: "Good quality note",
      });

      expect(result.curatorId).toBe("curator-1");
      expect(result.curationNotes).toBe("Good quality note");
    });
  });

  describe("get", () => {
    it("should get curation by id", () => {
      const created = repository.create({
        noteId: "20240115103045123",
        qualityScores: { relevance: 0.9, clarity: 0.8, atomicity: 0.85, connectivity: 0.75, overall: 0.82 },
      });

      const result = repository.get(created.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(created.id);
      expect(result?.noteId).toBe("20240115103045123");
    });

    it("should return null for non-existent id", () => {
      const result = repository.get("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("getByNoteId", () => {
    it("should get curation by note id", () => {
      repository.create({
        noteId: "20240115103045123",
        qualityScores: { relevance: 0.9, clarity: 0.8, atomicity: 0.85, connectivity: 0.75, overall: 0.82 },
      });

      const result = repository.getByNoteId("20240115103045123");

      expect(result).toBeDefined();
      expect(result?.noteId).toBe("20240115103045123");
    });
  });

  describe("query", () => {
    it("should query by status", () => {
      repository.create({
        noteId: "note-1",
        qualityScores: { relevance: 0.9, clarity: 0.8, atomicity: 0.85, connectivity: 0.75, overall: 0.82 },
        curationStatus: "approved",
      });
      repository.create({
        noteId: "note-2",
        qualityScores: { relevance: 0.7, clarity: 0.6, atomicity: 0.65, connectivity: 0.55, overall: 0.62 },
        curationStatus: "pending",
      });

      const results = repository.query({ curationStatus: "approved" });

      expect(results).toHaveLength(1);
      expect(results[0].curationStatus).toBe("approved");
    });

    it("should query by min quality score", () => {
      repository.create({
        noteId: "note-1",
        qualityScores: { relevance: 0.9, clarity: 0.8, atomicity: 0.85, connectivity: 0.75, overall: 0.82 },
      });
      repository.create({
        noteId: "note-2",
        qualityScores: { relevance: 0.5, clarity: 0.5, atomicity: 0.5, connectivity: 0.5, overall: 0.5 },
      });

      const results = repository.query({ minQualityScore: 0.8 });

      expect(results).toHaveLength(1);
      expect(results[0].qualityScores.overall).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe("update", () => {
    it("should update curation status", () => {
      const created = repository.create({
        noteId: "20240115103045123",
        qualityScores: { relevance: 0.9, clarity: 0.8, atomicity: 0.85, connectivity: 0.75, overall: 0.82 },
      });

      repository.update(created.id, {
        curationStatus: "approved",
        curatorId: "curator-1",
      });

      const result = repository.get(created.id);
      expect(result?.curationStatus).toBe("approved");
      expect(result?.curatorId).toBe("curator-1");
    });
  });

  describe("delete", () => {
    it("should delete curation", () => {
      const created = repository.create({
        noteId: "20240115103045123",
        qualityScores: { relevance: 0.9, clarity: 0.8, atomicity: 0.85, connectivity: 0.75, overall: 0.82 },
      });

      const deleted = repository.delete(created.id);

      expect(deleted).toBe(true);
      expect(repository.get(created.id)).toBeNull();
    });
  });
});
