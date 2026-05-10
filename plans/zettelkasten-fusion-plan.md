# Zettelkasten 融合实施方案

## 概述

本方案融合**方案一（TypeScript/OpenClaw内置）**与**方案二（CogLoom/Python独立服务）**的精华，保持 TypeScript 技术栈与 OpenClaw 深度集成，同时吸收方案二的优秀设计思想。

## 技术选型决策

| 组件 | 方案一 | 方案二 | 融合决策 | 理由 |
|------|--------|--------|----------|------|
| 技术栈 | TypeScript | Python | **TypeScript** | 与 OpenClaw 一致，避免跨语言复杂度 |
| 向量数据库 | sqlite-vec | LanceDB | **sqlite-vec** | 复用 OpenClaw 现有基础设施 |
| 部署模式 | 内置模块 | 独立服务 | **内置模块** | 简化部署，共享运行时 |
| 前端 UI | - | Streamlit | **待定** | 后期评估是否需要独立 UI |

## 五阶段融合映射

### Phase 1: 物理管道 ✅ 已完成
- [x] 三级目录结构（/Inbox, /References, /Zettels）
- [x] SQLite Schema + FTS5 索引
- [x] Markdown 文件系统
- [x] Repository 数据访问层

### Phase 2: 数据宪法（当前）
- [ ] YAML Frontmatter 解析与生成
- [ ] UID 生成策略（时间戳 + Slug）
- [ ] 强类型链接关系网（6种关系）
- [ ] MCP 工具骨架（7大核心工具）

### Phase 3: 认知流水线（新增）
- [ ] **夜间蒸馏服务（Distiller）**
  - OpenClaw memory 日志解析器
  - 对话切片与摘要生成
  - 两阶去重流水线（向量相似度 + LLM 决断）
- [ ] **CEQRC 深度内化工作流**
  - 5步流水线 Prompt 链
  - `zk_run_ceqrc_workflow` MCP 工具
- [ ] **动态置信度路由**
  - LLM 置信度评分（0-1）
  - 分流逻辑：高分→/Zettels，低分→/Inbox

### Phase 4: 神经中枢集成
- [ ] **双 Agent 架构**
  - **前台聊天主脑**：轻量级对话，只读搜索权限
  - **后台知识管理子脑**：CEQRC 流程，完整写权限
- [ ] **触发器系统**
  - CronJob 夜间批处理
  - `/zk` Slash Command
  - Session End Hook → /References

### Phase 5: 人机共生与反馈
- [ ] **审核面板 API**
  - /Inbox 列表接口
  - 卡片详情与状态修改
  - 蒸馏日志查看
- [ ] **反馈闭环机制**
  - 人类修正记录
  - 样本回流脚本
  - Few-shot 动态追加

## 核心设计思想吸收

### 1. 双 Agent 权限分离

```typescript
// MCP 工具权限矩阵
const TOOL_PERMISSIONS = {
  // 前台主脑 - 只读
  chatAgent: [
    'zk_search_notes',      // 搜索笔记
    'zk_get_note',          // 获取单条
    'zk_get_backlinks',     // 获取反向链接
    'zk_find_path',         // 路径发现
  ],
  
  // 后台子脑 - 读写
  knowledgeAgent: [
    'zk_create_note',       // 创建笔记
    'zk_update_note',       // 更新笔记
    'zk_create_link',       // 创建链接
    'zk_run_ceqrc_workflow', // CEQRC 工作流
    'zk_distill_memory',    // 蒸馏记忆
    ...chatAgentTools,      // 继承所有只读工具
  ]
};
```

### 2. 夜间蒸馏批处理

```typescript
// Distiller Service 核心流程
interface DistillerPipeline {
  // Step 1: 读取 OpenClaw memory 日志
  parseMemoryLog(date: string): ConversationSlice[];
  
  // Step 2: 对话切片
  sliceConversation(conversation: Conversation): Slice[];
  
  // Step 3: 生成摘要（调用本地 LLM）
  generateSummary(slice: Slice): Promise<Summary>;
  
  // Step 4: 两阶去重
  stage1VectorDeduplicate(candidates: Summary[]): Filtered[];  // 相似度≥0.7过滤
  stage2LLMDecide(items: Filtered[]): Decision[];              // CREATE/MERGE/SKIP
  
  // Step 5: 执行决策
  executeDecisions(decisions: Decision[]): Promise<Note[]>;
}
```

### 3. 置信度路由

```typescript
// 在 NoteService.createNote 中集成
async function createNoteWithConfidence(
  content: string,
  confidence: number,  // LLM 输出的置信度 0-1
  source: 'manual' | 'distilled' | 'ceqrc'
): Promise<Note> {
  const folder = confidence >= 0.7 ? 'zettels' 
               : confidence >= 0.4 ? 'references'
               : 'inbox';
  
  return await createNote({ ...content, folder, confidence, source });
}
```

## 新增模块设计

### 1. Distiller Service（夜间蒸馏）

```
src/zettelkasten/
├── distiller/
│   ├── memory-parser.ts      # OpenClaw memory 日志解析
│   ├── conversation-slicer.ts # 对话切片逻辑
│   ├── summarizer.ts         # 摘要生成（LLM调用）
│   ├── deduplicator.ts       # 两阶去重
│   ├── confidence-router.ts  # 置信度路由
│   └── distiller-service.ts  # 主服务编排
```

### 2. CEQRC 引擎

```
src/zettelkasten/
├── ceqrc/
│   ├── workflow-engine.ts    # 5步流水线引擎
│   ├── prompts/
│   │   ├── capture-prompt.ts
│   │   ├── explain-prompt.ts
│   │   ├── question-prompt.ts
│   │   ├── refine-prompt.ts
│   │   └── connect-prompt.ts
│   └── ceqrc-service.ts
```

### 3. 双 Agent MCP 配置

```
src/zettelkasten/
├── mcp/
│   ├── server.ts             # MCP 服务器
│   ├── tools/
│   │   ├── read-only/        # 前台主脑工具
│   │   └── read-write/       # 后台子脑工具
│   └── permissions.ts        # 权限矩阵
```

## 实施路线图

### 当前：Phase 2 核心服务
1. NoteService（含置信度字段）
2. LinkService（含6种关系类型）
3. TagService
4. MCP 服务器骨架（7大工具）

### 下一步：Phase 3 认知流水线
1. Memory 日志解析器
2. Distiller Service MVP
3. CEQRC 引擎
4. 置信度路由

### 后续：Phase 4-5
1. OpenClaw Agent 配置
2. CronJob 与 Hook
3. 审核面板 API
4. 反馈闭环

## 关键变更点

### 数据库 Schema 增强

```sql
-- 新增置信度字段
ALTER TABLE zettel ADD COLUMN confidence REAL DEFAULT 0.5;
ALTER TABLE zettel ADD COLUMN source TEXT DEFAULT 'manual';

-- 新增蒸馏日志表
CREATE TABLE distill_log (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  memory_file TEXT NOT NULL,
  slices_count INTEGER,
  created_count INTEGER,
  merged_count INTEGER,
  skipped_count INTEGER,
  processed_at TEXT
);
```

### 类型定义增强

```typescript
// types.ts 新增
export interface Note {
  // ...原有字段
  confidence: number;      // 0-1 置信度
  source: 'manual' | 'distilled' | 'ceqrc';
  reviewed: boolean;       // 是否人工审核
}

export interface DistillJob {
  date: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  slices: ConversationSlice[];
  decisions: LLMDecision[];
}
```

## 总结

本融合方案：
1.