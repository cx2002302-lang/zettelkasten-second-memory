#!/usr/bin/env node
/**
 * 测试自动审核功能
 */

import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const DB_PATH = join(homedir(), ".openclaw", "zettelkasten", "zettelkasten.db");
const db = new DatabaseSync(DB_PATH);

console.log("=== Auto-Review Test ===\n");

// 1. 创建 3 个测试笔记（不同置信度/内容长度）
const testNotes = [
  { title: "高质量笔记 - 架构设计", content: "今天讨论了微服务架构设计，决定采用领域驱动设计（DDD）作为核心方法论。每个服务边界围绕业务领域划分，使用事件驱动架构进行服务间通信。关键技术栈包括：Kafka 用于事件总线，gRPC 用于同步通信，PostgreSQL 用于持久化。团队共识是先从订单服务开始试点，验证架构可行性后再推广到其他领域。", confidence: 0.95, expected: "approve" },
  { title: "中等质量笔记", content: "这是一个中等长度的笔记内容，记录了一些想法但不够详细。可能需要后续补充。", confidence: 0.6, expected: "skip" },
  { title: "低质量笔记", content: "短", confidence: 0.2, expected: "flag" },
];

const insertNote = db.prepare(`
  INSERT INTO zettel_notes (id, title, content, summary, type, status, confidence, folder, reviewed, source, file_path, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'atomic', 'PERMANENT', ?, ?, 0, 'manual', 'test.md', datetime('now'), datetime('now'))
`);

const ids = [];
for (const note of testNotes) {
  const id = `test-ar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  insertNote.run(id, note.title, note.content, note.content.slice(0, 100), note.confidence, "inbox");
  ids.push({ id, ...note });
}

console.log("Created test notes:");
for (const n of ids) {
  console.log(`  [${n.id}] conf=${n.confidence} | expected=${n.expected} | "${n.title}"`);
}

// 2. 运行自动审核（直接 SQL 模拟 ReviewService.autoReviewInbox 逻辑）
const autoReviewThreshold = 0.7;
let approved = 0, flagged = 0, skipped = 0;

const insertReview = db.prepare(`
  INSERT INTO zettel_reviews (id, target_type, target_id, reviewer_id, action, previous_confidence, new_confidence, comment, created_at)
  VALUES (?, 'note', ?, 'auto-reviewer', ?, ?, ?, ?, datetime('now'))
`);

const updateNote = db.prepare(`
  UPDATE zettel_notes SET reviewed = 1, folder = ? WHERE id = ?
`);

for (const n of ids) {
  const contentLen = n.content.length;
  let qualityScore = n.confidence;
  if (contentLen >= 200) qualityScore += 0.1;
  else if (contentLen < 50) qualityScore -= 0.3;
  qualityScore = Math.min(1.0, Math.max(0.0, qualityScore));

  if (qualityScore >= autoReviewThreshold) {
    insertReview.run(`rev-${n.id}`, n.id, "approve", n.confidence, n.confidence, `Auto-approved (quality=${qualityScore.toFixed(2)})`);
    updateNote.run("zettels", n.id);
    approved++;
    console.log(`  ✅ APPROVED: "${n.title}" (quality=${qualityScore.toFixed(2)})`);
  } else if (qualityScore < 0.4) {
    insertReview.run(`rev-${n.id}`, n.id, "flag", n.confidence, n.confidence, `Auto-flagged (quality=${qualityScore.toFixed(2)})`);
    updateNote.run("inbox", n.id);
    flagged++;
    console.log(`  🚩 FLAGGED: "${n.title}" (quality=${qualityScore.toFixed(2)})`);
  } else {
    skipped++;
    console.log(`  ⏸️  SKIPPED: "${n.title}" (quality=${qualityScore.toFixed(2)}, kept in inbox)`);
  }
}

console.log(`\n=== Results ===`);
console.log(`Approved: ${approved} | Flagged: ${flagged} | Skipped: ${skipped}`);

// 3. 清理测试笔记
db.prepare("DELETE FROM zettel_notes WHERE id LIKE 'test-ar-%'").run();
db.prepare("DELETE FROM zettel_reviews WHERE target_id LIKE 'test-ar-%'").run();
console.log("\nTest notes cleaned up.");

db.close();
