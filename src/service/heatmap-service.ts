import type { DatabaseSync } from "node:sqlite";

export interface DailyActivity {
  date: string;
  created: number;
  updated: number;
  linksCreated: number;
}

export interface FolderDistribution {
  folder: string;
  count: number;
  percentage: number;
}

export interface LinkDensity {
  noteId: string;
  title: string;
  outDegree: number;
  inDegree: number;
  totalDegree: number;
}

export interface GlowDistribution {
  status: string;
  count: number;
  percentage: number;
  avgGlow: number;
}

export interface HeatmapData {
  period: { start: string; end: string };
  dailyActivity: DailyActivity[];
  folderDistribution: FolderDistribution[];
  glowDistribution: GlowDistribution[];
  topConnected: LinkDensity[];
  topIsolated: LinkDensity[];
  summary: {
    totalNotes: number;
    totalLinks: number;
    avgLinksPerNote: number;
    avgGlow: number;
    mostActiveDay: string | null;
  };
}

export interface GraphNode {
  id: string;
  label: string;
  folder: string;
  glow: number;
  glowStatus: string;
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

export interface NetworkGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    nodeCount: number;
    edgeCount: number;
    avgDegree: number;
    generatedAt: string;
  };
}

export class KnowledgeHeatmapService {
  constructor(private db: DatabaseSync) {}

  /**
   * 生成知识热力图数据
   */
  generateHeatmap(days: number = 30): HeatmapData {
    if (days < 1) {
      days = 1;
    }
    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    // 1. 每日活跃度
    const dailyActivity = this.getDailyActivity(startDate, endDate);

    // 2. Folder 分布
    const folderDistribution = this.getFolderDistribution();

    // 3. Glow 分布
    const glowDistribution = this.getGlowDistribution();

    // 4. 连接密度排行
    const linkDensity = this.getLinkDensity();
    const topConnected = linkDensity
      .filter((n) => n.totalDegree > 0)
      .sort((a, b) => b.totalDegree - a.totalDegree)
      .slice(0, 10);
    const topIsolated = linkDensity
      .filter((n) => n.totalDegree === 0)
      .slice(0, 10);

    // 5. 汇总
    const totalNotes = (
      this.db.prepare("SELECT COUNT(*) as cnt FROM zettel_notes").get() as {
        cnt: number;
      }
    ).cnt;
    const totalLinks = (
      this.db.prepare("SELECT COUNT(*) as cnt FROM zettel_links").get() as {
        cnt: number;
      }
    ).cnt;
    const avgGlow = (
      this.db
        .prepare("SELECT AVG(glow_score) as avg FROM zettel_note_stats")
        .get() as { avg: number }
    ).avg;

    const mostActive = dailyActivity.sort(
      (a, b) => b.created + b.updated - (a.created + a.updated)
    )[0];

    return {
      period: { start: startDate, end: endDate },
      dailyActivity,
      folderDistribution,
      glowDistribution,
      topConnected,
      topIsolated,
      summary: {
        totalNotes,
        totalLinks,
        avgLinksPerNote: totalNotes > 0 ? totalLinks / totalNotes : 0,
        avgGlow: avgGlow ?? 0,
        mostActiveDay: mostActive ? mostActive.date : null,
      },
    };
  }

  private getDailyActivity(startDate: string, endDate: string): DailyActivity[] {
    const created = this.db
      .prepare(
        `SELECT date(created_at) as date, COUNT(*) as cnt
         FROM zettel_notes
         WHERE date(created_at) BETWEEN ? AND ?
         GROUP BY date(created_at)
         ORDER BY date`
      )
      .all(startDate, endDate) as Array<{ date: string; cnt: number }>;

    const updated = this.db
      .prepare(
        `SELECT date(updated_at) as date, COUNT(*) as cnt
         FROM zettel_notes
         WHERE date(updated_at) BETWEEN ? AND ?
         GROUP BY date(updated_at)
         ORDER BY date`
      )
      .all(startDate, endDate) as Array<{ date: string; cnt: number }>;

    const links = this.db
      .prepare(
        `SELECT date(created_at) as date, COUNT(*) as cnt
         FROM zettel_links
         WHERE date(created_at) BETWEEN ? AND ?
         GROUP BY date(created_at)
         ORDER BY date`
      )
      .all(startDate, endDate) as Array<{ date: string; cnt: number }>;

    const dateMap = new Map<string, DailyActivity>();

    for (const c of created) {
      dateMap.set(c.date, {
        date: c.date,
        created: c.cnt,
        updated: 0,
        linksCreated: 0,
      });
    }

    for (const u of updated) {
      const existing = dateMap.get(u.date);
      if (existing) {
        existing.updated = u.cnt;
      } else {
        dateMap.set(u.date, {
          date: u.date,
          created: 0,
          updated: u.cnt,
          linksCreated: 0,
        });
      }
    }

    for (const l of links) {
      const existing = dateMap.get(l.date);
      if (existing) {
        existing.linksCreated = l.cnt;
      } else {
        dateMap.set(l.date, {
          date: l.date,
          created: 0,
          updated: 0,
          linksCreated: l.cnt,
        });
      }
    }

    return Array.from(dateMap.values()).sort(
      (a, b) => a.date.localeCompare(b.date)
    );
  }

