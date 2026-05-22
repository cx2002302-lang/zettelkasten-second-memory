/**
 * CronScheduler 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ZettelkastenCronScheduler,
  createCronScheduler,
  DEFAULT_NIGHTLY_SCHEDULE,
  DEFAULT_SCHEDULER_CONFIG,
  type CronSchedulerConfig,
} from "../cron-scheduler.js";
import type { DistillerService } from "../service/distiller-service.js";
import type { DistillJob } from "../core/types.js";

function createMockDistillerService(
  overrides: Partial<DistillJob> = {}
): DistillerService {
  return {
    distillYesterday: vi.fn().mockResolvedValue({
      id: "job-1",
      date: "2026-05-21",
      status: "completed",
      sliceCount: 3,
      summaryCount: 2,
      decisions: [],
      createdCount: 2,
      mergedCount: 0,
      skippedCount: 1,
      ...overrides,
    } as DistillJob),
  } as unknown as DistillerService;
}

describe("ZettelkastenCronScheduler", () => {
  let scheduler: ZettelkastenCronScheduler;
  let mockDistiller: DistillerService;

  beforeEach(() => {
    vi.useFakeTimers();
    mockDistiller = createMockDistillerService();
    scheduler = new ZettelkastenCronScheduler(mockDistiller);
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  describe("生命周期", () => {
    it("should start and set running state", () => {
      expect(scheduler.getIsRunning()).toBe(false);
      scheduler.start();
      expect(scheduler.getIsRunning()).toBe(true);
    });

    it("should schedule a nightly distill job on start", () => {
      scheduler.start();
      const jobs = scheduler.getJobs();
      expect(jobs.length).toBeGreaterThanOrEqual(1);
      expect(jobs[0].name).toBe(DEFAULT_NIGHTLY_SCHEDULE.jobName);
      expect(jobs[0].status).toBe("scheduled");
    });

    it("should not schedule job when nightly distill is disabled", () => {
      const disabledScheduler = new ZettelkastenCronScheduler(mockDistiller, {
        nightlyDistill: { ...DEFAULT_NIGHTLY_SCHEDULE, enabled: false },
      });
      disabledScheduler.start();
      expect(disabledScheduler.getJobs()).toHaveLength(0);
      disabledScheduler.stop();
    });

    it("should warn on double start", () => {
      scheduler.start();
      scheduler.start();
      expect(scheduler.getIsRunning()).toBe(true);
      const logs = scheduler.getLogs({ level: "warn" });
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].message).toContain("already running");
    });

    it("should stop and clear timers", () => {
      scheduler.start();
      expect(scheduler.getIsRunning()).toBe(true);
      scheduler.stop();
      expect(scheduler.getIsRunning()).toBe(false);
    });

    it("should be safe to stop when not running", () => {
      expect(() => scheduler.stop()).not.toThrow();
      expect(scheduler.getIsRunning()).toBe(false);
    });
  });

  describe("任务查询", () => {
    it("should get a specific job by id", () => {
      scheduler.start();
      const jobs = scheduler.getJobs();
      const job = scheduler.getJob(jobs[0].id);
      expect(job).toBeDefined();
      expect(job?.name).toBe(DEFAULT_NIGHTLY_SCHEDULE.jobName);
    });

    it("should return undefined for unknown job id", () => {
      expect(scheduler.getJob("nonexistent")).toBeUndefined();
    });
  });

  describe("任务执行", () => {
    it("should execute nightly distill when timer fires", async () => {
      scheduler.start();
      const jobs = scheduler.getJobs();
      const jobId = jobs[0].id;

      // Prevent rescheduling to avoid infinite timer loop
      (scheduler as any).config.nightlyDistill.enabled = false;

      // Fast-forward past the scheduled time (tomorrow 02:00)
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);
      await vi.runAllTimersAsync();

      const job = scheduler.getJob(jobId);
      expect(job?.status).toBe("completed");
      expect(mockDistiller.distillYesterday).toHaveBeenCalledTimes(1);
    });

    it("should mark job as failed when distillation fails", async () => {
      const failingDistiller = createMockDistillerService({
        status: "failed",
        error: "Distillation error",
      });
      const failScheduler = new ZettelkastenCronScheduler(failingDistiller, {
        nightlyDistill: {
          ...DEFAULT_NIGHTLY_SCHEDULE,
          retryCount: 0,
          retryIntervalMs: 0,
        },
      });
      failScheduler.start();
      const jobs = failScheduler.getJobs();
      const jobId = jobs[0].id;

      // Prevent rescheduling to avoid infinite timer loop
      (failScheduler as any).config.nightlyDistill.enabled = false;

      vi.advanceTimersByTime(25 * 60 * 60 * 1000);
      await vi.runAllTimersAsync();

      const job = failScheduler.getJob(jobId);
      expect(job?.status).toBe("failed");
      expect(job?.error).toBe("Distillation error");
      failScheduler.stop();
    });

    it("should retry failed jobs up to retryCount", async () => {
      const failingDistiller = createMockDistillerService({
        status: "failed",
        error: "Distillation error",
      });
      const retryScheduler = new ZettelkastenCronScheduler(failingDistiller, {
        nightlyDistill: {
          ...DEFAULT_NIGHTLY_SCHEDULE,
          retryCount: 2,
          retryIntervalMs: 1000,
        },
      });
      retryScheduler.start();

      // Prevent rescheduling to avoid infinite timer loop
      (retryScheduler as any).config.nightlyDistill.enabled = false;

      vi.advanceTimersByTime(25 * 60 * 60 * 1000);
      await vi.runAllTimersAsync();

      expect(failingDistiller.distillYesterday).toHaveBeenCalledTimes(3); // initial + 2 retries
      retryScheduler.stop();
    });
  });

  describe("手动触发", () => {
    it("should trigger manual distill", async () => {
      const result = await scheduler.triggerManualDistill();
      expect(result.status).toBe("completed");
      expect(mockDistiller.distillYesterday).toHaveBeenCalledTimes(1);
    });

    it("should log manual distill trigger", async () => {
      await scheduler.triggerManualDistill();
      const logs = scheduler.getLogs();
      expect(logs.some((l) => l.message.includes("Manual distill triggered"))).toBe(true);
    });
  });

  describe("日志管理", () => {
    it("should filter logs by level", () => {
      scheduler.start();
      scheduler.start(); // triggers warn

      const warnLogs = scheduler.getLogs({ level: "warn" });
      expect(warnLogs.every((l) => l.level === "warn")).toBe(true);
    });

    it("should limit log results", () => {
      scheduler.start();
      scheduler.start();
      scheduler.start();

      const limited = scheduler.getLogs({ limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it("should filter logs by jobId", () => {
      scheduler.start();
      const logs = scheduler.getLogs({ jobId: "scheduler" });
      expect(logs.every((l) => l.jobId === "scheduler")).toBe(true);
    });

    it("should cleanup old logs", () => {
      scheduler.start();
      const beforeCount = scheduler.getLogs().length;
      scheduler.cleanupOldLogs();
      const afterCount = scheduler.getLogs().length;
      // New logs should not be cleaned up
      expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
    });
  });

  describe("配置合并", () => {
    it("should merge custom config with defaults", () => {
      const customScheduler = new ZettelkastenCronScheduler(mockDistiller, {
        debugLogging: true,
        logRetentionDays: 7,
      });
      customScheduler.start();
      const logs = customScheduler.getLogs();
      expect(logs.length).toBeGreaterThanOrEqual(1);
      customScheduler.stop();
    });

    it("should merge nightlyDistill sub-config", () => {
      const customScheduler = new ZettelkastenCronScheduler(mockDistiller, {
        nightlyDistill: { ...DEFAULT_NIGHTLY_SCHEDULE, jobName: "custom-job" },
      });
      customScheduler.start();
      const jobs = customScheduler.getJobs();
      expect(jobs[0].name).toBe("custom-job");
      customScheduler.stop();
    });
  });

  describe("工厂函数", () => {
    it("createCronScheduler should return an instance", () => {
      const instance = createCronScheduler(mockDistiller);
      expect(instance).toBeInstanceOf(ZettelkastenCronScheduler);
    });
  });
});
