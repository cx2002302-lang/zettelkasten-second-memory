/**
 * Serendipity Engine — 意外发现引擎
 *
 * 基于图算法发现知识网络中"看似无关但深层相关"的笔记对。
 *
 * 算法组合：
 * 1. 共同邻居 (Adamic/Adar Index) — 发现潜在的链接机会
 * 2. Jaccard 系数 — 邻居集合重叠度
 * 3. 资源分配 (RA) Index — 平衡精确率和召回率
 * 4. 图距离 — BFS 距离 2-3 步的笔记对
 * 5. 向量语义相似度（预留接口，当前基于内容长度和标签重叠）
 */

import type { DatabaseSync } from "node:sqlite";

export interface SerendipityCandidate {
  fromNoteId: string;
  fromTitle: string;
  toNoteId: string;
  toTitle: string;
  score: number;
  reason: string;
  commonNeighbors: string[];
  pathLength: number;
}

export interface SerendipityEngineConfig {
  topK: number;
  minScore: number;
  maxPathLength: number;
}

const DEFAULT_CONFIG: SerendipityEngineConfig = {
  topK: 10,
  minScore: 0.3,
  maxPathLength: 3,
};

export class SerendipityEngine {
  private db: DatabaseSync;
  private config: SerendipityEngineConfig;

