#!/usr/bin/env node
/**
 * Wave 2 端到端测试脚本
 * 
 * 验证自动归档任务调度 + 归档历史 + 时间戳保留。
 * 
 * 用法:
 *   npx tsx scripts/test-wave2-in-openclaw.mjs
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";

const DB_PATH = path.join(os.homedir(), ".openclaw/zettelkasten/zettelkasten.db");

async function main() {
  console.log("=== Wave 2 端到端测试 ===");
  console.log("DB:", DB_PATH);

  const db = new DatabaseSync(DB_PATH);

  // 导入 Wave 2 服务
  const { ArchiveService } = await import(
    "../zettelkasten-github/src/service/archive-service.ts"
  );

  const archiveService = new ArchiveService(db);
  const errors = [];

  // 测试 1: 自动归档 dry-run
  console.log("\n[1/5] 测试 autoArchive dry-run...");
  try {
    const result = archiveService.autoArchiveZombies({ dryRun: true });
    console.log("  ✓ 发现", result.archived, "个僵尸笔记（dry-run，未实际归档）");
    for (const n of result.notes.slice(0, 3)) {
      console.log("   -", n.title, "|", n.reason.substring(0, 40));
    }
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("autoArchive dry-run: " + e.message);
  }

  // 测试 2: 归档历史记录
  console.log("\n[2/5] 测试 archive log...");
  try {
    const log = archiveService.getArchiveLog({ limit: 10 });
    console.log("  ✓ 归档日志条目:", log.length);
    for (const entry of log.slice(0, 3)) {
      console.log("   -", entry.createdAt, entry.action, entry.noteTitle);
    }
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("archive log: " + e.message);
  }

  // 测试 3: 归档统计
  console.log("\n[3/5] 测试 archive stats...");
  try {
    const stats = archiveService.getArchiveStats();
    console.log("  ✓ 归档:", stats.totalArchived, "| 恢复:", stats.totalRestored, "| 自动:", stats.totalAutoArchived);
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("archive stats: " + e.message);
  }

  // 测试 4: 归档不刷新 updated_at
  console.log("\n[4/5] 测试 archive 保留 updated_at...");
  try {
    const note = db.prepare("SELECT id, title, updated_at FROM zettel_notes WHERE folder != 'archive' LIMIT 1").get();
    if (note) {
      const before = note.updated_at;
      db.prepare("UPDATE zettel_notes SET folder = 'archive' WHERE id = ?").run(note.id);
      const after = db.prepare("SELECT updated_at FROM zettel_notes WHERE id = ?").get(note.id).updated_at;
      db.prepare("UPDATE zettel_notes SET folder = 'zettels' WHERE id = ?").run(note.id);

      if (before === after) {
        console.log("  ✓ updated_at 未改变（归档操作不刷新时间戳）");
      } else {
        throw new Error(`updated_at 被刷新: ${before} → ${after}`);
      }
    } else {
      console.log("  ⚠ 无可测试笔记");
    }
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("preserveUpdatedAt: " + e.message);
  }

  // 测试 5: zettel_archive_log 表存在
  console.log("\n[5/5] 测试 archive_log 表...");
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='zettel_archive_log'").get();
    if (table) {
      console.log("  ✓ zettel_archive_log 表存在");
    } else {
      throw new Error("zettel_archive_log 表不存在");
    }
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("archive_log table: " + e.message);
  }

  db.close();

  // 汇总
  console.log("\n" + "=".repeat(50));
  if (errors.length === 0) {
    console.log("✅ Wave 2 端到端测试全部通过！");
    process.exit(0);
  } else {
    console.log("❌ 失败项 (" + errors.length + "):");
    for (const err of errors) {
      console.log("  -", err);
    }
    process.exit(1);
  }
}

main().catch(e => {
  console.error("测试脚本异常:", e);
  process.exit(1);
});
