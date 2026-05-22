#!/usr/bin/env node
/**
 * Zettelkasten 性能基准测试
 *
 * 测试场景：
 * - 1000 / 5000 / 10000 条笔记
 * - 平均每个笔记 3 个出链
 * - 测量核心操作的耗时和内存占用
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";
import { mkdirSync, rmSync } from "node:fs";

const SRC_DIR = path.join(process.cwd(), "src");

const { ensureZettelkastenSchema } = await import(path.join(SRC_DIR, "storage/db-schema.ts"));
const { NoteService } = await import(path.join(SRC_DIR, "service/note-service.ts"));
const { LinkService } = await import(path.join(SRC_DIR, "service/link-service.ts"));
const { GlowCalculator } = await import(path.join(SRC_DIR, "engine/glow-calculator.ts"));
const { PathFinder } = await import(path.join(SRC_DIR, "engine/path-finder.ts"));
const { ArchiveService } = await import(path.join(SRC_DIR, "service/archive-service.ts"));
const { KnowledgeHeatmapService } = await import(path.join(SRC_DIR, "service/heatmap-service.ts"));

const TEST_DIR = path.join(os.tmpdir(), "zk-benchmark-" + Date.now());

// 测试规模配置
const SCALES = [1000, 5000, 10000];

// 生成随机笔记数据
function generateNoteData(index) {
  const topics = [
    "分布式系统", "数据库", "算法", "机器学习", "操作系统", "网络安全",
    "编程语言", "软件架构", "DevOps", "云计算", "区块链", "前端开发",
    "后端开发", "微服务", "容器化", "性能优化", "测试驱动", "持续集成",
    "设计模式", "数据结构", "编译原理", "图形学", "自然语言处理", "计算机视觉",
  ];
  const topic = topics[index % topics.length];
  const id = `note-${String(index).padStart(8, "0")}`;
  const title = `${topic}笔记-${index}`;
  const content = `这是关于${topic}的笔记内容。\n\n` +
    `第${index}条笔记，包含一些技术细节和概念解释。\n` +
    `关键词：${topic}、性能、优化、架构。\n\n` +
    `详细说明：在实际应用中，${topic}需要考虑多个维度的因素。\n` +
    `1. 可扩展性\n2. 可靠性\n3. 安全性\n4. 可维护性\n`;
  const folder = ["inbox", "references", "zettels"][index % 3];
  const confidence = 0.3 + (index % 7) * 0.1;
  const now = new Date(Date.now() - (index % 365) * 86400000).toISOString();
  return { id, title, content, folder, confidence, createdAt: now, updatedAt: now };
}

function generateLinkData(noteCount) {
  const links = [];
  const types = ["supports", "extends", "related", "refines", "contradicts"];
  const maxLinksPerNote = 5;

  for (let i = 0; i < noteCount; i++) {
    const linkCount = 1 + (i % maxLinksPerNote);
    for (let j = 0; j < linkCount; j++) {
      const target = (i + 1 + j * 7) % noteCount;
      if (target !== i) {
        links.push({
          from: `note-${String(i).padStart(8, "0")}`,
          to: `note-${String(target).padStart(8, "0")}`,
          type: types[j % types.length],
        });
      }
    }
  }
  return links;
}

function time(label, fn) {
  const start = performance.now();
  const memBefore = process.memoryUsage().heapUsed;
  const result = fn();
  const duration = performance.now() - start;
  const memAfter = process.memoryUsage().heapUsed;
  const memDelta = (memAfter - memBefore) / 1024 / 1024;
  return { result, duration, memDelta };
}

async function timeAsync(label, fn) {
  const start = performance.now();
  const memBefore = process.memoryUsage().heapUsed;
  const result = await fn();
  const duration = performance.now() - start;
  const memAfter = process.memoryUsage().heapUsed;
  const memDelta = (memAfter - memBefore) / 1024 / 1024;
  return { result, duration, memDelta };
}

async function runBenchmark(noteCount) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`📊 Benchmark: ${noteCount.toLocaleString()} notes`);
  console.log("=".repeat(70));

  mkdirSync(TEST_DIR, { recursive: true });
  const db = new DatabaseSync(":memory:");
  ensureZettelkastenSchema({ db, ftsEnabled: true });

  // 1. 批量插入笔记
  const insertNoteStmt = db.prepare(
    `INSERT INTO zettel_notes (id, title, content, summary, type, status, folder, confidence, source, reviewed, file_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const noteInsert = time("Insert notes", () => {
    db.exec("BEGIN TRANSACTION");
    for (let i = 0; i < noteCount; i++) {
      const n = generateNoteData(i);
      insertNoteStmt.run(
        n.id, n.title, n.content, n.title, "atomic", "PERMANENT", n.folder,
        n.confidence, "manual", 0, `${TEST_DIR}/${n.id}.md`, n.createdAt, n.updatedAt
      );
    }
    db.exec("COMMIT");
  });
  console.log(`  📝 Insert ${noteCount} notes: ${noteInsert.duration.toFixed(1)}ms (${(noteCount / noteInsert.duration * 1000).toFixed(0)} notes/sec)`);

  // 2. 批量插入链接
  const links = generateLinkData(noteCount);
  const insertLinkStmt = db.prepare(
    `INSERT INTO zettel_links (from_note_id, to_note_id, type, created_at) VALUES (?, ?, ?, ?)`
  );

  const linkInsert = time("Insert links", () => {
    db.exec("BEGIN TRANSACTION");
    const now = new Date().toISOString();
    for (const link of links) {
      insertLinkStmt.run(link.from, link.to, link.type, now);
    }
    db.exec("COMMIT");
  });
  console.log(`  🔗 Insert ${links.length} links: ${linkInsert.duration.toFixed(1)}ms`);

  // 3. 预填充 stats（避免 recalculateAll 首次运行时计算）
  const insertStatStmt = db.prepare(
    `INSERT INTO zettel_note_stats (note_id, glow_score, glow_status, backlink_count, outgoing_link_count, pagerank_score, days_since_created, days_since_updated, last_calculated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const statInsert = time("Insert stats", () => {
    db.exec("BEGIN TRANSACTION");
    for (let i = 0; i < noteCount; i++) {
      const id = `note-${String(i).padStart(8, "0")}`;
      const glow = 0.1 + Math.random() * 0.8;
      const status = glow > 0.7 ? "active" : glow > 0.4 ? "stable" : "zombie";
      const backlinks = Math.floor(Math.random() * 5);
      const outlinks = 1 + (i % 5);
      const pagerank = Math.random() * 2;
      insertStatStmt.run(id, glow, status, backlinks, outlinks, pagerank, i % 365, i % 180, new Date().toISOString());
    }
    db.exec("COMMIT");
  });
  console.log(`  📈 Insert ${noteCount} stats: ${statInsert.duration.toFixed(1)}ms`);

  // 初始化服务
  const noteService = new NoteService(db, TEST_DIR);
  const linkService = new LinkService(db);
  const glowCalc = new GlowCalculator(db);
  const pathFinder = new PathFinder(db);
  const archiveService = new ArchiveService(db);
  const heatmapService = new KnowledgeHeatmapService(db);

  console.log(`\n  🔍 Query Benchmarks:`);

  // 4. FTS 搜索
  const search1 = await timeAsync("Search (1 result)", () => noteService.searchNotes("分布式系统笔记-0", 20));
  console.log(`    Search single: ${search1.duration.toFixed(2)}ms (${search1.result.length} results)`);

  const search2 = await timeAsync("Search (broad)", () => noteService.searchNotes("系统", 50));
  console.log(`    Search broad:  ${search2.duration.toFixed(2)}ms (${search2.result.length} results)`);

  // 5. 单条读取
  const getNote = await timeAsync("Get note", () => noteService.getNote("note-00000000"));
  console.log(`    Get note:      ${getNote.duration.toFixed(2)}ms`);

  // 6. 反向链接
  const backlinks = time("Get backlinks", () => linkService.getLinksTo("note-00000001"));
  console.log(`    Backlinks:     ${backlinks.duration.toFixed(2)}ms (${backlinks.result.length} links)`);

  // 7. 发光度重计算
  const recalc = time("Recalculate glow", () => glowCalc.recalculateAll());
  console.log(`    Recalculate:   ${recalc.duration.toFixed(1)}ms (${recalc.result.length} notes)`);

  // 8. 排行查询
  const ranking = time("Glow ranking", () => glowCalc.getRanking({ limit: 20 }));
  console.log(`    Ranking:       ${ranking.duration.toFixed(2)}ms (${ranking.result.length} results)`);

  // 9. 僵尸检测
  const zombies = time("Find zombies", () => glowCalc.findZombies(50));
  console.log(`    Zombies:       ${zombies.duration.toFixed(2)}ms (${zombies.result.length} found)`);

  // 10. 最短路径
  const pathResult = time("Find path", () => pathFinder.findPath("note-00000000", `note-${String(noteCount - 1).padStart(8, "0")}`));
  console.log(`    Path find:     ${pathResult.duration.toFixed(2)}ms (${pathResult.result ? pathResult.result.path.length + " hops" : "no path"})`);

  // 11. 热力图
  const heatmap = time("Heatmap", () => heatmapService.generateHeatmap(30));
  console.log(`    Heatmap:       ${heatmap.duration.toFixed(2)}ms (${heatmap.result.summary.totalNotes} notes, ${heatmap.result.summary.totalLinks} links)`);

  // 12. 知识图谱
  const graph = time("Network graph", () => heatmapService.generateNetworkGraph({ limit: 100, glowMin: 0 }));
  console.log(`    Network graph: ${graph.duration.toFixed(2)}ms (${graph.result.meta.nodeCount} nodes, ${graph.result.meta.edgeCount} edges)`);

  // 13. 自动归档（dryRun）
  const autoArchive = time("Auto-archive", () => archiveService.autoArchiveZombies({ dryRun: true }));
  console.log(`    Auto-archive:  ${autoArchive.duration.toFixed(2)}ms (${autoArchive.result.archived} candidates)`);

  db.close();

  return {
    noteCount,
    linkCount: links.length,
    timings: {
      insertNotes: noteInsert.duration,
      insertLinks: linkInsert.duration,
      insertStats: statInsert.duration,
      searchSingle: search1.duration,
      searchBroad: search2.duration,
      getNote: getNote.duration,
      backlinks: backlinks.duration,
      recalculateGlow: recalc.duration,
      glowRanking: ranking.duration,
      findZombies: zombies.duration,
      findPath: pathResult.duration,
      heatmap: heatmap.duration,
      networkGraph: graph.duration,
      autoArchive: autoArchive.duration,
    },
  };
}

async function main() {
  console.log("========================================");
  console.log("Zettelkasten Performance Benchmark");
  console.log(`Node: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log("========================================");

  const results = [];
  for (const scale of SCALES) {
    const result = await runBenchmark(scale);
    results.push(result);
  }

  // 汇总报告
  console.log(`\n${"=".repeat(70)}`);
  console.log("📋 Summary Report");
  console.log("=".repeat(70));

  console.log(`\n${"Scale".padEnd(10)} ${"Notes".padStart(8)} ${"Links".padStart(10)} ${"Recalc".padStart(10)} ${"Search".padStart(10)} ${"Graph".padStart(10)}`);
  console.log("-".repeat(60));
  for (const r of results) {
    console.log(
      `${(r.noteCount >= 1000 ? (r.noteCount / 1000) + "K" : r.noteCount).padEnd(10)}` +
      `${r.noteCount.toLocaleString().padStart(8)}` +
      `${r.linkCount.toLocaleString().padStart(10)}` +
      `${r.timings.recalculateGlow.toFixed(1).padStart(9)}ms` +
      `${r.timings.searchBroad.toFixed(1).padStart(9)}ms` +
      `${r.timings.networkGraph.toFixed(1).padStart(9)}ms`
    );
  }

  // 性能阈值判断
  console.log(`\n🎯 Performance Thresholds:`);
  const last = results[results.length - 1];
  const checks = [
    { name: "Search < 100ms", pass: last.timings.searchBroad < 100 },
    { name: "Get note < 10ms", pass: last.timings.getNote < 10 },
    { name: "Glow recalc < 5000ms", pass: last.timings.recalculateGlow < 5000 },
    { name: "Ranking < 50ms", pass: last.timings.glowRanking < 50 },
    { name: "Heatmap < 200ms", pass: last.timings.heatmap < 200 },
    { name: "Network graph < 500ms", pass: last.timings.networkGraph < 500 },
    { name: "Path find < 500ms", pass: last.timings.findPath < 500 },
  ];
  for (const c of checks) {
    console.log(`  ${c.pass ? "✅" : "⚠️"} ${c.name}`);
  }

  // 清理
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}

  const allPass = checks.every((c) => c.pass);
  console.log(`\n${allPass ? "✅ All thresholds passed" : "⚠️ Some thresholds exceeded"}`);
  process.exit(allPass ? 0 : 0); // 非致命，仅报告
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
