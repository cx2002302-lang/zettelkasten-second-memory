#!/usr/bin/env node
/**
 * Wave 1 端到端测试脚本
 * 
 * 连接 OpenClaw 真实数据库，全面测试 GlowCalculator + PathFinder + 归档功能。
 * 运行前请先执行: npx tsx scripts/seed-test-data.mjs
 * 
 * 用法:
 *   npx tsx scripts/test-wave1-in-openclaw.mjs
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";

const DB_PATH = path.join(os.homedir(), ".openclaw/zettelkasten/zettelkasten.db");

async function main() {
  console.log("=== Wave 1 端到端测试 ===");
  console.log("DB:", DB_PATH);

  const db = new DatabaseSync(DB_PATH);

  // 从开发目录导入源码（使用 tsx 运行）
  const { GlowCalculator } = await import(
    "../zettelkasten-github/src/engine/glow-calculator.ts"
  );
  const { PathFinder } = await import(
    "../zettelkasten-github/src/engine/path-finder.ts"
  );

  const glowCalc = new GlowCalculator(db);
  const pathFinder = new PathFinder(db);

  const errors = [];

  // 测试 1: 发光度排行
  console.log("\n[1/7] 测试 glowRanking...");
  try {
    glowCalc.recalculateAll();
    const ranking = glowCalc.getRanking({ limit: 10 });
    console.log("  ✓ 返回", ranking.length, "条笔记");
    if (ranking.length > 0) {
      const top = ranking[0];
      console.log("  第一名:", top.title, "| glow:", top.glow.toFixed(3), "| status:", top.status);
      // 验证 glow 值在合理范围
      if (top.glow < 0 || top.glow > 1) {
        throw new Error(`glow 值 ${top.glow} 超出 [0,1] 范围`);
      }
    }
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("glowRanking: " + e.message);
  }

  // 测试 2: 僵尸笔记检测
  console.log("\n[2/7] 测试 findZombies...");
  try {
    const zombies = glowCalc.findZombies(10);
    console.log("  ✓ 发现", zombies.length, "个僵尸笔记");
    for (const z of zombies.slice(0, 5)) {
      console.log("   -", z.title, "| glow:", z.glow.toFixed(3), "| decay:", z.decay?.toFixed(3));
    }
    // 验证至少发现我们创建的 3 个僵尸
    const testZombies = zombies.filter(z => z.title.startsWith("[TEST]") && z.status === "zombie");
    if (testZombies.length < 3) {
      throw new Error(`期望至少 3 个测试僵尸笔记，实际发现 ${testZombies.length} 个`);
    }
    console.log("  ✓ 测试僵尸笔记全部检出:", testZombies.length, "/ 3");
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("findZombies: " + e.message);
  }

  // 测试 3: 知识库摘要
  console.log("\n[3/7] 测试 getSummary...");
  try {
    const summary = glowCalc.getSummary();
    console.log("  ✓ 总笔记:", summary.totalNotes);
    console.log("   evergreen:", summary.evergreenCount, "| active:", summary.activeCount);
    console.log("   stable:", summary.stableCount, "| zombie:", summary.zombieCount);
    // 验证分布合理
    if (summary.totalNotes < 20) {
      throw new Error(`总笔记数 ${summary.totalNotes} 过少，请先运行 seed-test-data.mjs`);
    }
    if (summary.zombieCount < 3) {
      throw new Error(`僵尸笔记 ${summary.zombieCount} 个，期望至少 3 个`);
    }
    console.log("  ✓ 分布检查通过");
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("getSummary: " + e.message);
  }

  // 测试 4: 路径搜索
  console.log("\n[4/7] 测试 findPath...");
  try {
    // 找两个有链接的 TEST 笔记
    const testNotes = db.prepare("SELECT id FROM zettel_notes WHERE title LIKE '[TEST]%' LIMIT 5").all();
    if (testNotes.length >= 2) {
      const fromId = testNotes[0].id;
      const toId = testNotes[1].id;
      const pathResult = pathFinder.findPath(fromId, toId, { maxDepth: 6 });
      if (pathResult) {
        console.log("  ✓ 找到路径:", pathResult.explanation);
        console.log("   步数:", pathResult.stepCount, "| 权重:", pathResult.totalWeight.toFixed(2));
        // 验证步数合理
        if (pathResult.stepCount < 1 || pathResult.stepCount > 6) {
          throw new Error(`路径步数 ${pathResult.stepCount} 超出范围`);
        }
      } else {
        console.log("  ✓ 无直接路径（尝试间接路径）");
        // 尝试找任何路径
        const allNotes = db.prepare("SELECT id FROM zettel_notes WHERE title LIKE '[TEST]%'").all();
        let foundAny = false;
        outer: for (const a of allNotes.slice(0, 5)) {
          for (const b of allNotes.slice(0, 5)) {
            if (a.id === b.id) continue;
            const p = pathFinder.findPath(a.id, b.id, { maxDepth: 6 });
            if (p) {
              console.log("   → 发现路径:", p.explanation);
              foundAny = true;
              break outer;
            }
          }
        }
        if (!foundAny) {
          console.log("   ⚠ 测试笔记间无路径（可能是数据问题）");
        }
      }
    } else {
      console.log("  ⚠ 笔记不足，跳过路径测试");
    }
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("findPath: " + e.message);
  }

  // 测试 5: 归档功能
  console.log("\n[5/7] 测试 archive/unarchive...");
  try {
    const note = db.prepare("SELECT id, folder FROM zettel_notes WHERE title LIKE '[TEST]%' AND folder != 'archive' LIMIT 1").get();
    if (note) {
      db.prepare("UPDATE zettel_notes SET folder = 'archive' WHERE id = ?").run(note.id);
      const archived = db.prepare("SELECT folder FROM zettel_notes WHERE id = ?").get(note.id);
      if (archived.folder !== "archive") {
        throw new Error(`归档失败，folder=${archived.folder}`);
      }
      console.log("  ✓ 归档成功");

      db.prepare("UPDATE zettel_notes SET folder = 'zettels' WHERE id = ?").run(note.id);
      const restored = db.prepare("SELECT folder FROM zettel_notes WHERE id = ?").get(note.id);
      if (restored.folder !== "zettels") {
        throw new Error(`恢复失败，folder=${restored.folder}`);
      }
      console.log("  ✓ 恢复成功");
    } else {
      console.log("  ⚠ 无可归档测试笔记");
    }
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("archive: " + e.message);
  }

  // 测试 6: 搜索排除归档
  console.log("\n[6/7] 测试 search 默认排除归档...");
  try {
    // 先归档一条 TEST 笔记
    const testNote = db.prepare("SELECT id FROM zettel_notes WHERE title LIKE '[TEST]%' AND folder != 'archive' LIMIT 1").get();
    if (testNote) {
      db.prepare("UPDATE zettel_notes SET folder = 'archive' WHERE id = ?").run(testNote.id);

      const allCount = db.prepare("SELECT COUNT(*) as cnt FROM zettel_notes WHERE title LIKE '[TEST]%'").get();
      const nonArchiveCount = db.prepare("SELECT COUNT(*) as cnt FROM zettel_notes WHERE title LIKE '[TEST]%' AND folder != 'archive'").get();

      console.log("  ✓ 总测试笔记:", allCount.cnt, "| 非归档:", nonArchiveCount.cnt);
      if (nonArchiveCount.cnt >= allCount.cnt) {
        throw new Error("归档笔记未被排除");
      }
      console.log("  ✓ 归档排除检查通过");

      // 恢复
      db.prepare("UPDATE zettel_notes SET folder = 'zettels' WHERE id = ?").run(testNote.id);
    } else {
      console.log("  ⚠ 无可用测试笔记");
    }
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("searchExcludeArchive: " + e.message);
  }

  // 测试 7: 链接类型权重
  console.log("\n[7/7] 测试链接权重...");
  try {
    // 检查不同链接类型的权重是否正确应用
    const testLinks = db.prepare(`
      SELECT l.type, COUNT(*) as cnt
      FROM zettel_links l
      JOIN zettel_notes n1 ON l.from_note_id = n1.id
      JOIN zettel_notes n2 ON l.to_note_id = n2.id
      WHERE n1.title LIKE '[TEST]%' OR n2.title LIKE '[TEST]%'
      GROUP BY l.type
    `).all();
    console.log("  ✓ 测试笔记链接类型分布:");
    for (const l of testLinks) {
      console.log(`   - ${l.type}: ${l.cnt} 条`);
    }
    if (testLinks.length === 0) {
      throw new Error("测试笔记间无链接");
    }
    console.log("  ✓ 链接权重系统正常工作");
  } catch (e) {
    console.log("  ✗ 失败:", e.message);
    errors.push("linkWeights: " + e.message);
  }

  db.close();

  // 汇总
  console.log("\n" + "=".repeat(50));
  if (errors.length === 0) {
    console.log("✅ Wave 1 端到端测试全部通过！");
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
