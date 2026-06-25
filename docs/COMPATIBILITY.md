# Zettelkasten 兼容性保障索引

> 本文档是 Zettelkasten 插件与 OpenClaw / Hermes 兼容性的“活记忆”。
> 每次兼容性相关修改前，应先更新本索引；AGENTS.md 会通过链接指向本文档。

---

## 1. 目标

- 明确支持的版本矩阵。
- 记录已知的兼容性坑和 shim（补丁）方案。
- 把版本判断逻辑集中到一处，避免散落在多个 shell 脚本里。
- 提供一键运行的兼容性测试命令。

---

## 2. 版本支持矩阵

| 组件 | 当前验证版本 | 最低要求 | 备注 |
|------|--------------|----------|------|
| Node.js | 22.22.2 | >= 22.14.0 | `node:sqlite` 需要 Node 22+ |
| OpenClaw | 2026.6.10（容器）<br>2026.4.24（生产环境） | >= 2026.4.23 | 2026.6.x 引入 `contracts.tools`；2026.4.x 已部署验证 |
| Hermes Agent | v0.17.0 (latest) | 实验性支持 | 通过 MCP HTTP bridge 接入 |
| MCP Protocol | 2024-11-05 ~ 2025-11-25 | 跟随 SDK | SDK 已支持协商 |

---

## 3. 已知的兼容性坑与修复

### 3.1 OpenClaw 2026.6.x 工具契约

- **表现**：agent 系统提示词里看不到任何 `zk_*` 工具。
- **根因**：2026.6.x 要求插件 manifest 显式声明 `contracts.tools`，未声明时 `api.registerTool` 会被运行时拒绝。
- **修复**：`src/plugin/openclaw.plugin.json` 已声明全部 `zk_*` 工具名；部署脚本增加了 `openclaw plugins registry --refresh`。
- **相关文件**：`src/plugin/openclaw.plugin.json`、`scripts/deploy.sh`、`<test-env>/scripts/deploy-zk-to-container.sh`

### 3.2 `tools.alsoAllow` 版本差异

- **表现**：配置 `tools.alsoAllow: ["zettelkasten"]` 在 2026.6.x 报 `unknown entries`（未声明 contracts 时）。
- **根因**：2026.6.x 工具策略支持 `group:plugins` 和插件 ID 展开。
- **修复**：版本 >= 2026.6 时使用 `["group:plugins"]`；低版本保留 `["zettelkasten"]`。
- **相关文件**：`scripts/deploy.sh`、`scripts/setup-skill-prompt.sh`、`<test-env>/scripts/deploy-zk-to-container.sh`

### 3.3 `systemPromptOverride` 移除

- **表现**：`scripts/setup-skill-prompt.sh` 在 2026.6.x 上设置 `agents.defaults.systemPromptOverride` 失败。
- **根因**：2026.6.x 已移除该字段。
- **修复**：脚本先检测版本，>= 2026.6 时跳过并提示；Skill 通过 `skills.load.extraDirs` 正常加载。
- **相关文件**：`scripts/setup-skill-prompt.sh`

### 3.4 Hermes MCP 连接行为

- **表现**：Hermes agent 连接 MCP bridge 时出现 400 / Method not allowed。
- **根因**：Hermes 会先发 HEAD/GET 探测，且使用新版 MCP 协议 `2025-11-25`；stateless transport 不能复用。
- **修复**：`src/mcp/http-bridge.ts` 使用有状态 `StreamableHTTPServerTransport`（`sessionIdGenerator: () => crypto.randomUUID()`）。
- **相关文件**：`src/mcp/http-bridge.ts`

### 3.5 Hermes 配置路径

- **表现**：`setup-hermes-mcp.sh` 写入 `~/.hermes/config.yaml` 不生效。
- **根因**：Hermes Docker 镜像实际使用 `/opt/data/config.yaml`。
- **修复**：脚本写入 `/opt/data/config.yaml` 并合并已有配置。
- **相关文件**：`<test-env>/scripts/setup-hermes-mcp.sh`

### 3.6 测试硬编码 `/test` 路径

- **表现**：新环境/CI 下单元测试因 `/test` 无写权限失败或告警。
- **根因**：测试文件写死 `/test/notes`、`/test/perf-notes` 等路径。
- **修复**：新增 `src/testing/test-fs.ts`，所有测试改用临时目录。
- **相关文件**：`src/testing/test-fs.ts`、12 个 `__tests__/*.test.ts`

---

## 4. 兼容性抽象层

所有版本判断应集中在：

- **Shell 脚本**：`scripts/lib/compat.sh`
- **Node/TypeScript**：`src/plugin/compatibility.ts`（未来若需要运行时判断）

函数约定：

```bash
# scripts/lib/compat.sh
oc_version_ge "2026.6.0"   # 当前 OpenClaw >= 2026.6.0 返回 0
oc_tool_policy_value        # 输出 "group:plugins" 或 "zettelkasten"
```

脚本应优先调用这些函数，而不是各自写 `grep -qE '^2026\.(6|7|...)'`。

---

## 4. 测试命令

```bash
# 1. 单元测试（1724 cases）
npm test

# 2. Hermes MCP 连通性
docker exec <hermes-container> hermes mcp test zettelkasten

# 3. Hermes + mock LLM E2E（无需 API Key）
bash <test-env>/scripts/run-hermes-zk-e2e.sh <hermes-container>


# 4. OpenClaw agent 工具可见性
openclaw agent --local --to +1234567890 \
  --message '搜索 Zettelkasten 里关于 testing 的笔记' \
  --verbose on --json --timeout 60

# 5. 生产环境 OpenClaw 验证（2026.4.24 实测通过）
bash scripts/deploy.sh
openclaw gateway restart
openclaw zk doctor
openclaw zk search testing
openclaw agent --local --to +1234567890 \
  --message '搜索我的 Zettelkasten 里关于 testing 的笔记，只返回标题和 ID' \
  --verbose on --json --timeout 60
```

---

## 5. TODO（兼容性专项）

- [x] 创建 `scripts/lib/compat.sh` 统一版本判断
- [x] 重构 `scripts/deploy.sh`、`scripts/setup-skill-prompt.sh`、`<test-env>/scripts/deploy-zk-to-container.sh` 调用 compat.sh
- [x] 创建 `scripts/run-compat-matrix.sh`：本地一键跑 OpenClaw + Hermes 容器测试
- [ ] （可选）添加 GitHub Actions workflow 运行兼容性矩阵
- [ ] 在 `openclaw.plugin.json` 中补充 `toolMetadata`（若 OpenClaw 后续需要）
- [ ] 监控上游 release notes，建立“破坏性变更”检查表

---

## 6. 相关文档

- 测试指南：`docs/TESTING_GUIDE.md`
