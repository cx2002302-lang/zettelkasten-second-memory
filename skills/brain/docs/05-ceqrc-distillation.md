# 05 CEQRC 与蒸馏

## 简版

| 工具 | 一句话 | 核心参数 |
|------|--------|----------|
| `zk_run_ceqrc` | 运行 CEQRC 深度内化工作流 | `note_id` `content` |
| `zk_distill_memory` | 蒸馏 OpenClaw memory 日志为原子笔记 | `memory_file_path` |

**CEQRC** = Capture（捕获）→ Explain（解释）→ Question（提问）→ Refine（精炼）→ Connect（连接）

---

## 明细版

### 概述

CEQRC 和蒸馏是知识的**深加工**功能：
- **CEQRC**：将粗糙的源内容通过 5 阶段工作流，转化为高质量原子笔记
- **蒸馏**：将 OpenClaw 的 memory 日志自动转化为原子笔记

### CEQRC 工作流

```
源内容 → Capture → Explain → Question → Refine → Connect → 原子笔记
```

| 阶段 | 作用 | 输出 |
|------|------|------|
| **Capture** | 提取核心概念和关键信息 | 关键概念列表 |
| **Explain** | 用自己的话解释每个概念 | 解释文本 |
| **Question** | 生成深入思考的问题 | 问题列表 |
| **Refine** | 将解释精炼为原子笔记 | Markdown 内容 |
| **Connect** | 与已有知识建立链接 | 关联建议 |

#### `zk_run_ceqrc` — 运行 CEQRC

**触发时机**：用户分享了一段需要深度整理的内容时。

**参数**：
- `note_id` (string, required)：源笔记 ID
- `content` (string, required)：要处理的内容

**返回**：
- `workflowId`：工作流 ID
- `phases`：各阶段结果
- `finalNote`：生成的原子笔记

**流程**：
1. Agent 调用 CEQRC 引擎
2. 引擎逐阶段处理内容
3. 最终生成原子笔记
4. 自动调用 `zk_create_note` 保存

### 蒸馏（Distillation）

#### `zk_distill_memory` — Memory 蒸馏

**触发时机**：
- 夜间服务自动执行（默认每天凌晨 2 点）
- 用户手动触发

**参数**：
- `memory_file_path` (string, optional)：Memory 日志路径，省略则蒸馏昨天的日志

**返回**：
- `jobId`：任务 ID
- `sliceCount`：切片数
- `summaryCount`：摘要数
- `createdCount`：创建的笔记数
- `mergedCount`：合并的笔记数
- `skippedCount`：跳过的笔记数

**流程**：
1. 读取 memory 日志
2. 按时间窗口切片
3. 对每个切片生成摘要
4. 与已有笔记去重
5. 创建新的原子笔记

### 使用场景

**场景 1：会议记录整理**
```
用户：把这次会议的讨论整理成笔记
Agent：
  1. zk_create_note(会议记录, confidence=0.5) → 源笔记
  2. zk_run_ceqrc(源笔记ID, 会议内容) → 生成多条原子笔记
  3. 返回结果给用户
```

**场景 2：每日自动蒸馏**
```
夜间服务（cron）：
  zk_distill_memory() → 自动将昨日对话转为笔记
  日志：created=3 merged=1 skipped=2
```

**场景 3：批量处理**
```
用户：蒸馏过去一周的 memory
Agent：
  zk_distill_memory(path="/path/to/weekly.log")
```

### 注意事项

1. **CEQRC 需要 LLM**：依赖配置的 LLM Provider，未配置时不可用
2. **蒸馏依赖 memory 日志**：需要 OpenClaw 启用 memory 记录
3. **去重机制**：蒸馏时会与已有笔记去重，避免重复创建
4. **置信度路由**：CEQRC 生成的笔记通常置信度较高（≥0.7），自动路由到 zettels
5. **手动确认**：重要内容建议用户确认后再保存
