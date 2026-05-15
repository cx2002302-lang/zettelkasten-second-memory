# Zettelkasten Project Guidelines

## 系统版本信息（每次思考必须考虑）

- **OpenClaw 版本**: 2026.4.24
- **Zettelkasten 插件版本**: 2026.4.23-v1.0.0-beta.5
- **Skill 版本**: 1.0.0-beta.3
- **Node 要求**: >= 22.14.0（`node:sqlite` 需要 Node 22+）
- **OpenClaw 最低要求**: >= 2026.4.23

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
/root/openclawFiles/
├── openclaw/                          # OpenClaw 源码（嵌入式 git 子模块）
│   ├── src/zettelkasten/              # 完整插件源码（20,028 LOC，577 tests）
│   │   ├── plugin/index.ts            # 插件入口（已修复 zk init + CLI 命令）
│   │   ├── skills/brain/              # Brain Skill（beta）
│   │   ├── service/note-service.ts    # 笔记业务层
│   │   ├── storage/db-schema.ts       # 数据库 Schema
│   │   └── ...
│   └── extensions/zettelkasten/       # 捆绑插件入口
├── zettelkasten-deployment/           # 旧部署包（已废弃，不要用）
├── releases/                          # 发布包
│   ├── zettelkasten-plugin-2026.4.23-v1.0.0.tar.gz
│   └── zettelkasten-skill-v1.0.0.tar.gz
└── plans/                             # 设计文档
```

## 关键修复历史

1. **zk init 修复** — 显式调用 `ensureZettelkastenSchema`，创建所有 11 张表
2. **部署路径** — 从 `/opt/` 迁移到 `~/.openclaw/zettelkasten-plugin/`（无 sudo）
3. **SDK 路径** — 移除 `sed` 替换，使用干净的 `openclaw/plugin-sdk/*` 导入
4. **CLI 命令** — 新增 `new`, `list`, `search`, `show`, `link`, `doctor`
5. **Skill 系统** — 4阶段工作流（检索→记录→关联→归档）
6. **FTS 中文搜索修复** — `note-repository.ts` 实现 FTS + LIKE 双引擎合并搜索
7. **插件工具暴露修复** — 配置 `tools.alsoAllow: ["zettelkasten"]` 使 agent 可见 MCP 工具
8. **systemPromptOverride 修复** — 移除 `file:` 前缀，直接内联 PROMPT.md 内容

## 常用命令

```bash
# 部署插件
bash scripts/deploy.sh

# 初始化
openclaw zk init
openclaw zk doctor

# Skill 激活（注意：systemPromptOverride 不支持 file: 前缀）
openclaw config set skills.load.extraDirs '["~/.openclaw/skills"]'
openclaw config set agents.defaults.skills '["zettelkasten-brain"]'

# 关键：必须配置 tools.alsoAllow，否则 agent 看不到 zk 工具
openclaw config set tools.alsoAllow '["zettelkasten"]'

# systemPromptOverride 需直接填入文本（可用脚本读取文件）
# PROMPT=$(cat ~/.openclaw/skills/zettelkasten-brain/PROMPT.md)
# openclaw config set agents.defaults.systemPromptOverride "$PROMPT"
```

## Zettelkasten 操作铁律（每次涉及 zk 时必须遵守）

> **绝对禁止** AI 代理直接执行 SQL、bash 脚本或命令行工具修改 Zettelkasten 数据库或文件系统。
>
> **正确做法**: 所有对知识库的读写**必须通过 MCP 工具**完成：
> - `zk_search_notes` — 检索
> - `zk_create_note` — 创建
> - `zk_update_note` — 更新
> - `zk_create_link` — 关联
> - `zk_get_note` — 读取
>
> **违反后果**: 直接操作 SQLite 会导致 FTS 索引不一致、链接表损坏、笔记状态丢失。任何绕过 Skill 规则的操作都是不可接受的。

## 注意事项

- **不要用** `zettelkasten-deployment/` 子集，统一用 `openclaw/src/zettelkasten/` 完整版
- **测试环境** — 当前环境 Node v22.22.2，577 个测试全部通过
- **Git** — 主仓库在 `/root/openclawFiles/`，标签 `v1.0.0-beta.1`
