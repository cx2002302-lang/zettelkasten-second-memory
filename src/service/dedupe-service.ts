/**
 * DedupeService - 两阶段去重服务
 *
 * 职责：
 * 1. 阶段1: 向量相似度筛选 (阈值 0.85)
 * 2. 阶段2: LLM 语义判断 (判断是否为同一概念)
 * 3. 生成去重决策 (CREATE/MERGE/SKIP)
 */

import type {
  DistillSummary,
  ZettelNote,
  DedupeCandidate,
  LLMDedupeDecision,
  DedupeServiceConfig,
  LLMProvider,
  DistillDecision,
} from "../core/types.js";
import { generateZettelId, toISOString } from "../core/utils.js";
import { DEFAULT_SIMILARITY_THRESHOLD } from "../core/constants.js";

/** 默认配置 */
const DEFAULT_CONFIG: DedupeServiceConfig = {
  vectorSimilarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
  maxCandidates: 5,
  embeddingModel: "text-embedding-3-small",
};

/** 向量存储（简化版，实际应使用向量数据库） */
interface VectorStore {
  [noteId: string]: number[];
}

export class DedupeService {
  private config: DedupeServiceConfig;
  private llmProvider: LLMProvider;
  private vectorStore: VectorStore = {};
  private existingNotes: Map<string, ZettelNote> = new Map();

  constructor(
    llmProvider: LLMProvider,
    config: Partial<DedupeServiceConfig> = {}
  ) {
    this.llmProvider = llmProvider;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 两阶段去重流水线
   * @param summaries 待去重的摘要列表
   * @param existingNotes 现有笔记列表
   * @returns 去重候选列表（含决策）
   */
  async deduplicate(
    summaries: DistillSummary[],
    existingNotes: ZettelNote[]
  ): Promise<DedupeCandidate[]> {
    // 加载现有笔记
    this.loadExistingNotes(existingNotes);

    // 阶段1: 向量相似度筛选
    const stage1Candidates = await this.stage1VectorFilter(summaries);

    // 阶段2: LLM 语义判断
    const stage2Candidates = await this.stage2LLMJudge(stage1Candidates);

    return stage2Candidates;
  }

  /**
   * 阶段1: 向量相似度筛选
   * 使用余弦相似度快速筛选潜在重复项
   */
  private async stage1VectorFilter(
    summaries: DistillSummary[]
  ): Promise<DedupeCandidate[]> {
    const candidates: DedupeCandidate[] = [];

    for (const summary of summaries) {
      // 生成摘要的嵌入向量
      const embedding = await this.llmProvider.generateEmbedding(
        `${summary.title}\n${summary.content}`
      );

      // 查找相似向量
      const matches = this.findSimilarVectors(
        embedding,
        this.config.vectorSimilarityThreshold
      );

      // 只保留前 N 个候选
      const topMatches = matches
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, this.config.maxCandidates);

      candidates.push({
        summary,
        vectorMatches: topMatches,
      });
    }

    return candidates;
  }

  /**
   * 阶段2: LLM 语义判断
   * 对阶段1筛选出的候选进行语义级判断
   */
  private async stage2LLMJudge(
    candidates: DedupeCandidate[]
  ): Promise<DedupeCandidate[]> {
    const judgedCandidates: DedupeCandidate[] = [];

    for (const candidate of candidates) {
      // 如果没有向量匹配，直接判定为 CREATE
      if (candidate.vectorMatches.length === 0) {
        judgedCandidates.push({
          ...candidate,
          llmDecision: this.createDecision(
            candidate.summary.id,
            "CREATE",
            0,
            "No similar notes found in vector search"
          ),
        });
        continue;
      }

      // 获取最相似的现有笔记
      const bestMatch = candidate.vectorMatches[0];
      const matchedNote = this.existingNotes.get(bestMatch.noteId);

      if (!matchedNote) {
        judgedCandidates.push({
          ...candidate,
          llmDecision: this.createDecision(
            candidate.summary.id,
            "CREATE",
            0,
            "Matched note not found"
          ),
        });
        continue;
      }

      // LLM 语义判断
      const judgment = await this.llmProvider.judgeDuplicate(
        `Title: ${candidate.summary.title}\nContent: ${candidate.summary.content}`,
        `Title: ${matchedNote.title}\nContent: ${matchedNote.content}`
      );

      const decision: DistillDecision = judgment.isDuplicate ? "MERGE" : "CREATE";

      judgedCandidates.push({
        ...candidate,
        llmDecision: this.createDecision(
          candidate.summary.id,
          decision,
          bestMatch.similarity,
          judgment.reason,
          matchedNote.id
        ),
      });
    }

    return judgedCandidates;
  }

  /**
   * 创建决策对象
   */
  private createDecision(
    candidateId: string,
    decision: DistillDecision,
    similarityScore: number,
    reason: string,
    matchedNoteId?: string
  ): LLMDedupeDecision {
    return {
      id: generateZettelId(),
      candidateId,
      matchedNoteId,
      decision,
      reason,
      similarityScore,
      decidedAt: toISOString(),
    };
  }

  /**
   * 查找相似向量
   * @param query 查询向量
   * @param threshold 相似度阈值
   * @returns 相似度匹配的笔记ID列表
   */
  private findSimilarVectors(
    query: number[],
    threshold: number
  ): Array<{ noteId: string; similarity: number }> {
    const matches: Array<{ noteId: string; similarity: number }> = [];

    for (const [noteId, vector] of Object.entries(this.vectorStore)) {
      const similarity = this.cosineSimilarity(query, vector);
      if (similarity >= threshold) {
        matches.push({ noteId, similarity });
      }
    }

    return matches;
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same dimension");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 加载现有笔记到内存
   */
  private loadExistingNotes(notes: ZettelNote[]): void {
    this.existingNotes.clear();
    this.vectorStore = {};

    for (const note of notes) {
      this.existingNotes.set(note.id, note);
      // 注意：实际应用中应该从向量数据库加载
      // 这里简化处理，假设向量会在需要时生成
    }
  }

  /**
   * 预计算并存储笔记的向量嵌入
   * @param note 笔记
   */
  async precomputeNoteEmbedding(note: ZettelNote): Promise<void> {
    const text = `${note.title}\n${note.content}`;
    const embedding = await this.llmProvider.generateEmbedding(text);
    this.vectorStore[note.id] = embedding;
  }

  /**
   * 批量预计算向量
   * @param notes 笔记列表
   */
  async batchPrecomputeEmbeddings(notes: ZettelNote[]): Promise<void> {
    for (const note of notes) {
      await this.precomputeNoteEmbedding(note);
    }
  }

  /**
   * 获取决策统计
   */
  getDecisionStats(candidates: DedupeCandidate[]): {
    create: number;
    merge: number;
    skip: number;
    total: number;
  } {
    const stats = {
      create: 0,
      merge: 0,
      skip: 0,
      total: candidates.length,
    };

    for (const candidate of candidates) {
      const decision = candidate.llmDecision?.decision;
      if (decision === "CREATE") stats.create++;
      else if (decision === "MERGE") stats.merge++;
      else if (decision === "SKIP") stats.skip++;
    }

    return stats;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<DedupeServiceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): DedupeServiceConfig {
    return { ...this.config };
  }

  /**
   * 清除向量缓存
   */
  clearVectorCache(): void {
    this.vectorStore = {};
    this.existingNotes.clear();
  }
}