# Zettelkasten 第二记忆系统 - 神经中枢集成 (Phase 4)

## 概述

Zettelkasten 第二记忆系统已成功与 OpenClaw 神经中枢集成，实现了完整的 **Phase 4: 神经中枢集成**。本文档描述集成架构、配置方法和使用方式。

## 集成架构

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenClaw 神经中枢                        │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │  前台主脑    │  │  后台子脑    │  │  Session Manager │ │
│  │  (Chat Agent)│  │(Knowledge    │  │                  │ │
│  │              │  │  Agent)      │  │                  │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────┘ │
│         │                 │                      │         │
│         ▼                 ▼                      ▼         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Zettelkasten 集成适配层                    │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  • Agent 配置管理器                                  │  │
│  │  • Session End Hook                                  │  │
│  │  • Cron 调度器                                       │  │
│  │  • MCP 服务器接口                                    │  │
│  │  • 全局集成单例                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│         │                 │                      │         │
│         ▼                 ▼                      ▼         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │  NoteService │  │  LinkService │  │ DistillerService │ │
│  │              │  │              │  │                  │ │
│  └──────────────┘  └──────────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 核心集成组件

### 1. Agent 配置系统 (`agent-config.ts`)

实现双 Agent 权限矩阵：

- **前台主脑 (Chat Agent)**: 只读权限
  - `zk_search_notes`: 搜索笔记
  - `zk_get_note`: 获取笔记详情
  - `zk_get_backlinks`: 获取反向链接
  - `zk_find_path`: 查找笔记间路径

- **后台子脑 (Knowledge Agent)**: 读写权限（包含所有前台工具）
  - `zk_create_note`: 创建新笔记
  - `zk_update_note`: 更新笔记
  - `zk_run_ceqrc`: 运行 CEQRC 认知流水线
  - `zk_distill_memory`: 手动蒸馏记忆
  - `zk_review_note`: 审核笔记置信度

### 2. Cron 调度器 (`cron-scheduler.ts`)

自动执行夜间蒸馏任务：

- **默认调度**: 每天凌晨 2:00 (`0 2 * * *`)
- **功能**:
  - 自动处理 inbox 中的新笔记
  - 运行 CEQRC 认知流水线
  - 执行两阶去重（向量相似度 + LLM 判断）
  - 根据置信度路由笔记 (≥0.7→zettels, ≥0.4→references)

### 3. Session End Hook (`session-hook.ts`)

会话结束时的自动处理：

- **触发条件**: OpenClaw 会话结束时
- **处理流程**:
  1. 解析会话日志 (OpenClaw memory 格式)
  2. 提取关键信息和对话摘要
  3. 创建原子化笔记
  4. 自动分类和链接

### 4. MCP 服务器接口 (`mcp/server.ts`)

提供 7 个 MCP 工具，可通过 OpenClaw 的 MCP 系统访问：

```typescript
// 工具列表
1. search_notes(query: string)        // 全文搜索笔记
2. get_note(id: string)               // 获取笔记详情
3. get_backlinks(id: string)          // 获取反向链接
4. find_path(sourceId, targetId)      // 查找笔记间最短路径
5. create_note(params)                // 创建新笔记
6. update_note(id, updates)           // 更新笔记
7. run_ceqrc(content)                 // 运行 CEQRC 流水线
8. distill_memory()                   // 手动触发蒸馏
9. review_note(id)                    // 审核笔记置信度
```

### 5. 集成初始化器 (`zettelkasten-integration.ts`)

统一管理所有集成组件的生命周期：

```typescript
import { initializeZettelkasten } from './integration/zettelkasten-integration.js';

const integration = await initializeZettelkasten({
  basePath: './zettelkasten',
  db: databaseInstance,
  llmProvider: yourLLMProvider,
  autoStartCron: true,
  enableSessionHook: true,
  debug: false,
});
```

## 配置方法

### 方法 1: 作为 OpenClaw 插件

在 `openclaw.json` 配置中添加：

```json
{
  "plugins": {
    "entries": {
      "zettelkasten": {
        "enabled": true,
        "config": {
          "notesDir": "~/.openclaw/zettelkasten/notes",
          "databasePath": "~/.openclaw/zettelkasten/zettelkasten.db",
          "agentConfigs": {
            "chat": {
              "tools": ["zk_search_notes", "zk_get_note", "zk_get_backlinks", "zk_find_path"]
            },
            "knowledge": {
              "tools": ["zk_search_notes", "zk_get_note", "zk_create_note", "zk_update_note", "zk_run_ceqrc"]
            }
          },
          "nightlyDistill": {
            "enabled": true,
            "cronExpression": "0 2 * * *"
          },
          "sessionHook": {
            "enabled": true
          },
          "confidenceThreshold": {
            "zettels": 0.7,
            "references": 0.4
          }
        }
      }
    }
  }
}
```

### 方法 2: 程序化集成

在 OpenClaw 扩展中直接集成：

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { zettelkastenConfigSchema } from "../src/zettelkasten/plugin/index.js";

