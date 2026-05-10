/**
 * PathFinder - 知识图谱路径搜索引擎
 *
 * 职责：
 * 1. BFS 最短路径算法（带链接类型权重）
 * 2. 自动生成中文路径解释
 * 3. 支持 maxDepth / linkTypeFilter 参数
 * 4. 循环检测（visited 集合）
 */

import type { DatabaseSync } from "node:sqlite";

export interface PathNode {
  noteId: string;
  title: string;
  linkType?: string;
}

export interface PathResult {
  fromId: string;
  fromTitle: string;
  toId: string;
  toTitle: string;
  path: PathNode[];
  totalWeight: number;
  stepCount: number;
  explanation: string;
}

export interface PathFinderOptions {
  maxDepth?: number;
  linkTypeFilter?: string[];
  excludeNoteIds?: string[];
}

/** 链接权重矩阵 */
const LINK_WEIGHTS: Record<string, number> = {
  supports: 1.0,
  supported_by: 1.0,
  refines: 1.2,
  refined_by: 1.2,
  extends: 1.5,
  extended_by: 1.5,
  contradicts: 2.0,
  contradicted_by: 2.0,
  is_example_of: 1.3,
  has_example: 1.3,
  related: 2.0,
};

const DEFAULT_MAX_DEPTH = 6;

export class PathFinder {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /**
   * 查找两张笔记之间的最短路径
   */
  findPath(fromId: string, toId: string, options: PathFinderOptions = {}): PathResult | null {
    const { maxDepth = DEFAULT_MAX_DEPTH, linkTypeFilter, excludeNoteIds = [] } = options;

    if (fromId === toId) {
      return null;
    }

    // 获取笔记标题
    const fromNote = this.getNoteTitle(fromId);
    const toNote = this.getNoteTitle(toId);

    if (!fromNote || !toNote) {
      return null;
    }

    // BFS 搜索
    const path = this.bfs(fromId, toId, maxDepth, linkTypeFilter, excludeNoteIds);

    if (!path) {
      return null;
    }

    const totalWeight = path.reduce((sum, node, i) => {
      if (i === 0) return 0;
      return sum + this.getLinkWeight(node.linkType);
    }, 0);

    return {
      fromId,
      fromTitle: fromNote.title,
      toId,
      toTitle: toNote.title,
      path,
      totalWeight,
      stepCount: path.length - 1,
      explanation: this.generateExplanation(path),
    };
  }

  /**
   * 查找从某笔记出发的所有路径（用于探索）
   */
  findPathsFrom(fromId: string, options: PathFinderOptions = {}): PathResult[] {
    const { maxDepth = DEFAULT_MAX_DEPTH, linkTypeFilter, excludeNoteIds = [] } = options;

    const fromNote = this.getNoteTitle(fromId);
    if (!fromNote) return [];

    // 获取所有可达的笔记
    const reachable = this.findAllReachable(fromId, maxDepth, linkTypeFilter, excludeNoteIds);

    const results: PathResult[] = [];

    for (const targetId of reachable) {
      if (targetId === fromId) continue;
      const path = this.findPath(fromId, targetId, { maxDepth, linkTypeFilter, excludeNoteIds });
      if (path) {
        results.push(path);
      }
    }

    return results;
  }

  // ============ 私有方法 ============

