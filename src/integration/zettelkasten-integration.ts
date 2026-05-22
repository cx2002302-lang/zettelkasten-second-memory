/**
 * Zettelkasten 集成初始化器
 *
 * 职责：
 * 1. 统一初始化所有集成组件
 * 2. 服务注册和依赖注入
 * 3. 生命周期管理
 * 4. 与 OpenClaw 核心系统的集成点
 *
 * 这是 Phase 4 神经中枢集成的统一入口。
 */

import type { DatabaseSync } from "node:sqlite";
import { AgentConfigManager } from "./agent-config.js";
import {
  ZettelkastenCronScheduler,
  createCronScheduler,
  type CronSchedulerConfig,
} from "./cron-scheduler.js";
import {
  SessionEndHookManager,
  createSessionEndHook,
  type SessionHookConfig,
} from "./session-hook.js";
import { DistillerService } from "../service/distiller-service.js";
import { NoteService } from "../service/note-service.js";
import { LinkService } from "../service/link-service.js";
import type { LLMProvider } from "../core/types.js";

// ============================================================================
// 集成配置
// ============================================================================

/** Zettelkasten 集成配置 */
export interface ZettelkastenIntegrationConfig {
  /** 基础路径 */
  basePath: string;
  /** 数据库实例 */
  db: DatabaseSync;
  /** LLM 提供者 */
  llmProvider: LLMProvider;
  /** Cron 调度配置 */
  cronConfig?: Partial<CronSchedulerConfig>;
  /** Session Hook 配置 */
  sessionHookConfig?: Partial<SessionHookConfig>;
  /** 是否自动启动 Cron 调度器 */
  autoStartCron: boolean;
  /** 是否启用 Session Hook */
  enableSessionHook: boolean;
  /** 调试模式 */
  debug: boolean;
}

/** 默认集成配置 */
export const DEFAULT_INTEGRATION_CONFIG: Omit<
  ZettelkastenIntegrationConfig,
  "db" | "llmProvider"
> = {
  basePath: "./zettelkasten",
  autoStartCron: true,
  enableSessionHook: true,
  debug: false,
};

// ============================================================================
// 集成状态
// ============================================================================

/** 集成组件状态 */
export type IntegrationComponentStatus = "uninitialized" | "initializing" | "ready" | "error";

/** 集成状态 */
export interface ZettelkastenIntegrationStatus {
  /** 整体状态 */
  overall: IntegrationComponentStatus;
  /** Agent 配置状态 */
  agentConfig: IntegrationComponentStatus;
  /** Cron 调度器状态 */
  cronScheduler: IntegrationComponentStatus;
  /** Session Hook 状态 */
  sessionHook: IntegrationComponentStatus;
  /** 服务层状态 */
  services: IntegrationComponentStatus;
  /** 错误信息 */
  errors: string[];
  /** 初始化时间 */
  initializedAt?: string;
}

// ============================================================================
// 集成初始化器
// ============================================================================

export class ZettelkastenIntegration {
  private config: ZettelkastenIntegrationConfig;
  private status: ZettelkastenIntegrationStatus;

  // 核心服务
  private noteService: NoteService;
  private linkService: LinkService;
  private distillerService: DistillerService;

  // 集成组件
  private agentConfigManager: AgentConfigManager;
  private cronScheduler?: ZettelkastenCronScheduler;
  private sessionHook?: SessionEndHookManager;

  constructor(config: ZettelkastenIntegrationConfig) {
    this.config = {
      ...DEFAULT_INTEGRATION_CONFIG,
      ...config,
    };

    this.status = {
      overall: "uninitialized",
      agentConfig: "uninitialized",
      cronScheduler: "uninitialized",
      sessionHook: "uninitialized",
      services: "uninitialized",
      errors: [],
    };

    // 初始化核心服务
    this.noteService = new NoteService(config.db, config.basePath);
    this.linkService = new LinkService(config.db);
    this.distillerService = new DistillerService(
      config.llmProvider,
      this.noteService,
      this.linkService
    );

    // 初始化 Agent 配置管理器
    this.agentConfigManager = new AgentConfigManager();
  }

