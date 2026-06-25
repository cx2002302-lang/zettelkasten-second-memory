# Zettelkasten Project Guidelines

## 系统版本信息（每次思考必须考虑）

- **OpenClaw 版本**: 2026.6.10（兼容 2026.4.23+）
- **Zettelkasten 插件版本**: 1.0.0-beta.7
- **Skill 版本**: 1.0.0-beta.2
- **Node 要求**: >= 22.14.0（`node:sqlite` 需要 Node 22+）
- **OpenClaw 最低要求**: >= 2026.4.23

## OpenClaw 2026.6.x 兼容性变更

2026.6.x 引入了基于 `contracts.tools` 的插件工具契约：

1. **插件 manifest 必须声明 `contracts.tools`**（已在 `src/plugin/openclaw.plugin.json` 中补齐全部 `zk_*` 工具名）。未声明时，运行时 `api.registerTool(...)` 会被拒绝，agent 看不到任何 zk 工具。
2. **工具 allowlist** 仍通过 `tools.alsoAllow` 配置，但推荐使用插件 ID 或 `group:plugins`：
   - `2026.4.x`：`tools.alsoAllow: ["zettelkasten"]`
   - `2026.6.x+`：`tools.alsoAllow: ["group:plugins"]` 或 `["zettelkasten"]`（两者在 manifest 声明 contracts 后都会被正确展开为具体工具）
3. **systemPromptOverride 已移除**：2026.6.x+ 不再接受 `agents.defaults.systemPromptOverride`，Skill 通过 `skills.load.extraDirs` 正常加载即可。
4. **修改 manifest 后需要刷新插件索引**：
   ```bash
   openclaw plugins registry --refresh
   openclaw gateway restart
   ```

## OpenClaw 2026.4.24 配置字段备忘

| 常见错误 | 正确字段 |
|---------|---------|
| `agents.default` | `agents.defaults` |
| `agents.defaults.systemPrompt` | `agents.defaults.systemPromptOverride` |
| `agents.defaults.skills` 填文件路径 | `agents.defaults.skills` 填 skill ID（如 `["zettelkasten-brain"]`） |

### ⚠️ 关键配置（部署时必须检查）

1. **插件工具暴露** — `tools.alsoAllow` 应包含 `"zettelkasten"`：
   ```json
   {
     "tools": {
       "profile": "coding",
       "alsoAllow": ["zettelkasten"]
     }
   }
   ```
   > 否则 agent 无法调用 `zk_search_notes` 等 MCP 工具。

   > **⚠️ 注意**: `alsoAllow` 中**不要放入 Skill ID**（如 `"zettelkasten-brain"`）。`alsoAllow` 只接受 **Tool Name**（以 `zk_` 为前缀的工具名，如 `"zk_search_notes"`、`"zk_create_note"` 等）。放入 Skill ID 会导致 OpenClaw Gateway 工具策略验证失败，引发崩溃-重启循环（BUG-001）。

2. **systemPromptOverride** — 不支持 `file:` 前缀，需直接填入文本内容：
   ```bash
   # 错误
   openclaw config set agents.defaults.systemPromptOverride "file:..."
   
   # 正确：直接写入文本（或通过脚本读取文件内容后设置）
   ```

Skill 目录注册（两种路径都兼容）：
```json
{
  "skills": {
    "load": {
      "extraDirs": ["~/.openclaw/skills"]
    }
  }
}
```
> **说明**: Skill 可以部署到 `~/.openclaw/skills/`（全局）或 `~/.openclaw/workspace/skills/`（workspace 内）。OpenClaw 都会自动扫描。推荐统一使用 `~/.openclaw/skills/`。

## 项目结构

```
/home/myxia/.openclaw/project/zettelkasten/      # 当前项目根目录
├── src/                                         # 完整插件源码
│   ├── plugin/index.ts                          # 插件入口（zk init + CLI 命令）
│   ├── skills/brain/                            # Brain Skill（beta）
│   ├── service/note-service.ts                  # 笔记业务层
│   ├── storage/db-schema.ts                     # 数据库 Schema（约 15 张表）
│   └── ...
├── zettelkasten-release/                        # 清理后的发布目录
├── zettelkasten-github/                         # GitHub 镜像副本
├── releases/                                    # 发布包
│   ├── zettelkasten-plugin-1.0.0-beta.7.tar.gz
│   └── zettelkasten-skill-v1.0.0-beta.6.tar.gz
├── scripts/                                     # 部署与辅助脚本
├── skills/                                      # Brain Skill 源码
└── plans/                                       # 设计文档
```

