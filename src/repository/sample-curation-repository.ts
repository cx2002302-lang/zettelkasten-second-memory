/**
 * 样本策划 Repository
 * 
 * 提供样本策划的 CRUD 操作和查询功能
 */

import type { DatabaseSync } from "node:sqlite";
import type {
  SampleCuration,
  CreateSampleCurationParams,
  UpdateSampleCurationParams,
  SampleQueryParams,
  ExportBatch,
  CreateExportBatchParams,
  CurationStatus,
  QualityScores,
} from "../core/types-phase5.js";
import { DEFAULT_PAGE_SIZE, MAX_SAMPLE_COUNT } from "../core/constants.js";

export class SampleCurationRepository {
  constructor(private db: DatabaseSync) {}

  /**
   * 创建样本策划记录
   */
  create(params: CreateSampleCurationParams): SampleCuration {
    const id = `sample_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const createdAt = new Date().toISOString();

    const curation: SampleCuration = {
      id,
      ...params,
      curationStatus: params.curationStatus ?? "pending",
      createdAt,
    };

    const stmt = this.db.prepare(
      `INSERT INTO zettel_sample_curations (
        id, note_id, quality_relevance, quality_clarity, quality_atomicity,
        quality_connectivity, quality_overall, curation_status, curator_id,
        curation_notes, export_batch_id, metadata, curated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      curation.id,
      curation.noteId,
      curation.qualityScores.relevance,
      curation.qualityScores.clarity,
      curation.qualityScores.atomicity,
      curation.qualityScores.connectivity,
      curation.qualityScores.overall,
      curation.curationStatus,
      curation.curatorId ?? null,
      curation.curationNotes ?? null,
      curation.exportBatchId ?? null,
      curation.metadata ? JSON.stringify(curation.metadata) : null,
      curation.curatedAt ?? null,
      curation.createdAt
    );

    return curation;
  }

  /**
   * 根据ID获取样本策划
   */
  get(id: string): SampleCuration | null {
    const row = this.db
      .prepare("SELECT * FROM zettel_sample_curations WHERE id = ?")
      .get(id) as Record<string, any> | undefined;

    if (!row) return null;

    return this.rowToSampleCuration(row);
  }

  /**
   * 根据笔记ID获取样本策划
   */
  getByNoteId(noteId: string): SampleCuration | null {
    const row = this.db
      .prepare("SELECT * FROM zettel_sample_curations WHERE note_id = ?")
      .get(noteId) as Record<string, any> | undefined;

    if (!row) return null;

    return this.rowToSampleCuration(row);
  }

  /**
   * 查询样本策划
   */
  query(params: SampleQueryParams = {}): SampleCuration[] {
    const conditions: string[] = [];
    const values: any[] = [];

    if (params.curationStatus) {
      conditions.push("curation_status = ?");
      values.push(params.curationStatus);
    }

    if (params.curatorId) {
      conditions.push("curator_id = ?");
      values.push(params.curatorId);
    }

    if (params.minQualityScore !== undefined) {
      conditions.push("quality_overall >= ?");
      values.push(params.minQualityScore);
    }

    if (params.exportBatchId) {
      conditions.push("export_batch_id = ?");
      values.push(params.exportBatchId);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const limit = params.limit ?? DEFAULT_PAGE_SIZE;
    const offset = params.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM zettel_sample_curations ${whereClause} ORDER BY quality_overall DESC, created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...values, limit, offset) as Record<string, any>[];

    return rows.map((row) => this.rowToSampleCuration(row));
  }

  /**
   * 更新样本策划
   */
  update(id: string, params: UpdateSampleCurationParams): boolean {
    const updates: string[] = [];
    const values: any[] = [];

    if (params.qualityScores) {
      if (params.qualityScores.relevance !== undefined) {
        updates.push("quality_relevance = ?");
        values.push(params.qualityScores.relevance);
      }
      if (params.qualityScores.clarity !== undefined) {
        updates.push("quality_clarity = ?");
        values.push(params.qualityScores.clarity);
      }
      if (params.qualityScores.atomicity !== undefined) {
        updates.push("quality_atomicity = ?");
        values.push(params.qualityScores.atomicity);
      }
      if (params.qualityScores.connectivity !== undefined) {
        updates.push("quality_connectivity = ?");
        values.push(params.qualityScores.connectivity);
      }
      if (params.qualityScores.overall !== undefined) {
        updates.push("quality_overall = ?");
        values.push(params.qualityScores.overall);
      }
    }

    if (params.curationStatus !== undefined) {
      updates.push("curation_status = ?");
      values.push(params.curationStatus);

      if (params.curationStatus === "approved" || params.curationStatus === "rejected") {
        updates.push("curated_at = ?");
        values.push(new Date().toISOString());
      }
    }

    if (params.curatorId !== undefined) {
      updates.push("curator_id = ?");
      values.push(params.curatorId);
    }

    if (params.curationNotes !== undefined) {
      updates.push("curation_notes = ?");
      values.push(params.curationNotes);
    }

    if (params.exportBatchId !== undefined) {
      updates.push("export_batch_id = ?");
      values.push(params.exportBatchId);
    }

    if (params.metadata !== undefined) {
      updates.push("metadata = ?");
      values.push(JSON.stringify(params.metadata));
    }

    if (updates.length === 0) return false;

    values.push(id);

    const stmt = this.db.prepare(
      `UPDATE zettel_sample_curations SET ${updates.join(", ")} WHERE id = ?`
    );
    const result = stmt.run(...values);
    return result.changes > 0;
  }

