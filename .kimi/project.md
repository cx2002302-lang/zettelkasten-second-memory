# Zettelkasten Project — 当前进度

> 最后更新: 2026-06-25  
> 当前版本: v1.0.0-beta.8.1 (已推送到 GitHub)  
> 测试状态: 1724 tests, 0 failures, 72 test files

---

## 系统信息

- **OpenClaw 版本**: 2026.4.24 / 2026.6.x（兼容 >= 2026.4.23）
- **Hermes Agent**: v0.17.0+（实验性支持）
- **插件版本**: v1.0.0-beta.8.1
- **Skill 版本**: v1.0.0-beta.3
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


---

## 本次会话已完成工作（2026-06-25）

### 1. OpenClaw 2026.6.x 兼容
- 在 `src/plugin/openclaw.plugin.json` 中声明 `contracts.tools` 工具契约
- 新增 `scripts/lib/compat.sh` 统一版本判断（`oc_version_ge`、`oc_tool_policy_value`）
- 重构 `deploy.sh`、`setup-skill-prompt.sh`、容器部署脚本，自动适配 2026.4.x / 2026.6.x+
- `setup-skill-prompt.sh` 在 >= 2026.6.x 时跳过已废弃的 `systemPromptOverride`

### 2. Hermes Agent 支持
- 新增 `src/mcp/http-bridge.ts`，使用有状态 `StreamableHTTPServerTransport`
- Hermes v0.17.0 已通过 mock / MiniMax 真实 LLM E2E 验证
- 修复 Hermes 配置写入路径为 `/opt/data/config.yaml`
- README/AGENTS/COMPATIBILITY 增加 Hermes 接入说明

### 3. 测试与稳定性
- 修复测试硬编码 `/test` 路径，统一使用 `src/testing/test-fs.ts` 临时目录
- 当前测试套件：**1724 tests, 0 failures, 72 test files**
- 新增 `scripts/run-compat-matrix.sh` 本地兼容性矩阵一键验证

### 4. 文档与发布包清理
- 校对 README.md / README.zh.md / AGENTS.md / docs/COMPATIBILITY.md
- 将 ASCII 系统架构图替换为 Mermaid 图
- 修正 Skill 安装路径为 `skills/brain`
- 从发布包移除 `CHANGELOG.md`、`DEVELOPMENT.md`、`docs/TESTING_GUIDE.md`、`src/PHASE*.md`、`src/INTEGRATION.md`，避免内部路径和死链
- GitHub 仓库 About/Topics 已更新，突出 OpenClaw 2026.6.x 与 Hermes 支持

### 5. GitHub 发布
- 提交并推送 `zettelkasten-github/main` 到 `60d73f5`
- 当前 Tag: `v1.0.0-beta.8.1`（待打 tag）

## 项目当前全景（BACKLOG 简化）

| 优先级 | 事项 | 状态 |
|--------|------|------|
| **P0** | OpenClaw 2026.6.x 兼容 | ✅ 已完成 |
| **P0** | Hermes Agent 接入验证 | ✅ 已完成 |
| **P0** | 修复测试失败 + 补全核心测试 | ✅ 已完成 |
| **P1** | 输入校验和异常处理 | ✅ 已完成 |
| **P1** | 性能基准测试 | ✅ 已完成（后续改用新基准） |
| **P1** | heatmap 边界测试 | ✅ 已完成 |
| **P2** | Phase 5/6 工具接入与文档同步 | ✅ 已完成 |
| **P2** | CLI E2E 测试 | ⏳ 可选，ROI 低 |
| **P3** | 功能开关系统 | ⏳ 未来 |
| **P3** | 语义搜索（sqlite-vec）| ⏳ 未来 |

---

## 下一步建议（按优先级）

### 选项 A: 发布 v1.0.0-beta.9 / v1.0.0 正式版准备
- 打 tag `v1.0.0-beta.8.1` 并生成 Release Notes
- 补充自动化 GitHub Actions 运行兼容性矩阵
- 整理并归档剩余内部 `plans/` 文档

### 选项 B: 功能开关系统
为后续 Wave 打基础，设计模块化启用/禁用机制：
- 每个模块（笔记、链接、归档、审核、反馈等）可独立开关
- 配置字段：`modules: { notes: true, links: true, archive: false, ... }`
- 减少资源占用、降低学习成本

### 选项 C: 优化发光度重计算
当前 10K 笔记约 1s，可改为增量更新或异步后台任务，`autoArchiveZombies()` 同样受益

---

## 项目结构

```
.
├── src/                           # 插件源码
│   ├── plugin/index.ts            # 插件入口（含 MCP 工具 + CLI）
│   ├── service/                   # 业务逻辑
│   ├── repository/                # 数据访问
│   ├── storage/db-schema.ts       # 数据库 Schema
│   ├── mcp/                       # MCP 工具与 HTTP bridge
│   ├── integration/               # OpenClaw 集成
│   ├── examples/                  # 使用示例
│   └── core/                      # 类型定义
├── skills/brain/                  # AI Skill（发布时同步到根目录）
├── zettelkasten-github/           # GitHub 发布仓库镜像
│   ├── docs/assets/               # 信息图
│   ├── docs/COMPATIBILITY.md
│   ├── scripts/deploy.sh
│   └── README.md / README.zh.md / AGENTS.md
├── plans/                         # 设计文档 + BACKLOG.md（内部，不发布）
├── scripts/                       # 部署与辅助脚本
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
npm test                              # 1724 tests
npm run build:bridge                  # 构建 Hermes MCP bridge
npx tsx scripts/benchmark.mjs         # 性能基准
npx tsx scripts/e2e-tool-test.mjs     # E2E 工具链
bash scripts/run-compat-matrix.sh     # 本地兼容性矩阵

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
