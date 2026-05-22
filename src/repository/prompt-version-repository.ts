/**
 * 提示词版本 Repository
 * 
 * 提供提示词版本的 CRUD 操作和查询功能
 */

import type { DatabaseSync } from "node:sqlite";
import type {
  PromptVersion,
  CreatePromptVersionParams,
  UpdatePromptVersionParams,
  PromptEffectiveness,
  PromptType,
} from "../core/types-phase5.js";

export class PromptVersionRepository {
  constructor(private db: DatabaseSync) {}

  /**
   * 创建提示词版本
   */
  create(params: CreatePromptVersionParams): PromptVersion {
    const id = `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const createdAt = new Date().toISOString();

    // 获取当前该类型的最大版本号
    const versionResult = this.db
      .prepare(
        "SELECT MAX(version) as max_version FROM zettel_prompt_versions WHERE prompt_type = ?"
      )
      .get(params.promptType) as { max_version: number | null };

    const version = (versionResult.max_version ?? 0) + 1;

    const promptVersion: PromptVersion = {
      id,
      ...params,
      version,
      isActive: false,
      usageCount: 0,
      createdAt,
    };

    const stmt = this.db.prepare(
      `INSERT INTO zettel_prompt_versions (
        id, prompt_type, version, content, description,
        is_active, usage_count, average_score, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      promptVersion.id,
      promptVersion.promptType,
      promptVersion.version,
      promptVersion.content,
      promptVersion.description ?? null,
      promptVersion.isActive ? 1 : 0,
      promptVersion.usageCount,
      promptVersion.averageScore ?? null,
      promptVersion.metadata ? JSON.stringify(promptVersion.metadata) : null,
      promptVersion.createdAt
    );

    return promptVersion;
  }

  /**
   * 根据ID获取提示词版本
   */
  get(id: string): PromptVersion | null {
    const row = this.db
      .prepare("SELECT * FROM zettel_prompt_versions WHERE id = ?")
      .get(id) as Record<string, any> | undefined;

    if (!row) return null;

    return this.rowToPromptVersion(row);
  }

  /**
   * 获取指定类型的活动提示词
   */
  getActiveByType(promptType: PromptType): PromptVersion | null {
    const row = this.db
      .prepare(
        "SELECT * FROM zettel_prompt_versions WHERE prompt_type = ? AND is_active = 1 ORDER BY version DESC LIMIT 1"
      )
      .get(promptType) as Record<string, any> | undefined;

    if (!row) return null;

    return this.rowToPromptVersion(row);
  }

  /**
   * 获取指定类型的所有提示词版本
   */
  getByType(promptType: PromptType): PromptVersion[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM zettel_prompt_versions WHERE prompt_type = ? ORDER BY version DESC"
      )
      .all(promptType) as Record<string, any>[];

    return rows.map((row) => this.rowToPromptVersion(row));
  }

  /**
   * 获取所有提示词版本
   */
  getAll(): PromptVersion[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM zettel_prompt_versions ORDER BY prompt_type, version DESC"
      )
      .all() as Record<string, any>[];

    return rows.map((row) => this.rowToPromptVersion(row));
  }

  /**
   * 更新提示词版本
   */
  update(id: string, params: UpdatePromptVersionParams): boolean {
    const updates: string[] = [];
    const values: any[] = [];

    if (params.description !== undefined) {
      updates.push("description = ?");
      values.push(params.description);
    }

    if (params.isActive !== undefined) {
      updates.push("is_active = ?");
      values.push(params.isActive ? 1 : 0);

      if (params.isActive) {
        updates.push("activated_at = ?");
        values.push(new Date().toISOString());
      }
    }

    if (params.metadata !== undefined) {
      updates.push("metadata = ?");
      values.push(JSON.stringify(params.metadata));
    }

    if (updates.length === 0) return false;

    values.push(id);

    const stmt = this.db.prepare(
      `UPDATE zettel_prompt_versions SET ${updates.join(", ")} WHERE id = ?`
    );
    const result = stmt.run(...values);
    return result.changes > 0;
  }

  /**
   * 激活提示词版本
   */
  activate(id: string): boolean {
    // 先获取提示词类型
    const promptVersion = this.get(id);
    if (!promptVersion) return false;

    // 先取消该类型的其他活动版本
    this.db
      .prepare(
        "UPDATE zettel_prompt_versions SET is_active = 0 WHERE prompt_type = ? AND is_active = 1"
      )
      .run(promptVersion.promptType);

    // 激活当前版本
    const stmt = this.db.prepare(
      "UPDATE zettel_prompt_versions SET is_active = 1, activated_at = ? WHERE id = ?"
    );
    const result = stmt.run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  /**
   * 增加使用计数
   */
  incrementUsage(id: string): boolean {
    const stmt = this.db.prepare(
      "UPDATE zettel_prompt_versions SET usage_count = usage_count + 1 WHERE id = ?"
    );
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * 更新平均评分
   */
  updateScore(id: string, newScore: number): boolean {
    const promptVersion = this.get(id);
    if (!promptVersion) return false;

    const currentCount = promptVersion.usageCount || 1;
    const currentAvg = promptVersion.averageScore || 0;
    const newAvg = (currentAvg * (currentCount - 1) + newScore) / currentCount;

    const stmt = this.db.prepare(
      "UPDATE zettel_prompt_versions SET average_score = ? WHERE id = ?"
    );
    const result = stmt.run(newAvg, id);
    return result.changes > 0;
  }

  /**
   * 删除提示词版本
   */
  delete(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM zettel_prompt_versions WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  /**
   * 获取提示词效果统计
   */
  getEffectivenessStats(): PromptEffectiveness[] {
    const rows = this.db
      .prepare(
        `SELECT 
          id, prompt_type, version, usage_count, average_score,
          CASE 
            WHEN average_score IS NOT NULL AND average_score >= 0.8 THEN 1.0
            WHEN average_score IS NOT NULL AND average_score >= 0.6 THEN 0.8
            WHEN average_score IS NOT NULL THEN 0.5
            ELSE 0.0
          END as success_rate,
          activated_at as last_used_at
        FROM zettel_prompt_versions
        WHERE is_active = 1 OR usage_count > 0
        ORDER BY prompt_type, version DESC`
      )
      .all() as Record<string, any>[];

    return rows.map((row) => ({
      promptId: row.id,
      promptType: row.prompt_type,
      version: row.version,
      usageCount: row.usage_count,
      averageScore: row.average_score ?? 0,
      successRate: row.success_rate,
      lastUsedAt: row.last_used_at,
    }));
  }

  /**
   * 将数据库行转换为 PromptVersion 对象
   */
  private rowToPromptVersion(row: Record<string, any>): PromptVersion {
    return {
      id: row.id,
      promptType: row.prompt_type,
      version: row.version,
      content: row.content,
      description: row.description,
      isActive: row.is_active === 1,
      usageCount: row.usage_count,
      averageScore: row.average_score,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      activatedAt: row.activated_at,
    };
  }
}
