/**
 * 系统调优 Repository
 * 
 * 提供系统调优参数的 CRUD 操作和查询功能
 */

import type { DatabaseSync } from "node:sqlite";
import type {
  SystemTuning,
  CreateSystemTuningParams,
  SystemTuningQueryParams,
} from "../core/types-phase5.js";

export class SystemTuningRepository {
  constructor(private db: DatabaseSync) {}

  /**
   * 创建系统调优记录
   */
  create(params: CreateSystemTuningParams): SystemTuning {
    const id = `tune_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const appliedAt = new Date().toISOString();

    const tuning: SystemTuning = {
      id,
      ...params,
      autoTuned: params.autoTuned ?? false,
      appliedAt,
    };

    const stmt = this.db.prepare(
      `INSERT INTO zettel_system_tunings (
        id, parameter_name, parameter_value, previous_value,
        change_reason, feedback_id, auto_tuned, tuning_score,
        metadata, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      tuning.id,
      tuning.parameterName,
      tuning.parameterValue,
      tuning.previousValue ?? null,
      tuning.changeReason ?? null,
      tuning.feedbackId ?? null,
      tuning.autoTuned ? 1 : 0,
      tuning.tuningScore ?? null,
      tuning.metadata ? JSON.stringify(tuning.metadata) : null,
      tuning.appliedAt
    );

    return tuning;
  }

  /**
   * 根据ID获取系统调优记录
   */
  get(id: string): SystemTuning | null {
    const row = this.db
      .prepare("SELECT * FROM zettel_system_tunings WHERE id = ?")
      .get(id) as Record<string, any> | undefined;

    if (!row) return null;

    return this.rowToSystemTuning(row);
  }

  /**
   * 查询系统调优记录
   */
  query(params: SystemTuningQueryParams = {}): SystemTuning[] {
    const conditions: string[] = [];
    const values: any[] = [];

    if (params.parameterName) {
      conditions.push("parameter_name = ?");
      values.push(params.parameterName);
    }

    if (params.autoTuned !== undefined) {
      conditions.push("auto_tuned = ?");
      values.push(params.autoTuned ? 1 : 0);
    }

    if (params.feedbackId) {
      conditions.push("feedback_id = ?");
      values.push(params.feedbackId);
    }

    if (params.startDate) {
      conditions.push("applied_at >= ?");
      values.push(params.startDate);
    }

    if (params.endDate) {
      conditions.push("applied_at <= ?");
      values.push(params.endDate);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM zettel_system_tunings ${whereClause} ORDER BY applied_at DESC LIMIT ? OFFSET ?`
      )
      .all(...values, limit, offset) as Record<string, any>[];

    return rows.map((row) => this.rowToSystemTuning(row));
  }

  /**
   * 获取指定参数的最新调优记录
   */
  getLatestByParameter(parameterName: string): SystemTuning | null {
    const row = this.db
      .prepare(
        "SELECT * FROM zettel_system_tunings WHERE parameter_name = ? ORDER BY applied_at DESC LIMIT 1"
      )
      .get(parameterName) as Record<string, any> | undefined;

    if (!row) return null;

    return this.rowToSystemTuning(row);
  }

  /**
   * 获取所有参数的最新值
   */
  getAllCurrentParameters(): Record<string, string> {
    const rows = this.db
      .prepare(
        `SELECT parameter_name, parameter_value 
         FROM zettel_system_tunings 
         WHERE id IN (
           SELECT MAX(id) 
           FROM zettel_system_tunings 
           GROUP BY parameter_name
         )`
      )
      .all() as Array<{ parameter_name: string; parameter_value: string }>;

    const params: Record<string, string> = {};
    for (const row of rows) {
      params[row.parameter_name] = row.parameter_value;
    }
    return params;
  }

  /**
   * 获取指定参数的调优历史
   */
  getParameterHistory(parameterName: string, limit: number = 20): SystemTuning[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM zettel_system_tunings WHERE parameter_name = ? ORDER BY applied_at DESC LIMIT ?"
      )
      .all(parameterName, limit) as Record<string, any>[];

    return rows.map((row) => this.rowToSystemTuning(row));
  }

  /**
   * 删除系统调优记录
   */
  delete(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM zettel_system_tunings WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  /**
   * 获取调优统计
   */
  getStats(): {
    totalTunings: number;
    autoTunedCount: number;
    manualTunedCount: number;
    byParameter: Record<string, number>;
    averageScore: number;
  } {
    const totalResult = this.db
      .prepare("SELECT COUNT(*) as count FROM zettel_system_tunings")
      .get() as { count: number };

    const autoResult = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM zettel_system_tunings WHERE auto_tuned = 1"
      )
      .get() as { count: number };

    const paramCounts = this.db
      .prepare(
        `SELECT parameter_name, COUNT(*) as count FROM zettel_system_tunings GROUP BY parameter_name`
      )
      .all() as Array<{ parameter_name: string; count: number }>;

    const scoreResult = this.db
      .prepare(
        "SELECT AVG(tuning_score) as avg FROM zettel_system_tunings WHERE tuning_score IS NOT NULL"
      )
      .get() as { avg: number | null };

    const byParameter: Record<string, number> = {};
    for (const { parameter_name, count } of paramCounts) {
      byParameter[parameter_name] = count;
    }

    return {
      totalTunings: totalResult.count,
      autoTunedCount: autoResult.count,
      manualTunedCount: totalResult.count - autoResult.count,
      byParameter,
      averageScore: scoreResult.avg ?? 0,
    };
  }

  /**
   * 回滚到指定参数值
   */
  rollback(parameterName: string, tuningId: string): SystemTuning | null {
    const targetTuning = this.get(tuningId);
    if (!targetTuning) return null;

    // 创建回滚记录
    return this.create({
      parameterName,
      parameterValue: targetTuning.previousValue ?? targetTuning.parameterValue,
      previousValue: this.getLatestByParameter(parameterName)?.parameterValue,
      changeReason: `Rollback to tuning ${tuningId}`,
      autoTuned: false,
    });
  }

  /**
   * 将数据库行转换为 SystemTuning 对象
   */
  private rowToSystemTuning(row: Record<string, any>): SystemTuning {
    return {
      id: row.id,
      parameterName: row.parameter_name,
      parameterValue: row.parameter_value,
      previousValue: row.previous_value,
      changeReason: row.change_reason,
      feedbackId: row.feedback_id,
      autoTuned: row.auto_tuned === 1,
      tuningScore: row.tuning_score,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      appliedAt: row.applied_at,
    };
  }
}