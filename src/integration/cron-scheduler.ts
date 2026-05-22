/**
 * Zettelkasten CronJob 调度器 - 夜间批处理
 *
 * 职责：
 * 1. 配置夜间蒸馏任务的 Cron 调度
 * 2. 管理任务队列和执行状态
 * 3. 记录执行日志
 *
 * 默认调度：每天凌晨 2:00 执行
 */

import type { DistillerService } from "../service/distiller-service.js";
import type { DistillJob } from "../core/types.js";

// ============================================================================
// Cron 调度配置类型
// ============================================================================

/** Cron 调度配置 */
export interface CronScheduleConfig {
  /** Cron 表达式 (默认: 0 2 * * * = 每天凌晨 2:00) */
  cronExpression: string;
  /** 时区 */
  timezone: string;
  /** 是否启用 */
  enabled: boolean;
  /** 任务名称 */
  jobName: string;
  /** 任务描述 */
  description?: string;
  /** 超时时间(毫秒) */
  timeoutMs: number;
  /** 重试次数 */
  retryCount: number;
  /** 重试间隔(毫秒) */
  retryIntervalMs: number;
}

/** 调度任务状态 */
export type SchedulerJobStatus =
  | "idle"
  | "scheduled"
  | "running"
  | "completed"
  | "failed"
  | "retrying";

/** 调度任务记录 */
export interface SchedulerJobRecord {
  /** 任务ID */
  id: string;
  /** 任务名称 */
  name: string;
  /** 当前状态 */
  status: SchedulerJobStatus;
  /** 计划执行时间 */
  scheduledAt: string;
  /** 实际开始时间 */
  startedAt?: string;
  /** 完成时间 */
  completedAt?: string;
  /** 关联的蒸馏作业 */
  distillJob?: DistillJob;
  /** 错误信息 */
  error?: string;
  /** 重试次数 */
  retryAttempt: number;
}

/** 执行日志条目 */
export interface ExecutionLogEntry {
  /** 日志ID */
  id: string;
  /** 任务ID */
  jobId: string;
  /** 日志级别 */
  level: "info" | "warn" | "error";
  /** 消息 */
  message: string;
  /** 详情 */
  details?: Record<string, unknown>;
  /** 时间戳 */
  timestamp: string;
}

// ============================================================================
// 默认配置
// ============================================================================

/** 默认调度配置：每天凌晨 2:00 */
export const DEFAULT_NIGHTLY_SCHEDULE: CronScheduleConfig = {
  cronExpression: "0 2 * * *",
  timezone: "UTC",
  enabled: true,
  jobName: "zettelkasten-nightly-distill",
  description: "夜间蒸馏批处理：处理前一天的所有 memory 日志",
  timeoutMs: 30 * 60 * 1000, // 30分钟
  retryCount: 3,
  retryIntervalMs: 5 * 60 * 1000, // 5分钟
};

/** 调度器配置 */
export interface CronSchedulerConfig {
  /** 夜间蒸馏调度 */
  nightlyDistill: CronScheduleConfig;
  /** 是否启用调试日志 */
  debugLogging: boolean;
  /** 最大日志保留天数 */
  logRetentionDays: number;
}

/** 默认调度器配置 */
export const DEFAULT_SCHEDULER_CONFIG: CronSchedulerConfig = {
  nightlyDistill: DEFAULT_NIGHTLY_SCHEDULE,
  debugLogging: false,
  logRetentionDays: 30,
};

// ============================================================================
// Cron 调度器
// ============================================================================

export class ZettelkastenCronScheduler {
  private config: CronSchedulerConfig;
  private distillerService: DistillerService;
  private jobs: Map<string, SchedulerJobRecord> = new Map();
  private logs: ExecutionLogEntry[] = [];
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private isRunning: boolean = false;

  constructor(
    distillerService: DistillerService,
    config: Partial<CronSchedulerConfig> = {}
  ) {
    this.distillerService = distillerService;
    this.config = {
      ...DEFAULT_SCHEDULER_CONFIG,
      ...config,
      nightlyDistill: {
        ...DEFAULT_NIGHTLY_SCHEDULE,
        ...config.nightlyDistill,
      },
    };
  }

  // ============================================================================
  // 日志记录
  // ============================================================================

  /**
   * 记录日志
   */
  private log(
    level: "info" | "warn" | "error",
    message: string,
    details?: Record<string, unknown>
  ): void {
    const entry: ExecutionLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      jobId: "scheduler",
      level,
      message,
      details,
      timestamp: new Date().toISOString(),
    };

    this.logs.push(entry);

