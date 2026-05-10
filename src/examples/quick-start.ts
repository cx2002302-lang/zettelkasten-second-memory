#!/usr/bin/env -S node --no-warnings
/**
 * Zettelkasten 快速启动示例
 * 
 * 演示如何在 OpenClaw 项目中集成 Zettelkasten 第二记忆系统。
 * 
 * 前置要求：
 * 1. 已安装 OpenClaw 核心系统
 * 2. Node.js 20+ 和 TypeScript
 * 3. SQLite3
 * 
 * 运行：
 * npx tsx src/zettelkasten/examples/quick-start.ts
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';
import { open } from 'node:sqlite';

// Zettelkasten 核心模块
import { createZettelkastenIntegration } from '../integration/zettelkasten-integration.js';
import type { LLMProvider } from '../core/types.js';
import { createMockLLMProvider } from './mock-llm-provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 模拟 LLM 提供者（用于演示）
 * 在实际环境中，应使用真实的 LLM（OpenAI、Claude 等）
 */
function createDemoLLMProvider(): LLMProvider {
  return createMockLLMProvider();
}

/**
 * 快速启动 Zettelkasten 集成
 */
async function quickStart() {
  console.log('🚀 Zettelkasten 第二记忆系统 - 快速启动\n');

  // 1. 创建数据目录
  const baseDir = join(os.homedir(), '.openclaw', 'zettelkasten');
  const notesDir = join(baseDir, 'notes');
  const dbPath = join(baseDir, 'zettelkasten.db');
  
  console.log(`📁 数据目录: ${baseDir}`);
  console.log(`📝 笔记目录: ${notesDir}`);
  console.log(`🗃️  数据库: ${dbPath}\n`);

  // 2. 打开数据库
  console.log('🔌 连接数据库...');
  const db = await open(dbPath);
  
  // 初始化数据库表（如果不存在）
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      folder TEXT NOT NULL,
      source_type TEXT,
      confidence REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      source_note_id TEXT NOT NULL,
      target_note_id TEXT NOT NULL,
      link_type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      created_at INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS note_tags (
      note_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (note_id, tag_id),
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title,
      content,
      tokenize='porter unicode61 remove_diacritics 2'
    );
  `);
  console.log('✅ 数据库初始化完成\n');

  // 3. 创建 LLM 提供者
  console.log('🧠 创建 LLM 提供者（演示模式）...');
  const llmProvider = createDemoLLMProvider();
  console.log('✅ LLM 提供者创建完成\n');

  // 4. 创建 Zettelkasten 集成
  console.log('🔗 初始化 Zettelkasten 集成...');
  const integration = createZettelkastenIntegration({
    basePath: baseDir,
    db,
    llmProvider,
    autoStartCron: true,
    enableSessionHook: true,
    debug: true,
    cronConfig: {
      nightlyDistillEnabled: true,
      nightlyDistillSchedule: '0 2 * * *', // 每天凌晨2点
      immediateTestRun: false,
    },
    sessionHookConfig: {
      enabled: true,
      autoDistillOnSessionEnd: true,
      minSessionDurationMs: 5000, // 最短5秒的会话才处理
    },
  });

  // 5. 启动集成
  console.log('⚡ 启动集成组件...');
  const status = await integration.initialize();
  
  console.log('\n📊 集成状态:');
  console.log(`  整体状态: ${status.overall}`);
  console.log(`  Agent 配置: ${status.agentConfig}`);
  console.log(`  Cron 调度器: ${status.cronScheduler}`);
  console.log(`  Session Hook: ${status.sessionHook}`);
  console.log(`  服务层: ${status.services}`);
  
  if (status.initializedAt) {
    console.log(`  初始化时间: ${status.initializedAt}`);
  }
  
  if (status.errors.length > 0) {
    console.log(`  错误: ${status.errors.join(', ')}`);
  }
  
  console.log('\n✅ Zettelkasten 集成已启动！\n');

  // 6. 演示基本功能
  console.log('🎯 演示功能:');
  
  // 获取服务实例
  const noteService = integration.getNoteService();
  const linkService = integration.getLinkService();
  
  // 创建示例笔记
  console.log('  1. 创建示例笔记...');
  const noteId = `demo-${Date.now()}`;
  await noteService.createNote({
    id: noteId,
    title: 'Zettelkasten 快速启动演示',
    content: `这是一个 Zettelkasten 第二记忆系统的快速启动演示笔记。

## 主要功能

- **原子化笔记**: 每个笔记专注于单一概念
- **双向链接**: 笔记之间可以互相引用
- **标签系统**: 灵活的标签管理
- **置信度路由**: 基于置信度自动分类笔记
- **夜间蒸馏**: 自动处理和整理笔记

## 集成状态

- ✅ Phase 1-3 全部完成
- 🔄 Phase 4 集成进行中
- ⏳ Phase 5 人机共生待开始`,
    folder: 'inbox',
    sourceType: 'manual',
    confidence: 0.9,
  });
  console.log(`     已创建笔记: ${noteId}\n`);

  // 搜索笔记
  console.log('  2. 搜索笔记...');
  const searchResults = await noteService.searchNotes('Zettelkasten');
  console.log(`     找到 ${searchResults.length} 个相关笔记\n`);

  // 获取笔记详情
  console.log('  3. 获取笔记详情...');
  const note = await noteService.getNote(noteId);
  console.log(`     标题: ${note?.title}`);
  console.log(`     文件夹: ${note?.folder}`);
  console.log(`     置信度: ${note?.confidence}\n`);

  // 7. 展示集成功能
  console.log('🔧 可用集成功能:');
  console.log('  • 夜间蒸馏 (Cron 调度)');
  console.log('  • 会话结束钩子');
  console.log('  • MCP 服务器接口 (7个工具)');
  console.log('  • 双 Agent 权限矩阵');
  console.log('  • CEQRC 认知流水线\n');

  // 8. 关闭程序前的提示
  console.log('💡 后续步骤:');
  console.log('  1. 配置真实的 LLM 提供者 (OpenAI/Claude 等)');
  console.log('  2. 在 OpenClaw 配置中添加 Zettelkasten 插件');
  console.log('  3. 配置 Agent 权限矩阵');
  console.log('  4. 启动夜间蒸馏服务\n');

  console.log('📚 文档:');
  console.log('  • 完整 API: src/zettelkasten/README.md');
  console.log('  • 配置指南: docs/zettelkasten-config.md');
  console.log('  • 集成示例: src/zettelkasten/examples/\n');

  // 保持程序运行以演示 Cron 调度器
  console.log('⏳ 保持程序运行以演示 Cron 调度器...');
  console.log('  (按 Ctrl+C 退出)\n');

  // 设置优雅退出
  process.on('SIGINT', async () => {
    console.log('\n🛑 正在关闭 Zettelkasten 集成...');
    await integration.shutdown();
    await db.close();
    console.log('👋 程序退出');
    process.exit(0);
  });

  // 10秒后演示手动触发蒸馏
  setTimeout(async () => {
    console.log('\n⚡ 演示: 手动触发蒸馏（10秒后）...');
    try {
      const cronScheduler = integration.getCronScheduler();
      if (cronScheduler) {
        const job = await cronScheduler.triggerManualDistill();
        console.log(`✅ 蒸馏任务已触发: ${job.id}`);
      }
    } catch (error) {
      console.log(`⚠️  蒸馏触发失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, 10000);
}

// 运行快速启动
if (import.meta.url === `file://${process.argv[1]}`) {
  quickStart().catch((error) => {
    console.error('❌ 快速启动失败:', error);
    process.exit(1);
  });
}
