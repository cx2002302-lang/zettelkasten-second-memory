/**
 * SampleCurationService 测试套件
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { SampleCurationService } from "../sample-curation-service.js";
import type {
  CreateSampleCurationParams,
  QualityScores,
  CurationStatus,
} from "../../core/types-phase5.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

describe("SampleCurationService", () => {
  let db: DatabaseSync;
  let service: SampleCurationService;
  let tempDir: string;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");

    // 创建必要的表 - 使用正确的列名
    db.exec(`
      CREATE TABLE zettel_sample_curations (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL UNIQUE,
        quality_relevance REAL NOT NULL,
        quality_clarity REAL NOT NULL,
        quality_atomicity REAL NOT NULL,
        quality_connectivity REAL NOT NULL,
        quality_overall REAL NOT NULL,
        curation_status TEXT NOT NULL,
        curator_id TEXT,
        curation_notes TEXT,
        export_batch_id TEXT,
        metadata TEXT,
        curated_at TEXT,
        created_at TEXT NOT NULL
      )
    `);

    db.exec(`
      CREATE TABLE zettel_export_batches (
        id TEXT PRIMARY KEY,
        sample_count INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        exported_at TEXT NOT NULL,
        expires_at TEXT
      )
    `);

    // 创建 notes 表，因为 getHighQualitySamples 需要 JOIN
    db.exec(`
      CREATE TABLE zettel_notes (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        summary TEXT,
        confidence REAL NOT NULL,
        folder TEXT NOT NULL,
        tags TEXT,
        links TEXT,
        source TEXT,
        source_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    tempDir = fs.mkdtempSync(path.join(tmpdir(), "curation-test-"));

    service = new SampleCurationService(db, {
      exportPath: tempDir,
      qualityThreshold: 0.8,
      autoCuration: true,
    });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    db.close();
  });

  describe("constructor", () => {
    it("should initialize with default config", () => {
      const defaultService = new SampleCurationService(db);
      expect(defaultService).toBeDefined();
    });

    it("should initialize with custom config", () => {
      const customService = new SampleCurationService(db, {
        qualityThreshold: 0.9,
        autoCuration: false,
        exportFormat: "csv",
        exportPath: "/custom/path",
      });
      expect(customService).toBeDefined();
    });
  });

  describe("createCuration", () => {
    it("should create curation", () => {
      const qualityScores: QualityScores = {
        relevance: 0.9,
        clarity: 0.8,
        atomicity: 0.85,
        connectivity: 0.7,
        overall: 0.81,
      };

      const params: CreateSampleCurationParams = {
        noteId: "20240115120000000",
        qualityScores,
        curationStatus: "approved" as CurationStatus,
        curationNotes: "High quality note",
      };

      const result = service.createCuration(params);

      expect(result).toMatchObject({
        noteId: "20240115120000000",
        qualityScores,
        curationStatus: "approved",
        curationNotes: "High quality note",
      });
      expect(result.id).toMatch(/^sample_\d+_[a-z0-9]+$/);
    });

    it("should use pending as default status", () => {
      const qualityScores: QualityScores = {
        relevance: 0.5,
        clarity: 0.5,
        atomicity: 0.5,
        connectivity: 0.5,
        overall: 0.5,
      };

      const result = service.createCuration({
        noteId: "20240115120000001",
        qualityScores,
      });

      expect(result.curationStatus).toBe("pending");
    });
  });

  describe("getCuration", () => {
    it("should get curation by id", () => {
      const created = service.createCuration({
        noteId: "20240115120000000",
        qualityScores: {
          relevance: 0.9,
          clarity: 0.8,
          atomicity: 0.85,
          connectivity: 0.7,
          overall: 0.81,
        },
      });

      const result = service.getCuration(created.id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(created.id);
    });

    it("should return null when not found", () => {
      const result = service.getCuration("non_existent_id");
      expect(result).toBeNull();
    });
  });

  describe("getCurationByNoteId", () => {
    it("should get curation by note id", () => {
      service.createCuration({
        noteId: "20240115120000000",
        qualityScores: {
          relevance: 0.9,
          clarity: 0.8,
          atomicity: 0.85,
          connectivity: 0.7,
          overall: 0.81,
        },
      });

      const result = service.getCurationByNoteId("20240115120000000");

      expect(result).not.toBeNull();
      expect(result?.noteId).toBe("20240115120000000");
    });

    it("should return null when note not curated", () => {
      const result = service.getCurationByNoteId("non_existent_note");
      expect(result).toBeNull();
    });
  });

  describe("updateCuration", () => {
    it("should update curation", () => {
      const created = service.createCuration({
        noteId: "20240115120000000",
        qualityScores: {
          relevance: 0.9,
          clarity: 0.8,
          atomicity: 0.85,
          connectivity: 0.7,
          overall: 0.81,
        },
        curationStatus: "pending" as CurationStatus,
      });

      const updated = service.updateCuration(created.id, {
        curationStatus: "approved" as CurationStatus,
        curationNotes: "Approved after review",
      });

      expect(updated).toBe(true);

      const result = service.getCuration(created.id);
      expect(result?.curationStatus).toBe("approved");
      expect(result?.curationNotes).toBe("Approved after review");
    });

    it("should return false when curation not found", () => {
      const result = service.updateCuration("non_existent_id", {
        curationStatus: "approved" as CurationStatus,
      });
      expect(result).toBe(false);
    });
  });

  describe("deleteCuration", () => {
    it("should delete curation", () => {
      const created = service.createCuration({
        noteId: "20240115120000000",
        qualityScores: {
          relevance: 0.9,
          clarity: 0.8,
          atomicity: 0.85,
          connectivity: 0.7,
          overall: 0.81,
        },
      });

      const deleted = service.deleteCuration(created.id);

      expect(deleted).toBe(true);
      expect(service.getCuration(created.id)).toBeNull();
    });

    it("should return false when curation not found", () => {
      const result = service.deleteCuration("non_existent_id");
      expect(result).toBe(false);
    });
  });

  describe("queryCurations", () => {
    it("should query curations with filters", () => {
      service.createCuration({
        noteId: "20240115120000000",
        qualityScores: {
          relevance: 0.9,
          clarity: 0.8,
          atomicity: 0.85,
          connectivity: 0.7,
          overall: 0.81,
        },
        curationStatus: "approved" as CurationStatus,
      });
      service.createCuration({
        noteId: "20240115120000001",
        qualityScores: {
          relevance: 0.5,
          clarity: 0.5,
          atomicity: 0.5,
          connectivity: 0.5,
          overall: 0.5,
        },
        curationStatus: "pending" as CurationStatus,
      });

      const approved = service.queryCurations({
        curationStatus: "approved" as CurationStatus,
      });

      expect(approved).toHaveLength(1);
      expect(approved[0].curationStatus).toBe("approved");
    });

    it("should return all curations when no filters", () => {
      service.createCuration({
        noteId: "20240115120000000",
        qualityScores: {
          relevance: 0.9,
          clarity: 0.8,
          atomicity: 0.85,
          connectivity: 0.7,
          overall: 0.81,
        },
      });

      const results = service.queryCurations();

      expect(results).toHaveLength(1);
    });
  });

  describe("getHighQualitySamples", () => {
    it("should get high quality samples", () => {
      // 先插入对应的 notes，因为 getHighQualitySamples 需要 JOIN zettel_notes
      db.exec(`
        INSERT INTO zettel_notes (id, content, confidence, folder, created_at, updated_at)
        VALUES
          ('20240115120000000', 'High quality note content', 0.9, 'inbox', '2024-01-15T12:00:00.000Z', '2024-01-15T12:00:00.000Z'),
          ('20240115120000001', 'Low quality note content', 0.5, 'inbox', '2024-01-15T12:00:00.000Z', '2024-01-15T12:00:00.000Z')
      `);

      service.createCuration({
        noteId: "20240115120000000",
        qualityScores: {
          relevance: 0.95,
          clarity: 0.9,
          atomicity: 0.85,
          connectivity: 0.8,
          overall: 0.875,
        },
        curationStatus: "approved" as CurationStatus,
      });
      service.createCuration({
        noteId: "20240115120000001",
        qualityScores: {
          relevance: 0.5,
          clarity: 0.5,
          atomicity: 0.5,
          connectivity: 0.5,
          overall: 0.5,
        },
        curationStatus: "approved" as CurationStatus,
      });

      const highQuality = service.getHighQualitySamples(0.8);

      expect(highQuality).toHaveLength(1);
      expect(highQuality[0].qualityScores.overall).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe("exportSamples", () => {
    it("should export samples to file", () => {
      const curation = service.createCuration({
        noteId: "20240115120000000",
        qualityScores: {
          relevance: 0.95,
          clarity: 0.9,
          atomicity: 0.85,
          connectivity: 0.8,
          overall: 0.875,
        },
        curationStatus: "approved" as CurationStatus,
      });

      const batch = service.exportSamples([curation.id], "jsonl");

      expect(batch).not.toBeNull();
      expect(batch?.sampleCount).toBe(1);
      expect(fs.existsSync(batch!.filePath)).toBe(true);
    });

    it("should return null for empty sample list", () => {
      const result = service.exportSamples([]);
      expect(result).toBeNull();
    });
  });

  describe("getExportBatch", () => {
    it("should get export batch by id", () => {
      const curation = service.createCuration({
        noteId: "20240115120000000",
        qualityScores: {
          relevance: 0.95,
          clarity: 0.9,
          atomicity: 0.85,
          connectivity: 0.8,
          overall: 0.875,
        },
        curationStatus: "approved" as CurationStatus,
      });

      const batch = service.exportSamples([curation.id]);
      expect(batch).not.toBeNull();

      const retrieved = service.getExportBatch(batch!.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(batch!.id);
    });

    it("should return null when batch not found", () => {
      const result = service.getExportBatch("non_existent_id");
      expect(result).toBeNull();
    });
  });

  describe("getAllExportBatches", () => {
    it("should get all export batches", () => {
      const curation = service.createCuration({
        noteId: "20240115120000000",
        qualityScores: {
          relevance: 0.95,
          clarity: 0.9,
          atomicity: 0.85,
          connectivity: 0.8,
          overall: 0.875,
        },
        curationStatus: "approved" as CurationStatus,
      });

      service.exportSamples([curation.id]);
      service.exportSamples([curation.id]);

      const batches = service.getAllExportBatches();
      expect(batches).toHaveLength(2);
    });
  });

  describe("getStats", () => {
    it("should get curation stats", () => {
      service.createCuration({
        noteId: "20240115120000000",
        qualityScores: {
          relevance: 0.95,
          clarity: 0.9,
          atomicity: 0.85,
          connectivity: 0.8,
          overall: 0.875,
        },
        curationStatus: "approved" as CurationStatus,
      });
      service.createCuration({
        noteId: "20240115120000001",
        qualityScores: {
          relevance: 0.5,
          clarity: 0.5,
          atomicity: 0.5,
          connectivity: 0.5,
          overall: 0.5,
        },
        curationStatus: "pending" as CurationStatus,
      });

      const stats = service.getStats();

      expect(stats.total).toBe(2);
      expect(stats.approved).toBe(1);
      expect(stats.pending).toBe(1);
      expect(stats.averageQuality).toBeGreaterThan(0);
    });

    it("should return zero stats when no curations", () => {
      const stats = service.getStats();

      expect(stats.total).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.approved).toBe(0);
      expect(stats.rejected).toBe(0);
      expect(stats.exported).toBe(0);
      expect(stats.averageQuality).toBe(0);
    });
  });

  describe("batchCurate", () => {
    it("should batch curate notes", () => {
      const curation = service.createCuration({
        noteId: "20240115120000000",
        qualityScores: {
          relevance: 0.95,
          clarity: 0.9,
          atomicity: 0.85,
          connectivity: 0.8,
          overall: 0.875,
        },
        curationStatus: "pending" as CurationStatus,
      });

      const results = service.batchCurate(
        ["20240115120000000"],
        "curator_123",
        "approved" as CurationStatus
      );

      expect(results).toHaveLength(1);
      expect(results[0].curationStatus).toBe("approved");
      expect(results[0].curatorId).toBe("curator_123");
    });

    it("should return empty array when notes not curated", () => {
      const results = service.batchCurate(["non_existent_note"]);
      expect(results).toEqual([]);
    });
  });

  describe("updateConfig", () => {
    it("should update config", () => {
      service.updateConfig({
        qualityThreshold: 0.9,
        autoCuration: false,
      });

      expect(() => service.updateConfig({})).not.toThrow();
    });
  });
});
