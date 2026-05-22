#!/usr/bin/env node
/**
 * 手动处理积压的 Inbox 笔记
 */

import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const DB_PATH = join(homedir(), ".openclaw", "zettelkasten", "zettelkasten.db");
const STALE_DAYS = 7; // 积压超过 7 天就自动处理

const db = new DatabaseSync(DB_PATH);

console.log("=== Inbox Stale Cleanup ===\n");

// 查询积压笔记
const staleNotes = db
  .prepare(
    `SELECT id, title, confidence, LENGTH(content) as content_length,
            julianday('now') - julianday(created_at) as age_days
     FROM zettel_notes
     WHERE reviewed = 0
     AND julianday('now') - julianday(created_at) > ?
     ORDER BY created_at ASC`
  )
  .all(STALE_DAYS);

console.log(`Found ${staleNotes.length} stale inbox notes (> ${STALE_DAYS} days)\n`);

if (staleNotes.length === 0) {
  console.log("✅ No stale notes to process.");
  db.close();
  process.exit(0);
}

// 打印待处理笔记
for (const n of staleNotes) {
  const age = Math.floor(n.age_days);
  const action = n.confidence >= 0.5 && n.content_length >= 50 ? "APPROVE" : n.confidence < 0.3 || n.content_length < 50 ? "ARCHIVE" : "FLAG";
  console.log(`[${action}] conf=${n.confidence.toFixed(2)} len=${n.content_length} age=${age}d | ${n.title?.substring(0, 50) || "[no title]"}`);
}

// 处理
let approved = 0;
let archived = 0;
let flagged = 0;

const insertReview = db.prepare(
  `INSERT INTO zettel_reviews (id, target_type, target_id, reviewer_id, action, previous_confidence, new_confidence, comment, created_at)
   VALUES (?, 'note', ?, 'auto-stale', ?, ?, ?, ?, datetime('now'))`
);

const updateNote = db.prepare(
  `UPDATE zettel_notes SET folder = ?, reviewed = 1 WHERE id = ?`
);

for (const note of staleNotes) {
  const conf = note.confidence || 0;
  const len = note.content_length || 0;
  const age = Math.floor(note.age_days);

  if (conf >= 0.5 && len >= 50) {
    // 积压但质量不错 → 自动通过
    const reviewId = `stale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    insertReview.run(reviewId, note.id, "approve", conf, conf, `Auto-approved stale inbox (age=${age}d, conf=${conf.toFixed(2)}, len=${len})`);
    updateNote.run("zettels", note.id);
    approved++;
  } else if (conf < 0.3 || len < 50) {
    // 积压且质量差 → 归档
    db.prepare(`UPDATE zettel_notes SET folder = 'archive', reviewed = 1 WHERE id = ?`).run(note.id);
    archived++;
  } else {
    // 中间地带 → flag
    const reviewId = `stale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    insertReview.run(reviewId, note.id, "flag", conf, conf, `Auto-flagged stale inbox (age=${age}d, conf=${conf.toFixed(2)}, len=${len})`);
    flagged++;
  }
}

console.log(`\n=== Result ===`);
console.log(`Approved: ${approved} | Archived: ${archived} | Flagged: ${flagged} | Total: ${staleNotes.length}`);

// 验证
const after = db.prepare("SELECT COUNT(*) as c FROM zettel_notes WHERE reviewed = 0").get();
console.log(`\nInbox remaining: ${after.c}`);

db.close();
console.log("\n✅ Done!");
