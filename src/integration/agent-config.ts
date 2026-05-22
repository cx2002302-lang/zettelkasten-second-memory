/**
 * OpenClaw Agent 配置系统 - 双 Agent 权限架构
 *
 * 职责：
 * 1. 定义双 Agent 角色（前台主脑 / 后台子脑）
 * 2. 配置权限矩阵
 * 3. 分配 MCP 工具集
 *
 * 架构：
 * - 前台主脑 (Chat Brain): 只读权限，4 个工具
 * - 后台子脑 (Knowledge Brain): 读写权限，6 个工具
 */

// ============================================================================
// Agent 类型定义
// ============================================================================

/** Agent 角色类型 */
export type AgentRole = "chat" | "knowledge";

/** Agent 权限级别 */
export type AgentPermission = "read-only" | "read-write";

/** MCP 工具名称 */
export type MCPToolName =
  // 只读工具（前台主脑）
  | "zk_search_notes"
  | "zk_get_note"
  | "zk_get_backlinks"
  | "zk_find_path"
  // 读写工具（后台子脑）
  | "zk_create_note"
  | "zk_update_note"
  | "zk_create_link"
  | "zk_run_ceqrc_workflow"
  | "zk_distill_memory"
  | "zk_review_note";

// ============================================================================
// Agent 配置接口
// ============================================================================

/** Agent 配置 */
export interface AgentConfig {
  /** Agent 唯一标识 */
  id: string;
  /** Agent 角色 */
  role: AgentRole;
  /** 权限级别 */
  permission: AgentPermission;
  /** 分配的 MCP 工具列表 */
  tools: MCPToolName[];
  /** 是否启用 */
  enabled: boolean;
  /** 配置元数据 */
  metadata?: {
    /** 显示名称 */
    displayName?: string;
    /** 描述 */
    description?: string;
    /** 创建时间 */
    createdAt?: string;
  };
}

/** Agent 配置注册表 */
export interface AgentConfigRegistry {
  /** 获取指定角色的 Agent 配置 */
  getAgent(role: AgentRole): AgentConfig | undefined;
  /** 注册 Agent 配置 */
  registerAgent(config: AgentConfig): void;
  /** 注销 Agent 配置 */
  unregisterAgent(role: AgentRole): void;
  /** 列出所有 Agent */
  listAgents(): AgentConfig[];
  /** 检查工具是否被允许 */
  isToolAllowed(role: AgentRole, tool: MCPToolName): boolean;
}

// ============================================================================
// 权限矩阵
// ============================================================================

/** 前台主脑 - 只读工具集 */
export const CHAT_BRAIN_TOOLS: MCPToolName[] = [
  "zk_search_notes",
  "zk_get_note",
  "zk_get_backlinks",
  "zk_find_path",
];

/** 后台子脑 - 完整工具集（继承只读工具） */
export const KNOWLEDGE_BRAIN_TOOLS: MCPToolName[] = [
  ...CHAT_BRAIN_TOOLS,
  "zk_create_note",
  "zk_update_note",
  "zk_create_link",
  "zk_run_ceqrc_workflow",
  "zk_distill_memory",
  "zk_review_note",
];

/** 工具权限矩阵 */
export const TOOL_PERMISSION_MATRIX: Record<AgentRole, MCPToolName[]> = {
  chat: CHAT_BRAIN_TOOLS,
  knowledge: KNOWLEDGE_BRAIN_TOOLS,
};

/** 默认 Agent 配置 */
export const DEFAULT_AGENT_CONFIGS: Record<AgentRole, AgentConfig> = {
  chat: {
    id: "agent:chat:brain",
    role: "chat",
    permission: "read-only",
    tools: CHAT_BRAIN_TOOLS,
    enabled: true,
    metadata: {
      displayName: "前台聊天主脑",
      description: "轻量级对话 Agent，只读搜索权限，用于回答用户关于知识库的问题",
      createdAt: new Date().toISOString(),
    },
  },
  knowledge: {
    id: "agent:knowledge:brain",
    role: "knowledge",
    permission: "read-write",
    tools: KNOWLEDGE_BRAIN_TOOLS,
    enabled: true,
    metadata: {
      displayName: "后台知识管理子脑",
      description: "知识管理 Agent，完整读写权限，执行 CEQRC 流程和夜间蒸馏",
      createdAt: new Date().toISOString(),
    },
  },
};

// ============================================================================
// Agent 配置管理器
// ============================================================================

