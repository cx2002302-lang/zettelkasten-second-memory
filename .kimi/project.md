# Zettelkasten Project — 当前进度

> 最后更新: 2026-05-12  
> 当前版本: v1.0.0-beta.4 (已推送到 GitHub)  
> 测试状态: 689 tests, 0 failures, 26 files

---

## 系统信息

- **OpenClaw 版本**: 2026.4.24
- **插件版本**: v1.0.0-beta.4
- **Skill 版本**: 1.0.0-beta.2
- **Node 要求**: >= 22.14.0
- **当前环境 Node**: v22.22.2

---

## 本次会话已完成工作（2026-05-12）

### 1. 测试修复与补全（P1）
- 新增 3 个测试文件，59 个测试：
  - `feedback-repository.test.ts` (25 tests)
  - `review-repository.test.ts` (20 tests)
  - `archive-service.test.ts` (14 tests)
- 修复 feedback-repository.ts SQLite undefined 绑定 bug
- 修复 feedback-repository.ts rating null → undefined 转换
- 修复 archive-service.ts `zombie.folder` 不存在 bug
- 修复 feedback-service.test.ts 时间竞态 flaky test
- 新增 heatmap-service 边界测试（空 DB、空过滤、负数 limit、glowMin 越界）
- 创建 vitest.config.ts 排除 `zettelkasten-github/` 重复测试
- 最终状态: **689 tests, 0 failures**

### 2. 输入校验（P1 → 6.4）
- **note-service.ts**: title/content 非空校验，confidence 0-1 范围校验（create + update）
- **link-service.ts**: 禁止自环（from === to），type 必须是 11 个合法值之一
- **heatmap-service.ts**: days < 1 自动修正为 1，glowMin clamp 到 [0,1]
- 全部有对应的单元测试覆盖

### 3. 性能基准测试（P1 → 6.5）
- 创建 `scripts/benchmark.mjs`
- 测试规模: 1K / 5K / 10K 笔记
- 全部 7 项阈值通过 ✅
- 关键数据（10K 规模）:
  - FTS 搜索: 1.9ms
  - 单条读取: 0.08ms
  - 发光度重算: 1,013ms（唯一瓶颈）
  - 知识图谱: 5.5ms
  - 热力图: 30ms
- 报告: `plans/PERFORMANCE-BENCHMARK.md`

### 4. E2E 实战测试
- 创建 `scripts/e2e-tool-test.mjs`
- 覆盖 16 个 MCP 工具流
- 28/28 通过 ✅
- 部署到 `~/.openclaw/zettelkasten-plugin/`
- `zk init` + `zk doctor`: 16 OK, 0 FAIL

### 5. GitHub Release v1.0.0-beta.4
- 更新 README.md / README.zh.md（版本号 + 性能章节）
- 更新 CHANGELOG.md
- 生成性能信息图提示词: `docs/assets/performance-infographic-prompt.md`
- 压缩主图 + 性能图到 ~1MB
- Git commit: `347fe19`
- Git tag: `v1.0.0-beta.4`
- 已推送到 GitHub ✅
- Release 包: `releases/zettelkasten-plugin-v1.0.0-beta.4.tar.gz` (15M)
- Release Notes: `releases/RELEASE_NOTES-v1.0.0-beta.4.md`

---

## 项目当前全景（BACKLOG 简化）

| 优先级 | 事项 | 状态 |
|--------|------|------|
| **P0** | 功能开关系统设计 | ⏳ 未开始 |
| **P0** | 修复测试失败 + 补全核心测试 | ✅ 已完成 |
| **P1** | 输入校验和异常处理 | ✅ 已完成 |
| **P1** | 性能基准测试 | ✅ 已完成 |
| **P1** | heatmap 边界测试 | ✅ 已完成 |
| **P2** | Phase 5 代码接入 plugin（MCP/CLI）| ⏳ 未开始 |
| **P2** | CLI E2E 测试 | ⏳ 可选，ROI 低 |
| **P3** | MemoryHostBridge / SessionBridge | ⏳ 未来 |
| **P3** | 语义搜索（sqlite-vec）| ⏳ 未来 |

