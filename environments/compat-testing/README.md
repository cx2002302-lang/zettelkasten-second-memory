# Zettelkasten 兼容测试环境

本目录提供在 Docker 中同时运行多版本 OpenClaw 与 Hermes 的兼容测试环境。

## 快速开始

> 前提：已安装 Docker，当前用户属于 `docker` 组；若使用代理，请在 `.env` 中配置。

```bash
# 1. （可选）创建 /opt/zettelkasten-compat 符号链接，方便统一入口
#    需要 root 权限，请复制到终端用 sudo 执行：
#    sudo bash scripts/setup-opt-symlink.sh

# 2. 配置 API Key
#    方式 A：编辑 .env（已存在 .env.example 模板）
#    方式 B：将 key 写入项目仓库外部：
#            /home/myxia/.openclaw/project/zettelkasten-secrets/minimax.env
#            start-container.sh 会自动加载该外部目录的 *.env
#            （防止 API Key 随仓库发布泄露）

# 3. 启动并部署 OpenClaw 三个版本
bash scripts/start-container.sh openclaw-2026-4-23
bash scripts/deploy-zk-to-container.sh openclaw-2026-4-23

bash scripts/start-container.sh openclaw-2026-4-24
bash scripts/deploy-zk-to-container.sh openclaw-2026-4-24

bash scripts/start-container.sh openclaw-latest
bash scripts/deploy-zk-to-container.sh openclaw-latest

# 3. 启动 Hermes
bash scripts/start-container.sh hermes-latest

# 4. 运行兼容测试并生成报告
bash scripts/run-compat-tests.sh

# 5. （可选）使用 OpenClaw agent CLI 对项目内容进行测试
bash scripts/run-agent-project-test.sh openclaw-2026-4-24 health
bash scripts/run-agent-project-test.sh openclaw-2026-4-24 review
```

## 端口映射

| 容器 | 镜像 | 宿主机端口 | 容器内端口 |
|------|------|-----------|-----------|
| openclaw-2026-4-23 | ghcr.io/openclaw/openclaw:2026.4.23 | 18890 | 18789 |
| openclaw-2026-4-24 | ghcr.io/openclaw/openclaw:2026.4.24 | 18891 | 18789 |
| openclaw-latest | ghcr.io/openclaw/openclaw:latest | 18892 | 18789 |
| hermes-latest | nousresearch/hermes-agent:latest | 8652 / 9129 | 8642 / 9119 |

> 生产环境 OpenClaw 已占用宿主机 18791，因此测试环境使用 18890–18892。

## 已知兼容性差异

- **OpenClaw 2026.6.x (`latest`) 已移除 `agents.defaults.systemPromptOverride`**。
  因此 `openclaw-latest` 的测试报告中 `systemPromptOverride` 列为 `⚠️`，
  不影响 Zettelkasten 插件核心功能（`zk doctor` 与 zk 系列命令均通过）。

- **MiniMax CN key（`sk-cp-` 前缀）在 `latest` 上需走 OpenAI-compatible 端点**：
  `deploy-zk-to-container.sh` 会自动配置 `minimax-openai` 自定义 provider（`https://api.minimaxi.com/v1`），Agent 测试已成功调用。

- **`openclaw agent --local` 在 2026.4.x 上会挂起**：
  在 codex catalog fallback 后挂起，生产环境同样复现，与 Docker 无关。
  `run-agent-project-test.sh` 在 2026.4.x 会自动改用 Gateway 模式；2026.6.x+ 使用 `--local`。

- **Hermes 默认 `hermes` 命令为交互式 TUI**，无终端会自动退出。
  测试环境使用 `sleep infinity` 保持容器存活，便于版本探测。

## 一键检测 / 关闭 / 重启

```bash
# 查看所有测试容器状态
bash scripts/manage-test-env.sh status

# 停止所有测试容器（保留容器与数据，可再次 start）
bash scripts/manage-test-env.sh stop

# 停止并删除容器
bash scripts/manage-test-env.sh stop -r

# 停止并删除容器 + 清空数据卷（危险）
bash scripts/manage-test-env.sh stop -v

# 重启所有测试容器
bash scripts/manage-test-env.sh restart

# 查看指定容器日志
bash scripts/manage-test-env.sh logs openclaw-latest
```

## 重置环境

```bash
bash scripts/reset-all.sh
```

## 目录结构

```
.
├── docker-compose.yml          # 参考配置（当前 docker-compose v1 不兼容新版 Docker，请以脚本为准）
├── .env.example                # 环境变量示例
├── .gitignore                  # 排除 .env / secrets / reports
├── PROBLEMS.md                 # 测试已知问题汇总
├── config/
│   └── openclaw-container.json # 2026.4.x 容器化预置配置
├── secrets/                    # 敏感配置文件说明（不被 Git 跟踪）
│   └── minimax.env.location    # 指向外部真实 key 文件位置
├── scripts/
│   ├── start-container.sh          # 启动单个容器
│   ├── deploy-zk-to-container.sh   # 向 OpenClaw 容器部署 Zettelkasten
│   ├── run-compat-tests.sh         # 运行全部测试并生成报告
│   ├── run-agent-project-test.sh   # 使用 OpenClaw agent CLI 测试项目内容
│   ├── manage-test-env.sh          # 一键检测/关闭/重启测试容器
│   ├── reset-all.sh                # 重置环境
│   ├── retry-pull.sh               # 代理不稳定时循环拉取镜像
│   ├── setup-opt-symlink.sh        # 创建 /opt/zettelkasten-compat 符号链接
│   └── install-docker.sh           # Docker 安装参考脚本
└── reports/                      # 测试报告输出目录
```

## 报告

- 兼容报告：`reports/2026-06-25-120531/summary.md`
- 全量报告（含 Agent 测试与问题高亮）：`reports/2026-06-25-120531/full-report.md`
- 问题跟踪：`PROBLEMS.md`
