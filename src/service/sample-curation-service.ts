/**
 * 样本策划服务
 * 
 * 提供高质量样本的策划、导出和回流功能
 */

import type { DatabaseSync } from "node:sqlite";
import { SampleCurationRepository } from "../repository/sample-curation-repository.js";
import type {
  SampleCuration,
  CreateSampleCurationParams,
  UpdateSampleCurationParams,
  SampleQueryParams,
  ExportBatch,
  CreateExportBatchParams,
  CurationStatus,
  QualityScores,
  SampleCurationConfig,
} from "../core/types-phase5.js";
import type { ZettelNote } from "../core/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

export class SampleCurationService {
  private curationRepo: SampleCurationRepository;
  private config: SampleCurationConfig;

  constructor(
    private db: DatabaseSync,
    config?: Partial<SampleCurationConfig>
  ) {
    this.curationRepo = new SampleCurationRepository(db);
    this.config = {
      qualityThreshold: 0.8,
      autoCuration: true,
      exportFormat: "jsonl",
      exportPath: "./exports",
      ...config,
    };
  }

  /**
   * 创建样本策划记录
   */
  createCuration(params: CreateSampleCurationParams): SampleCuration {
    return this.curationRepo.create(params);
  }

  /**
   * 更新样本策划
   */
  updateCuration(id: string, params: UpdateSampleCurationParams): boolean {
    return this.curationRepo.update(id, params);
  }

  /**
   * 获取样本策划
   */
  getCuration(id: string): SampleCuration | null {
    return this.curationRepo.get(id);
  }

  /**
   * 根据笔记ID获取样本策划
   */
  getCurationByNoteId(noteId: string): SampleCuration | null {
    return this.curationRepo.getByNoteId(noteId);
  }

  /**
   * 查询样本策划
   */
  queryCurations(params: SampleQueryParams = {}): SampleCuration[] {
    return this.curationRepo.query(params);
  }

  /**
   * 删除样本策划
   */
  deleteCuration(id: string): boolean {
    return this.curationRepo.delete(id);
  }

  /**
   * 自动策划笔记
   */
  autoCurateNote(note: ZettelNote): SampleCuration | null {
    if (!this.config.autoCuration) {
      return null;
    }

    // 计算质量评分
    const qualityScores = this.calculateQualityScores(note);

    // 如果质量超过阈值，自动策划
    if (qualityScores.overall >= this.config.qualityThreshold) {
      return this.createCuration({
        noteId: note.id,
        qualityScores,
        curationStatus: "approved",
        curationNotes: "Auto-curated based on quality scores",
      });
    }

    return null;
  }

  /**
   * 计算笔记质量评分
   */
  calculateQualityScores(note: ZettelNote): QualityScores {
    // 相关性评分：基于标签数量和链接数量
    const relevance = Math.min(
      (note.tags.length * 0.1) + (note.links.length * 0.1),
      1.0
    );

    // 清晰度评分：基于摘要长度和内容长度
    const hasSummary = note.summary && note.summary.length > 20 ? 0.3 : 0;
    const contentLength = note.content.length;
    const clarity = Math.min(
      hasSummary + (contentLength > 100 && contentLength < 2000 ? 0.5 : 0.2),
      1.0
    );

    // 原子性评分：基于内容长度和段落数
    const paragraphs = note.content.split("\n\n").filter((p) => p.trim()).length;
    const atomicity = paragraphs <= 3 && contentLength < 1500 ? 0.9 : 0.5;

    // 连通性评分：基于链接数量
    const connectivity = Math.min(note.links.length * 0.2, 1.0);

    // 综合评分
    const overall = (relevance + clarity + atomicity + connectivity) / 4;

    return {
      relevance,
      clarity,
      atomicity,
      connectivity,
      overall,
    };
  }

  /**
   * 获取高质量样本
   */
  getHighQualitySamples(minScore: number = 0.8, limit: number = 1000): SampleCuration[] {
    return this.curationRepo.getHighQualitySamples(minScore, limit);
  }

  /**
   * 导出样本到文件
   */
  exportSamples(
    sampleIds: string[],
    format: "jsonl" | "csv" | "json" = this.config.exportFormat
  ): ExportBatch | null {
    if (sampleIds.length === 0) {
      return null;
    }

    // 确保导出目录存在
    if (!fs.existsSync(this.config.exportPath)) {
      fs.mkdirSync(this.config.exportPath, { recursive: true });
    }

    // 生成文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `samples_${timestamp}.${format}`;
    const filePath = path.join(this.config.exportPath, filename);

    // 路径遍历校验
    const resolvedPath = path.resolve(filePath);
    const resolvedBase = path.resolve(this.config.exportPath);
    if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
      throw new Error(`Path traversal detected: ${filename}`);
    }

    // 获取样本数据
    const samples = sampleIds
      .map((id) => this.curationRepo.get(id))
      .filter((s): s is SampleCuration => s !== null);

    // 导出数据
    let content: string;
    switch (format) {
      case "jsonl":
        content = samples.map((s) => JSON.stringify(s)).join("\n");
        break;
      case "json":
        content = JSON.stringify(samples, null, 2);
        break;
      case "csv":
        content = this.convertToCSV(samples);
        break;
      default:
        content = JSON.stringify(samples);
    }

    // 写入文件
    fs.writeFileSync(filePath, content, "utf-8");

    // 创建导出批次记录
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30天后过期

    const batchParams: CreateExportBatchParams = {
      sampleIds,
      filePath,
      expiresAt: expiresAt.toISOString(),
    };

    return this.curationRepo.createExportBatch(batchParams);
  }

  /**
   * 转换为CSV格式
   */
  private convertToCSV(samples: SampleCuration[]): string {
    if (samples.length === 0) return "";

    const headers = [
      "id",
      "noteId",
      "relevance",
      "clarity",
      "atomicity",
      "connectivity",
      "overall",
      "curationStatus",
      "curatedAt",
    ];

    const rows = samples.map((s) => [
      s.id,
      s.noteId,
      s.qualityScores.relevance,
      s.qualityScores.clarity,
      s.qualityScores.atomicity,
      s.qualityScores.connectivity,
      s.qualityScores.overall,
      s.curationStatus,
      s.curatedAt ?? "",
    ]);

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  /**
   * 获取导出批次
   */
  getExportBatch(id: string): ExportBatch | null {
    return this.curationRepo.getExportBatch(id);
  }

  /**
   * 获取所有导出批次
   */
  getAllExportBatches(): ExportBatch[] {
    return this.curationRepo.getAllExportBatches();
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
    return this.curationRepo.getStats();
  }

  /**
   * 批量策划
   */
  batchCurate(
    noteIds: string[],
    curatorId?: string,
    status: CurationStatus = "approved"
  ): SampleCuration[] {
    const curated: SampleCuration[] = [];

    for (const noteId of noteIds) {
      // 检查是否已策划
      const existing = this.getCurationByNoteId(noteId);
      if (existing) {
        // 更新状态
        this.updateCuration(existing.id, {
          curationStatus: status,
          curatorId,
        });
        curated.push({ ...existing, curationStatus: status, curatorId });
      }
    }

    return curated;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SampleCurationConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
