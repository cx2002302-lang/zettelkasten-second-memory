# Zettelkasten 实现任务清单

> 分 Phase 的详细开发任务，基于技术选型文档和路线图

---

## Phase 1: 基础架构 (Foundation)

**目标**: 建立项目基础结构，实现核心数据模型和存储层

### 1.1 项目结构搭建
- [ ] 创建 `src/zettelkasten/` 目录结构
  ```
  src/zettelkasten/
  ├── core/
  │   ├── types.ts
  │   ├── constants.ts
  │   └── utils.ts
  ├── repository/
  │   ├── note-repository.ts
  │   ├── link-repository.ts
  │   └── tag-repository.ts
  ├── storage/
  │   ├── file-storage.ts
  │   └── db-storage.ts
  ├── templates/
  │   ├── atomic.md
  │   ├── structure.md
  │   └── source.md
  └── index.ts
  ```
- [ ] 配置 TypeScript 编译选项
- [ ] 安装依赖: `gray-matter`, `remark`, `remark-gfm`, `dayjs`

### 1.2 核心类型定义
- [ ] 定义 `ZettelNote` 接口
  - id: string (YYYYMMDDHHMM)
  - title: string
  - content: string
  - type: 'atomic' | 'structure' | 'source'
  - status: 'FLEETING' | 'LITERATURE' | 'PERMANENT'
  - tags: string[]
  - links: Link[]
  - metadata: NoteMetadata
- [ ] 定义 `Link` 接口
  - to: string
  - context: string
  - relationship: LinkType
- [ ] 定义 `Tag` 接口
- [ ] 定义查询参数接口

### 1.3 数据库 Schema
- [ ] 创建 `zettel_notes` 表
- [ ] 创建 `zettel_links` 表
- [ ] 创建 `zettel_tags` 表
- [ ] 创建 `zettel_note_tags` 关联表
- [ ] 创建 FTS5 全文搜索索引
- [ ] 创建 sqlite-vec 向量表

### 1.4 文件存储层
- [ ] 实现 `.zettelkasten/` 目录初始化
- [ ] 实现分层目录结构 (`notes/YYYY/MM/`)
- [ ] 实现 Markdown 文件读写
- [ ] 实现 Frontmatter 解析/生成

### 1.5 数据库存储层
- [ ] 实现数据库连接管理
- [ ] 实现 CRUD 操作
- [ ] 实现事务支持

**验收标准**:
- [ ] 可以创建、读取、更新、删除卡片
- [ ] Markdown 文件正确生成在指定目录
- [ ] 数据库索引正确建立
- [ ] 单元测试通过

---

## Phase 2: 核心服务 (Core Services)

**目标**: 实现业务逻辑层和核心约束

### 2.1 笔记服务
- [ ] 实现 `NoteService`
  - createNote(): 创建卡片（自动生成ID）
  - getNote(): 获取卡片
  - updateNote(): 更新卡片
  - deleteNote(): 删除卡片
  - listNotes(): 列表查询
- [ ] 实现 ID 生成器（YYYYMMDDHHMM + 冲突检测）
- [ ] 实现模板渲染系统

### 2.2 链接服务
- [ ] 实现 `LinkService`
  - createLink(): 创建链接
  - removeLink(): 删除链接
  - getBacklinks(): 获取反向链接
  - validateLink(): 验证链接（防止循环）
- [ ] 实现链接上下文验证（强制描述）
- [ ] 实现双向链接自动维护

### 2.3 标签服务
- [ ] 实现 `TagService`
  - createTag(): 创建标签
  - getTag(): 获取标签
  - listTags(): 列出所有标签
  - getNotesByTag(): 按标签查询卡片

### 2.4 核心约束实现
- [ ] 实现原子化检查
  - 检测句子数/段落数
  - 检测信号词（"第一/第二/第三"等）
  - AI 辅助拆分建议