export class AgentConfigManager implements AgentConfigRegistry {
  private configs: Map<AgentRole, AgentConfig> = new Map();

  constructor() {
    // 初始化默认配置
    this.registerAgent(DEFAULT_AGENT_CONFIGS.chat);
    this.registerAgent(DEFAULT_AGENT_CONFIGS.knowledge);
  }

  /** 获取指定角色的 Agent 配置 */
  getAgent(role: AgentRole): AgentConfig | undefined {
    return this.configs.get(role);
  }

  /** 注册 Agent 配置 */
  registerAgent(config: AgentConfig): void {
    this.configs.set(config.role, config);
  }

  /** 注销 Agent 配置 */
  unregisterAgent(role: AgentRole): void {
    this.configs.delete(role);
  }

  /** 列出所有 Agent */
  listAgents(): AgentConfig[] {
    return Array.from(this.configs.values());
  }

  /** 检查工具是否被允许 */
  isToolAllowed(role: AgentRole, tool: MCPToolName): boolean {
    const config = this.configs.get(role);
    if (!config || !config.enabled) {
      return false;
    }
    return config.tools.includes(tool);
  }

  /** 更新 Agent 配置 */
  updateAgent(role: AgentRole, updates: Partial<Omit<AgentConfig, "role">>): void {
    const existing = this.configs.get(role);
    if (!existing) {
      throw new Error(`Agent role '${role}' not found`);
    }
    this.configs.set(role, { ...existing, ...updates });
  }

  /** 启用 Agent */
  enableAgent(role: AgentRole): void {
    this.updateAgent(role, { enabled: true });
  }

  /** 禁用 Agent */
  disableAgent(role: AgentRole): void {
    this.updateAgent(role, { enabled: false });
  }

  /** 获取 Agent 的工具权限列表 */
  getAllowedTools(role: AgentRole): MCPToolName[] {
    const config = this.configs.get(role);
    if (!config || !config.enabled) {
      return [];
    }
    return config.tools;
  }

  /** 重置为默认配置 */
  resetToDefaults(): void {
    this.configs.clear();
    this.registerAgent(DEFAULT_AGENT_CONFIGS.chat);
    this.registerAgent(DEFAULT_AGENT_CONFIGS.knowledge);
  }
}

// ============================================================================
// MCP 服务器配置适配器
// ============================================================================

/**
 * 根据 Agent 角色生成 MCP 服务器配置
 */
export function createMCPConfigForAgent(
  role: AgentRole,
  manager: AgentConfigManager
): {
  enableReadOnlyTools: boolean;
  enableReadWriteTools: boolean;
} {
  const config = manager.getAgent(role);
  if (!config || !config.enabled) {
    return { enableReadOnlyTools: false, enableReadWriteTools: false };
  }

  const hasReadOnly = config.tools.some((t) => CHAT_BRAIN_TOOLS.includes(t));
  const hasReadWrite = config.tools.some((t) =>
    KNOWLEDGE_BRAIN_TOOLS.filter((kt) => !CHAT_BRAIN_TOOLS.includes(kt)).includes(t)
  );

  return {
    enableReadOnlyTools: hasReadOnly,
    enableReadWriteTools: hasReadWrite,
  };
}

/**
 * 验证 Agent 配置是否有效
 */
export function validateAgentConfig(config: AgentConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.id) {
    errors.push("Agent ID is required");
  }

  if (!config.role) {
    errors.push("Agent role is required");
  }

  if (!["chat", "knowledge"].includes(config.role)) {
    errors.push(`Invalid agent role: ${config.role}`);
  }

  if (!config.tools || config.tools.length === 0) {
    errors.push("Agent must have at least one tool assigned");
  }

  // 验证工具权限一致性
  if (config.role === "chat") {
    const invalidTools = config.tools.filter(
      (t) => !CHAT_BRAIN_TOOLS.includes(t)
    );
    if (invalidTools.length > 0) {
      errors.push(`Chat agent cannot have tools: ${invalidTools.join(", ")}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// 全局单例
// ============================================================================

let globalAgentConfigManager: AgentConfigManager | null = null;

/**
 * 获取全局 Agent 配置管理器
 */
export function getAgentConfigManager(): AgentConfigManager {
  if (!globalAgentConfigManager) {
    globalAgentConfigManager = new AgentConfigManager();
  }
  return globalAgentConfigManager;
}

/**
 * 重置全局 Agent 配置管理器
 */
export function resetAgentConfigManager(): void {
  globalAgentConfigManager = null;
}
