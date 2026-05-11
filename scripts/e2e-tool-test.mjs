#!/usr/bin/env node
/**
 * Zettelkasten MCP 工具端到端测试
 * 直接调用插件工具函数，模拟 Agent 的完整工作流
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";
import { existsSync, mkdirSync, rmSync } from "node:fs";

// 使用当前项目源码
const SRC_DIR = path.join(process.cwd(), "src");

// 动态 import（ESM）
const { ensureZettelkastenSchema } = await import(path.join(SRC_DIR, "storage/db-schema.ts"));
const { NoteService } = await import(path.join(SRC_DIR, "service/note-service.ts"));
const { LinkService } = await import(path.join(SRC_DIR, "service/link-service.ts"));
const { GlowCalculator } = await import(path.join(SRC_DIR, "engine/glow-calculator.ts"));
const { PathFinder } = await import(path.join(SRC_DIR, "engine/path-finder.ts"));
const { ArchiveService } = await import(path.join(SRC_DIR, "service/archive-service.ts"));
const { KnowledgeHeatmapService } = await import(path.join(SRC_DIR, "service/heatmap-service.ts"));
const { ReviewService } = await import(path.join(SRC_DIR, "service/review-service.ts"));
const { FeedbackService } = await import(path.join(SRC_DIR, "service/feedback-service.ts"));

const TEST_DB = ":memory:";
const TEST_DIR = path.join(os.tmpdir(), "zk-e2e-test-" + Date.now());

let passed = 0;
let failed = 0;

function log(title, icon = "🔧") {
  console.log(`\n${icon} ${title}`);
  console.log("─".repeat(60));
}

function ok(msg) {
  console.log(`  ✅ ${msg}`);
  passed++;
}

function err(msg, error) {
  console.log(`  ❌ ${msg}: ${error?.message || error}`);
  failed++;
}

async function main() {
  console.log("========================================");
  console.log("Zettelkasten E2E Tool Chain Test");
  console.log(`Source: ${SRC_DIR}`);
  console.log("========================================");

  // 初始化
  mkdirSync(TEST_DIR, { recursive: true });
  const db = new DatabaseSync(TEST_DB);
  ensureZettelkastenSchema({ db, ftsEnabled: false });

  const noteService = new NoteService(db, TEST_DIR, {
    highConfidenceThreshold: 0.7,
    mediumConfidenceThreshold: 0.4,
  });
  const linkService = new LinkService(db);
  const glowCalc = new GlowCalculator(db);
  const pathFinder = new PathFinder(db);
  const archiveService = new ArchiveService(db);
  const heatmapService = new KnowledgeHeatmapService(db);
  const reviewService = new ReviewService(db);
  const feedbackService = new FeedbackService(db);

  // ============================================================
  // 1. 创建笔记 (zk_create_note)
  // ============================================================
  log("1. Create Notes", "📝");
  let n1, n2, n3, n4;
  try {
    n1 = await noteService.createNote(
      { title: "分布式系统基础", content: "CAP 定理指出：一致性、可用性、分区容错性不可同时满足。" },
      { confidence: 0.85, source: "manual" }
    );
    ok(`Created note: ${n1.id} -> ${n1.folder} (confidence=${n1.confidence})`);

    n2 = await noteService.createNote(
      { title: "Raft 共识算法", content: "Raft 通过领导者选举和日志复制实现一致性。" },
      { confidence: 0.9, source: "manual" }
    );
    ok(`Created note: ${n2.id} -> ${n2.folder}`);

    n3 = await noteService.createNote(
      { title: "临时想法", content: "也许可以用 CRDT 解决冲突？" },
      { confidence: 0.3, source: "manual" }
    );
    ok(`Created note: ${n3.id} -> ${n3.folder} (low confidence -> inbox)`);

    n4 = await noteService.createNote(
      { title: "Zettelkasten 方法", content: "卡片盒笔记法的核心原则是原子化和双向链接。" },
      { confidence: 0.8, source: "manual" }
    );
    ok(`Created note: ${n4.id} -> ${n4.folder}`);
  } catch (e) {
    err("Create notes", e);
  }

  // ============================================================
  // 2. 输入校验测试
  // ============================================================
  log("2. Input Validation", "🛡️");
  try {
    await noteService.createNote({ title: "", content: "test" });
    err("Empty title should be rejected", new Error("No error thrown"));
  } catch (e) {
    ok("Empty title rejected: " + e.message);
  }

  try {
    await noteService.createNote({ title: "test", content: "" });
    err("Empty content should be rejected", new Error("No error thrown"));
  } catch (e) {
    ok("Empty content rejected: " + e.message);
  }

  try {
    linkService.createLink(n1.id, n1.id, "related");
    err("Self-link should be rejected", new Error("No error thrown"));
  } catch (e) {
    ok("Self-link rejected: " + e.message);
  }

  try {
    linkService.createLink(n1.id, n2.id, "invalid_type");
    err("Invalid link type should be rejected", new Error("No error thrown"));
  } catch (e) {
    ok("Invalid link type rejected: " + e.message);
  }

  // ============================================================
  // 3. 创建链接 (zk_create_link)
  // ============================================================
  log("3. Create Links", "🔗");
  try {
    linkService.createLink(n1.id, n2.id, "supports", { context: "Raft 是分布式一致性的具体实现" });
    ok(`Link: ${n1.id} --supports--> ${n2.id}`);

    linkService.createLink(n2.id, n4.id, "related", { context: "笔记方法也适用于算法学习" });
    ok(`Link: ${n2.id} --related--> ${n4.id}`);

    linkService.createLink(n1.id, n4.id, "extends", { context: "Zettelkasten 可以延伸到系统设计" });
    ok(`Link: ${n1.id} --extends--> ${n4.id}`);
  } catch (e) {
    err("Create links", e);
  }

  // ============================================================
  // 4. 搜索笔记 (zk_search_notes)
  // ============================================================
  log("4. Search Notes", "🔍");
  try {
    const results = await noteService.searchNotes("一致性", 10);
    if (results.length >= 2) {
      ok(`Search '一致性': ${results.length} results`);
    } else {
      err("Search returned too few results", new Error(`Got ${results.length}`));
    }
  } catch (e) {
    err("Search notes", e);
  }

  // ============================================================
  // 5. 获取单条笔记 (zk_get_note)
  // ============================================================
  log("5. Get Note", "📄");
  try {
    const note = await noteService.getNote(n1.id);
    if (note && note.title === "分布式系统基础") {
      ok(`Get note: ${note.id} | ${note.title} | links=${note.links.length}`);
    } else {
      err("Get note returned wrong data", new Error("Mismatched"));
    }
  } catch (e) {
    err("Get note", e);
  }

  // ============================================================
  // 6. 获取反向链接 (zk_get_backlinks)
  // ============================================================
  log("6. Get Backlinks", "↩️");
  try {
    const backlinks = linkService.getLinksTo(n2.id);
    if (backlinks.length >= 1) {
      ok(`Backlinks to ${n2.id}: ${backlinks.length}`);
    } else {
      err("No backlinks found", new Error("Expected >= 1"));
    }
  } catch (e) {
    err("Get backlinks", e);
  }

  // ============================================================
  // 7. 发光度排行 (zk_glow_ranking)
  // ============================================================
  log("7. Glow Ranking", "✨");
  try {
    glowCalc.recalculateAll();
    const ranking = glowCalc.getRanking({ limit: 10 });
    if (ranking.length > 0) {
      ok(`Glow ranking: ${ranking.length} notes, top=${ranking[0].title} (glow=${ranking[0].glow.toFixed(3)})`);
    } else {
      err("Glow ranking empty", new Error("Expected > 0"));
    }
  } catch (e) {
    err("Glow ranking", e);
  }

  // ============================================================
  // 8. 查找僵尸笔记 (zk_find_zombies)
  // ============================================================
  log("8. Find Zombies", "🧟");
  try {
    const zombies = glowCalc.findZombies(10);
    ok(`Zombies found: ${zombies.length}`);
  } catch (e) {
    err("Find zombies", e);
  }

  // ============================================================
  // 9. 查找路径 (zk_find_path)
  // ============================================================
  log("9. Find Path", "🛤️");
  try {
    const result = pathFinder.findPath(n1.id, n4.id);
    if (result && result.path.length > 0) {
      ok(`Path ${n1.id} -> ${n4.id}: ${result.path.length} hops, weight=${result.totalWeight.toFixed(2)}`);
    } else {
      err("No path found", new Error("Expected path"));
    }
  } catch (e) {
    err("Find path", e);
  }

  // ============================================================
  // 10. 知识热力图 (zk_knowledge_heatmap)
  // ============================================================
  log("10. Knowledge Heatmap", "🔥");
  try {
    const heatmap = heatmapService.generateHeatmap(30);
    ok(`Heatmap: ${heatmap.summary.totalNotes} notes, ${heatmap.summary.totalLinks} links, avgGlow=${heatmap.summary.avgGlow.toFixed(3)}`);
  } catch (e) {
    err("Knowledge heatmap", e);
  }

  // ============================================================
  // 11. 知识图谱 (zk_network_graph)
  // ============================================================
  log("11. Network Graph", "🕸️");
  try {
    const graph = heatmapService.generateNetworkGraph({ limit: 10, glowMin: 0 });
    ok(`Network graph: ${graph.meta.nodeCount} nodes, ${graph.meta.edgeCount} edges, avgDegree=${graph.meta.avgDegree.toFixed(2)}`);
  } catch (e) {
    err("Network graph", e);
  }

  // ============================================================
  // 12. 审核笔记 (zk_review_note)
  // ============================================================
  log("12. Review Note", "✅");
  try {
    const reviewed = await noteService.reviewNote(n3.id, "approve");
    if (reviewed && reviewed.reviewed) {
      ok(`Reviewed ${n3.id}: approved, folder=${reviewed.folder}`);
    } else {
      err("Review failed", new Error("Note not reviewed"));
    }
  } catch (e) {
    err("Review note", e);
  }

  // ============================================================
  // 13. 反馈闭环 (zk_submit_feedback)
  // ============================================================
  log("13. Feedback Loop", "💬");
  try {
    const fb = feedbackService.submitFeedback({
      targetType: "note",
      targetId: n1.id,
      feedbackType: "thumbs_up",
      source: "user",
      rating: 0.9,
    });
    ok(`Feedback submitted: ${fb.id}`);

    const stats = feedbackService.getStats();
    ok(`Feedback stats: total=${stats.totalFeedback}, thumbsUp=${stats.thumbsUpCount}`);
  } catch (e) {
    err("Feedback loop", e);
  }

  // ============================================================
  // 14. 归档/恢复 (zk_archive_note / zk_unarchive_note)
  // ============================================================
  log("14. Archive / Unarchive", "📦");
  try {
    const archived = await noteService.archiveNote(n4.id);
    if (archived && archived.folder === "archive") {
      ok(`Archived ${n4.id}: folder=${archived.folder}`);
    } else {
      err("Archive failed", new Error("Folder not changed"));
    }

    // archiveNote 通过 updateNote 实现，不记录 archive_log（只有 autoArchiveZombies 和 logAction 才记录）
    // 这里验证 getArchiveLog 接口正常即可
    const log1 = archiveService.getArchiveLog({ limit: 5 });
    ok(`Archive log query OK: ${log1.length} total entries`);

    const unarchived = await noteService.unarchiveNote(n4.id);
    if (unarchived && unarchived.folder === "zettels") {
      ok(`Unarchived ${n4.id}: folder=${unarchived.folder}`);
    } else {
      err("Unarchive failed", new Error("Folder not changed"));
    }
  } catch (e) {
    err("Archive/unarchive", e);
  }

  // ============================================================
  // 15. 更新笔记 (zk_update_note)
  // ============================================================
  log("15. Update Note", "✏️");
  try {
    const updated = await noteService.updateNote(n1.id, {
      title: "分布式系统基础（修订版）",
      confidence: 0.95,
    });
    if (updated && updated.title.includes("修订版") && updated.confidence === 0.95) {
      ok(`Updated ${n1.id}: title="${updated.title}", confidence=${updated.confidence}`);
    } else {
      err("Update failed", new Error("Data mismatch"));
    }
  } catch (e) {
    err("Update note", e);
  }

  // ============================================================
  // 16. 自动归档僵尸笔记
  // ============================================================
  log("16. Auto Archive Zombies", "🤖");
  try {
    // 插入一个僵尸笔记（updated_at 200天前）
    const zombieId = `zombie-${Date.now()}`;
    db.prepare(
      `INSERT INTO zettel_notes (id, title, content, summary, type, status, folder, confidence, source, reviewed, file_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      zombieId, "僵尸笔记", "内容", "摘要", "atomic", "PERMANENT", "zettels",
      0.5, "manual", 1, `${TEST_DIR}/${zombieId}.md`,
      new Date(Date.now() - 200 * 86400000).toISOString(),
      new Date(Date.now() - 200 * 86400000).toISOString()
    );

    const result = archiveService.autoArchiveZombies();
    ok(`Auto archive: ${result.archived} zombies archived`);

    const row = db.prepare("SELECT folder FROM zettel_notes WHERE id = ?").get(zombieId);
    if (row && row.folder === "archive") {
      ok(`Zombie ${zombieId} correctly moved to archive`);
    }
  } catch (e) {
    err("Auto archive zombies", e);
  }

  // ============================================================
  // 清理
  // ============================================================
  db.close();
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}

  // ============================================================
  // 报告
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log(`  E2E Test Complete`);
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log("=".repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
