/**
 * Zettelkasten Phase 4 集成测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentConfigManager,
  CHAT_BRAIN_TOOLS,
  KNOWLEDGE_BRAIN_TOOLS,
  createMCPConfigForAgent,
  validateAgentConfig,
  getAgentConfigManager,
  resetAgentConfigManager,
  type AgentConfig,
  type AgentRole,
} from "../agent-config.js";
import {
  DEFAULT_NIGHTLY_SCHEDULE,
  DEFAULT_SCHEDULER_CONFIG,
} from "../cron-scheduler.js";
import {
  DEFAULT_SESSION_HOOK_CONFIG,
} from "../session-hook.js";
import {
  createZettelkastenIntegration,
  DEFAULT_INTEGRATION_CONFIG,
  getZettelkastenIntegration,
  setZettelkastenIntegration,
  resetZettelkastenIntegration,
} from "../zettelkasten-integration.js";

describe("Phase 4: 神经中枢集成", () => {
  describe("Agent 配置系统", () => {
    let manager: AgentConfigManager;

    beforeEach(() => {
      manager = new AgentConfigManager();
    });

    it("应该初始化默认的双 Agent 配置", () => {
      const agents = manager.listAgents();
      expect(agents).toHaveLength(2);

      const chatAgent = manager.getAgent("chat");
      expect(chatAgent).toBeDefined();
      expect(chatAgent?.permission).toBe("read-only");
      expect(chatAgent?.tools).toEqual(CHAT_BRAIN_TOOLS);

      const knowledgeAgent = manager.getAgent("knowledge");
      expect(knowledgeAgent).toBeDefined();
      expect(knowledgeAgent?.permission).toBe("read-write");
      expect(knowledgeAgent?.tools).toEqual(KNOWLEDGE_BRAIN_TOOLS);
    });

    it("应该正确验证工具权限", () => {
      expect(manager.isToolAllowed("chat", "zk_search_notes")).toBe(true);
      expect(manager.isToolAllowed("chat", "zk_get_note")).toBe(true);
      expect(manager.isToolAllowed("chat", "zk_get_backlinks")).toBe(true);
      expect(manager.isToolAllowed("chat", "zk_find_path")).toBe(true);
      expect(manager.isToolAllowed("chat", "zk_create_note")).toBe(false);
      expect(manager.isToolAllowed("knowledge", "zk_create_note")).toBe(true);
    });

    it("应该支持 Agent 启用/禁用", () => {
      manager.disableAgent("chat");
      expect(manager.getAgent("chat")?.enabled).toBe(false);
      expect(manager.isToolAllowed("chat", "zk_search_notes")).toBe(false);

      manager.enableAgent("chat");
      expect(manager.getAgent("chat")?.enabled).toBe(true);
    });

    it("应该支持注册和注销 Agent", () => {
      const customConfig: AgentConfig = {
        id: "custom-agent",
        role: "knowledge",
        permission: "read-write",
        tools: KNOWLEDGE_BRAIN_TOOLS,
        enabled: true,
      };

      manager.registerAgent(customConfig);
      expect(manager.getAgent("knowledge")?.id).toBe("custom-agent");

      manager.unregisterAgent("knowledge");
      expect(manager.getAgent("knowledge")).toBeUndefined();
    });

    it("应该支持更新 Agent 配置", () => {
      manager.updateAgent("chat", { enabled: false });
      expect(manager.getAgent("chat")?.enabled).toBe(false);

      manager.updateAgent("chat", { enabled: true });
      expect(manager.getAgent("chat")?.enabled).toBe(true);
    });

    it("更新不存在的 Agent 应该抛出错误", () => {
      expect(() => manager.updateAgent("nonexistent" as AgentRole, {})).toThrow();
    });

    it("应该支持获取允许的工具列表", () => {
      const chatTools = manager.getAllowedTools("chat");
      expect(chatTools).toEqual(CHAT_BRAIN_TOOLS);

      manager.disableAgent("chat");
      expect(manager.getAllowedTools("chat")).toEqual([]);
    });

    it("应该支持重置为默认配置", () => {
      manager.disableAgent("chat");
      manager.unregisterAgent("knowledge");

      manager.resetToDefaults();

      expect(manager.listAgents()).toHaveLength(2);
      expect(manager.getAgent("chat")?.enabled).toBe(true);
    });

    it("应该支持获取全局配置管理器", () => {
      resetAgentConfigManager();
      const globalManager = getAgentConfigManager();
      expect(globalManager).toBeDefined();
      expect(globalManager.listAgents()).toHaveLength(2);

      const globalManager2 = getAgentConfigManager();
      expect(globalManager2).toBe(globalManager);
    });
  });

  describe("Agent 配置常量", () => {
    it("CHAT_BRAIN_TOOLS 应该包含只读工具", () => {
      expect(CHAT_BRAIN_TOOLS).toContain("zk_search_notes");
      expect(CHAT_BRAIN_TOOLS).toContain("zk_get_note");
      expect(CHAT_BRAIN_TOOLS).toContain("zk_get_backlinks");
      expect(CHAT_BRAIN_TOOLS).toContain("zk_find_path");
      expect(CHAT_BRAIN_TOOLS).toHaveLength(4);
    });

    it("KNOWLEDGE_BRAIN_TOOLS 应该包含所有工具", () => {
      expect(KNOWLEDGE_BRAIN_TOOLS).toContain("zk_search_notes");
      expect(KNOWLEDGE_BRAIN_TOOLS).toContain("zk_create_note");
      expect(KNOWLEDGE_BRAIN_TOOLS).toContain("zk_update_note");
      expect(KNOWLEDGE_BRAIN_TOOLS).toContain("zk_create_link");
      expect(KNOWLEDGE_BRAIN_TOOLS).toContain("zk_run_ceqrc_workflow");
      expect(KNOWLEDGE_BRAIN_TOOLS).toContain("zk_distill_memory");
      expect(KNOWLEDGE_BRAIN_TOOLS).toContain("zk_review_note");
      expect(KNOWLEDGE_BRAIN_TOOLS).toHaveLength(10);
    });
  });

  describe("MCP 配置生成", () => {
    it("应该为 chat agent 生成只读配置", () => {
      const manager = new AgentConfigManager();
      const config = createMCPConfigForAgent("chat", manager);
      expect(config.enableReadOnlyTools).toBe(true);
      expect(config.enableReadWriteTools).toBe(false);
    });

    it("应该为 knowledge agent 生成读写配置", () => {
      const manager = new AgentConfigManager();
      const config = createMCPConfigForAgent("knowledge", manager);
      expect(config.enableReadOnlyTools).toBe(true);
      expect(config.enableReadWriteTools).toBe(true);
    });

    it("禁用的 agent 应该返回 false", () => {
      const manager = new AgentConfigManager();
      manager.disableAgent("chat");
      const config = createMCPConfigForAgent("chat", manager);
      expect(config.enableReadOnlyTools).toBe(false);
      expect(config.enableReadWriteTools).toBe(false);
    });
  });

  describe("Agent 配置验证", () => {
    it("应该验证有效的配置", () => {
      const validConfig: AgentConfig = {
        id: "test-agent",
        role: "chat",
        permission: "read-only",
        tools: CHAT_BRAIN_TOOLS,
        enabled: true,
      };
      const result = validateAgentConfig(validConfig);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("应该检测缺少 ID 的配置", () => {
      const invalidConfig = {
        id: "",
        role: "chat" as AgentRole,
        permission: "read-only" as const,
        tools: CHAT_BRAIN_TOOLS,
        enabled: true,
      };
      const result = validateAgentConfig(invalidConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Agent ID is required");
    });
  });

  describe("Cron 调度器", () => {
    it("应该有正确的默认配置", () => {
      expect(DEFAULT_NIGHTLY_SCHEDULE.cronExpression).toBe("0 2 * * *");
      expect(DEFAULT_NIGHTLY_SCHEDULE.enabled).toBe(true);
      expect(DEFAULT_NIGHTLY_SCHEDULE.jobName).toBe("zettelkasten-nightly-distill");
      expect(DEFAULT_NIGHTLY_SCHEDULE.timezone).toBe("UTC");
      expect(DEFAULT_NIGHTLY_SCHEDULE.timeoutMs).toBe(30 * 60 * 1000);
      expect(DEFAULT_NIGHTLY_SCHEDULE.retryCount).toBe(3);
    });

    it("DEFAULT_SCHEDULER_CONFIG 应该有正确的默认值", () => {
      expect(DEFAULT_SCHEDULER_CONFIG.nightlyDistill.cronExpression).toBe("0 2 * * *");
      expect(DEFAULT_SCHEDULER_CONFIG.debugLogging).toBe(false);
      expect(DEFAULT_SCHEDULER_CONFIG.logRetentionDays).toBe(30);
    });
  });

  describe("Session Hook", () => {
    it("应该有正确的默认配置", () => {
      expect(DEFAULT_SESSION_HOOK_CONFIG.enabled).toBe(true);
      expect(DEFAULT_SESSION_HOOK_CONFIG.minSessionMessages).toBe(5);
      expect(DEFAULT_SESSION_HOOK_CONFIG.minSessionDurationMinutes).toBe(1);
      expect(DEFAULT_SESSION_HOOK_CONFIG.timeoutMs).toBe(60 * 1000);
      expect(DEFAULT_SESSION_HOOK_CONFIG.awaitCompletion).toBe(false);
      expect(DEFAULT_SESSION_HOOK_CONFIG.retryOnFailure).toBe(true);
      expect(DEFAULT_SESSION_HOOK_CONFIG.maxRetries).toBe(2);
      expect(DEFAULT_SESSION_HOOK_CONFIG.generateSessionSummary).toBe(true);
      expect(DEFAULT_SESSION_HOOK_CONFIG.sessionSummaryFolder).toBe("references");
    });
  });

  describe("集成初始化器", () => {
    it("应该正确导出集成创建函数", () => {
      expect(typeof createZettelkastenIntegration).toBe("function");
    });

    it("DEFAULT_INTEGRATION_CONFIG 应该有正确的默认值", () => {
      expect(DEFAULT_INTEGRATION_CONFIG.basePath).toBe("./zettelkasten");
      expect(DEFAULT_INTEGRATION_CONFIG.autoStartCron).toBe(true);
      expect(DEFAULT_INTEGRATION_CONFIG.enableSessionHook).toBe(true);
      expect(DEFAULT_INTEGRATION_CONFIG.debug).toBe(false);
    });

    it("应该支持全局集成实例管理", () => {
      resetZettelkastenIntegration();
      expect(getZettelkastenIntegration()).toBeNull();

      // 创建一个 mock 集成对象
      const mockIntegration = { test: true } as any;
      setZettelkastenIntegration(mockIntegration);
      expect(getZettelkastenIntegration()).toBe(mockIntegration);

      resetZettelkastenIntegration();
      expect(getZettelkastenIntegration()).toBeNull();
    });
  });
});