    // 控制台输出
    // TODO: replace with structured logger
    // const prefix = `[Zettelkasten Cron] ${level.toUpperCase()}:`;
    // if (level === "error") {
    //   console.error(prefix, message, details || "");
    // } else if (level === "warn") {
    //   console.warn(prefix, message, details || "");
    // } else {
    //   console.log(prefix, message, details || "");
    // }
  }

  // ============================================================================
  // 生命周期管理
  // ============================================================================

  /**
   * 启动调度器
   */
  start(): void {
    if (this.isRunning) {
      this.log("warn", "Scheduler is already running");
      return;
    }

    this.isRunning = true;
    this.log("info", "Zettelkasten CronScheduler started");

    // 如果启用了夜间蒸馏，设置定时器
    if (this.config.nightlyDistill.enabled) {
      this.scheduleNightlyDistill();
    }
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    // 清除所有定时器
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    this.isRunning = false;
    this.log("info", "Zettelkasten CronScheduler stopped");
  }

  /**
   * 检查调度器是否运行中
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  // ============================================================================
  // 任务调度
  // ============================================================================

  /**
   * 调度夜间蒸馏任务
   */
  private scheduleNightlyDistill(): void {
    const config = this.config.nightlyDistill;
    const jobId = `nightly-distill-${Date.now()}`;

    // 计算下一个执行时间
    const nextRun = this.calculateNextRun(config.cronExpression, config.timezone);
    const delayMs = nextRun.getTime() - Date.now();

    this.log("info", "Scheduled nightly distill job", {
      jobId,
      nextRun: nextRun.toISOString(),
      delayMs,
    });

    // 创建任务记录
    const job: SchedulerJobRecord = {
      id: jobId,
      name: config.jobName,
      status: "scheduled",
      scheduledAt: nextRun.toISOString(),
      retryAttempt: 0,
    };
    this.jobs.set(jobId, job);

    // 设置定时器
    const timer = setTimeout(() => {
      void this.executeNightlyDistill(jobId);
    }, delayMs);

    this.timers.set(jobId, timer);
  }

  /**
   * 计算下一次执行时间
   */
  private calculateNextRun(cronExpression: string, _timezone: string): Date {
    // 简化的 cron 解析：只支持 "0 2 * * *" 格式
    const parts = cronExpression.split(" ");
    if (parts.length !== 5) {
      throw new Error(`Unsupported cron expression: ${cronExpression}`);
    }

    const [minute, hour] = parts.map(Number);
    const now = new Date();
    const next = new Date(now);

    next.setHours(hour, minute, 0, 0);

    // 如果今天的时间已过，设置为明天
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    return next;
  }

  // ============================================================================
  // 任务执行
  // ============================================================================

  /**
   * 执行夜间蒸馏任务
   */
  private async executeNightlyDistill(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      this.log("error", `Job not found: ${jobId}`);
      return;
    }

    job.status = "running";
    job.startedAt = new Date().toISOString();

    this.log("info", `Starting nightly distill job: ${jobId}`);

    try {
      // 获取所有现有笔记（用于去重）
      // 注意：这里需要从 NoteService 获取，通过 distillerService 内部访问
      const existingNotes: import("../core/types.js").ZettelNote[] = [];

      // 执行蒸馏
      const distillJob = await this.distillerService.distillYesterday(existingNotes);

      job.distillJob = distillJob;

      if (distillJob.status === "completed") {
        job.status = "completed";
        job.completedAt = new Date().toISOString();
        this.log("info", `Nightly distill completed`, {
          jobId,
          created: distillJob.createdCount,
          merged: distillJob.mergedCount,
          skipped: distillJob.skippedCount,
        });
      } else {
        throw new Error(distillJob.error || "Distillation failed");
      }
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      this.log("error", `Nightly distill failed: ${job.error}`, { jobId });

      // 尝试重试
      await this.handleRetry(jobId);
    }

    // 重新调度下一次执行
    if (this.isRunning && this.config.nightlyDistill.enabled) {
      this.scheduleNightlyDistill();
    }
  }

  /**
   * 处理重试逻辑
   */
  private async handleRetry(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || !job.error) return;

    const config = this.config.nightlyDistill;

    if (job.retryAttempt < config.retryCount) {
      job.retryAttempt++;
      job.status = "retrying";

      this.log("warn", `Retrying job ${jobId}, attempt ${job.retryAttempt}/${config.retryCount}`);

      // 延迟重试
      await new Promise((resolve) => setTimeout(resolve, config.retryIntervalMs));

      if (this.isRunning) {
        await this.executeNightlyDistill(jobId);
      }
    } else {
      this.log("error", `Job ${jobId} failed after ${config.retryCount} retries`);
    }
  }

  // ============================================================================
  // 查询方法
  // ============================================================================

  /**
   * 获取所有任务记录
   */
  getJobs(): SchedulerJobRecord[] {
    return Array.from(this.jobs.values());
  }

  /**
   * 获取指定任务
   */
  getJob(jobId: string): SchedulerJobRecord | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * 获取执行日志
   */
  getLogs(options?: {
    level?: "info" | "warn" | "error";
    jobId?: string;
    limit?: number;
  }): ExecutionLogEntry[] {
    let filtered = this.logs;

    if (options?.level) {
      filtered = filtered.filter((log) => log.level === options.level);
    }

    if (options?.jobId) {
      filtered = filtered.filter((log) => log.jobId === options.jobId);
    }

    if (options?.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  /**
   * 清理旧日志
   */
  cleanupOldLogs(): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.logRetentionDays);

    const cutoffISO = cutoffDate.toISOString();
    this.logs = this.logs.filter((log) => log.timestamp >= cutoffISO);

    this.log("info", `Cleaned up logs older than ${this.config.logRetentionDays} days`);
  }

  /**
   * 手动触发蒸馏（用于测试或立即执行）
   */
  async triggerManualDistill(): Promise<DistillJob> {
    const jobId = `manual-distill-${Date.now()}`;

    this.log("info", `Manual distill triggered: ${jobId}`);

    const existingNotes: import("../core/types.js").ZettelNote[] = [];
    return await this.distillerService.distillYesterday(existingNotes);
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 Cron 调度器
 */
export function createCronScheduler(
  distillerService: DistillerService,
  config?: Partial<CronSchedulerConfig>
): ZettelkastenCronScheduler {
  return new ZettelkastenCronScheduler(distillerService, config);
}
