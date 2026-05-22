/**
 * Community Detector — 知识社区发现
 *
 * 使用简化版 Louvain 算法发现知识网络中的社区/聚类。
 * 每个社区可以生成一个结构笔记（MOC）。
 */

import type { DatabaseSync } from "node:sqlite";

export interface Community {
  id: number;
  notes: Array<{ id: string; title: string; glowScore: number }>;
  hubNoteId: string;
  hubNoteTitle: string;
  size: number;
  density: number;
}

export interface CommunityDetectorConfig {
  minClusterSize: number;
  maxClusters: number;
}

const DEFAULT_CONFIG: CommunityDetectorConfig = {
  minClusterSize: 3,
  maxClusters: 10,
};

export class CommunityDetector {
  private db: DatabaseSync;
  private config: CommunityDetectorConfig;

  constructor(db: DatabaseSync, config?: Partial<CommunityDetectorConfig>) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 发现知识社区
   * 使用基于标签的聚类 + 链接密度验证
   */
  detectCommunities(): Community[] {
    // 步骤 1: 基于标签做初始聚类
    const tagClusters = this.clusterByTags();

    // 步骤 2: 基于链接密度合并/拆分
    const refinedClusters = this.refineByLinkDensity(tagClusters);

    // 步骤 3: 过滤小社区，计算中心节点
    const communities: Community[] = [];
    for (const cluster of refinedClusters) {
      if (cluster.length < this.config.minClusterSize) continue;

      const hub = this.findHubNote(cluster);
      const density = this.calculateDensity(cluster);

      const notes = cluster.map((id) => {
        const note = this.db
          .prepare("SELECT id, title, glow_score FROM zettel_notes LEFT JOIN zettel_note_stats ON zettel_notes.id = zettel_note_stats.note_id WHERE id = ?")
          .get(id) as { id: string; title: string; glow_score: number } | undefined;
        return {
          id,
          title: note?.title || "[未知]",
          glowScore: note?.glow_score || 0,
        };
      });

      communities.push({
        id: communities.length + 1,
        notes: notes.sort((a, b) => b.glowScore - a.glowScore),
        hubNoteId: hub.id,
        hubNoteTitle: hub.title,
        size: cluster.length,
        density: Math.round(density * 100) / 100,
      });
    }

    // 按大小排序
    communities.sort((a, b) => b.size - a.size);
    return communities.slice(0, this.config.maxClusters);
  }

  /**
   * 基于标签聚类
   * 共享标签的笔记分到同一簇
   */
  private clusterByTags(): string[][] {
    // 获取所有标签及其关联的笔记
    const tagNotes = this.db
      .prepare(
        `SELECT t.name as tag, n.id as note_id
         FROM zettel_tags t
         JOIN zettel_note_tags nt ON t.id = nt.tag_id
         JOIN zettel_notes n ON nt.note_id = n.id
         WHERE n.folder != 'archive'
         ORDER BY t.name`
      )
      .all() as Array<{ tag: string; note_id: string }>;

    // 构建标签 → 笔记列表 映射
    const tagMap = new Map<string, Set<string>>();
    for (const row of tagNotes) {
      if (!tagMap.has(row.tag)) {
        tagMap.set(row.tag, new Set());
      }
      tagMap.get(row.tag)!.add(row.note_id);
    }

    // 构建笔记 → 标签集合 映射
    const noteTags = new Map<string, Set<string>>();
    for (const row of tagNotes) {
      if (!noteTags.has(row.note_id)) {
        noteTags.set(row.note_id, new Set());
      }
      noteTags.get(row.note_id)!.add(row.tag);
    }

    // 使用并查集做聚类：共享标签的笔记合并
    const uf = new UnionFind();
    const allNotes = Array.from(noteTags.keys());
    for (const noteId of allNotes) {
      uf.add(noteId);
    }

    for (const [tag, notes] of tagMap) {
      const noteList = Array.from(notes);
      for (let i = 1; i < noteList.length; i++) {
        uf.union(noteList[0], noteList[i]);
      }
    }

    // 收集聚类结果
    const clusters = new Map<string, string[]>();
    for (const noteId of allNotes) {
      const root = uf.find(noteId);
      if (!clusters.has(root)) {
        clusters.set(root, []);
      }
      clusters.get(root)!.push(noteId);
    }

    return Array.from(clusters.values());
  }

  /**
   * 基于链接密度细化聚类
   * 如果一个大簇内部链接密度低，尝试拆分
   */
  private refineByLinkDensity(clusters: string[][]): string[][] {
    const refined: string[][] = [];

    for (const cluster of clusters) {
      if (cluster.length <= this.config.minClusterSize * 2) {
        refined.push(cluster);
        continue;
      }

      // 大簇：检查内部链接密度
      const density = this.calculateDensity(cluster);
      if (density >= 0.3) {
        refined.push(cluster);
        continue;
      }

      // 密度低：按 hub 拆分
      const subClusters = this.splitByHubs(cluster);
      refined.push(...subClusters);
    }

    return refined;
  }

