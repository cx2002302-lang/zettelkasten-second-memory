#!/usr/bin/env node
/**
 * 清理空内容/占位符笔记
 *
 * 检测标准：
 * - content 长度 < 50 字符
 * - 标题匹配 placeholder 模式（如 "Memory entry X"）
 * - content 和 title 相同
 *
 * 处理方式：
 * - 默认 dry-run，只打印会清理的笔记
 * - 加 --confirm 参数才实际删除
 */

import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const DB_PATH = join(homedir(), ".openclaw", "zettelkasten", "zettelkasten.db");
const DRY_RUN = !process.argv.includes("--confirm");

const PLACEHOLDER_PATTERNS = [
  /^Memory entry\s+\d+/i,
  /^Entry\s+\d+/i,
  /^Note\s+\d+/i,
  /^Untitled/i,
  /^No title/i,
  /^\d+$/,
  /^Item\s+\d+/i,
  /^Log entry/i,
  /^Record \d+/i,
];

function isPlaceholder(title, content, source) {
  const t = (title || "").trim();
  const c = (content || "").trim();

  // 最高优先级：标题匹配 placeholder 模式（如 "Memory entry X"）
  // 这类笔记无论内容长度如何都是无意义的
  for (const p of PLACEHOLDER_PATTERNS) {
    if (p.test(t)) return true;
  }

  // 第二优先级：内容只是元数据描述（scene7 导入的典型问题）
  const metaPatterns = [
    /^Memory entry \d+ regarding/i,
    /^This is a memory entry/i,
    /^Conversation from .+ to/i,
    /^> 来源：/m,  // scene7 元数据格式
  ];
  for (const p of metaPatterns) {
    if (p.test(c)) return true;
  }

  // 第三优先级：内容太短（<50 字符）且来源是 distilled
  // 手动创建的短笔记可能是有意的（如测试、标签）
  if (c.length < 50 && source === "distilled") return true;

  // 标题和内容完全相同（LLM 偷懒）
  if (t === c && c.length < 100) return true;

  return false;
}

async function main() {
  console.log(`Database: ${DB_PATH}`);
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (add --confirm to actually delete)" : "DELETE"}`);
  console.log("");

  const db = new DatabaseSync(DB_PATH);

  // 查询所有笔记
  const notes = db
    .prepare("SELECT id, title, content, confidence, source, folder, created_at FROM zettel_notes")
    .all();

  const toDelete = [];
  const toReview = [];

  for (const n of notes) {
    if (isPlaceholder(n.title, n.content)) {
      toDelete.push(n);
    }
  }

  console.log(`Total notes: ${notes.length}`);
  console.log(`Empty/placeholder notes to clean: ${toDelete.length}`);
  console.log("");

  if (toDelete.length === 0) {
    console.log("✅ No empty notes found. Database is clean.");
    db.close();
    return;
  }

  // 打印前 20 条
  for (const n of toDelete.slice(0, 20)) {
    const preview = n.content
      ? n.content.substring(0, 60).replace(/\n/g, " ")
      : "[EMPTY]";
    console.log(`  [${n.id}] ${n.title?.substring(0, 40) || "[no title]"} | len=${n.content?.length || 0} | src=${n.source} | folder=${n.folder}`);
    console.log(`    → ${preview}`);
  }
  if (toDelete.length > 20) {
    console.log(`  ... and ${toDelete.length - 20} more`);
  }

  console.log("");

  if (DRY_RUN) {
    console.log("⚠️  DRY-RUN mode. No changes made.");
    console.log(`   Run with --confirm to delete ${toDelete.length} notes.`);
    db.close();
    return;
  }

  // 实际删除
  let deleted = 0;
  const deleteStmt = db.prepare("DELETE FROM zettel_notes WHERE id = ?");
  const deleteLinks = db.prepare("DELETE FROM zettel_links WHERE from_note_id = ? OR to_note_id = ?");
  const deleteTags = db.prepare("DELETE FROM zettel_note_tags WHERE note_id = ?");
  const deleteFeedback = db.prepare("DELETE FROM zettel_feedback WHERE target_id = ? AND target_type = 'note'");

  for (const n of toDelete) {
    try {
      deleteLinks.run(n.id, n.id);
      deleteTags.run(n.id);
      deleteFeedback.run(n.id);
      deleteStmt.run(n.id);
      deleted++;
    } catch (e) {
      console.error(`  Failed to delete ${n.id}: ${e.message}`);
    }
  }

  console.log(`✅ Deleted ${deleted}/${toDelete.length} empty/placeholder notes.`);
  db.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
