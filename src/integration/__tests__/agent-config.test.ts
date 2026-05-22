/**
 * AgentConfig 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentConfigManager,
  CHAT_BRAIN_TOOLS,
  KNOWLEDGE_BRAIN_TOOLS,
  DEFAULT_AGENT_CONFIGS,
  createMCPConfigForAgent,
  validateAgentConfig,
  getAgentConfigManager,
  resetAgentConfigManager,
  type AgentConfig,
  type AgentRole,
} from "../agent-config.js";

describe("AgentConfigManager", () => {
  let manager: AgentConfigManager;

  beforeEach(() => {
    manager = new AgentConfigManager();
  });

  describe("load / 初始化", () => {
    it("should load default dual-agent configs on construction", () => {
      const agents = manager.listAgents();
      expect(agents).toHaveLength(2);
    });

    it("should have chat agent with read-only permission", () => {
      const chat = manager.getAgent("chat");
      expect(chat).toBeDefined();
      expect(chat!.role).toBe("chat");
      expect(chat!.permission).toBe("read-only");
      expect(chat!.tools).toEqual(CHAT_BRAIN_TOOLS);
      expect(chat!.enabled).toBe(true);
    });

    it("should have knowledge agent with read-write permission", () => {
      const knowledge = manager.getAgent("knowledge");
      expect(knowledge).toBeDefined();
      expect(knowledge!.role).toBe("knowledge");
      expect(knowledge!.permission).toBe("read-write");
      expect(knowledge!.tools).toEqual(KNOWLEDGE_BRAIN_TOOLS);
      expect(knowledge!.enabled).toBe(true);
    });
  });

  describe("getConfig", () => {
    it("should get existing agent config", () => {
      const chat = manager.getAgent("chat");
      expect(chat).toBeDefined();
      expect(chat!.id).toBe(DEFAULT_AGENT_CONFIGS.chat.id);
    });

    it("should return undefined for unknown role", () => {
      expect(manager.getAgent("unknown" as AgentRole)).toBeUndefined();
    });
  });

  describe("validate", () => {
    it("validateAgentConfig should pass for valid chat config", () => {
      const config: AgentConfig = {
        id: "test-chat",
        role: "chat",
        permission: "read-only",
        tools: CHAT_BRAIN_TOOLS,
        enabled: true,
      };
      const result = validateAgentConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("validateAgentConfig should detect missing id", () => {
      const config = {
        id: "",
        role: "chat" as AgentRole,
        permission: "read-only" as const,
        tools: CHAT_BRAIN_TOOLS,
        enabled: true,
      };
      const result = validateAgentConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Agent ID is required");
    });

    it("validateAgentConfig should detect missing role", () => {
      const config = {
        id: "test",
        role: "" as AgentRole,
        permission: "read-only" as const,
        tools: CHAT_BRAIN_TOOLS,
        enabled: true,
      };
      const result = validateAgentConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Agent role is required");
    });

    it("validateAgentConfig should detect invalid role", () => {
      const config = {
        id: "test",
        role: "invalid" as AgentRole,
        permission: "read-only" as const,
        tools: CHAT_BRAIN_TOOLS,
        enabled: true,
      };
      const result = validateAgentConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Invalid agent role: invalid");
    });

    it("validateAgentConfig should detect empty tools", () => {
      const config: AgentConfig = {
        id: "test",
        role: "chat",
        permission: "read-only",
        tools: [],
        enabled: true,
      };
      const result = validateAgentConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Agent must have at least one tool assigned");
    });

    it("validateAgentConfig should detect chat agent with write tools", () => {
      const config: AgentConfig = {
        id: "test",
        role: "chat",
        permission: "read-only",
        tools: ["zk_create_note" as any],
        enabled: true,
      };
      const result = validateAgentConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Chat agent cannot have tools"))).toBe(true);
    });
  });

  describe("权限矩阵检查", () => {
    it("should allow chat agent to use read-only tools", () => {
      expect(manager.isToolAllowed("chat", "zk_search_notes")).toBe(true);
      expect(manager.isToolAllowed("chat", "zk_get_note")).toBe(true);
      expect(manager.isToolAllowed("chat", "zk_get_backlinks")).toBe(true);
      expect(manager.isToolAllowed("chat", "zk_find_path")).toBe(true);
    });

    it("should deny chat agent write tools", () => {
      expect(manager.isToolAllowed("chat", "zk_create_note")).toBe(false);
      expect(manager.isToolAllowed("chat", "zk_update_note")).toBe(false);
      expect(manager.isToolAllowed("chat", "zk_create_link")).toBe(false);
      expect(manager.isToolAllowed("chat", "zk_distill_memory")).toBe(false);
    });

    it("should allow knowledge agent all tools", () => {
      expect(manager.isToolAllowed("knowledge", "zk_search_notes")).toBe(true);
      expect(manager.isToolAllowed("knowledge", "zk_create_note")).toBe(true);
      expect(manager.isToolAllowed("knowledge", "zk_update_note")).toBe(true);
      expect(manager.isToolAllowed("knowledge", "zk_distill_memory")).toBe(true);
    });

    it("should deny tools for disabled agent", () => {
      manager.disableAgent("chat");
      expect(manager.isToolAllowed("chat", "zk_search_notes")).toBe(false);
    });

    it("should deny tools for unknown role", () => {
      expect(manager.isToolAllowed("unknown" as AgentRole, "zk_search_notes")).toBe(false);
    });
  });

  describe("注册与注销", () => {
    it("should register a custom agent", () => {
      const custom: AgentConfig = {
        id: "custom-1",
        role: "knowledge",
        permission: "read-write",
        tools: KNOWLEDGE_BRAIN_TOOLS,
        enabled: true,
      };
      manager.registerAgent(custom);
      expect(manager.getAgent("knowledge")?.id).toBe("custom-1");
    });

    it("should unregister an agent", () => {
      manager.unregisterAgent("chat");
      expect(manager.getAgent("chat")).toBeUndefined();
      expect(manager.listAgents()).toHaveLength(1);
    });
  });

  describe("更新配置", () => {
    it("should update agent config", () => {
      manager.updateAgent("chat", { enabled: false });
      expect(manager.getAgent("chat")?.enabled).toBe(false);
    });

    it("should throw when updating non-existent agent", () => {
      expect(() => manager.updateAgent("nonexistent" as AgentRole, {})).toThrow(
        "Agent role 'nonexistent' not found"
      );
    });
  });

  describe("启用与禁用", () => {
    it("should disable and enable agent", () => {
      manager.disableAgent("chat");
      expect(manager.getAgent("chat")?.enabled).toBe(false);

      manager.enableAgent("chat");
      expect(manager.getAgent("chat")?.enabled).toBe(true);
    });

    it("should return empty tools for disabled agent", () => {
      manager.disableAgent("chat");
      expect(manager.getAllowedTools("chat")).toEqual([]);
    });
  });

  describe("getAllowedTools", () => {
    it("should return all tools for enabled knowledge agent", () => {
      const tools = manager.getAllowedTools("knowledge");
      expect(tools).toEqual(KNOWLEDGE_BRAIN_TOOLS);
    });

    it("should return empty array for unknown role", () => {
      expect(manager.getAllowedTools("unknown" as AgentRole)).toEqual([]);
    });
  });

  describe("resetToDefaults", () => {
    it("should reset to default configs", () => {
      manager.disableAgent("chat");
      manager.unregisterAgent("knowledge");
      manager.resetToDefaults();

      expect(manager.listAgents()).toHaveLength(2);
      expect(manager.getAgent("chat")?.enabled).toBe(true);
      expect(manager.getAgent("knowledge")).toBeDefined();
    });
  });

  describe("MCP 配置生成", () => {
    it("createMCPConfigForAgent should return read-only for chat", () => {
      const config = createMCPConfigForAgent("chat", manager);
      expect(config.enableReadOnlyTools).toBe(true);
      expect(config.enableReadWriteTools).toBe(false);
    });

    it("createMCPConfigForAgent should return read-write for knowledge", () => {
      const config = createMCPConfigForAgent("knowledge", manager);
      expect(config.enableReadOnlyTools).toBe(true);
      expect(config.enableReadWriteTools).toBe(true);
    });

    it("createMCPConfigForAgent should return false for disabled agent", () => {
      manager.disableAgent("chat");
      const config = createMCPConfigForAgent("chat", manager);
      expect(config.enableReadOnlyTools).toBe(false);
      expect(config.enableReadWriteTools).toBe(false);
    });

    it("createMCPConfigForAgent should return false for unknown role", () => {
      const config = createMCPConfigForAgent("unknown" as AgentRole, manager);
      expect(config.enableReadOnlyTools).toBe(false);
      expect(config.enableReadWriteTools).toBe(false);
    });
  });

  describe("全局单例", () => {
    it("getAgentConfigManager should return singleton", () => {
      resetAgentConfigManager();
      const m1 = getAgentConfigManager();
      const m2 = getAgentConfigManager();
      expect(m1).toBe(m2);
      expect(m1.listAgents()).toHaveLength(2);
    });

    it("resetAgentConfigManager should clear singleton", () => {
      resetAgentConfigManager();
      const m1 = getAgentConfigManager();
      resetAgentConfigManager();
      const m2 = getAgentConfigManager();
      expect(m1).not.toBe(m2);
    });
  });

  describe("常量", () => {
    it("CHAT_BRAIN_TOOLS should have exactly 4 read-only tools", () => {
      expect(CHAT_BRAIN_TOOLS).toHaveLength(4);
      expect(CHAT_BRAIN_TOOLS).toContain("zk_search_notes");
      expect(CHAT_BRAIN_TOOLS).toContain("zk_get_note");
      expect(CHAT_BRAIN_TOOLS).toContain("zk_get_backlinks");
      expect(CHAT_BRAIN_TOOLS).toContain("zk_find_path");
    });

    it("KNOWLEDGE_BRAIN_TOOLS should include all chat tools plus write tools", () => {
      expect(KNOWLEDGE_BRAIN_TOOLS).toHaveLength(10);
      for (const tool of CHAT_BRAIN_TOOLS) {
        expect(KNOWLEDGE_BRAIN_TOOLS).toContain(tool);
      }
      expect(KNOWLEDGE_BRAIN_TOOLS).toContain("zk_create_note");
      expect(KNOWLEDGE_BRAIN_TOOLS).toContain("zk_update_note");
      expect(KNOWLEDGE_BRAIN_TOOLS).toContain("zk_create_link");
      expect(KNOWLEDGE_BRAIN_TOOLS).toContain("zk_run_ceqrc_workflow");
      expect(KNOWLEDGE_BRAIN_TOOLS).toContain("zk_distill_memory");
      expect(KNOWLEDGE_BRAIN_TOOLS).toContain("zk_review_note");
    });
  });
});