  /**
   * 删除样本策划
   */
  delete(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM zettel_sample_curations WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  /**
   * 获取高质量样本（用于导出）
   */
  getHighQualitySamples(minScore: number = 0.8, limit: number = MAX_SAMPLE_COUNT): SampleCuration[] {
    const rows = this.db
      .prepare(
        `SELECT sc.* FROM zettel_sample_curations sc
         JOIN zettel_notes n ON sc.note_id = n.id
         WHERE sc.quality_overall >= ? 
         AND sc.curation_status = 'approved'
         AND sc.export_batch_id IS NULL
         ORDER BY sc.quality_overall DESC
         LIMIT ?`
      )
      .all(minScore, limit) as Record<string, any>[];

    return rows.map((row) => this.rowToSampleCuration(row));
  }

  /**
   * 创建导出批次
   */
  createExportBatch(params: CreateExportBatchParams): ExportBatch {
    const id = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const exportedAt = new Date().toISOString();

    const batch: ExportBatch = {
      id,
      sampleCount: params.sampleIds.length,
      filePath: params.filePath,
      exportedAt,
      expiresAt: params.expiresAt,
    };

    const stmt = this.db.prepare(
      `INSERT INTO zettel_export_batches (
        id, sample_count, file_path, exported_at, expires_at
      ) VALUES (?, ?, ?, ?, ?)`
    );
    stmt.run(
      batch.id,
      batch.sampleCount,
      batch.filePath,
      batch.exportedAt,
      batch.expiresAt
    );

    // 更新样本的导出批次ID
    const updateStmt = this.db.prepare(
      "UPDATE zettel_sample_curations SET export_batch_id = ?, curation_status = 'exported' WHERE id = ?"
    );
    for (const sampleId of params.sampleIds) {
      updateStmt.run(batch.id, sampleId);
    }

    return batch;
  }

  /**
   * 获取导出批次
   */
  getExportBatch(id: string): ExportBatch | null {
    const row = this.db
      .prepare("SELECT * FROM zettel_export_batches WHERE id = ?")
      .get(id) as Record<string, any> | undefined;

    if (!row) return null;

    return {
      id: row.id,
      sampleCount: row.sample_count,
      filePath: row.file_path,
      exportedAt: row.exported_at,
      expiresAt: row.expires_at,
    };
  }

  /**
   * 获取所有导出批次
   */
  getAllExportBatches(): ExportBatch[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM zettel_export_batches ORDER BY exported_at DESC"
      )
      .all() as Record<string, any>[];

    return rows.map((row) => ({
      id: row.id,
      sampleCount: row.sample_count,
      filePath: row.file_path,
      exportedAt: row.exported_at,
      expiresAt: row.expires_at,
    }));
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    exported: number;
    averageQuality: number;
  } {
    const totalResult = this.db
      .prepare("SELECT COUNT(*) as count FROM zettel_sample_curations")
      .get() as { count: number };

    const statusCounts = this.db
      .prepare(
        `SELECT curation_status, COUNT(*) as count FROM zettel_sample_curations GROUP BY curation_status`
      )
      .all() as Array<{ curation_status: string; count: number }>;

    const avgResult = this.db
      .prepare(
        "SELECT AVG(quality_overall) as avg FROM zettel_sample_curations"
      )
      .get() as { avg: number | null };

    const stats = {
      total: totalResult.count,
      pending: 0,
      approved: 0,
      rejected: 0,
      exported: 0,
      averageQuality: avgResult.avg ?? 0,
    };

    for (const { curation_status, count } of statusCounts) {
      switch (curation_status) {
        case "pending":
          stats.pending = count;
          break;
        case "approved":
          stats.approved = count;
          break;
        case "rejected":
          stats.rejected = count;
          break;
        case "exported":
          stats.exported = count;
          break;
      }
    }

    return stats;
  }

  /**
   * 将数据库行转换为 SampleCuration 对象
   */
  private rowToSampleCuration(row: Record<string, any>): SampleCuration {
    return {
      id: row.id,
      noteId: row.note_id,
      qualityScores: {
        relevance: row.quality_relevance,
        clarity: row.quality_clarity,
        atomicity: row.quality_atomicity,
        connectivity: row.quality_connectivity,
        overall: row.quality_overall,
      },
      curationStatus: row.curation_status,
      curatorId: row.curator_id,
      curationNotes: row.curation_notes,
      exportBatchId: row.export_batch_id,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      curatedAt: row.curated_at,
      createdAt: row.created_at,
    };
  }
}