  constructor(db: DatabaseSync, config?: Partial<SerendipityEngineConfig>) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 发现意外关联
   * 找出当前未直接链接但潜在相关的笔记对
   */
  discover(topK?: number): SerendipityCandidate[] {
    const limit = topK ?? this.config.topK;
    const candidates: SerendipityCandidate[] = [];

    // 获取所有笔记对（排除已有直接链接的）
    const notePairs = this.getUnlinkedNotePairs();

    // 预加载所有笔记内容用于内容相似度计算
    const noteContents = this.loadNoteContents();

    for (const pair of notePairs) {
      const { fromId, fromTitle, toId, toTitle } = pair;

      // 1. 计算共同邻居 (Adamic/Adar)
      const aaScore = this.adamicAdarScore(fromId, toId);

      // 2. 计算 Jaccard 系数
      const jaccardScore = this.jaccardScore(fromId, toId);

      // 3. 计算资源分配 (RA) Index
      const raScore = this.resourceAllocationScore(fromId, toId);

      // 4. 计算图距离
      const pathLength = this.shortestPathLength(fromId, toId);
      if (pathLength === 0 || pathLength > this.config.maxPathLength) continue;

      // 5. 计算标签重叠度
      const tagOverlapScore = this.tagOverlapScore(fromId, toId);

      // 6. 计算内容相似度（基于关键词重叠）
      const contentSimScore = this.contentSimilarity(
        noteContents.get(fromId) || "",
        noteContents.get(toId) || ""
      );

      // 综合评分 (加权平均)
      // 在低连接率图中，增加内容相似度的权重
      const score =
        aaScore * 0.25 +
        jaccardScore * 0.15 +
        raScore * 0.15 +
        tagOverlapScore * 0.15 +
        contentSimScore * 0.3;

      if (score >= this.config.minScore) {
        const commonNeighbors = this.getCommonNeighborTitles(fromId, toId);
        const reason = this.generateReason(aaScore, jaccardScore, raScore, tagOverlapScore, commonNeighbors);

        candidates.push({
          fromNoteId: fromId,
          fromTitle,
          toNoteId: toId,
          toTitle,
          score: Math.round(score * 100) / 100,
          reason,
          commonNeighbors,
          pathLength,
        });
      }
    }

    // 按分数排序，取 topK
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, limit);
  }

  /**
   * 获取未直接链接的笔记对（排除已有链接 + 自链接）
   */
  /**
   * 预加载笔记内容
   */
  private loadNoteContents(): Map<string, string> {
    const rows = this.db
      .prepare("SELECT id, content FROM zettel_notes WHERE folder != 'archive'")
      .all() as Array<{ id: string; content: string }>;

    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.id, (row.content || "").toLowerCase());
    }
    return map;
  }

  /**
   * 基于关键词重叠的内容相似度
   */
  private contentSimilarity(contentA: string, contentB: string): number {
    if (!contentA || !contentB) return 0;

    // 提取中文和英文词汇
    const wordsA = this.extractKeywords(contentA);
    const wordsB = this.extractKeywords(contentB);

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.size / union.size;
  }

  /**
   * 提取关键词（过滤停用词）
   */
  private extractKeywords(text: string): Set<string> {
    const stopWords = new Set([
      "的", "了", "是", "在", "和", "有", "我", "都", "个", "与", "也", "对", "为", "能",
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "have", "has", "had",
      "do", "does", "did", "will", "would", "could", "should", "may", "might", "can",
      "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
      "this", "that", "these", "those", "it", "its", "they", "them", "their", "we", "us", "our",
      "and", "or", "but", "if", "then", "else", "when", "where", "why", "how", "what", "which",
      "who", "whom", "whose", "about", "up", "out", "down", "off", "over", "under", "again",
    ]);

    // 提取中文词汇（2-4字）
    const chineseWords = new Set<string>();
    for (let i = 0; i < text.length - 1; i++) {
      for (let len = 2; len <= 4 && i + len <= text.length; len++) {
        const word = text.substring(i, i + len);
        // 只保留中文词汇
        if (/^[\u4e00-\u9fa5]+$/.test(word) && !stopWords.has(word)) {
          chineseWords.add(word);
        }
      }
    }

    // 提取英文单词
    const englishWords = new Set<string>();
    const matches = text.match(/[a-z]+/g);
    if (matches) {
      for (const word of matches) {
        if (word.length >= 3 && !stopWords.has(word)) {
          englishWords.add(word);
        }
      }
    }

    return new Set([...chineseWords, ...englishWords]);
  }

  private getUnlinkedNotePairs(): Array<{ fromId: string; fromTitle: string; toId: string; toTitle: string }> {
    // 获取所有笔记
    const notes = this.db
      .prepare("SELECT id, title FROM zettel_notes WHERE folder != 'archive' ORDER BY id")
      .all() as Array<{ id: string; title: string }>;

    // 获取所有已有的链接（双向都要排除）
    const existingLinks = this.db
      .prepare("SELECT from_note_id, to_note_id FROM zettel_links")
      .all() as Array<{ from_note_id: string; to_note_id: string }>;

    const linkedSet = new Set<string>();
    for (const link of existingLinks) {
      const key = link.from_note_id < link.to_note_id
        ? `${link.from_note_id}:${link.to_note_id}`
        : `${link.to_note_id}:${link.from_note_id}`;
      linkedSet.add(key);
    }

    const pairs: Array<{ fromId: string; fromTitle: string; toId: string; toTitle: string }> = [];

    // 采样：避免 O(n²) 全量计算，只取前 80 条笔记的组合
    const sampleSize = Math.min(notes.length, 80);
    const sampled = notes.slice(0, sampleSize);

    for (let i = 0; i < sampled.length; i++) {
      for (let j = i + 1; j < sampled.length; j++) {
        const a = sampled[i];
        const b = sampled[j];
        const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        if (!linkedSet.has(key)) {
          pairs.push({ fromId: a.id, fromTitle: a.title, toId: b.id, toTitle: b.title });
        }
      }
    }

    return pairs;
  }

  /**
   * Adamic/Adar Index: 按共同邻居度数的对数倒数加权
   * score = Σ(1 / log|N(c)|) for c in N(A) ∩ N(B)
   */
  private adamicAdarScore(aId: string, bId: string): number {
    const neighborsA = this.getNeighborIds(aId);
    const neighborsB = this.getNeighborIds(bId);

    const common = neighborsA.filter((id) => neighborsB.includes(id));
    if (common.length === 0) return 0;

    let score = 0;
    for (const cId of common) {
      const degree = this.getDegree(cId);
      if (degree > 1) {
        score += 1 / Math.log(degree);
      }
    }

    // 归一化
    return Math.min(score / 5, 1.0);
  }

  /**
   * Jaccard Coefficient: |N(A) ∩ N(B)| / |N(A) ∪ N(B)|
   */
  private jaccardScore(aId: string, bId: string): number {
    const neighborsA = new Set(this.getNeighborIds(aId));
    const neighborsB = new Set(this.getNeighborIds(bId));

    const intersection = new Set([...neighborsA].filter((x) => neighborsB.has(x)));
    const union = new Set([...neighborsA, ...neighborsB]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  /**
   * Resource Allocation (RA) Index
   * score = Σ(1 / |N(c)|) for c in N(A) ∩ N(B)
   */
  private resourceAllocationScore(aId: string, bId: string): number {
    const neighborsA = this.getNeighborIds(aId);
    const neighborsB = this.getNeighborIds(bId);

    const common = neighborsA.filter((id) => neighborsB.includes(id));
    if (common.length === 0) return 0;

    let score = 0;
    for (const cId of common) {
      const degree = this.getDegree(cId);
      if (degree > 0) {
        score += 1 / degree;
      }
    }

    return Math.min(score / 3, 1.0);
  }

  /**
   * 标签重叠度评分
   */
  private tagOverlapScore(aId: string, bId: string): number {
    const tagsA = this.db
      .prepare(
        `SELECT t.name FROM zettel_tags t
         JOIN zettel_note_tags nt ON t.id = nt.tag_id
         WHERE nt.note_id = ?`
      )
      .all(aId) as Array<{ name: string }>;

    const tagsB = this.db
      .prepare(
        `SELECT t.name FROM zettel_tags t
         JOIN zettel_note_tags nt ON t.id = nt.tag_id
         WHERE nt.note_id = ?`
      )
      .all(bId) as Array<{ name: string }>;

    const setA = new Set(tagsA.map((t) => t.name));
    const setB = new Set(tagsB.map((t) => t.name));

    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  /**
   * BFS 计算最短路径长度（限制 maxPathLength）
   */
  private shortestPathLength(fromId: string, toId: string): number {
    if (fromId === toId) return 0;

    const visited = new Set<string>([fromId]);
    const queue: Array<{ id: string; depth: number }> = [{ id: fromId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= this.config.maxPathLength) continue;

      const neighbors = this.db
        .prepare(
          `SELECT to_note_id as id FROM zettel_links WHERE from_note_id = ?
           UNION
           SELECT from_note_id as id FROM zettel_links WHERE to_note_id = ?`
        )
        .all(current.id, current.id) as Array<{ id: string }>;

      for (const n of neighbors) {
        if (n.id === toId) return current.depth + 1;
        if (!visited.has(n.id)) {
          visited.add(n.id);
          queue.push({ id: n.id, depth: current.depth + 1 });
        }
      }
    }

    return Infinity;
  }

  /**
   * 获取笔记的邻居 ID 列表（包含双向）
   */
  private getNeighborIds(noteId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT to_note_id as id FROM zettel_links WHERE from_note_id = ?
         UNION
         SELECT from_note_id as id FROM zettel_links WHERE to_note_id = ?`
      )
      .all(noteId, noteId) as Array<{ id: string }>;

    return rows.map((r) => r.id);
  }

  /**
   * 获取笔记的度数（邻居数量）
   */
  private getDegree(noteId: string): number {
    const result = this.db
      .prepare(
        `SELECT COUNT(*) as c FROM (
          SELECT to_note_id FROM zettel_links WHERE from_note_id = ?
          UNION
          SELECT from_note_id FROM zettel_links WHERE to_note_id = ?
        )`
      )
      .get(noteId, noteId) as { c: number };

    return result.c;
  }

  /**
   * 获取共同邻居的标题
   */
  private getCommonNeighborTitles(aId: string, bId: string): string[] {
    const neighborsA = this.getNeighborIds(aId);
    const neighborsB = this.getNeighborIds(bId);
    const common = neighborsA.filter((id) => neighborsB.includes(id));

    if (common.length === 0) return [];

    const placeholders = common.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT title FROM zettel_notes WHERE id IN (${placeholders})`)
      .all(...common) as Array<{ title: string }>;

    return rows.map((r) => r.title).filter((t) => t).slice(0, 3);
  }

  /**
   * 生成推荐理由
   */
  private generateReason(
    aa: number,
    jaccard: number,
    ra: number,
    tagOverlap: number,
    commonNeighbors: string[]
  ): string {
    const reasons: string[] = [];

    if (aa > 0.5) reasons.push("共同邻居高度相关");
    else if (aa > 0.2) reasons.push("有共同邻居");

    if (jaccard > 0.3) reasons.push("连接网络重叠度高");

    if (ra > 0.3) reasons.push("资源分配指数显著");

    if (tagOverlap > 0.3) reasons.push("标签高度重叠");
    else if (tagOverlap > 0) reasons.push("有共同标签");

    if (commonNeighbors.length > 0) {
      reasons.push(`通过「${commonNeighbors[0]}」等笔记间接关联`);
    }

    return reasons.join("；") || "潜在语义关联";
  }
}
