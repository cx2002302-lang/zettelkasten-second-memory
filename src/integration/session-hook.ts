/**
 * Zettelkasten Session End Hook - 会话结束触发蒸馏
 *
 * 职责：
 * 1. 监听 OpenClaw 会话结束事件
 * 2. 异步触发笔记蒸馏
 * 3. 支持配置是否启用
 * 4. 错误回退机制
 */

import type { DistillerService } from "../service/distiller-service.js";
import type { DistillJob } from "../core/types.js";

// ============================================================================
// Session Hook 配置类型
// ============================================================================

/** Session Hook 配置 */
export interface SessionHookConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 最小会话长度（消息数）才触发蒸馏 */
  minSessionMessages: number;
  /** 最小会话时长（分钟）才触发蒸馏 */
  minSessionDurationMinutes: number;
  /** 异步执行超时（毫秒） */
  timeoutMs: number;
  /** 是否等待蒸馏完成 */
  awaitCompletion: boolean;
  /** 失败时是否重试 */
  retryOnFailure: boolean;
  /** 最大重试次数 */
  maxRetries: number;
  /** 是否生成会话摘要笔记 */
  generateSessionSummary: boolean;
  /** 会话摘要笔记的目标文件夹 */
  sessionSummaryFolder: "inbox" | "references" | "zettels";
}

/** Session 信息 */
export interface SessionInfo {
  /** 会话ID */
  sessionId: string;
  /** 会话键 */
  sessionKey: string;
  /** 开始时间 */
  startedAt: string;
  /** 结束时间 */
  endedAt: string;
  /** 消息数量 */
  messageCount: number;
  /** 会话主题/标题（如果有） */
  topic?: string;
  /** 参与者 */
  participants?: string[];
}

/** Hook 执行结果 */
export interface SessionHookResult {
  /** 是否成功 */
  success: boolean;
  /** 会话ID */
  sessionId: string;
  /** 处理的切片数量 */
  slicesProcessed: number;
  /** 创建的笔记数量 */
  notesCreated: number;
  /** 执行时间（毫秒） */
  executionTimeMs: number;
  /** 错误信息 */
  error?: string;
  /** 关联的蒸馏作业 */
  distillJob?: DistillJob;
}

/** Hook 事件类型 */
export type SessionHookEventType = "session_start" | "session_end" | "session_distill_complete" | "session_distill_failed";

/** Hook 事件监听器 */
export type SessionHookEventListener = (event: {
  type: SessionHookEventType;
  sessionId: string;
  timestamp: string;
  data?: unknown;
}) => void;

// ============================================================================
// 默认配置
// ============================================================================

/** 默认 Session Hook 配置 */
export const DEFAULT_SESSION_HOOK_CONFIG: SessionHookConfig = {
  enabled: true,
  minSessionMessages: 5,
  minSessionDurationMinutes: 1,
  timeoutMs: 60 * 1000, // 1分钟
  awaitCompletion: false, // 默认异步执行，不阻塞
  retryOnFailure: true,
  maxRetries: 2,
  generateSessionSummary: true,
  sessionSummaryFolder: "references",
};

// ============================================================================
// Session End Hook 管理器
// ============================================================================

export class SessionEndHookManager {
  private config: SessionHookConfig;
  private distillerService: DistillerService;
  private listeners: Set<SessionHookEventListener> = new Set();
  private isInitialized: boolean = false;
  private pendingHooks: Map<string, Promise<SessionHookResult>> = new Map();

  constructor(
    distillerService: DistillerService,
    config: Partial<SessionHookConfig> = {}
  ) {
    this.distillerService = distillerService;
    this.config = { ...DEFAULT_SESSION_HOOK_CONFIG, ...config };
  }

  // ============================================================================
  // 生命周期管理
  // ============================================================================

  /**
   * 初始化 Hook
   */
  initialize(): void {
    if (this.isInitialized) {
      // TODO: replace with structured logger
      // console.warn("[Zettelkasten SessionHook] Already initialized");
      return;
    }

    this.isInitialized = true;
    this.emitEvent("session_start", "system", { initialized: true });

    // TODO: replace with structured logger
    // console.log("[Zettelkasten SessionHook] Initialized", {
    //   enabled: this.config.enabled,
    //   minSessionMessages: this.config.minSessionMessages,
    // });
  }

  /**
   * 销毁 Hook
   */
  destroy(): void {
    this.isInitialized = false;
    this.listeners.clear();
    this.pendingHooks.clear();
    // TODO: replace with structured logger
    // console.log("[Zettelkasten SessionHook] Destroyed");
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SessionHookConfig>): void {
    this.config = { ...this.config, ...config };
    // TODO: replace with structured logger
    // console.log("[Zettelkasten SessionHook] Config updated", this.config);
  }

  // ============================================================================
  // 事件监听
  // ============================================================================

  /**
   * 添加事件监听器
   */
  addEventListener(listener: SessionHookEventListener): void {
    this.listeners.add(listener);
  }

  /**
   * 移除事件监听器
   */
  removeEventListener(listener: SessionHookEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * 触发事件
   */
  private emitEvent(
    type: SessionHookEventType,
    sessionId: string,
    data?: unknown
  ): void {
    const event = {
      type,
      sessionId,
      timestamp: new Date().toISOString(),
      data,
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        // TODO: replace with structured logger
        // console.error("[Zettelkasten SessionHook] Event listener error:", error);
      }
    }
  }

  // ============================================================================
  // Session End 处理
  // ============================================================================

