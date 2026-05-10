export type NoteType = "atomic" | "structure" | "source";

export type NoteStatus = "FLEETING" | "LITERATURE" | "PERMANENT";

export type NoteFolder = "inbox" | "references" | "zettels" | "archive";

export type SourceType = "manual" | "distilled" | "ceqrc";

export type LinkType =
  | "supports"
  | "supported_by"
  | "refines"
  | "refined_by"
  | "extends"
  | "extended_by"
  | "contradicts"
  | "contradicted_by"
  | "is_example_of"
  | "has_example"
  | "related";

export interface ZettelNote {
  /** 唯一ID (YYYYMMDDHHMMSS) */
  id: string;
  /** 标题 */
  title: string;
  /** Markdown内容 */
  content: string;
  /** AI生成的摘要 (最大280字符) */
  summary?: string;
  /** 卡片类型 */
  type: NoteType;
  /** 生命周期状态 */
  status: NoteStatus;
  /** 存储文件夹 (inbox/references/zettels) */
  folder: NoteFolder;
  /** 置信度评分 (0-1) */
  confidence?: number;
  /** 来源类型 */
  source?: SourceType;
  /** 是否已人工审核 */
  reviewed: boolean;
  /** 标签数组 */
  tags: string[];
  /** 关联的OpenClaw会话键 */
  sessionKey?: string;
  /** Markdown文件路径 */
  filePath: string;
  /** 创建时间 (ISO 8601) */
  createdAt: string;
  /** 最后更新时间 (ISO 8601) */
  updatedAt: string;
  /** 正向链接 (我指向的卡片) */
  links: Link[];
}

export interface Link {
  /** 目标卡片ID */
  to: string;
  /** 链接类型 */
  type: LinkType;
  /** 链接上下文描述 (为什么建立链接) */
  context?: string;
  /** 创建时间 (ISO 8601) */
  createdAt: string;
}

export interface Tag {
  /** 标签名称 */
  name: string;
  /** 标签描述 */
  description?: string;
  /** 创建时间 (ISO 8601) */
  createdAt: string;
}

export interface CreateNoteParams {
  /** 标题 */
  title: string;
  /** Markdown内容 */
  content: string;
  /** 卡片类型 (默认为 atomic) */
  type?: NoteType;
  /** 存储文件夹 (默认为 inbox) */
  folder?: NoteFolder;
  /** 置信度评分 (0-1) */
  confidence?: number;
  /** 来源类型 */
  source?: SourceType;
  /** 标签数组 */
  tags?: string[];
  /** 链接数组 */
  links?: {
    to: string;
    type: LinkType;
    context?: string;
  }[];
  /** 关联的OpenClaw会话键 */
  sessionKey?: string;
  /** 是否自动生成摘要 */
  generateSummary?: boolean;
}

export interface UpdateNoteParams {
  /** 标题 */
  title?: string;
  /** Markdown内容 */
  content?: string;
  /** 存储文件夹 */
  folder?: NoteFolder;
  /** 置信度评分 (0-1) */
  confidence?: number;
  /** 来源类型 */
  source?: SourceType;
  /** 是否已审核 */
  reviewed?: boolean;
  /** 保留原 updated_at（用于归档/恢复等元数据操作） */
  preserveUpdatedAt?: boolean;
  /** 标签数组 */
  tags?: string[];
  /** 链接数组 */
  links?: {
    to: string;
    type: LinkType;
    context?: string;
  }[];
  /** 生命周期状态 */
  status?: NoteStatus;
  /** 是否自动生成摘要 (当内容变更时) */
  generateSummary?: boolean;
}

export interface QueryNotesParams {
  /** 按类型过滤 */
  type?: NoteType;
  /** 按状态过滤 */
  status?: NoteStatus;
  /** 按标签过滤 */
  tags?: string[];
  /** 按链接到特定卡片过滤 */
  linkedTo?: string;
  /** 按被特定卡片链接过滤 */
  linkedFrom?: string;
  /** 按会话键过滤 */
  sessionKey?: string;
  /** 全文搜索关键词 */
  search?: string;
  /** 置信度最小值 */
  minConfidence?: number;
  /** 置信度最大值 */
  maxConfidence?: number;
  /** 创建时间范围 - 开始 */
  createdAfter?: string;
  /** 创建时间范围 - 结束 */
  createdBefore?: string;
  /** 排序字段 */
  sortBy?: "createdAt" | "updatedAt" | "title" | "confidence";
  /** 排序方向 */
  sortDirection?: "asc" | "desc";
  /** 分页 - 偏移量 */
  offset?: number;
  /** 分页 - 每页数量 */
  limit?: number;
}

export interface SearchResult {
  /** 卡片 */
  note: ZettelNote;
  /** 搜索得分 (0-1) */
  score: number;
  /** 匹配的片段 */
  snippet?: string;
}

