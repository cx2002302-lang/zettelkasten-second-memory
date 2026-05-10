/**
 * CEQRCEngine - CEQRC 工作流引擎
 *
 * CEQRC = Capture → Explain → Question → Refine → Connect
 * 五个阶段的状态机实现
 *
 * 职责：
 * 1. 管理五阶段工作流状态
 * 2. 执行每个阶段的处理
 * 3. 协调阶段间的数据流转
 */

import type {
  CEQRCPhase,
  CEQRCStatus,
  CEQRCWorkflow,
  CEQRCConfig,
  LLMProvider,
  ZettelNote,
  CaptureOutput,
  ExplainOutput,
  QuestionOutput,
  RefineOutput,
  ConnectOutput,
} from "../core/types.js";
import { generateZettelId, toISOString } from "../core/utils.js";

/** 默认配置 */
const DEFAULT_CONFIG: CEQRCConfig = {
  autoAdvance: true,
  phaseTimeoutMs: 30000,
  minConfidenceThreshold: 0.7,
};

/** 阶段顺序 */
const PHASE_ORDER: CEQRCPhase[] = ["capture", "explain", "question", "refine", "connect"];

/** 阶段提示词模板 */
const PHASE_PROMPTS: Record<CEQRCPhase, string> = {
  capture: `You are in the CAPTURE phase of the CEQRC workflow.
Analyze the following content and extract:
1. Core concept (the main idea)
2. Key terms (important terminology)
3. Context (where this knowledge comes from)

Content:
{content}

Respond in JSON format:
{
  "coreConcept": "string",
  "keyTerms": ["string"],
  "context": "string"
}`,

  explain: `You are in the EXPLAIN phase of the CEQRC workflow.
Take the captured concept and explain it in your own words.
1. Provide your own explanation
2. Create an analogy if helpful
3. Give a simplified version

Core Concept: {coreConcept}
Context: {context}

Respond in JSON format:
{
  "ownWordsExplanation": "string",
  "analogy": "string (optional)",
  "simplifiedVersion": "string"
}`,

  question: `You are in the QUESTION phase of the CEQRC workflow.
Generate questions to deepen understanding:
1. Clarification questions (what does X mean?)
2. Boundary questions (when does this not apply?)
3. Application questions (how can I use this?)

Concept: {coreConcept}
Explanation: {explanation}

Respond in JSON format:
{
  "clarificationQuestions": ["string"],
  "boundaryQuestions": ["string"],
  "applicationQuestions": ["string"]
}`,

  refine: `You are in the REFINE phase of the CEQRC workflow.
Create an atomic note (one idea per note):
1. Write a clear, concise title
2. Write the content (your own words, one idea only)
3. Rate the atomicity (0-1 score)

Core Concept: {coreConcept}
Explanation: {explanation}
Questions: {questions}

Respond in JSON format:
{
  "refinedTitle": "string",
  "refinedContent": "string (markdown)",
  "atomicityScore": number
}`,

  connect: `You are in the CONNECT phase of the CEQRC workflow.
Find connections to existing knowledge:
1. Suggest links to related notes
2. Identify upstream concepts (what does this build on?)
3. Identify downstream applications (what does this enable?)

Note Title: {title}
Note Content: {content}
Existing Notes: {existingNotes}

Respond in JSON format:
{
  "suggestedLinks": [
    {
      "targetNoteId": "string",
      "linkType": "supports|extends|refines|contradicts|is_example_of|related",
      "context": "string",
      "relevanceScore": number
    }
  ],
  "upstreamConcepts": ["string"],
  "downstreamApplications": ["string"]
}`,
};

export class CEQRCEngine {
  private config: CEQRCConfig;
  private llmProvider: LLMProvider;
  private workflows: Map<string, CEQRCWorkflow> = new Map();