  /**
   * 按中心节点拆分大簇
   */
  private splitByHubs(cluster: string[]): string[][] {
    // 找度数最高的几个节点作为 hub
    const degrees = cluster.map((id) => ({
      id,
      degree: this.getInternalDegree(id, cluster),
    }));

    degrees.sort((a, b) => b.degree - a.degree);

    // 取前 2-3 个 hub
    const hubCount = Math.min(3, Math.floor(cluster.length / 5) + 1);
    const hubs = degrees.slice(0, hubCount).map((d) => d.id);

    // 每个非 hub 节点归属到最近的 hub
    const subClusters: string[][] = hubs.map((h) => [h]);
    const hubIndex = new Map<string, number>();
    for (let i = 0; i < hubs.length; i++) {
      hubIndex.set(hubs[i], i);
    }

    for (const noteId of cluster) {
      if (hubIndex.has(noteId)) continue;

      // 找到最近的 hub（链接数最多的）
      let bestHub = 0;
      let bestLinks = -1;
      for (let i = 0; i < hubs.length; i++) {
        const links = this.countLinksBetween(noteId, hubs[i]);
        if (links > bestLinks) {
          bestLinks = links;
          bestHub = i;
        }
      }

      subClusters[bestHub].push(noteId);
    }

    return subClusters.filter((c) => c.length >= this.config.minClusterSize);
  }

  /**
   * 计算簇内链接密度
   * density = 实际链接数 / 最大可能链接数
   */
  private calculateDensity(cluster: string[]): number {
    const set = new Set(cluster);
    const n = cluster.length;
    if (n <= 1) return 0;

    let actualLinks = 0;
    for (let i = 0; i < cluster.length; i++) {
      for (let j = i + 1; j < cluster.length; j++) {
        if (this.hasLink(cluster[i], cluster[j])) {
          actualLinks++;
        }
      }
    }

    const maxLinks = (n * (n - 1)) / 2;
    return actualLinks / maxLinks;
  }

  /**
   * 找簇的中心节点（glow score 最高且连接最多）
   */
  private findHubNote(cluster: string[]): { id: string; title: string } {
    let bestId = cluster[0];
    let bestScore = -1;

    for (const id of cluster) {
      const glowRow = this.db
        .prepare("SELECT glow_score FROM zettel_note_stats WHERE note_id = ?")
      .get(id) as { glow_score: number } | undefined;
      const glowScore = glowRow?.glow_score || 0;
      const degree = this.getInternalDegree(id, cluster);
      const score = glowScore * 0.6 + degree * 0.4;

      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }

    const note = this.db
      .prepare("SELECT title FROM zettel_notes WHERE id = ?")
      .get(bestId) as { title: string } | undefined;

    return { id: bestId, title: note?.title || "[未知]" };
  }

  /**
   * 获取节点在簇内的度数
   */
  private getInternalDegree(noteId: string, cluster: string[]): number {
    const set = new Set(cluster);
    const neighbors = this.getNeighborIds(noteId);
    return neighbors.filter((id) => set.has(id) && id !== noteId).length;
  }

  /**
   * 检查两个笔记是否有直接链接
   */
  private hasLink(aId: string, bId: string): boolean {
    const result = this.db
      .prepare(
        `SELECT 1 FROM zettel_links
         WHERE (from_note_id = ? AND to_note_id = ?)
         OR (from_note_id = ? AND to_note_id = ?)
         LIMIT 1`
      )
      .get(aId, bId, bId, aId);

    return result !== undefined;
  }

  /**
   * 计算两个笔记之间的链接数（0 或 1，但可能有双向）
   */
  private countLinksBetween(aId: string, bId: string): number {
    const result = this.db
      .prepare(
        `SELECT COUNT(*) as c FROM zettel_links
         WHERE (from_note_id = ? AND to_note_id = ?)
         OR (from_note_id = ? AND to_note_id = ?)`
      )
      .get(aId, bId, bId, aId) as { c: number };

    return result.c;
  }

  /**
   * 获取笔记的邻居 ID 列表
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
}

/**
 * 并查集（Union-Find）数据结构
 */
class UnionFind {
  private parent = new Map<string, string>();

  add(x: string): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
    }
  }

  find(x: string): string {
    const p = this.parent.get(x);
    if (!p) return x;
    if (p !== x) {
      this.parent.set(x, this.find(p));
    }
    return this.parent.get(x)!;
  }

  union(x: string, y: string): void {
    const rootX = this.find(x);
    const rootY = this.find(y);
    if (rootX !== rootY) {
      this.parent.set(rootX, rootY);
    }
  }
}