export interface GraphPath {
  /** 路径中的卡片ID序列 */
  path: string[];
  /** 路径长度 */
  length: number;
  /** 路径强度 (基于链接权重) */
  strength: number;
  /** 路径解释 */
  explanation?: string;
}

export interface TopicCluster {
  /** 集群ID */
  id: string;
  /** 集群名称 */
  name: string;
  /** 中心卡片ID */
  centroid: string[];
  /** 成员卡片ID */
  members: string[];
  /** 内部链接密度 */
  density: number;
  /** 形成时间 */
  formedAt: string;
}

export interface ZettelkastenStats {
  /** 卡片总数 */
  totalNotes: number;
  /** 按类型统计 */
  byType: Record<NoteType, number>;
  /** 按状态统计 */
  byStatus: Record<NoteStatus, number>;
  /** 链接总数 */
  totalLinks: number;
  /** 标签总数 */
  totalTags: number;
  /** 最早卡片创建时间 */
  oldestNoteAt: string;
  /** 最新卡片创建时间 */
  newestNoteAt: string;
}

// ============================================================================
// Phase 3: 认知流水线类型定义
// ============================================================================

/** CEQRC 阶段枚举 */
export type CEQRCPhase = "capture" | "explain" | "question" | "refine" | "connect";

/** CEQRC 工作流状态 */
export type CEQRCStatus = "pending" | "processing" | "completed" | "failed";

/** 蒸馏决策类型 */
export type DistillDecision = "CREATE" | "MERGE" | "SKIP";

/** Memory 日志条目类型 */
export type MemoryLogEntryType = "user" | "assistant" | "system" | "tool";