## 关键修复历史

1. **zk init 修复** — 显式调用 `ensureZettelkastenSchema`，创建所有核心表（约 15 张，含 virtual FTS）
2. **部署路径** — 从 `/opt/` 迁移到 `~/.openclaw/zettelkasten-plugin/`（无 sudo）
3. **SDK 路径** — 移除 `sed` 替换，使用干净的 `openclaw/plugin-sdk/*` 导入
4. **CLI 命令** — 新增 `new`, `list`, `search`, `show`, `link`, `doctor`
5. **Skill 系统** — 4阶段工作流（检索→记录→关联→归档）
6. **FTS 中文搜索修复** — `note-repository.ts` 实现 FTS + LIKE 双引擎合并搜索
7. **插件工具暴露修复** — 配置 `tools.alsoAllow: ["zettelkasten"]` 使 agent 可见 MCP 工具
8. **systemPromptOverride 修复** — 移除 `file:` 前缀，直接内联 PROMPT.md 内容
9. **OpenClaw 2026.6.x 兼容** — 在 `openclaw.plugin.json` 中声明 `contracts.tools`，并刷新插件索引
10. **Hermes MCP Bridge** — 新增 `src/mcp/http-bridge.ts`，将 Zettelkasten MCP 工具以 Streamable HTTP 暴露给 Hermes Agent

## 常用命令

```bash
# 部署插件
bash scripts/deploy.sh

# 初始化
openclaw zk init
openclaw zk doctor

# Skill 激活
openclaw config set skills.load.extraDirs '["~/.openclaw/skills"]'
openclaw config set agents.defaults.skills '["zettelkasten-brain"]'

# 关键：必须配置 tools.alsoAllow，否则 agent 看不到 zk 工具
# 2026.4.x
openclaw config set tools.alsoAllow '["zettelkasten"]'
# 2026.6.x+（推荐）
openclaw config set tools.alsoAllow '["group:plugins"]'

# 修改 plugin manifest 后刷新索引
openclaw plugins registry --refresh
openclaw gateway restart

# Hermes Agent 接入（测试环境）
npm run build:bridge
bash environments/compat-testing/scripts/deploy-zk-to-container.sh openclaw-latest
bash environments/compat-testing/scripts/setup-hermes-mcp.sh hermes-latest openclaw-latest
docker exec hermes-latest hermes mcp test zettelkasten

# Hermes + Zettelkasten 端到端测试（无需 API Key，使用 mock LLM）
bash environments/compat-testing/scripts/run-hermes-zk-e2e.sh hermes-latest

# Hermes + Zettelkasten 真实 LLM 端到端测试（MiniMax）
# 需先准备 environments/compat-testing/secrets/minimax.env
bash environments/compat-testing/scripts/run-hermes-zk-e2e-real.sh hermes-latest
```

## Zettelkasten 操作铁律（每次涉及 zk 时必须遵守）

> **绝对禁止** AI 代理直接执行 SQL、bash 脚本或命令行工具修改 Zettelkasten 数据库或文件系统。
>
> **正确做法**: 所有对知识库的读写**必须通过 MCP 工具**完成：
> - `zk_search_notes` — 检索
> - `zk_create_note` — 创建
> - `zk_update_note` — 更新
> - `zk_create_link` / `zk_create_note` / `zk_update_note` — 关联与写入
> - `zk_get_note` — 读取
>
> **违反后果**: 直接操作 SQLite 会导致 FTS 索引不一致、链接表损坏、笔记状态丢失。任何绕过 Skill 规则的操作都是不可接受的。

## 注意事项

- **不要用** `zettelkasten-deployment/` 子集，统一用本项目 `src/` 完整版
- **测试环境** — 当前环境 Node v22.22.2，1724 个测试全部通过
- **Git** — 主仓库为当前目录 `/home/myxia/.openclaw/project/zettelkasten/`，最近提交 `备份: v1.0.0-beta.7 发布完成`