  /**
   * 处理 Session End 事件
   * 这是主要入口点，由 OpenClaw 核心系统在会话结束时调用
   */
  async onSessionEnd(sessionInfo: SessionInfo): Promise<SessionHookResult> {
    if (!this.config.enabled) {
      // TODO: replace with structured logger
      // console.log("[Zettelkasten SessionHook] Disabled, skipping session:", sessionInfo.sessionId);
      return {
        success: true,
        sessionId: sessionInfo.sessionId,
        slicesProcessed: 0,
        notesCreated: 0,
        executionTimeMs: 0,
      };
    }

    // 检查会话是否符合蒸馏条件
    if (!this.shouldDistillSession(sessionInfo)) {
      // TODO: replace with structured logger
      // console.log("[Zettelkasten SessionHook] Session does not meet criteria:", sessionInfo.sessionId);
      return {
        success: true,
        sessionId: sessionInfo.sessionId,
        slicesProcessed: 0,
        notesCreated: 0,
        executionTimeMs: 0,
      };
    }

    // 触发会话结束事件
    this.emitEvent("session_end", sessionInfo.sessionId, sessionInfo);

    // 执行蒸馏
    if (this.config.awaitCompletion) {
      // 同步等待
      return await this.executeDistill(sessionInfo);
    } else {
      // 异步执行，不阻塞主流程
      const promise = this.executeDistill(sessionInfo);
      this.pendingHooks.set(sessionInfo.sessionId, promise);

      // 清理完成的 promise
      promise.finally(() => {
        this.pendingHooks.delete(sessionInfo.sessionId);
      });

      // 立即返回成功状态
      return {
        success: true,
        sessionId: sessionInfo.sessionId,
        slicesProcessed: 0,
        notesCreated: 0,
        executionTimeMs: 0,
        distillJob: undefined,
      };
    }
  }

  /**
   * 检查会话是否符合蒸馏条件
   */
  private shouldDistillSession(sessionInfo: SessionInfo): boolean {
    // 检查消息数量
    if (sessionInfo.messageCount < this.config.minSessionMessages) {
      return false;
    }

    // 检查会话时长
    const durationMinutes =
      (new Date(sessionInfo.endedAt).getTime() - new Date(sessionInfo.startedAt).getTime()) /
      (1000 * 60);

    if (durationMinutes < this.config.minSessionDurationMinutes) {
      return false;
    }

    return true;
  }

  /**
   * 执行蒸馏
   */
  private async executeDistill(sessionInfo: SessionInfo): Promise<SessionHookResult> {
    const startTime = Date.now();

    try {
      // 获取现有笔记用于去重
      const existingNotes: import("../core/types.js").ZettelNote[] = [];

      // 执行蒸馏
      const distillJob = await this.distillerService.distillYesterday(existingNotes);

      const executionTimeMs = Date.now() - startTime;

      const result: SessionHookResult = {
        success: distillJob.status === "completed",
        sessionId: sessionInfo.sessionId,
        slicesProcessed: distillJob.sliceCount,
        notesCreated: distillJob.createdCount,
        executionTimeMs,
        distillJob,
      };

      if (result.success) {
        this.emitEvent("session_distill_complete", sessionInfo.sessionId, result);
      } else {
        this.emitEvent("session_distill_failed", sessionInfo.sessionId, {
          error: distillJob.error,
        });
      }

      return result;
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.emitEvent("session_distill_failed", sessionInfo.sessionId, {
        error: errorMessage,
      });

      return {
        success: false,
        sessionId: sessionInfo.sessionId,
        slicesProcessed: 0,
        notesCreated: 0,
        executionTimeMs,
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // 查询和状态
  // ============================================================================

  /**
   * 获取挂起的 Hook 数量
   */
  getPendingCount(): number {
    return this.pendingHooks.size;
  }

  /**
   * 等待所有挂起的 Hook 完成
   */
  async waitForPending(): Promise<void> {
    if (this.pendingHooks.size === 0) {
      return;
    }

    await Promise.all(this.pendingHooks.values());
  }

  /**
   * 检查是否有挂起的 Hook
   */
  hasPending(): boolean {
    return this.pendingHooks.size > 0;
  }

  // ============================================================================
  // 重试机制
  // ============================================================================

  /**
   * 重试失败的蒸馏
   */
  async retrySession(sessionInfo: SessionInfo, attempt: number = 1): Promise<SessionHookResult> {
    if (attempt > this.config.maxRetries) {
      return {
        success: false,
        sessionId: sessionInfo.sessionId,
        slicesProcessed: 0,
        notesCreated: 0,
        executionTimeMs: 0,
        error: `Max retries (${this.config.maxRetries}) exceeded`,
      };
    }

    // TODO: replace with structured logger
    // console.log(`[Zettelkasten SessionHook] Retrying session ${sessionInfo.sessionId}, attempt ${attempt}`);

    // 延迟重试
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));

    return await this.executeDistill(sessionInfo);
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 Session End Hook 管理器
 */
export function createSessionEndHook(
  distillerService: DistillerService,
  config?: Partial<SessionHookConfig>
): SessionEndHookManager {
  return new SessionEndHookManager(distillerService, config);
}

/**
 * 注册全局 Session End Hook
 * 由 OpenClaw 核心系统在初始化时调用
 */
export function registerGlobalSessionHook(
  distillerService: DistillerService,
  config?: Partial<SessionHookConfig>
): SessionEndHookManager {
  const hook = createSessionEndHook(distillerService, config);
  hook.initialize();
  return hook;
}
