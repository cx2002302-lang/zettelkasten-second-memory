#!/usr/bin/env node
/**
 * 测试数据填充脚本
 * 
 * 生成带特殊标记的测试笔记，用于端到端测试。
 * 所有测试数据可通过 title 中的 `[TEST]` 前缀识别和清理。
 * 
 * 用法:
 *   npx tsx scripts/seed-test-data.mjs
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";

const DB_PATH = path.join(os.homedir(), ".openclaw/zettelkasten/zettelkasten.db");
const TEST_MARKER = "[TEST]";
const TEST_TAG = "<!-- TEST_DATA: auto-generated, safe to delete via clean-test-data.mjs -->";

function now() {
  return new Date().toISOString();
}

function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function generateId() {
  const ts = Date.now().toString();
  const rnd = Math.floor(Math.random() * 100000).toString().padStart(5, "0");
  return ts + rnd;
}

async function main() {
  console.log("=== 测试数据填充 ===");
  console.log("DB:", DB_PATH);

  const db = new DatabaseSync(DB_PATH);
  db.exec("BEGIN TRANSACTION");

  const insertNote = db.prepare(`
    INSERT INTO zettel_notes (id, title, content, summary, type, status, folder, 
      confidence, source, reviewed, session_key, file_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLink = db.prepare(`
    INSERT INTO zettel_links (from_note_id, to_note_id, type, context, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const notes = [];

  // ===== 僵尸笔记 (Zombies): 180+天未更新, 零入链 =====
  const zombies = [
    { title: "旧版 API 设计草案", days: 210, type: "atomic" },
    { title: "废弃的部署脚本说明", days: 200, type: "source" },
    { title: "早期数据库 Schema v0.1", days: 195, type: "structure" },
  ];

  for (const z of zombies) {
    const id = generateId();
    const updated = daysAgo(z.days);
    const created = daysAgo(z.days + 30);
    insertNote.run(
      id,
      `${TEST_MARKER} ${z.title}`,
      `这是一篇超过 ${z.days} 天未更新的笔记，应该被检测为僵尸笔记。\n${TEST_TAG}`,
      `僵尸笔记示例: ${z.title}`,
      z.type,
      "FLEETING",
      "zettels",
      0.5,
      "manual",
      1,
      null,
      `test-data/${id}.md`,
      created,
      updated
    );
    notes.push({ id, category: "zombie", title: z.title });
    console.log(`  + 僵尸笔记: ${z.title} (${z.days}天前)`);
  }

  // ===== Evergreen 候选: 高引用, 高质量, 近期更新 =====
  const evergreens = [
    { title: "Zettelkasten 方法论总纲", type: "structure" },
    { title: "知识管理核心原则", type: "structure" },
    { title: "双链笔记最佳实践", type: "atomic" },
  ];

  for (const eg of evergreens) {
    const id = generateId();
    const updated = daysAgo(5);
    const created = daysAgo(60);
    insertNote.run(
      id,
      `${TEST_MARKER} ${eg.title}`,
      `这是一篇高质量的核心笔记，应该被检测为常青笔记。\n${TEST_TAG}`,
      `Evergreen 示例: ${eg.title}`,
      eg.type,
      "PERMANENT",
      "zettels",
      0.95,
      "distilled",
      1,
      null,
      `test-data/${id}.md`,
      created,
      updated
    );
    notes.push({ id, category: "evergreen", title: eg.title });
    console.log(`  + Evergreen: ${eg.title}`);
  }

  // ===== 活跃笔记 (Active): 中等引用, 近期更新 =====
  const actives = [
    { title: " weekly review 模板", type: "structure" },
    { title: "项目管理 Checklist", type: "atomic" },
    { title: "代码审查指南", type: "atomic" },
    { title: "团队沟通规范", type: "atomic" },
  ];

  for (const a of actives) {
    const id = generateId();
    const updated = daysAgo(10);
    const created = daysAgo(45);
    insertNote.run(
      id,
      `${TEST_MARKER} ${a.title}`,
      `这是一篇活跃的笔记，有持续更新和引用。\n${TEST_TAG}`,
      `Active 示例: ${a.title}`,
      a.type,
      "LITERATURE",
      "zettels",
      0.8,
      "manual",
      1,
      null,
      `test-data/${id}.md`,
      created,
      updated
    );
    notes.push({ id, category: "active", title: a.title });
    console.log(`  + Active: ${a.title}`);
  }

  // ===== 稳定笔记 (Stable): 低引用, 任意时间 =====
  const stables = [
    { title: "某次会议记录", days: 90, type: "source" },
    { title: "技术选型备忘录", days: 120, type: "atomic" },
    { title: "读书笔记摘录", days: 60, type: "source" },
    { title: "工具链配置备份", days: 80, type: "source" },
  ];

  for (const s of stables) {
    const id = generateId();
    const updated = daysAgo(s.days);
    const created = daysAgo(s.days + 20);
    insertNote.run(
      id,
      `${TEST_MARKER} ${s.title}`,
      `这是一篇稳定的笔记，引用较少但仍有价值。\n${TEST_TAG}`,
      `Stable 示例: ${s.title}`,
      s.type,
      "LITERATURE",
      "zettels",
      0.6,
      "manual",
      1,
      null,
      `test-data/${id}.md`,
      created,
      updated
    );
    notes.push({ id, category: "stable", title: s.title });
    console.log(`  + Stable: ${s.title} (${s.days}天前)`);
  }

  // ===== 创建链接网络 =====
  // 结构: Evergreen <- 被大量引用
  //       Active <- 被 Evergreen 引用
  //       Stable <- 被 Active 引用
  //       Zombie <- 孤立

  const evergreenIds = notes.filter(n => n.category === "evergreen").map(n => n.id);
  const activeIds = notes.filter(n => n.category === "active").map(n => n.id);
  const stableIds = notes.filter(n => n.category === "stable").map(n => n.id);

  const links = [];

  // Evergreen 引用 Active (高权重)
  for (let i = 0; i < activeIds.length && i < evergreenIds.length; i++) {
    links.push({ from: evergreenIds[i % evergreenIds.length], to: activeIds[i], type: "supports", ctx: "核心方法支撑" });
  }

  // Active 引用 Stable
  for (let i = 0; i < stableIds.length && i < activeIds.length; i++) {
    links.push({ from: activeIds[i % activeIds.length], to: stableIds[i], type: "refines", ctx: "具体实践细化" });
  }

  // Evergreen 之间互相引用
  for (let i = 0; i < evergreenIds.length - 1; i++) {
    links.push({ from: evergreenIds[i], to: evergreenIds[i + 1], type: "extends", ctx: "方法论扩展" });
    links.push({ from: evergreenIds[i + 1], to: evergreenIds[i], type: "related", ctx: "相关概念" });
  }

  // 额外给第一个 evergreen 增加更多引用，使其 glow 最高
  for (const toId of [...activeIds.slice(0, 2), ...stableIds.slice(0, 2)]) {
    links.push({ from: evergreenIds[0], to: toId, type: "is_example_of", ctx: "最佳实践示例" });
  }

  // Active 之间互相引用
  for (let i = 0; i < activeIds.length - 1; i++) {
    links.push({ from: activeIds[i], to: activeIds[i + 1], type: "related", ctx: "工作流关联" });
  }

  const nowStr = now();
  for (const link of links) {
    try {
      insertLink.run(link.from, link.to, link.type, link.ctx, nowStr);
      console.log(`  → 链接: ${link.type} (${link.ctx})`);
    } catch (e) {
      // 忽略重复链接
      if (!e.message.includes("UNIQUE constraint failed")) {
        throw e;
      }
    }
  }

  db.exec("COMMIT");
  db.close();

  console.log(`\n✅ 测试数据填充完成！`);
  console.log(`   僵尸: ${zombies.length} | Evergreen: ${evergreens.length} | Active: ${actives.length} | Stable: ${stables.length}`);
  console.log(`   链接: ${links.length}`);
  console.log(`   所有笔记标题前缀: "${TEST_MARKER}"`);
  console.log(`   清理命令: npx tsx scripts/clean-test-data.mjs`);
}

main().catch(e => {
  console.error("填充失败:", e);
  process.exit(1);
});