/** OpenClaw Memory 日志条目 */
export interface MemoryLogEntry {
  /** 条目唯一ID */
  id: string;
  /** 条目类型 */
  type: MemoryLogEntryType;
  /** 内容 */
  content: string;
  /** 时间戳 */
  timestamp: string;
  /** 关联的会话ID */
  sessionId?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/** 对话切片 */
export interface ConversationSlice {
  /** 切片ID */
  id: string;
  /** 原始条目ID列表 */
  entryIds: string[];
  /** 切片内容（拼接后的文本） */
  content: string;
  /** 切片主题/标题 */
  topic?: string;
  /** 时间范围 */
  timeRange: {
    start: string;
    end: string;
  };
  /** 预估的token数量 */
  tokenCount?: number;
}

/** 蒸馏摘要结果 */
export interface DistillSummary {
  /** 摘要ID */
  id: string;
  /** 源切片ID */
  sliceId: string;
  /** 原子笔记标题 */
  title: string;
  /** 原子笔记内容 */
  content: string;
  /** AI摘要 */
  summary?: string;
  /** 置信度评分 (0-1) */
  confidence: number;
  /** 建议标签 */
  suggestedTags: string[];
  /** 建议链接的笔记ID */
  suggestedLinks: string[];
  /** 生成时间 */
  generatedAt: string;
}

/** LLM去重决策 */
export interface LLMDedupeDecision {
  /** 决策ID */
  id: string;
  /** 候选摘要ID */
  candidateId: string;
  /** 匹配到的现有笔记ID（如果有） */
  matchedNoteId?: string;
  /** 决策类型 */
  decision: DistillDecision;
  /** 决策理由 */
  reason: string;
  /** 相似度分数 */
  similarityScore: number;
  /** 决策时间 */
  decidedAt: string;
}

/** 两阶段去重候选 */
export interface DedupeCandidate {
  /** 候选摘要 */
  summary: DistillSummary;
  /** 阶段1：向量相似度匹配的候选笔记 */
  vectorMatches: Array<{
    noteId: string;
    similarity: number;
  }>;
  /** 阶段2：LLM语义判断结果 */
  llmDecision?: LLMDedupeDecision;
}

/** 蒸馏作业 */
export interface DistillJob {
  /** 作业ID */
  id: string;
  /** 处理日期 */
  date: string;
  /** 状态 */
  status: "pending" | "processing" | "completed" | "failed";
  /** 源memory文件路径 */
  memoryFilePath?: string;
  /** 解析的切片数量 */
  sliceCount: number;
  /** 生成的摘要数量 */
  summaryCount: number;
  /** 去重决策列表 */
  decisions: LLMDedupeDecision[];
  /** 创建的笔记数量 */
  createdCount: number;
  /** 合并的笔记数量 */
  mergedCount: number;
  /** 跳过的数量 */
  skippedCount: number;
  /** 错误信息 */
  error?: string;
  /** 开始时间 */
  startedAt?: string;
  /** 完成时间 */
  completedAt?: string;
}

/** CEQRC 工作流实例 */
export interface CEQRCWorkflow {
  /** 工作流ID */
  id: string;
  /** 源笔记ID */
  sourceNoteId: string;
  /** 当前阶段 */
  currentPhase: CEQRCPhase;
  /** 阶段状态 */
  phaseStatus: Record<CEQRCPhase, CEQRCStatus>;
  /** 阶段输出 */
  phaseOutputs: Partial<Record<CEQRCPhase, unknown>>;
  /** 生成的最终笔记ID */
  resultNoteId?: string;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

/** Capture 阶段输出 */
export interface CaptureOutput {
  /** 核心概念 */
  coreConcept: string;
  /** 关键术语 */
  keyTerms: string[];
  /** 上下文 */
  context: string;
}

/** Explain 阶段输出 */
export interface ExplainOutput {
  /** 用自己的话解释 */
  ownWordsExplanation: string;
  /** 类比 */
  analogy?: string;
  /** 简化版本 */
  simplifiedVersion: string;
}

/** Question 阶段输出 */
export interface QuestionOutput {
  /** 澄清性问题 */
  clarificationQuestions: string[];
  /** 边界问题 */
  boundaryQuestions: string[];
  /** 应用问题 */
  applicationQuestions: string[];
}

/** Refine 阶段输出 */
export interface RefineOutput {
  /** 精炼后的标题 */
  refinedTitle: string;
  /** 精炼后的内容 */
  refinedContent: string;
  /** 原子性评分 */
  atomicityScore: number;
}

/** Connect 阶段输出 */
export interface ConnectOutput {
  /** 建议的链接 */
  suggestedLinks: Array<{
    targetNoteId: string;
    linkType: LinkType;
    context: string;
    relevanceScore: number;
  }>;
  /** 上游概念 */
  upstreamConcepts: string[];
  /** 下游应用 */
  downstreamApplications: string[];
}

/** 向量嵌入结果 */
export interface VectorEmbedding {
  /** 笔记ID */
  noteId: string;
  /** 嵌入向量 */
  embedding: number[];
  /** 模型名称 */
  model: string;
  /** 创建时间 */
  createdAt: string;
}

/** 去重服务配置 */
export interface DedupeServiceConfig {
  /** 向量相似度阈值 (默认0.85) */
  vectorSimilarityThreshold: number;
  /** 最大候选数量 */
  maxCandidates: number;
  /** 使用的嵌入模型 */
  embeddingModel: string;
}

/** 蒸馏服务配置 */
export interface DistillerServiceConfig {
  /** 高置信度阈值 */
  highConfidenceThreshold: number;
  /** 中置信度阈值 */
  mediumConfidenceThreshold: number;
  /** 批处理大小 */
  batchSize: number;
  /** 最大切片token数 */
  maxSliceTokens: number;
  /** 是否启用夜间模式 */
  nightModeEnabled: boolean;
}

/** CEQRC 引擎配置 */
export interface CEQRCConfig {
  /** 是否自动执行下一阶段 */
  autoAdvance: boolean;
  /** 阶段超时时间(毫秒) */
  phaseTimeoutMs: number;
  /** 最小置信度要求 */
  minConfidenceThreshold: number;
}

/** Memory 解析器配置 */
export interface MemoryParserConfig {
  /** 时间窗口(分钟) - 多长时间内的消息视为一个切片 */
  timeWindowMinutes: number;
  /** 最小消息数 */
  minMessages: number;
  /** 最大消息数 */
  maxMessages: number;
  /** 最大切片长度(字符) */
  maxSliceLength: number;
}

/** 蒸馏日志条目 */
export interface DistillLogEntry {
  /** 日志ID */
  id: string;
  /** 作业ID */
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

/** LLM 提供者接口 */
export interface LLMProvider {
  /** 生成摘要 */
  generateSummary(content: string, context?: string): Promise<DistillSummary>;
  /** 判断是否为重复内容 */
  judgeDuplicate(candidate: string, existing: string): Promise<{ isDuplicate: boolean; reason: string }>;
  /** 生成嵌入向量 */
  generateEmbedding(text: string): Promise<number[]>;
  /** CEQRC 阶段处理 */
  processCEQRCPhase(phase: CEQRCPhase, input: unknown): Promise<unknown>;
}
// ============================================================================
// Phase 4: 神经中枢集成类型定义
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

/** Cron 调度配置 */
export interface CronScheduleConfig {
  /** Cron 表达式 */
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

/** Zettelkasten 集成配置 */
export interface ZettelkastenIntegrationConfig {
  /** 基础路径 */
  basePath: string;
  /** 数据库实例 */
  db: import("node:sqlite").DatabaseSync;
  /** LLM 提供者 */
  llmProvider: LLMProvider;
  /** Cron 调度配置 */
  cronConfig?: Partial<CronScheduleConfig>;
  /** Session Hook 配置 */
  sessionHookConfig?: Partial<SessionHookConfig>;
  /** 是否自动启动 Cron 调度器 */
  autoStartCron: boolean;
  /** 是否启用 Session Hook */
  enableSessionHook: boolean;
  /** 调试模式 */
  debug: boolean;
}
