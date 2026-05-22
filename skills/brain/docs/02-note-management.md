# 02 笔记管理

## 简版

| 工具 | 一句话 | 核心参数 |
|------|--------|----------|
| `zk_create_note` | 创建新笔记（含置信度自动路由） | `title` `content` `tags` `confidence` `source` |
| `zk_update_note` | 更新已有笔记 | `id` `title` `content` `confidence` `tags` |
| `zk_archive_note` | 归档笔记（默认搜索排除） | `note_id` |
| `zk_unarchive_note` | 恢复已归档笔记 | `note_id` |
| `zk_review_note` | 审核 Inbox 笔记（approve/reject/improve） | `note_id` `decision` `improvements` |

---

## 明细版

### 概述

笔记管理是 Zettelkasten 的核心。笔记创建时通过 **置信度路由** 自动分类：
- **≥0.7** → `zettels` 文件夹（高质量原子笔记）
- **≥0.4** → `references` 文件夹（参考资料）
- **<0.4** → `inbox` 文件夹（待审核）

### 可用工具详解

#### `zk_create_note` — 创建笔记

**触发时机**：
- 用户明确说"记下来"、"保存"、"记录"
- 用户分享新发现、新方法、新概念
- 用户总结知识或产生有价值结论
- 用户纠正了 Agent 的错误理解

**参数**：
- `title` (string, required)：笔记标题，5-15 字概括核心
- `content` (string, required)：Markdown 格式内容
- `tags` (string[], optional)：标签列表，2-5 个关键词
- `confidence` (number, optional)：置信度 0-1，影响路由
- `source` (enum, optional)：`manual` | `distilled` | `ceqrc`，默认 `manual`

**置信度设置规则**：
| 场景 | 建议置信度 |
|------|-----------|
| 用户确认的事实 | ≥0.8 |
| 用户分享的经验 | 0.7 |
| 推测或常识 | 0.5 |
| 临时想法 | 0.3 |

**返回**：创建成功的笔记对象（含自动分配的 `id` `folder` `createdAt`）

**行为**：
- 自动解析内容中的 `[[笔记标题]]` 语法，创建双向链接
- 如果目标笔记不存在，跳过链接创建（不报错）
- 置信度缺失时默认路由到 `inbox`

#### `zk_update_note` — 更新笔记

**触发时机**：用户要求修改已有笔记内容时。

**参数**：
- `id` (string, required)：笔记 ID
- `title` (string, optional)：新标题
- `content` (string, optional)：新内容
- `confidence` (number, optional)：新置信度（可能触发文件夹变更）
- `tags` (string[], optional)：替换标签列表

**注意**：只提供要修改的字段，未提供的字段保持不变。

#### `zk_archive_note` — 归档笔记

**触发时机**：
- 用户说"归档这条笔记"
- 用户问"这条笔记是不是该归档了"
- 发现笔记已过时且无人引用

**参数**：
- `note_id` (string, required)：笔记 ID

**行为**：将笔记移动到 `archive` 文件夹，不影响数据，只是默认搜索排除。

**注意**：归档后可通过 `zk_search_archived` 专门检索。

#### `zk_unarchive_note` — 恢复归档

**触发时机**：用户要求恢复已归档笔记时。

**参数**：
- `note_id` (string, required)：笔记 ID

**行为**：将笔记从 `archive` 恢复到 `references` 文件夹。

#### `zk_review_note` — 审核笔记

**触发时机**：Inbox 中的笔记需要人工审核时。

**参数**：
- `note_id` (string, required)：笔记 ID
- `decision` (enum, required)：`approve` | `reject` | `improve`
- `improvements` (object, optional)：`{ title?, content?, confidence? }`

**决策说明**：
| 决策 | 效果 |
|------|------|
| `approve` | 根据置信度路由到 zettels/references |
| `reject` | 标记为已审核但不移动 |
| `improve` | 先更新笔记内容，再路由 |

### 使用场景

**场景 1：自动记录**
```
用户：我发现用 pnpm 比 npm 快多了
Agent：zk_create_note(
  title: "pnpm vs npm 性能对比",
  content: "pnpm 使用硬链接和符号链接...",
  tags: ["pnpm", "npm", "package-manager"],
  confidence: 0.7
) → 返回笔记 ID
```

**场景 2：审核 Inbox**
```
用户：审核这条笔记
Agent：zk_review_note(id, "approve") → 路由到 zettels
```

**场景 3：归档旧笔记**
```
用户：归档这条旧 API 文档
Agent：zk_archive_note(id) → 移动到 archive 文件夹
```

### 注意事项

1. **原子化原则**：一个笔记 = 一个想法，不要把多个主题混在一起
2. **先查重**：创建笔记前先搜索，避免重复创建相同内容
3. **告知 ID**：创建笔记后必须告知用户笔记 ID
4. **不直接修改**：用户未要求时，不要自动修改已有笔记
5. **禁止删除**：Agent 没有删除笔记的权限