- [ ] 实现自治性检查
  - 检测模糊指代词（"如上所述"等）
  - 高亮提示
- [ ] 实现"永远链接"约束
  - 保存时验证至少1个链接
  - 阻止无链接保存
  - 推荐相关卡片

### 2.5 搜索服务
- [ ] 实现全文搜索（FTS5）
- [ ] 实现标签搜索
- [ ] 实现链接搜索
- [ ] 实现组合查询

**验收标准**:
- [ ] 可以完整创建原子卡片（含链接、标签）
- [ ] 核心约束生效（原子化、自治性、永远链接）
- [ ] 搜索功能可用
- [ ] 单元测试覆盖核心逻辑

---

## Phase 3: 高级功能 (Advanced Features)

**目标**: 实现"特效"功能

### 3.1 动态拓扑组合
- [ ] 实现 `ViewCompositionQuery` 解析器
- [ ] 实现递归查询（SQL CTE）
- [ ] 实现多种排序策略
- [ ] 实现视图管理器

### 3.2 语义吸附
- [ ] 集成 sqlite-vec 向量搜索
- [ ] 实现 Embedding 生成
- [ ] 实现语义相似度计算
- [ ] 实现侧边栏推荐 UI

### 3.3 知识断层检测
- [ ] 实现社区发现算法（Louvain）
- [ ] 实现集群密度计算
- [ ] 实现断层检测逻辑
- [ ] 实现桥接建议

### 3.4 知识发光度
- [ ] 实现 PageRank 计算
- [ ] 实现 Betweenness 计算
- [ ] 实现发光度公式
- [ ] 实现视觉反馈（UI）

### 3.5 路径搜索
- [ ] 实现 BFS 路径搜索
- [ ] 实现最短路径算法
- [ ] 实现路径解释生成

### 3.6 组合特效
- [ ] 实现层叠组合（Stacking）
- [ ] 实现逻辑碰撞（Collision）
- [ ] 实现随机漫步（Random Walk）
- [ ] 实现版本分支（Branching）

**验收标准**:
- [ ] 至少实现 3 个"特效"功能
- [ ] 性能满足日常使用（<100ms 响应）
- [ ] 集成测试通过

---

## Phase 4: 集成与接口 (Integration & API)

**目标**: 与 OpenClaw 系统集成，暴露 MCP 接口

### 4.1 Memory Host 集成
- [ ] 实现 `ZettelMemoryBridge`
- [ ] 卡片自动索引到 memory-host-sdk
- [ ] 支持通过记忆搜索发现卡片

### 4.2 Session 集成
- [ ] 实现 `SessionBridge`
- [ ] 会话自动转换为卡片
- [ ] 卡片记录来源会话

### 4.3 MCP 工具设计
- [ ] 设计 MCP 工具列表
  - `zettel_create`: 创建卡片
  - `zettel_search`: 搜索卡片
  - `zettel_link`: 创建链接
  - `zettel_query`: 组合查询
  - `zettel_suggest_links`: 推荐链接
  - `zettel_find_path`: 路径搜索
- [ ] 实现 MCP Server
- [ ] 注册到 OpenClaw 工具系统

### 4.4 AI 增强功能
- [ ] 实现 CEQRC 工作流集成
- [ ] 实现自动摘要生成
- [ ] 实现关键词提取
- [ ] 实现链接推荐 AI

### 4.5 CLI 工具
- [ ] 实现命令行工具
  - `zettel new`: 创建卡片
  - `zettel search`: 搜索
  - `zettel link`: 链接
  - `zettel stats`: 统计

**验收标准**:
- [ ] MCP 工具可用
- [ ] AI 可以调用 Zettelkasten 功能
- [ ] CLI 工具可用
- [ ] 端到端测试通过

---

## Phase 5: 优化与扩展 (Optimization & Extension)

**目标**: 性能优化和功能扩展

### 5.1 性能优化
- [ ] 数据库查询优化
- [ ] 索引优化
-