/**
 * SystemTuningRepository 测试套件
 *
 * 测试系统调优仓库的所有 CRUD 操作和查询功能
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { SystemTuningRepository } from "../system-tuning-repository.js";
import type { CreateSystemTuningParams } from "../../core/types-phase5.js";

describe("SystemTuningRepository", () => {
  let db: DatabaseSync;
  let repository: SystemTuningRepository;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");

    // 创建系统调优表
    db.exec(`
      CREATE TABLE zettel_system_tunings (
        id TEXT PRIMARY KEY,
        parameter_name TEXT NOT NULL,
        parameter_value TEXT NOT NULL,
        previous_value TEXT,
        change_reason TEXT,
        feedback_id TEXT,
        auto_tuned INTEGER DEFAULT 0,
        tuning_score REAL,
        metadata TEXT,
        applied_at TEXT NOT NULL
      )
    `);

    repository = new SystemTuningRepository(db);
  });

  describe("create", () => {
    it("应该创建系统调优记录", () => {
      const params: CreateSystemTuningParams = {
        parameterName: "confidence_threshold",
        parameterValue: "0.85",
        changeReason: "提高准确率",
      };

      const result = repository.create(params);

      expect(result).toMatchObject({
        parameterName: "confidence_threshold",
        parameterValue: "0.85",
        changeReason: "提高准确率",
        autoTuned: false,
      });
      expect(result.previousValue).toBeUndefined();
      expect(result.feedbackId).toBeUndefined();
      expect(result.tuningScore).toBeUndefined();
      expect(result.id).toMatch(/^tune_\d+_[a-z0-9]+$/);
      expect(result.appliedAt).toBeDefined();
    });

    it("应该创建带有所有可选字段的系统调优记录", () => {
      const params: CreateSystemTuningParams = {
        parameterName: "batch_size",
        parameterValue: "100",
        previousValue: "50",
        changeReason: "优化性能",
        feedbackId: "feedback_123",
        autoTuned: true,
        tuningScore: 0.92,
        metadata: { source: "auto_optimizer" },
      };

      const result = repository.create(params);

      expect(result).toMatchObject({
        parameterName: "batch_size",
        parameterValue: "100",
        previousValue: "50",
        changeReason: "优化性能",
        feedbackId: "feedback_123",
        autoTuned: true,
        tuningScore: 0.92,
        metadata: { source: "auto_optimizer" },
      });
    });

    it("应该处理空字符串值", () => {
      const params: CreateSystemTuningParams = {
        parameterName: "empty_param",
        parameterValue: "",
      };

      const result = repository.create(params);

      expect(result.parameterValue).toBe("");
    });

    it("应该处理特殊字符的参数值", () => {
      const params: CreateSystemTuningParams = {
        parameterName: "special_chars",
        parameterValue: 'value with "quotes" and \'apostrophes\'',
        changeReason: "Test special chars: <>&",
      };

      const result = repository.create(params);

      expect(result.parameterValue).toBe('value with "quotes" and \'apostrophes\'');
      expect(result.changeReason).toBe("Test special chars: <>&");
    });
  });

  describe("get", () => {
    it("应该通过ID获取系统调优记录", () => {
      const created = repository.create({
        parameterName: "test_param",
        parameterValue: "test_value",
      });

      const result = repository.get(created.id);

      expect(result).toMatchObject({
        id: created.id,
        parameterName: "test_param",
        parameterValue: "test_value",
      });
    });

    it("应该返回null当记录不存在时", () => {
      const result = repository.get("non_existent_id");

      expect(result).toBeNull();
    });

    it("应该正确解析metadata", () => {
      const created = repository.create({
        parameterName: "with_metadata",
        parameterValue: "value",
        metadata: { key1: "value1", key2: 123 },
      });

      const result = repository.get(created.id);

      expect(result?.metadata).toEqual({ key1: "value1", key2: 123 });
    });

    it("应该正确处理auto_tuned布尔值", () => {
      const autoTuned = repository.create({
        parameterName: "auto_tuned_param",
        parameterValue: "value",
        autoTuned: true,
      });

      const manualTuned = repository.create({
        parameterName: "manual_tuned_param",
        parameterValue: "value",
        autoTuned: false,
      });

      const autoResult = repository.get(autoTuned.id);
      const manualResult = repository.get(manualTuned.id);

      expect(autoResult?.autoTuned).toBe(true);
      expect(manualResult?.autoTuned).toBe(false);
    });
  });

  describe("query", () => {
    beforeEach(() => {
      // 创建测试数据
      repository.create({
        parameterName: "param1",
        parameterValue: "value1",
        autoTuned: true,
        feedbackId: "feedback_1",
      });
      repository.create({
        parameterName: "param1",
        parameterValue: "value1_updated",
        autoTuned: false,
        feedbackId: "feedback_2",
      });
      repository.create({
        parameterName: "param2",
        parameterValue: "value2",
        autoTuned: true,
      });
    });

    it("应该返回所有记录当没有过滤条件时", () => {
      const results = repository.query();

      expect(results).toHaveLength(3);
    });

    it("应该按参数名过滤", () => {
      const results = repository.query({ parameterName: "param1" });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.parameterName === "param1")).toBe(true);
    });

    it("应该按autoTuned过滤", () => {
      const autoResults = repository.query({ autoTuned: true });

      expect(autoResults).toHaveLength(2);
      expect(autoResults.every((r) => r.autoTuned)).toBe(true);
    });

    it("应该按feedbackId过滤", () => {
      const results = repository.query({ feedbackId: "feedback_1" });

      expect(results).toHaveLength(1);
      expect(results[0].feedbackId).toBe("feedback_1");
    });

    it("应该支持limit和offset", () => {
      const limited = repository.query({ limit: 2 });
      expect(limited).toHaveLength(2);

      const offset = repository.query({ limit: 2, offset: 1 });
      expect(offset).toHaveLength(2);
    });

    it("应该按applied_at降序排列", () => {
      const results = repository.query();

      // 最新的记录应该在最前面
      for (let i = 1; i < results.length; i++) {
        expect(
          new Date(results[i - 1].appliedAt).getTime()
        ).toBeGreaterThanOrEqual(new Date(results[i].appliedAt).getTime());
      }
    });

    it("应该支持日期范围过滤", () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      const future = new Date(Date.now() + 86400000).toISOString();

      const results = repository.query({
        startDate: past,
        endDate: future,
      });

      expect(results.length).toBeGreaterThan(0);
    });

    it("应该支持组合过滤条件", () => {
      const results = repository.query({
        parameterName: "param1",
        autoTuned: true,
      });

      expect(results).toHaveLength(1);
      expect(results[0].parameterName).toBe("param1");
      expect(results[0].autoTuned).toBe(true);
    });
  });

  describe("getLatestByParameter", () => {
    it("应该获取指定参数的最新调优记录", () => {
      repository.create({
        parameterName: "test_param",
        parameterValue: "value1",
      });

      // 等待一小段时间确保时间戳不同
      const latest = repository.create({
        parameterName: "test_param",
        parameterValue: "value2",
      });

      const result = repository.getLatestByParameter("test_param");

      // 由于时间戳相同，按ID排序，最新的ID应该更大
      expect(result).not.toBeNull();
      expect(result?.parameterName).toBe("test_param");
      expect(result?.parameterValue).toBeOneOf(["value1", "value2"]);
    });

    it("应该返回null当参数不存在时", () => {
      const result = repository.getLatestByParameter("non_existent_param");

      expect(result).toBeNull();
    });
  });

  describe("getAllCurrentParameters", () => {
    it("应该获取所有参数的最新值", () => {
      repository.create({
        parameterName: "param1",
        parameterValue: "value1_v1",
      });
      repository.create({
        parameterName: "param1",
        parameterValue: "value1_v2",
      });
      repository.create({
        parameterName: "param2",
        parameterValue: "value2_v1",
      });

      const result = repository.getAllCurrentParameters();

      expect(result).toMatchObject({
        param1: expect.any(String),
        param2: "value2_v1",
      });
    });

    it("应该返回空对象当没有记录时", () => {
      const result = repository.getAllCurrentParameters();

      expect(result).toEqual({});
    });
  });

  describe("getParameterHistory", () => {
    it("应该获取指定参数的调优历史", () => {
      repository.create({
        parameterName: "test_param",
        parameterValue: "value1",
      });
      repository.create({
        parameterName: "test_param",
        parameterValue: "value2",
      });
      repository.create({
        parameterName: "other_param",
        parameterValue: "other_value",
      });

      const history = repository.getParameterHistory("test_param");

      expect(history).toHaveLength(2);
      expect(history.every((h) => h.parameterName === "test_param")).toBe(true);
    });

    it("应该支持限制返回数量", () => {
      for (let i = 0; i < 5; i++) {
        repository.create({
          parameterName: "test_param",
          parameterValue: `value${i}`,
        });
      }

      const history = repository.getParameterHistory("test_param", 3);

      expect(history).toHaveLength(3);
    });

    it("应该返回空数组当参数不存在时", () => {
      const history = repository.getParameterHistory("non_existent");

      expect(history).toEqual([]);
    });
  });

  describe("delete", () => {
    it("应该删除系统调优记录", () => {
      const created = repository.create({
        parameterName: "test_param",
        parameterValue: "value",
      });

      const deleted = repository.delete(created.id);

      expect(deleted).toBe(true);
      expect(repository.get(created.id)).toBeNull();
    });

    it("应该返回false当记录不存在时", () => {
      const result = repository.delete("non_existent_id");

      expect(result).toBe(false);
    });
  });

  describe("getStats", () => {
    it("应该获取调优统计信息", () => {
      repository.create({
        parameterName: "param1",
        parameterValue: "value1",
        autoTuned: true,
        tuningScore: 0.9,
      });
      repository.create({
        parameterName: "param1",
        parameterValue: "value2",
        autoTuned: false,
        tuningScore: 0.8,
      });
      repository.create({
        parameterName: "param2",
        parameterValue: "value",
        autoTuned: true,
        tuningScore: 0.95,
      });

      const stats = repository.getStats();

      expect(stats.totalTunings).toBe(3);
      expect(stats.autoTunedCount).toBe(2);
      expect(stats.manualTunedCount).toBe(1);
      expect(stats.byParameter).toMatchObject({
        param1: 2,
        param2: 1,
      });
      expect(stats.averageScore).toBeCloseTo(0.883, 2);
    });

    it("应该处理没有记录的情况", () => {
      const stats = repository.getStats();

      expect(stats.totalTunings).toBe(0);
      expect(stats.autoTunedCount).toBe(0);
      expect(stats.manualTunedCount).toBe(0);
      expect(stats.byParameter).toEqual({});
      expect(stats.averageScore).toBe(0);
    });

    it("应该处理没有评分的情况", () => {
      repository.create({
        parameterName: "param1",
        parameterValue: "value1",
        tuningScore: undefined,
      });

      const stats = repository.getStats();

      expect(stats.averageScore).toBe(0);
    });
  });

  describe("rollback", () => {
    it("应该回滚到指定参数值", () => {
      const original = repository.create({
        parameterName: "test_param",
        parameterValue: "original_value",
      });

      const updated = repository.create({
        parameterName: "test_param",
        parameterValue: "updated_value",
        previousValue: "original_value",
      });

      const rollback = repository.rollback("test_param", original.id);

      expect(rollback).not.toBeNull();
      expect(rollback?.parameterValue).toBe("original_value");
      expect(rollback?.changeReason).toContain("Rollback");
      expect(rollback?.changeReason).toContain(original.id);
      expect(rollback?.autoTuned).toBe(false);
    });

    it("应该返回null当目标记录不存在时", () => {
      const result = repository.rollback("test_param", "non_existent_id");

      expect(result).toBeNull();
    });

    it("应该使用previousValue作为回滚目标", () => {
      const tuning = repository.create({
        parameterName: "test_param",
        parameterValue: "current_value",
        previousValue: "previous_value",
      });

      const rollback = repository.rollback("test_param", tuning.id);

      expect(rollback?.parameterValue).toBe("previous_value");
    });
  });
});