---

## 下一步建议（按优先级）

### 选项 A: P0 功能开关系统（推荐）
为 Wave 4 打基础。设计模块化启用/禁用机制：
- 每个模块（笔记、链接、归档、审核、反馈等）可独立开关
- 配置字段：`modules: { notes: true, links: true, archive: false, ... }`
- 减少资源占用、降低学习成本

### 选项 B: P2 Phase 5 接上线
让审核面板、反馈闭环、提示词进化真正暴露为 MCP 工具：
- `plugin/index.ts` 当前完全没有引用 ReviewService / FeedbackService / SampleCurationService / PromptEvolutionService
- 需要新增 MCP 工具注册（10+ 个 Phase 5 工具）
- 需要新增 CLI 命令

### 选项 C: 优化发光度重计算
性能基准发现这是唯一瓶颈（10K 笔记 1s）：
- 改为增量更新（只计算变更的笔记）
- 或异步后台任务
- `autoArchiveZombies()` 同样受益

---

## 项目结构

```
.
├── src/                           # 插件源码（当前工作目录）
│   ├── plugin/index.ts            # 插件入口（含 MCP 工具 + CLI）
│   ├── service/                   # 业务逻辑
│   ├── repository/                # 数据访问
│   ├── storage/db-schema.ts       # 数据库 Schema（11 张表）
│   ├── skills/brain/              # AI Skill
│   └── core/                      # 类型定义
├── zettelkasten-github/           # GitHub 仓库副本（已推送 beta.4）
│   ├── docs/assets/               # 信息图（主图 + 性能 CN/EN）
│   ├── plans/PERFORMANCE-BENCHMARK.md
│   ├── scripts/benchmark.mjs
│   ├── scripts/e2e-tool-test.mjs
│   └── README.md / README.zh.md / CHANGELOG.md
├── skills/brain/                  # Skill 文件
├── plans/                         # 设计文档 + BACKLOG.md
├── scripts/deploy.sh              # 部署脚本
├── AGENTS.md                      # 项目指南（必读）
└── DEVELOPMENT.md                 # 开发指南
```

---

## 关键规则

### Zettelkasten 操作铁律
- **绝对禁止** AI 代理直接执行 SQL、bash 脚本或命令行工具修改数据库
- **正确做法**: 所有读写必须通过 MCP 工具完成

### OpenClaw 配置字段（2026.4.24）
| 错误 | 正确 |
|------|------|
| `agents.default` | `agents.defaults` |
| `agents.defaults.systemPrompt` | `agents.defaults.systemPromptOverride` |
| `skills` 填文件路径 | `skills` 填 skill ID |

### 关键配置（必须）
1. **插件工具暴露**: `tools.alsoAllow` 必须包含 `"zettelkasten"`
2. **systemPromptOverride**: 不支持 `file:` 前缀
3. **部署路径**: `~/.openclaw/zettelkasten-plugin/`

---

## 常用命令

```bash
# 部署插件
bash scripts/deploy.sh

# 测试
npm test                              # 689 tests
npx vitest run src/service/__tests__/heatmap-service.test.ts
npx tsx scripts/benchmark.mjs         # 性能基准
npx tsx scripts/e2e-tool-test.mjs     # E2E 工具链

# OpenClaw
openclaw zk init
openclaw zk doctor
openclaw gateway restart

# GitHub 发布（在 zettelkasten-github/ 目录）
git add -A && git commit -m "..." && git tag v1.x.x && git push origin main --tags
```

---

## 注意事项

- 不要用 `zettelkasten-deployment/` 子集，统一用完整版
- 测试环境需要 Node 22+（`node:sqlite`）
- 部署无需 sudo，路径在 `~/.openclaw/`
- 主仓库 GitHub: https://github.com/cx2002302-lang/zettelkasten-second-memory