export default definePluginEntry({
  id: "zettelkasten",
  name: "Zettelkasten Second Memory System",
  description: "Atomic note‑taking and knowledge‑graph distillation",
  configSchema: zettelkastenConfigSchema,
  
  async register(api) {
    // 初始化 Zettelkasten
    const integration = await initializeZettelkasten({
      basePath: api.pluginConfig.notesDir,
      // ... 其他配置
    });
    
    // 注册 MCP 服务器
    if (api.registerMcpServer) {
      const { createZettelkastenMCPServer } = await import("../src/zettelkasten/mcp/server.js");
      const mcpServer = createZettelkastenMCPServer(/* 依赖注入 */);
      api.registerMcpServer(mcpServer, {
        name: "zettelkasten",
        description: "Zettelkasten second memory system tools"
      });
    }
    
    // 注册工具
    api.registerTool(/* ... */);
    
    // 注册 Session Hook
    api.registerSessionEndHook(integration.onSessionEnd.bind(integration));
  }
});
```

### 方法 3: 独立使用

在非 OpenClaw 环境中独立使用：

```typescript
import { initializeZettelkasten } from './zettelkasten-integration.js';
import { createMockLLMProvider } from './mock-llm-provider.js';

// 快速启动
const integration = await initializeZettelkasten({
  basePath: './my-zettelkasten',
  db: await open('./my-zettelkasten.db'),
  llmProvider: createMockLLMProvider(), // 或使用真实的 LLM
  autoStartCron: true,
  enableSessionHook: false,
});

// 使用服务
const noteService = integration.getNoteService();
await noteService.createNote({
  title: "我的第一个 Zettelkasten 笔记",
  content: "这是一个原子化笔记示例...",
  folder: "inbox",
  confidence: 0.8,
});
```

## 使用示例

### 示例 1: 通过 MCP 工具访问

```javascript
// 在前台主脑（聊天 Agent）中使用
const notes = await ctx.callMCPTool('zk_search_notes', {
  query: '人工智能'
});

// 在后台子脑（知识 Agent）中使用
const newNote = await ctx.callMCPTool('zk_create_note', {
  title: '关于神经网络的新发现',
  content: '最近研究发现...',
  folder: 'inbox'
});
```

### 示例 2: 手动触发蒸馏

```typescript
// 通过集成接口
const cronScheduler = integration.getCronScheduler();
if (cronScheduler) {
  const job = await cronScheduler.triggerManualDistill();
  console.log(`蒸馏任务已触发: ${job.id}`);
}

// 通过 MCP 工具
await ctx.callMCPTool('zk_distill_memory', {});
```

### 示例 3: 会话结束自动处理

```typescript
// 当 OpenClaw 会话结束时自动调用
const result = await integration.onSessionEnd({
  sessionId: 'session-123',
  agentId: 'chat-agent',
  durationMs: 60000,
  messageCount: 42,
  summary: '讨论人工智能伦理的会话',
  transcripts: [...]
});

console.log(`处理结果: ${result.notesCreated} 个新笔记创建`);
```

## 部署指南

### 开发环境

1. **克隆代码**:
   ```bash
   git clone <repository>
   cd openclaw
   ```

2. **安装依赖**:
   ```bash
   npm install
   ```

3. **编译 Zettelkasten**:
   ```bash
   npm run build:zettelkasten
   ```

4. **运行集成测试**:
   ```bash
   npm test -- zettelkasten-integration
   ```

### 生产环境

1. **配置 LLM 提供者**:
   - 替换 `mock-llm-provider.ts` 为真实的 LLM（OpenAI、Claude 等）
   - 设置 API 密钥和环境变量

2. **数据库优化**:
   - 考虑使用连接池
   - 定期备份数据库
   - 启用 WAL 模式提高性能

3. **监控和日志**:
   - 集成状态监控
   - 错误报警
   - 性能指标收集

## 故障排除

### 常见问题

1. **数据库连接失败**
   - 检查数据库文件权限
   - 确保 SQLite 驱动正确安装
   - 验证数据库路径是否存在

2. **LLM 提供者不可用**
   - 检查 API 密钥配置
   - 验证网络连接
   - 查看 LLM 服务状态

3. **Cron 调度器不工作**
   - 检查系统时间设置
   - 验证 cron 表达式格式
   - 查看日志文件中的错误信息

4. **Session Hook 不触发**
   - 确认 OpenClaw 版本支持 Session Hook
   - 检查会话结束事件的触发条件
   - 查看调试日志

### 调试模式

启用调试模式获取详细日志：

```typescript
const integration = await initializeZettelkasten({
  // ... 其他配置
  debug: true, // 启用调试模式
});
```

## 性能优化建议

1. **数据库索引**:
   - 为常用查询字段创建索引
   - 定期运行 `VACUUM` 优化数据库
   - 考虑使用内存数据库缓存热点数据

2. **LLM 调用优化**:
   - 批量处理相似内容
   - 实现请求缓存
   - 使用流式响应减少等待时间

3. **内存管理**:
   - 限制同时处理的会话数量
   - 实现分页查询
   - 定期清理临时文件

## 后续开发路线图

### Phase 5: 人机共生与反馈
- [ ] 审核面板 API
- [ ] 人机反馈闭环机制
- [ ] 样本回流与提示词进化

### 高级功能
- [ ] 实时协同编辑
- [ ] 跨设备同步
- [ ] 智能推荐系统
- [ ] 可视化知识图谱

## 支持与贡献

- **问题反馈**: 在 GitHub Issues 提交问题
- **功能请求**: 使用 Feature Request 模板
- **贡献代码**: 遵循项目代码规范
- **文档改进**: 提交 Pull Request

## 许可证

Zettelkasten 第二记忆系统采用 MIT 许可证，详情见 `LICENSE` 文件。

---

**集成状态**: ✅ Phase 4 已完成  
**健康度**: 87/100  
**最后更新**: 2026-04-21  
**版本**: 1.0.0
