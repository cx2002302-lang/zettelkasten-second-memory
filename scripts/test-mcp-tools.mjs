#!/usr/bin/env node
/**
 * OpenClaw Agent MCP 工具端到端验证
 * 
 * 直接实例化 ZettelkastenMCPServer，调用所有 Wave 1 MCP 工具，
 * 验证 Agent 调用链路的完整性和正确性。
 * 
 * 用法:
 *   npx tsx scripts/test-mcp-tools.mjs
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";

const DB_PATH = path.join(os.homedir(), ".openclaw/zettelkasten/zettelkasten.db");
const PLUGIN_DIR = path.join(os.homedir(), ".openclaw/zettelkasten-plugin");

async function main() {
  console.log("=== OpenClaw Agent MCP 工具验证 ===");
  console.log("DB:", DB_PATH);

  const db = new DatabaseSync(DB_PATH);

  // 从插件目录导入 MCP Server
  const { ZettelkastenMCPServer } = await import(
    path.join(PLUGIN_DIR, "mcp/server.ts")
  );

  const server = new ZettelkastenMCPServer(db, PLUGIN_DIR, {
    dbPath: DB_PATH,
    notesBaseDir: PLUGIN_DIR,
    enableReadOnlyTools: true,
    enableReadWriteTools: true,
  });

  const errors = [];

  // 获取所有可用工具
  const tools = server.getTools();
  console.log("\n注册工具:", tools.map(t => t.name).join(", "));

  // 构建工具名称到 handler 的映射
  const toolMap = {};
  for (const t of tools) {
    toolMap[t.name] = t.handler;
  }

  // ===== 测试 1: zk_glow_ranking =====
  console.log("\n[1/6] zk_glow_ranking");
  try {
    const result = await toolMap["zk_glow_ranking"]({ limit: 5 });
    console.log("  ✓ 返回", result.length, "条笔记");
    if (result.length > 0) {
      console.log("   Top1:", result[0].title, "| glow:", result[0].glow.toFixed(3), "| status:", result[0].status);
    }
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("zk_glow_ranking: " + e.message);
  }

  // ===== 测试 2: zk_find_zombies =====
  console.log("\n[2/6] zk_find_zombies");
  try {
    const result = await toolMap["zk_find_zombies"]({ limit: 10 });
    console.log("  ✓ 发现", result.length, "个僵尸笔记");
    const testZombies = result.filter(z => z.title.startsWith("[TEST]"));
    console.log("  ✓ TEST 僵尸:", testZombies.length, "/ 3");
    for (const z of testZombies) {
      console.log("   -", z.title, "| glow:", z.glow.toFixed(3));
    }
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("zk_find_zombies: " + e.message);
  }

  // ===== 测试 3: zk_search_archived =====
  console.log("\n[3/6] zk_search_archived");
  try {
    // 先归档一条非僵尸的 TEST 笔记（避免更新僵尸的 updated_at）
    // 选择 updated_at 在 30 天内的笔记（确定不是僵尸）
    const testNote = db.prepare("SELECT id FROM zettel_notes WHERE title LIKE '[TEST]%' AND folder != 'archive' AND updated_at > datetime('now', '-30 days') LIMIT 1").get();
    if (testNote) {
      await server.archiveNote(testNote.id);
      console.log("  → 已归档测试笔记:", testNote.id);
    }

    const result = await toolMap["zk_search_archived"]({ query: "TEST", limit: 10 });
    console.log("  ✓ 搜索归档返回", result.length, "条笔记");

    // 恢复
    if (testNote) {
      await server.unarchiveNote(testNote.id);
      console.log("  → 已恢复测试笔记");
    }
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("zk_search_archived: " + e.message);
  }

  // ===== 测试 4: zk_find_path =====
  console.log("\n[4/6] zk_find_path");
  try {
    const testNotes = db.prepare("SELECT id FROM zettel_notes WHERE title LIKE '[TEST]%' LIMIT 5").all();
    if (testNotes.length >= 2) {
      const result = await toolMap["zk_find_path"]({
        fromNoteId: testNotes[0].id,
        toNoteId: testNotes[1].id,
        maxDepth: 6,
      });
      if (result) {
        console.log("  ✓ 路径:", result.explanation);
        console.log("   步数:", result.stepCount, "| 权重:", result.totalWeight.toFixed(2));
      } else {
        console.log("  ✓ 无直接路径（数据正常）");
      }
    } else {
      console.log("  ⚠ 测试笔记不足");
    }
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("zk_find_path: " + e.message);
  }

  // ===== 测试 5: zk_search_notes (默认排除归档) =====
  console.log("\n[5/6] zk_search_notes");
  try {
    const result = await toolMap["zk_search_notes"]({ query: "TEST", limit: 20 });
    // searchNotes 返回 SearchResult[]，每项有 note 属性
    const notes = result.map(r => r.note || r);
    const testNotes = notes.filter(n => n.title && n.title.startsWith("[TEST]"));
    console.log("  ✓ 搜索返回", result.length, "条，其中 TEST:", testNotes.length);
    // 确认没有 archive 的
    const archivedInResult = notes.filter(n => n.folder === "archive");
    if (archivedInResult.length > 0) {
      throw new Error(`搜索结果包含 ${archivedInResult.length} 条归档笔记，应被排除`);
    }
    console.log("  ✓ 归档笔记正确排除");
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("zk_search_notes: " + e.message);
  }

  // ===== 测试 6: zk_get_note + zk_get_backlinks =====
  console.log("\n[6/6] zk_get_note + zk_get_backlinks");
  try {
    const note = db.prepare("SELECT id, title FROM zettel_notes WHERE title LIKE '[TEST]%' LIMIT 1").get();
    if (note) {
      const detail = await toolMap["zk_get_note"]({ id: note.id });
      console.log("  ✓ getNote:", detail.title);

      const backlinks = await toolMap["zk_get_backlinks"]({ noteId: note.id });
      console.log("  ✓ backlinks:", backlinks.length, "条");
    } else {
      console.log("  ⚠ 无测试笔记");
    }
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("zk_get_note/backlinks: " + e.message);
  }

  db.close();

  // 汇总
  console.log("\n" + "=".repeat(50));
  if (errors.length === 0) {
    console.log("✅ MCP 工具验证全部通过！Agent 调用链路正常。");
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
  console.error("验证脚本异常:", e);
  process.exit(1);
});