  constructor(llmProvider: LLMProvider, config: Partial<CEQRCConfig> = {}) {
    this.llmProvider = llmProvider;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 创建新的 CEQRC 工作流
   * @param sourceNoteId 源笔记ID
   * @returns 工作流实例
   */
  createWorkflow(sourceNoteId: string): CEQRCWorkflow {
    const now = toISOString();
    const workflow: CEQRCWorkflow = {
      id: generateZettelId(),
      sourceNoteId,
      currentPhase: "capture",
      phaseStatus: {
        capture: "pending",
        explain: "pending",
        question: "pending",
        refine: "pending",
        connect: "pending",
      },
      phaseOutputs: {},
      createdAt: now,
      updatedAt: now,
    };

    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  /**
   * 获取工作流
   * @param workflowId 工作流ID
   * @returns 工作流实例或 null
   */
  getWorkflow(workflowId: string): CEQRCWorkflow | null {
    return this.workflows.get(workflowId) || null;
  }

  /**
   * 执行工作流到完成
   * @param workflowId 工作流ID
   * @param sourceContent 源内容
   * @param existingNotes 现有笔记列表（用于 connect 阶段）
   * @returns 完成的工作流
   */
  async runWorkflow(
    workflowId: string,
    sourceContent: string,
    existingNotes: ZettelNote[]
  ): Promise<CEQRCWorkflow> {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    // 依次执行每个阶段
    for (const phase of PHASE_ORDER) {
      await this.executePhase(workflowId, phase, sourceContent, existingNotes);

      // 检查阶段是否成功完成
      const updatedWorkflow = this.getWorkflow(workflowId)!;
      if (updatedWorkflow.phaseStatus[phase] === "failed") {
        throw new Error(`Phase ${phase} failed`);
      }
    }

    return this.getWorkflow(workflowId)!;
  }

  /**
   * 执行单个阶段
   * @param workflowId 工作流ID
   * @param phase 阶段名称
   * @param sourceContent 源内容
   * @param existingNotes 现有笔记列表
   */
  async executePhase(
    workflowId: string,
    phase: CEQRCPhase,
    sourceContent: string,
    existingNotes: ZettelNote[]
  ): Promise<void> {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    // 更新阶段状态为处理中
    workflow.phaseStatus[phase] = "processing";
    workflow.currentPhase = phase;

    try {
      const output = await this.processPhase(phase, workflow, sourceContent, existingNotes);
      workflow.phaseOutputs[phase] = output;
      workflow.phaseStatus[phase] = "completed";
    } catch (error) {
      workflow.phaseStatus[phase] = "failed";
      throw error;
    } finally {
      workflow.updatedAt = toISOString();
    }
  }

  /**
   * 处理具体阶段
   */
  private async processPhase(
    phase: CEQRCPhase,
    workflow: CEQRCWorkflow,
    sourceContent: string,
    existingNotes: ZettelNote[]
  ): Promise<unknown> {
    const prompt = this.buildPhasePrompt(phase, workflow, sourceContent, existingNotes);
    return await this.llmProvider.processCEQRCPhase(phase, prompt);
  }

  /**
   * 构建阶段提示词
   */
  private buildPhasePrompt(
    phase: CEQRCPhase,
    workflow: CEQRCWorkflow,
    sourceContent: string,
    existingNotes: ZettelNote[]
  ): string {
    let prompt = PHASE_PROMPTS[phase];

    // 根据阶段替换不同的变量
    switch (phase) {
      case "capture":
        prompt = prompt.replace("{content}", sourceContent);
        break;

      case "explain": {
        const captureOutput = workflow.phaseOutputs.capture as CaptureOutput | undefined;
        if (captureOutput) {
          prompt = prompt
            .replace("{coreConcept}", captureOutput.coreConcept)
            .replace("{context}", captureOutput.context);
        }
        break;
      }

      case "question": {
        const captureOutput = workflow.phaseOutputs.capture as CaptureOutput | undefined;
        const explainOutput = workflow.phaseOutputs.explain as ExplainOutput | undefined;
        if (captureOutput && explainOutput) {
          prompt = prompt
            .replace("{coreConcept}", captureOutput.coreConcept)
            .replace("{explanation}", explainOutput.ownWordsExplanation);
        }
        break;
      }

      case "refine": {
        const captureOutput = workflow.phaseOutputs.capture as CaptureOutput | undefined;
        const explainOutput = workflow.phaseOutputs.explain as ExplainOutput | undefined;
        const questionOutput = workflow.phaseOutputs.question as QuestionOutput | undefined;
        if (captureOutput && explainOutput) {
          prompt = prompt
            .replace("{coreConcept}", captureOutput.coreConcept)
            .replace("{explanation}", explainOutput.ownWordsExplanation)
            .replace("{questions}", JSON.stringify(questionOutput || {}));
        }
        break;
      }

      case "connect": {
        const refineOutput = workflow.phaseOutputs.refine as RefineOutput | undefined;
        if (refineOutput) {
          const notesSummary = existingNotes
            .map((n) => `- ${n.id}: ${n.title}`)
            .join("\n");
          prompt = prompt
            .replace("{title}", refineOutput.refinedTitle)
            .replace("{content}", refineOutput.refinedContent)
            .replace("{existingNotes}", notesSummary);
        }
        break;
      }
    }

    return prompt;
  }

  /**
   * 获取工作流结果
   * @param workflowId 工作流ID
   * @returns 精炼后的笔记内容
   */
  getWorkflowResult(workflowId: string): {
    title: string;
    content: string;
    links: ConnectOutput["suggestedLinks"];
    atomicityScore: number;
  } | null {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow || workflow.phaseStatus.connect !== "completed") {
      return null;
    }

    const refineOutput = workflow.phaseOutputs.refine as RefineOutput | undefined;
    const connectOutput = workflow.phaseOutputs.connect as ConnectOutput | undefined;

    if (!refineOutput) {
      return null;
    }

    return {
      title: refineOutput.refinedTitle,
      content: refineOutput.refinedContent,
      links: connectOutput?.suggestedLinks || [],
      atomicityScore: refineOutput.atomicityScore,
    };
  }

  /**
   * 获取所有工作流
   */
  getAllWorkflows(): CEQRCWorkflow[] {
    return Array.from(this.workflows.values());
  }

  /**
   * 删除工作流
   */
  deleteWorkflow(workflowId: string): boolean {
    return this.workflows.delete(workflowId);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CEQRCConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): CEQRCConfig {
    return { ...this.config };
  }
}