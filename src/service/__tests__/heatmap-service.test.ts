import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ensureZettelkastenSchema } from "../../storage/db-schema.js";
import { KnowledgeHeatmapService } from "../heatmap-service.js";

describe("KnowledgeHeatmapService", () => {
  let db: DatabaseSync;
  let service: KnowledgeHeatmapService;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureZettelkastenSchema({ db });
    service = new KnowledgeHeatmapService(db);

    // 插入测试笔记
    const now = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString();

    db.prepare(
      `INSERT INTO zettel_notes (id, title, content, type, status, folder, file_path, created_at, updated_at)
       VALUES (?, ?, ?, 'atomic', 'PERMANENT', ?, ?, ?, ?)`
    ).run("n1", "Note A", "content A", "zettels", "/a.md", now, now);
    db.prepare(
      `INSERT INTO zettel_notes (id, title, content, type, status, folder, file_path, created_at, updated_at)
       VALUES (?, ?, ?, 'atomic', 'PERMANENT', ?, ?, ?, ?)`
    ).run("n2", "Note B", "content B", "zettels", "/b.md", yesterday, yesterday);
    db.prepare(
      `INSERT INTO zettel_notes (id, title, content, type, status, folder, file_path, created_at, updated_at)
       VALUES (?, ?, ?, 'atomic', 'PERMANENT', ?, ?, ?, ?)`
    ).run("n3", "Note C", "content C", "inbox", "/c.md", lastWeek, lastWeek);

    // 插入链接
    db.prepare(
      `INSERT INTO zettel_links (from_note_id, to_note_id, type, created_at)
       VALUES (?, ?, 'supports', ?)`
    ).run("n1", "n2", now);
    db.prepare(
      `INSERT INTO zettel_links (from_note_id, to_note_id, type, created_at)
       VALUES (?, ?, 'extends', ?)`
    ).run("n2", "n3", yesterday);

    // 插入 stats
    db.prepare(
      `INSERT INTO zettel_note_stats (note_id, glow_score, glow_status, backlink_count, pagerank_score)
       VALUES (?, 0.8, 'active', 1, 0.5)`
    ).run("n1");
    db.prepare(
      `INSERT INTO zettel_note_stats (note_id, glow_score, glow_status, backlink_count, pagerank_score)
       VALUES (?, 0.6, 'stable', 1, 0.3)`
    ).run("n2");
    db.prepare(
      `INSERT INTO zettel_note_stats (note_id, glow_score, glow_status, backlink_count, pagerank_score)
       VALUES (?, 0.2, 'zombie', 0, 0.1)`
    ).run("n3");
  });

  describe("generateHeatmap", () => {
    it("应该返回热力图数据", () => {
      const data = service.generateHeatmap(30);

      expect(data.period.start).toBeDefined();
      expect(data.period.end).toBeDefined();
      expect(data.summary.totalNotes).toBe(3);
      expect(data.summary.totalLinks).toBe(2);
      expect(data.summary.avgLinksPerNote).toBeCloseTo(0.67, 1);
    });

    it("应该返回 folder 分布", () => {
      const data = service.generateHeatmap(30);

      const zettelsFolder = data.folderDistribution.find(
        (f) => f.folder === "zettels"
      );
      expect(zettelsFolder).toBeDefined();
      expect(zettelsFolder!.count).toBe(2);

      const inboxFolder = data.folderDistribution.find(
        (f) => f.folder === "inbox"
      );
      expect(inboxFolder).toBeDefined();
      expect(inboxFolder!.count).toBe(1);
    });

    it("应该返回 glow 分布", () => {
      const data = service.generateHeatmap(30);

      expect(data.glowDistribution.length).toBeGreaterThan(0);
      const active = data.glowDistribution.find((g) => g.status === "active");
      expect(active).toBeDefined();
      expect(active!.count).toBe(1);
    });

    it("应该返回连接密度排行", () => {
      const data = service.generateHeatmap(30);

      expect(data.topConnected.length).toBeGreaterThan(0);
      const top = data.topConnected[0];
      expect(top.totalDegree).toBeGreaterThan(0);
    });

    it("应该返回孤立笔记", () => {
      // 插入一个真正的孤立笔记
      db.prepare(
        `INSERT INTO zettel_notes (id, title, content, type, status, folder, file_path, created_at, updated_at)
         VALUES (?, ?, ?, 'atomic', 'PERMANENT', ?, ?, ?, ?)`
      ).run("n4", "Isolated Note", "no links", "inbox", "/d.md", new Date().toISOString(), new Date().toISOString());

      const data = service.generateHeatmap(30);

      const isolated = data.topIsolated.find((n) => n.noteId === "n4");
      expect(isolated).toBeDefined();
      expect(isolated!.totalDegree).toBe(0);
    });
  });

  describe("generateNetworkGraph", () => {
    it("应该返回知识图谱", () => {
      const graph = service.generateNetworkGraph();

      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.meta.nodeCount).toBeGreaterThan(0);
      expect(graph.meta.generatedAt).toBeDefined();
    });

    it("应该支持 folder 过滤", () => {
      const graph = service.generateNetworkGraph({
        folderFilter: ["zettels"],
      });

      expect(graph.nodes.every((n) => n.folder === "zettels")).toBe(true);
    });

    it("应该支持 glow 阈值过滤", () => {
      const graph = service.generateNetworkGraph({ glowMin: 0.5 });

      expect(graph.nodes.every((n) => n.glow >= 0.5)).toBe(true);
    });

    it("应该返回链接权重", () => {
      const graph = service.generateNetworkGraph();

      const supportsEdge = graph.edges.find((e) => e.type === "supports");
      expect(supportsEdge).toBeDefined();
      expect(supportsEdge!.weight).toBe(1.0);

      const extendsEdge = graph.edges.find((e) => e.type === "extends");
      expect(extendsEdge).toBeDefined();
      expect(extendsEdge!.weight).toBe(1.5);
    });

    it("应该返回节点度数", () => {
      const graph = service.generateNetworkGraph();

      const n1 = graph.nodes.find((n) => n.id === "n1");
      expect(n1).toBeDefined();
      expect(n1!.degree).toBeGreaterThan(0);
    });
  });
});