  // ============================================================================
  // 初始化流程
  // ============================================================================

  /**
   * 初始化所有集成组件
   */
  async initialize(): Promise<ZettelkastenIntegrationStatus> {
    if (this.status.overall === "ready") {
      // TODO: replace with structured logger
      // console.log("[Zettelkasten Integration] Already initialized");
      return this.status;
    }

    this.status.overall = "initializing";
    this.status.errors = [];

    // TODO: replace with structured logger
    // console.log("[Zettelkasten Integration] Initializing...");

    try {
      // 1. 初始化服务层
      await this.initializeServices();

      // 2. 初始化 Agent 配置
      await this.initializeAgentConfig();

      // 3. 初始化 Cron 调度器
      await this.initializeCronScheduler();

      // 4. 初始化 Session Hook
      await this.initializeSessionHook();

      // 标记为就绪
      this.status.overall = "ready";
      this.status.initializedAt = new Date().toISOString();

      // TODO: replace with structured logger
      // console.log("[Zettelkasten Integration] Initialization complete");
    } catch (error) {
      this.status.overall = "error";
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.status.errors.push(errorMessage);
      // TODO: replace with structured logger
      // console.error("[Zettelkasten Integration] Initialization failed:", errorMessage);
      throw error;
    }

    return this.status;
  }

  /**
   * 初始化服务层
   */
  private async initializeServices(): Promise<void> {
    // TODO: replace with structured logger
    // console.log("[Zettelkasten Integration] Initializing services...");
    this.status.services = "initializing";

    try {
      // 服务已在构造函数中创建
      // 这里可以添加额外的服务初始化逻辑
      this.status.services = "ready";
    } catch (error) {
      this.status.services = "error";
      throw error;
    }
  }

  /**
   * 初始化 Agent 配置
   */
  private async initializeAgentConfig(): Promise<void> {
    // TODO: replace with structured logger
    // console.log("[Zettelkasten Integration] Initializing agent config...");
    this.status.agentConfig = "initializing";

    try {
      // AgentConfigManager 已在构造函数中初始化
      // 验证配置
      const agents = this.agentConfigManager.listAgents();
      // TODO: replace with structured logger
      // console.log(`[Zettelkasten Integration] Configured ${agents.length} agents`);
      this.status.agentConfig = "ready";
    } catch (error) {
      this.status.agentConfig = "error";
      throw error;
    }
  }

  /**
   * 初始化 Cron 调度器
   */
  private async initializeCronScheduler(): Promise<void> {
    if (!this.config.autoStartCron) {
      // TODO: replace with structured logger
      // console.log("[Zettelkasten Integration] Cron scheduler disabled");
      this.status.cronScheduler = "ready";
      return;
    }

    // TODO: replace with structured logger
    // console.log("[Zettelkasten Integration] Initializing cron scheduler...");
    this.status.cronScheduler = "initializing";

    try {
      this.cronScheduler = createCronScheduler(
        this.distillerService,
        this.config.cronConfig
      );
      this.cronScheduler.start();
      this.status.cronScheduler = "ready";
    } catch (error) {
      this.status.cronScheduler = "error";
      throw error;
    }
  }

  /**
   * 初始化 Session Hook
   */
  private async initializeSessionHook(): Promise<void> {
    if (!this.config.enableSessionHook) {
      // TODO: replace with structured logger
      // console.log("[Zettelkasten Integration] Session hook disabled");
      this.status.sessionHook = "ready";
      return;
    }

    // TODO: replace with structured logger
    // console.log("[Zettelkasten Integration] Initializing session hook...");
    this.status.sessionHook = "initializing";

    try {
      this.sessionHook = createSessionEndHook(
        this.distillerService,
        this.config.sessionHookConfig
      );
      this.sessionHook.initialize();
      this.status.sessionHook = "ready";
    } catch (error) {
      this.status.sessionHook = "error";
      throw error;
    }
  }