  /**
   * BFS 最短路径算法
   */
  private bfs(
    fromId: string,
    toId: string,
    maxDepth: number,
    linkTypeFilter?: string[],
    excludeNoteIds: string[] = []
  ): PathNode[] | null {
    const visited = new Set<string>([fromId, ...excludeNoteIds]);
    const queue: Array<{ nodeId: string; path: PathNode[]; weight: number }> = [
      {
        nodeId: fromId,
        path: [{ noteId: fromId, title: this.getNoteTitle(fromId)?.title ?? fromId }],
        weight: 0,
      },
    ];

    // 记录每个节点的最优路径（防止循环和冗余）
    const bestPaths = new Map<string, { path: PathNode[]; weight: number }>();
    bestPaths.set(fromId, { path: queue[0].path, weight: 0 });

    while (queue.length > 0) {
      // 按权重排序，优先探索权重小的路径
      queue.sort((a, b) => a.weight - b.weight);
      const current = queue.shift()!;

      if (current.path.length > maxDepth + 1) {
        continue;
      }

      if (current.nodeId === toId) {
        return current.path;
      }

      // 获取邻居
      const neighbors = this.getNeighbors(current.nodeId, linkTypeFilter);

      for (const neighbor of neighbors) {
        if (visited.has(neighbor.noteId)) {
          // 检查是否是更优路径
          const existing = bestPaths.get(neighbor.noteId);
          const newWeight = current.weight + this.getLinkWeight(neighbor.linkType);

          if (existing && existing.weight <= newWeight) {
            continue;
          }
        }

        visited.add(neighbor.noteId);
        const newPath = [...current.path, neighbor];
        const newWeight = current.weight + this.getLinkWeight(neighbor.linkType);

        bestPaths.set(neighbor.noteId, { path: newPath, weight: newWeight });
        queue.push({
          nodeId: neighbor.noteId,
          path: newPath,
          weight: newWeight,
        });
      }
    }

    return null;
  }

  /**
   * 获取笔记的邻居（双向链接）
   */
  private getNeighbors(noteId: string, linkTypeFilter?: string[]): PathNode[] {
    let sql = `
      SELECT
        CASE WHEN l.from_note_id = ? THEN l.to_note_id ELSE l.from_note_id END as note_id,
        n.title,
        l.type
      FROM zettel_links l
      JOIN zettel_notes n ON n.id = CASE WHEN l.from_note_id = ? THEN l.to_note_id ELSE l.from_note_id END
      WHERE (l.from_note_id = ? OR l.to_note_id = ?)
    `;

    const params: string[] = [noteId, noteId, noteId, noteId];

    if (linkTypeFilter && linkTypeFilter.length > 0) {
      const placeholders = linkTypeFilter.map(() => "?").join(",");
      sql += ` AND l.type IN (${placeholders})`;
      params.push(...linkTypeFilter);
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{
      note_id: string;
      title: string;
      type: string;
    }>;

    return rows.map((row) => ({
      noteId: row.note_id,
      title: row.title,
      linkType: row.type,
    }));
  }

  /**
   * 查找所有可达节点
   */
  private findAllReachable(
    fromId: string,
    maxDepth: number,
    linkTypeFilter?: string[],
    excludeNoteIds: string[] = []
  ): string[] {
    const visited = new Set<string>([fromId, ...excludeNoteIds]);
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: fromId, depth: 0 }];
    const reachable: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.depth >= maxDepth) {
        continue;
      }

      const neighbors = this.getNeighbors(current.nodeId, linkTypeFilter);

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.noteId)) {
          visited.add(neighbor.noteId);
          reachable.push(neighbor.noteId);
          queue.push({ nodeId: neighbor.noteId, depth: current.depth + 1 });
        }
      }
    }

    return reachable;
  }

  /**
   * 获取笔记标题
   */
  private getNoteTitle(noteId: string): { title: string } | null {
    const result = this.db
      .prepare(`SELECT title FROM zettel_notes WHERE id = ?`)
      .get(noteId) as { title: string } | undefined;

    return result ?? null;
  }

  /**
   * 获取链接权重
   */
  private getLinkWeight(linkType?: string): number {
    return LINK_WEIGHTS[linkType ?? "related"] ?? 2.0;
  }

  /**
   * 生成中文路径解释
   */
  private generateExplanation(path: PathNode[]): string {
    if (path.length <= 2) {
      return `直接通过「${path[1]?.linkType || "相关"}」链接`;
    }

    const steps: string[] = [];
    for (let i = 1; i < path.length; i++) {
      const linkType = path[i].linkType || "相关";
      steps.push(`从「${path[i - 1].title}」${linkType}到「${path[i].title}」`);
    }

    return `经过 ${path.length - 1} 步: ${steps.join("，")}`;
  }
}