  private getFolderDistribution(): FolderDistribution[] {
    const total = (
      this.db.prepare("SELECT COUNT(*) as cnt FROM zettel_notes").get() as {
        cnt: number;
      }
    ).cnt;

    const rows = this.db
      .prepare(
        "SELECT folder, COUNT(*) as cnt FROM zettel_notes GROUP BY folder"
      )
      .all() as Array<{ folder: string; cnt: number }>;

    return rows.map((r) => ({
      folder: r.folder,
      count: r.cnt,
      percentage: total > 0 ? (r.cnt / total) * 100 : 0,
    }));
  }

  private getGlowDistribution(): GlowDistribution[] {
    const total = (
      this.db
        .prepare("SELECT COUNT(*) as cnt FROM zettel_note_stats")
        .get() as { cnt: number }
    ).cnt;

    const rows = this.db
      .prepare(
        `SELECT glow_status, COUNT(*) as cnt, AVG(glow_score) as avg_glow
         FROM zettel_note_stats
         GROUP BY glow_status`
      )
      .all() as Array<{
        glow_status: string;
        cnt: number;
        avg_glow: number;
      }>;

    return rows.map((r) => ({
      status: r.glow_status,
      count: r.cnt,
      percentage: total > 0 ? (r.cnt / total) * 100 : 0,
      avgGlow: r.avg_glow ?? 0,
    }));
  }

  private getLinkDensity(): LinkDensity[] {
    const notes = this.db
      .prepare(
        `SELECT n.id, n.title,
                COALESCE((SELECT COUNT(*) FROM zettel_links WHERE from_note_id = n.id), 0) as out_degree,
                COALESCE((SELECT COUNT(*) FROM zettel_links WHERE to_note_id = n.id), 0) as in_degree
         FROM zettel_notes n`
      )
      .all() as Array<{
        id: string;
        title: string;
        out_degree: number;
        in_degree: number;
      }>;

    return notes.map((n) => ({
      noteId: n.id,
      title: n.title,
      outDegree: n.out_degree,
      inDegree: n.in_degree,
      totalDegree: n.out_degree + n.in_degree,
    }));
  }

  /**
   * 生成知识图谱数据
   */
  generateNetworkGraph(options?: {
    limit?: number;
    folderFilter?: string[];
    glowMin?: number;
  }): NetworkGraph {
    const limit = Math.max(0, Math.floor(Number(options?.limit ?? 200)));
    const folderFilter = options?.folderFilter;
    const glowMin = Math.max(0, Math.min(1, Number(options?.glowMin ?? 0)));

    let nodeSql = `
      SELECT n.id, n.title, n.folder,
             COALESCE(s.glow_score, 0) as glow,
             COALESCE(s.glow_status, 'stable') as glow_status
      FROM zettel_notes n
      LEFT JOIN zettel_note_stats s ON n.id = s.note_id
      WHERE COALESCE(s.glow_score, 0) >= ?
    `;
    const nodeParams: (number | string)[] = [glowMin];

    if (folderFilter && folderFilter.length > 0) {
      const placeholders = folderFilter.map(() => "?").join(",");
      nodeSql += ` AND n.folder IN (${placeholders})`;
      nodeParams.push(...folderFilter);
    }

    nodeSql += ` ORDER BY COALESCE(s.glow_score, 0) DESC LIMIT ?`;
    nodeParams.push(limit);

    const nodes = this.db.prepare(nodeSql).all(...nodeParams) as Array<{
      id: string;
      title: string;
      folder: string;
      glow: number;
      glow_status: string;
    }>;

    const nodeIds = new Set(nodes.map((n) => n.id));

    // 只获取这些节点之间的链接
    const edges = this.db
      .prepare(
        `SELECT from_note_id, to_note_id, type
         FROM zettel_links
         WHERE from_note_id IN (${Array.from(nodeIds)
           .map(() => "?")
           .join(",")})
           AND to_note_id IN (${Array.from(nodeIds)
             .map(() => "?")
             .join(",")})`
      )
      .all(...Array.from(nodeIds), ...Array.from(nodeIds)) as Array<{
        from_note_id: string;
        to_note_id: string;
        type: string;
      }>;

    const edgeList: GraphEdge[] = edges.map((e) => ({
      source: e.from_note_id,
      target: e.to_note_id,
      type: e.type,
      weight: this.getLinkWeight(e.type),
    }));

    const nodeList: GraphNode[] = nodes.map((n) => ({
      id: n.id,
      label: n.title,
      folder: n.folder,
      glow: n.glow,
      glowStatus: n.glow_status,
      degree: edgeList.filter(
        (e) => e.source === n.id || e.target === n.id
      ).length,
    }));

    const avgDegree =
      nodeList.length > 0
        ? nodeList.reduce((sum, n) => sum + n.degree, 0) / nodeList.length
        : 0;

    return {
      nodes: nodeList,
      edges: edgeList,
      meta: {
        nodeCount: nodeList.length,
        edgeCount: edgeList.length,
        avgDegree,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private getLinkWeight(type: string): number {
    const weights: Record<string, number> = {
      supports: 1.0,
      refines: 1.2,
      extends: 1.5,
      contradicts: 2.0,
      is_example_of: 1.3,
      related: 2.0,
    };
    return weights[type] ?? 1.5;
  }
}
