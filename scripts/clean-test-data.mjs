#!/usr/bin/env node
/**
 * 测试数据清理脚本
 * 
 * 删除所有由 seed-test-data.mjs 生成的测试笔记及其链接、统计记录。
 * 通过 title 中的 `[TEST]` 前缀精确识别。
 * 
 * 用法:
 *   npx tsx scripts/clean-test-data.mjs [--dry-run]
 * 
 * 选项:
 *   --dry-run   仅预览要删除的数据，不实际执行
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";

const DB_PATH = path.join(os.homedir(), ".openclaw/zettelkasten/zettelkasten.db");
const TEST_MARKER = "[TEST]%";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("=== 测试数据清理 ===");
  console.log("DB:", DB_PATH);
  if (dryRun) {
    console.log("模式: 预览 (--dry-run)");
  }

  const db = new DatabaseSync(DB_PATH);

  // 统计要删除的笔记
  const notesToDelete = db.prepare(
    "SELECT id, title FROM zettel_notes WHERE title LIKE ?"
  ).all(TEST_MARKER);

  console.log(`\n发现 ${notesToDelete.length} 条测试笔记:`);
  for (const n of notesToDelete) {
    console.log(`  - ${n.id}: ${n.title}`);
  }

  if (notesToDelete.length === 0) {
    console.log("\n✅ 没有测试笔记需要清理。");
    db.close();
    return;
  }

  // 统计关联链接（from 或 to 是测试笔记）
  const ids = notesToDelete.map(n => n.id);
  const placeholders = ids.map(() => "?").join(",");

  const linksFrom = db.prepare(
    `SELECT COUNT(*) as cnt FROM zettel_links WHERE from_note_id IN (${placeholders})`
  ).get(...ids);
  const linksTo = db.prepare(
    `SELECT COUNT(*) as cnt FROM zettel_links WHERE to_note_id IN (${placeholders})`
  ).get(...ids);

  console.log(`\n关联链接: ${linksFrom.cnt + linksTo.cnt} 条`);

  // 统计 stats 记录
  const statsCount = db.prepare(
    `SELECT COUNT(*) as cnt FROM zettel_note_stats WHERE note_id IN (${placeholders})`
  ).get(...ids);

  console.log(`关联统计: ${statsCount.cnt} 条`);

  if (dryRun) {
    console.log("\n[预览结束，未执行删除]");
    db.close();
    return;
  }

  // 执行删除（外键约束 CASCADE 会自动删除 links 和 stats）
  console.log("\n执行删除...");
  db.exec("BEGIN TRANSACTION");

  for (const id of ids) {
    db.prepare("DELETE FROM zettel_notes WHERE id = ?").run(id);
  }

  db.exec("COMMIT");
  db.close();

  console.log(`\n✅ 清理完成！删除了 ${notesToDelete.length} 条测试笔记及其关联数据。`);
}

main().catch(e => {
  console.error("清理失败:", e);
  process.exit(1);
});