  // ============================================================================
  // 生命周期管理
  // ============================================================================

  /**
   * 停止所有组件
   */
  async shutdown(): Promise<void> {
    // TODO: replace with structured logger
    // console.log("[Zettelkasten Integration] Shutting down...");

    // 停止 Cron 调度器
    if (this.cronScheduler) {
      this.cronScheduler.stop();
    }

    // 销毁 Session Hook
    if (this.sessionHook) {
      this.sessionHook.destroy();
    }

    this.status.overall = "uninitialized";
    // TODO: replace with structured logger
    // console.log("[Zettelkasten Integration] Shutdown complete");
  }

  // ============================================================================
  // 状态查询
  // ============================================================================

  /**
   * 获取集成状态
   */
  getStatus(): ZettelkastenIntegrationStatus {
    return { ...this.status };
  }

  /**
   * 检查是否已就绪
   */
  isReady(): boolean {
    return this.status.overall === "ready";
  }

  // ============================================================================
  // 服务访问
  // ============================================================================

  /**
   * 获取 NoteService
   */
  getNoteService(): NoteService {
    return this.noteService;
  }

  /**
   * 获取 LinkService
   */
  getLinkService(): LinkService {
    return this.linkService;
  }

  /**
   * 获取 DistillerService
   */
  getDistillerService(): DistillerService {
    return this.distillerService;
  }

  /**
   * 获取 Agent 配置管理器
   */
  getAgentConfigManager(): AgentConfigManager {
    return this.agentConfigManager;
  }

  /**
   * 获取 Cron 调度器
   */
  getCronScheduler(): ZettelkastenCronScheduler | undefined {
    return this.cronScheduler;
  }

  /**
   * 获取 Session Hook
   */
  getSessionHook(): SessionEndHookManager | undefined {
    return this.sessionHook;
  }

  // ============================================================================
  // OpenClaw 集成点
  // ============================================================================

  /**
   * 处理会话结束事件
   * 由 OpenClaw 核心系统在会话结束时调用
   */
  async onSessionEnd(sessionInfo: import("./session-hook.js").SessionInfo): Promise<import("./session-hook.js").SessionHookResult> {
    if (!this.sessionHook) {
      return {
        success: false,
        sessionId: sessionInfo.sessionId,
        slicesProcessed: 0,
        notesCreated: 0,
        executionTimeMs: 0,
        error: "Session hook not initialized",
      };
    }

    return await this.sessionHook.onSessionEnd(sessionInfo);
  }

  /**
   * 手动触发夜间蒸馏
   */
  async triggerManualDistill(): Promise<import("../core/types.js").DistillJob> {
    if (!this.cronScheduler) {
      throw new Error("Cron scheduler not initialized");
    }
    return await this.cronScheduler.triggerManualDistill();
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 Zettelkasten 集成
 */
export function createZettelkastenIntegration(
  config: ZettelkastenIntegrationConfig
): ZettelkastenIntegration {
  return new ZettelkastenIntegration(config);
}

/**
 * 初始化 Zettelkasten 集成（便捷函数）
 */
export async function initializeZettelkasten(
  config: ZettelkastenIntegrationConfig
): Promise<ZettelkastenIntegration> {
  const integration = createZettelkastenIntegration(config);
  await integration.initialize();
  return integration;
}

// ============================================================================
// 全局单例
// ============================================================================

let globalIntegration: ZettelkastenIntegration | null = null;

/**
 * 获取全局 Zettelkasten 集成实例
 */
export function getZettelkastenIntegration(): ZettelkastenIntegration | null {
  return globalIntegration;
}

/**
 * 设置全局 Zettelkasten 集成实例
 */
export function setZettelkastenIntegration(integration: ZettelkastenIntegration): void {
  globalIntegration = integration;
}

/**
 * 重置全局实例
 */
export function resetZettelkastenIntegration(): void {
  globalIntegration = null;
}
