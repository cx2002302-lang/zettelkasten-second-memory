# Zettelkasten 兼容测试环境

在 Docker 中并行运行多版本 OpenClaw 与 Hermes Agent，验证：

- Zettelkasten plugin 在不同 OpenClaw 版本下的兼容性
- Hermes MCP bridge 在不同 Hermes 版本下的兼容性
- 防止未经测试的变更部署到生产后导致系统崩溃

## 容器服务

| 容器 | 基础镜像 | 宿主机端口 | 说明 |
|------|---------|-----------|------|
| openclaw-latest | ghcr.io/openclaw/openclaw:latest | 18892 (gateway) / 19092 (MCP) | 滚动 latest，提前暴露新兼容问题 |
| openclaw-prod-mirror | ghcr.io/openclaw/openclaw:2026.4.24 | 18891 (gateway) / 19091 (MCP) | 与生产环境一致 |
| hermes-latest | nousresearch/hermes-agent:latest | 8652 / 9129 | 滚动 latest |
| hermes-prod-mirror | nousresearch/hermes-agent:0.17.0（本地固定 tag） | 8653 / 9130 | 与生产环境一致（v0.17.0） |

> 生产环境 OpenClaw 已占用宿主机 18791，测试环境使用 18891–18892 / 8652–8653。

## 快速开始

```bash
cd environments/compat-testing

# 1. 配置 API Key（.env 已被 .gitignore 排除）
cp .env.example .env   # 然后编辑填入真实 key

# 2. 启动全部 4 个容器（自动构建本地镜像、创建网络、固定 hermes 生产 tag）
make up

# 3. 部署 Zettelkasten 到 OpenClaw 容器（全新数据卷才需要；复用已有卷可跳过）
bash scripts/deploy-zk-to-container.sh openclaw-prod-mirror
bash scripts/deploy-zk-to-container.sh openclaw-latest

# 4. 运行兼容性测试，报告写入 reports/<时间戳>/
make test

# 5. 测试完毕，完全关闭
make down
```

其他常用目标：`make ps`（状态）、`make logs`（日志，`make logs S=openclaw-latest` 看单个）、`make clean`（容器+数据卷+本地镜像完全清理）、`make seed`（为全新 prod-mirror 数据卷播种预置配置）、`make pull`（刷新 latest 上游镜像）。

## 敏感信息管理

- 所有 API Key 放在 `.env`，`docker-compose.yml` 通过 `env_file` 整体注入 4 个容器。
- `.env` 已被 `.gitignore` 排除；`.env.example` 是模板，只含占位符。
- MiniMax key（`sk-cp-` 前缀）在 OpenClaw latest 上由 `deploy-zk-to-container.sh` 自动配置
  `minimax-openai` provider（`https://api.minimaxi.com/v1`）。

## 版本固定

- OpenClaw 生产版本由 `.env` 的 `OPENCLAW_PROD_VERSION` 控制（默认 2026.4.24，与 `openclaw --version` 的生产版本一致）。
- Hermes 上游在 Docker Hub 只发布 `latest` tag。`make pin-hermes-prod` 会把本地已验证为
  v0.17.0 的 `nousresearch/hermes-agent:latest` 固化为 `nousresearch/hermes-agent:0.17.0`，
  `hermes-prod-mirror` 即从该固定 tag 构建，避免滚动 latest 漂移。版本号由 `.env` 的
  `HERMES_PROD_TAG` 控制。生产 Hermes 升级后：先 `make pull`，确认 `hermes-latest`
  容器内 `hermes --version`，再更新 `HERMES_PROD_TAG` 并重新 `make pin-hermes-prod`。

## 两层关闭保障

所有容器不测试时必须能完全关闭：

1. **Makefile（日常）**
   - `make down` — 停止并删除全部测试容器（保留数据卷）
   - `make clean` — 追加删除数据卷与本地构建镜像
2. **scripts/cleanup-docker.sh（兜底，可无人值守）**
   - 按容器名 + label + compose 项目三重匹配，强制停止并删除所有
     compat-testing 容器（包括脚本时代遗留的 `openclaw-2026-4-23/24`）
   - 支持 `--volumes`（连数据卷一起删）、`--network`、`--dry-run`
   - 建议 cron 每天 03:00 执行，防止忘记关闭：

     ```cron
     0 3 * * * /home/myxia/.openclaw/project/zettelkasten/environments/compat-testing/scripts/cleanup-docker.sh >> /home/myxia/.openclaw/project/zettelkasten/environments/compat-testing/reports/cleanup.log 2>&1
     ```

## Compose 工具链

Makefile 按以下顺序自动探测：

1. `bin/docker-compose` — 项目内置 v2+ standalone（已 gitignore，约 70MB；
   删除后可从 https://github.com/docker/compose/releases 下载 `docker-compose-linux-x86_64` 恢复）
2. `docker compose` 插件
3. 系统 `docker-compose`（v1.29.2，当前可用，但不保证未来 Docker API 兼容性）

## 已知兼容性差异

- **OpenClaw 2026.6.x (`latest`) 已移除 `agents.defaults.systemPromptOverride`**：
  测试报告中该列为 `⚠️`，不影响 Zettelkasten 插件核心功能。
- **`openclaw agent --local` 在 2026.4.x 上挂起**（codex catalog fallback 后）：
  生产环境同样复现，与 Docker 无关；`run-agent-project-test.sh` 会自动改用 Gateway 模式。
- **Hermes 默认命令是交互式 TUI**，无终端会自动退出：
  测试容器以 `sleep infinity` 保持存活，通过 `docker exec` 探测与测试。

## 目录结构

```
.
├── docker-compose.yml          # 4 服务编排定义（compose v2 语法）
├── Dockerfile.openclaw         # OpenClaw 测试镜像（build arg 固定版本）
├── Dockerfile.hermes           # Hermes 测试镜像（build arg 固定版本）
├── Makefile                    # up / down / logs / test / clean（第 1 层关闭保障）
├── .env                        # API Key 等敏感配置（gitignore，勿提交）
├── .env.example                # 环境变量模板
├── bin/docker-compose          # 内置 compose v2+ standalone（gitignore）
├── config/
│   ├── openclaw-container.json # OpenClaw 2026.4.x 容器预置配置（make seed 播种）
│   └── hermes-container.yaml   # Hermes MCP 配置模板
├── secrets/                    # 外部敏感配置指针（不被 Git 跟踪）
├── scripts/
│   ├── cleanup-docker.sh           # 强制清理全部 compat-testing 容器（第 2 层保障，cron 03:00）
│   ├── start-container.sh          # 兼容旧用法：docker run 启动单个容器
│   ├── deploy-zk-to-container.sh   # 向 OpenClaw 容器部署 Zettelkasten
│   ├── run-compat-tests.sh         # 兼容性测试矩阵（make test 调用）
│   ├── run-agent-project-test.sh   # OpenClaw agent CLI 项目内容测试
│   ├── manage-test-env.sh          # 状态/停止/重启（旧脚本，已被 Makefile 覆盖）
│   └── ...                         # 其余 Hermes/MCP/E2E 辅助脚本
└── reports/                    # 测试报告输出目录（gitignore）
```

## 历史报告与问题

- 最近兼容报告：`reports/2026-06-25-120531/summary.md`
- 已知问题跟踪：`PROBLEMS.md`
