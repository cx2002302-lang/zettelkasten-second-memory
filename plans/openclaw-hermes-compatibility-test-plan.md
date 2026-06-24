# OpenClaw / Hermes 兼容测试环境部署计划

> 目标：为 Zettelkasten 第二记忆系统建立可复现、可自动化的 OpenClaw / Hermes 多版本兼容测试环境。

---

## 1. 背景与目标

Zettelkasten 插件以 MCP 工具形式暴露给 OpenClaw，并通过 Skill（`zettelkasten-brain`）驱动 AI 代理使用这些工具。随着 OpenClaw 与 Hermes 持续迭代，插件需要验证：

- 不同 OpenClaw 版本下的插件加载、配置字段、MCP 工具暴露机制。
- 不同 Hermes 版本（若未来支持 Hermes 网关协议或迁移）下的工具调用兼容性。
- Skill 提示词、系统提示注入、工具策略（`tools.alsoAllow`）的兼容性。

本计划定义如何在一台测试服务器/工作站上，用 Docker 同时运行多个经典版本与最新版本的 OpenClaw / Hermes 实例，执行标准化兼容测试。

---

## 2. 测试版本矩阵

### 2.1 OpenClaw 版本

| 版本标签 | 类型 | 说明 |
|----------|------|------|
| `2026.4.23` | 经典最低版本 | AGENTS.md 中声明的 OpenClaw 最低要求 |
| `2026.4.24` | 当前生产版本 | 用户当前运行版本 |
| `latest` | 最新版本 | `ghcr.io/openclaw/openclaw:latest`，每周拉取一次 |
| `nightly` / `edge` | 前沿版本 | 可选，用于提前发现破坏性变更 |

### 2.2 Hermes Agent 版本

| 版本标签 | 类型 | 说明 |
|----------|------|------|
| `v1.0` 系列 | 经典稳定版 | Hermes 早期稳定版本 |
| `latest` | 最新版本 | `nousresearch/hermes-agent:latest` |

> 注：当前 Zettelkasten 插件主要面向 OpenClaw 设计，Hermes 列为“未来兼容/迁移验证”。若短期内不正式支持 Hermes，可先部署并记录差异，作为架构储备。

### 2.3 Zettelkasten 插件版本

| 版本标签 | 说明 |
|----------|------|
| `current` | 当前工作目录源码（通过 volume 挂载） |
| `v1.0.0-beta.7` | 当前发布版 tarball |
| `last-stable` | 上一个稳定发布版，用于回归 |

---

## 3. 部署架构

### 3.1 总体拓扑

```
┌─────────────────────────────────────────────────────────────┐
│                    测试主机 (Docker Host)                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ openclaw-2026.4.23 │  │ openclaw-2026.4.24 │  │ openclaw-latest │ │
│  │   port: 18790    │  │   port: 18791    │  │ port: 18792  │ │
│  │  data: oc-2026.4.23-data │  data: oc-2026.4.24-data │  data: oc-latest-data │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ hermes-v1.0     │  │ hermes-latest   │                   │
│  │   port: 8642    │  │   port: 8643    │                   │
│  │  data: hermes-v1.0-data │  data: hermes-latest-data │                   │
│  └─────────────────┘  └─────────────────┘                   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │        zettelkasten-test-orchestrator               │   │
│  │  - 分发测试用例                                       │   │
│  │  - 收集结果                                           │   │
│  │  - 生成兼容性报告                                     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 数据隔离原则

每个 OpenClaw / Hermes 实例使用独立 Docker named volume，避免配置、数据库、skill 状态相互污染：

- `oc-<version>-data` → 挂载到容器的 `/root/.openclaw`
- `hermes-<version>-data` → 挂载到容器的 `/root/.hermes`
- 测试时再把 Zettelkasten 插件目录 bind mount 到 `/root/.openclaw/zettelkasten-plugin`

---

## 4. 目录结构

在主机上统一放在 `/opt/zettelkasten-compat/`（或项目内的 `environments/`）：

```
/opt/zettelkasten-compat/
├── docker-compose.yml          # 多实例编排
├── .env                        # API keys、网关 token
├── scripts/
│   ├── bootstrap.sh            # 一键启动所有环境
│   ├── setup-openclaw.sh       # 初始化 OpenClaw 配置
│   ├── setup-hermes.sh         # 初始化 Hermes 配置
│   ├── deploy-zk-plugin.sh     # 向指定容器部署 Zettelkasten 插件
│   └── run-compat-tests.sh     # 执行兼容性测试
├── configs/
│   ├── openclaw-2026.4.23.json
│   ├── openclaw-2026.4.24.json
│   └── openclaw-latest.json
├── plugins/
│   ├── zettelkasten-current -> /home/myxia/.openclaw/project/zettelkasten/src
│   └── zettelkasten-beta.7.tar.gz
└── reports/
    └── 2026-06-24/
        ├── openclaw-2026.4.23.md
        ├── openclaw-2026.4.24.md
        └── summary.md
```

---

## 5. Docker Compose 示例

```yaml
version: "3.9"

services:
  openclaw-2026-4-23:
    container_name: openclaw-2026-4-23
    image: ghcr.io/openclaw/openclaw:2026.4.23
    ports:
      - "18790:18789"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - MINIMAX_API_KEY=${MINIMAX_API_KEY}
    volumes:
      - oc-2026-4-23-data:/root/.openclaw
      - ./plugins/zettelkasten-current:/root/.openclaw/zettelkasten-plugin:ro
      - ./skills/zettelkasten-brain:/root/.openclaw/skills/zettelkasten-brain:ro
    command: ["node", "openclaw.mjs", "gateway", "--bind", "0.0.0.0"]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "openclaw", "status"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 60s

  openclaw-2026-4-24:
    container_name: openclaw-2026-4-24
    image: ghcr.io/openclaw/openclaw:2026.4.24
    ports:
      - "18791:18789"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - MINIMAX_API_KEY=${MINIMAX_API_KEY}
    volumes:
      - oc-2026-4-24-data:/root/.openclaw
      - ./plugins/zettelkasten-current:/root/.openclaw/zettelkasten-plugin:ro
      - ./skills/zettelkasten-brain:/root/.openclaw/skills/zettelkasten-brain:ro
    command: ["node", "openclaw.mjs", "gateway", "--bind", "0.0.0.0"]
    restart: unless-stopped

  openclaw-latest:
    container_name: openclaw-latest
    image: ghcr.io/openclaw/openclaw:latest
    ports:
      - "18792:18789"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - MINIMAX_API_KEY=${MINIMAX_API_KEY}
    volumes:
      - oc-latest-data:/root/.openclaw
      - ./plugins/zettelkasten-current:/root/.openclaw/zettelkasten-plugin:ro
      - ./skills/zettelkasten-brain:/root/.openclaw/skills/zettelkasten-brain:ro
    command: ["node", "openclaw.mjs", "gateway", "--bind", "0.0.0.0"]
    restart: unless-stopped

  hermes-latest:
    container_name: hermes-latest
    image: nousresearch/hermes-agent:latest
    ports:
      - "8642:8642"
      - "9119:9119"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    volumes:
      - hermes-latest-data:/root/.hermes
    restart: unless-stopped

volumes:
  oc-2026-4-23-data:
  oc-2026-4-24-data:
  oc-latest-data:
  hermes-latest-data:
```

---

## 6. 初始化与配置流程

### 6.1 首次启动 OpenClaw 容器

```bash
# 1. 启动容器
docker compose up -d openclaw-2026-4-24

# 2. 进入容器执行 onboard（首次）
docker exec -it openclaw-2026-4-24 openclaw onboard \
  --workspace /root/.openclaw/workspace \
  --gateway-port 18789 \
  --gateway-bind 0.0.0.0

# 3. 部署 Zettelkasten 插件
docker exec openclaw-2026-4-24 bash /root/.openclaw/zettelkasten-plugin/scripts/deploy.sh

# 4. 设置 Skill 提示词
docker exec openclaw-2026-4-24 bash /root/.openclaw/zettelkasten-plugin/scripts/setup-skill-prompt.sh

# 5. 重启 gateway
docker exec openclaw-2026-4-24 openclaw gateway restart
```

### 6.2 配置持久化

首次 onboard 生成的 `openclaw.json` 会保存在 named volume 中。后续重启容器时直接加载，无需重复 onboard。若需批量重置，可运行：

```bash
docker compose down -v
docker compose up -d
```

### 6.3 Hermes 初始化

Hermes 首次启动会进入 wizard，建议通过环境变量预配置：

```bash
docker exec -it hermes-latest hermes setup --non-interactive \
  --provider anthropic \
  --api-key $ANTHROPIC_API_KEY
```

---

## 7. 兼容性测试用例

### 7.1 OpenClaw 插件加载测试

| ID | 用例 | 期望结果 |
|----|------|----------|
| OC-01 | `openclaw plugin list` 能看到 zettelkasten | ✅ 已加载 |
| OC-02 | `openclaw zk doctor` 执行通过 | ✅ 17 OK, 0 FAIL |
| OC-03 | `openclaw config get tools.alsoAllow` 包含 zettelkasten | ✅ 工具暴露正确 |
| OC-04 | `openclaw config get agents.defaults.skills` 包含 zettelkasten-brain | ✅ Skill 已注册 |
| OC-05 | `openclaw config get agents.defaults.systemPromptOverride` 非空且含工具名 | ✅ 提示词注入正确 |
| OC-06 | 调用 `zk_search_notes` 返回结果 | ✅ MCP 工具可调用 |
| OC-07 | 调用 `zk_create_note` 创建笔记 | ✅ 写入正常 |
| OC-08 | 调用 `zk_get_note` 读取笔记 | ✅ 读取正常 |
| OC-09 | 插件配置字段（phase6、feishuWebhook、staleReviewDays）可被识别 | ✅ 不报错 |
| OC-10 | 升级插件版本后 `openclaw zk doctor` 仍通过 | ✅ 迁移兼容 |

### 7.2 Skill 行为测试

| ID | 用例 | 期望结果 |
|----|------|----------|
| SK-01 | 用户提问“我之前记录的 Docker 网络配置是什么？”代理调用 `zk_search_notes` | ✅ 先检索后回答 |
| SK-02 | 用户说“记下来：pnpm 比 npm 快”代理调用 `zk_create_note` | ✅ 自动记录 |
| SK-03 | PROMPT.md 中工具名与实际注册一致 | ✅ 无 `zk_run_ceqrc_workflow` 等错误名称 |

### 7.3 Hermes 兼容探测（若适用）

| ID | 用例 | 期望结果 |
|----|------|----------|
| HE-01 | Hermes 能列出 OpenAI-compatible tools | 记录差异 |
| HE-02 | Hermes 调用 `zk_search_notes` | 记录差异 |
| HE-03 | Hermes 长期记忆与 Zettelkasten 笔记互通 | 未来目标 |

---

## 8. 自动化脚本设计

### 8.1 `scripts/run-compat-tests.sh`

```bash
#!/bin/bash
# 对所有 OpenClaw / Hermes 容器执行兼容性测试

VERSIONS=("openclaw-2026-4-23" "openclaw-2026-4-24" "openclaw-latest")
REPORT_DIR="reports/$(date +%Y-%m-%d-%H%M%S)"
mkdir -p "$REPORT_DIR"

for container in "${VERSIONS[@]}"; do
  echo "Testing $container..."
  report="$REPORT_DIR/$container.md"
  echo "# $container Compatibility Report" > "$report"

  # 插件加载
  docker exec "$container" openclaw plugin list >> "$report" 2>&1

  # doctor
  docker exec "$container" openclaw zk doctor >> "$report" 2>&1

  # 工具调用
  docker exec "$container" openclaw tool call zk_search_notes '{"query":"docker","limit":5}' >> "$report" 2>&1

  # 配置检查
  docker exec "$container" openclaw config get tools.alsoAllow >> "$report" 2>&1
  docker exec "$container" openclaw config get agents.defaults.skills >> "$report" 2>&1
done

echo "Reports saved to $REPORT_DIR"
```

### 8.2 `scripts/reset-all.sh`

```bash
#!/bin/bash
# 重置所有测试环境（清空 volume）
docker compose down -v
docker compose up -d
```

---

## 9. CI/CD 集成建议

1. **GitHub Actions / GitLab CI** 中增加 `compat-matrix` job：
   - 每周一凌晨运行一次。
   - 矩阵变量：`openclaw_version: [2026.4.23, 2026.4.24, latest]`。
   - 使用 `services:` 启动 OpenClaw 容器作为 service。

2. **测试失败通知**：
   - 任意版本 `zk doctor` 失败即标记 job 失败。
   - 生成 Markdown 报告上传到 artifact。

3. **版本升级前 gate**：
   - 在发布新版 Zettelkasten 插件前，必须跑通 `latest` 与 `current-production` 两个 OpenClaw 版本。

---

## 10. 风险与注意事项

| 风险 | 缓解措施 |
|------|----------|
| OpenClaw `latest` 镜像破坏性更新 | 先拉取镜像并跑通 doctor 再纳入 CI；失败时固定到上一个可用版本 |
| 多个 OpenClaw 实例端口冲突 | 使用 18790+ 递增端口，通过 `.env` 集中管理 |
| 数据卷污染导致测试结果不可复现 | 每次完整测试前执行 `docker compose down -v` |
| API key 泄露 | 全部通过 `.env` 注入，`.env` 加入 `.gitignore` |
| Hermes 与 OpenClaw 配置差异大 | 先以“探测/记录差异”为主，不强制要求功能完全一致 |

---

## 11. 里程碑与时间表

| 阶段 | 任务 | 时间估算 |
|------|------|----------|
| M1 | 搭建 `docker-compose.yml` 与目录结构 | 0.5 天 |
| M2 | 实现 OpenClaw 2026.4.23 / 2026.4.24 / latest 三实例 | 1 天 |
| M3 | 实现 Hermes latest 实例与基础探测脚本 | 0.5 天 |
| M4 | 编写 `run-compat-tests.sh` 与报告生成 | 1 天 |
| M5 | 接入 CI/CD（每周自动运行） | 0.5 天 |
| M6 | 跑通首轮全矩阵测试并归档 baseline | 0.5 天 |

**总计约 4 个工作日**。

---

## 12. 下一步行动

1. 在本机或测试服务器创建 `/opt/zettelkasten-compat/` 目录。
2. 准备 `.env` 文件填入 API keys。
3. 复制本计划中的 `docker-compose.yml` 与脚本。
4. 执行 `docker compose up -d` 启动首个 OpenClaw 2026.4.24 实例。
5. 验证 `openclaw zk doctor` 通过后，再扩展矩阵。

---

*计划版本：v1.0.0-beta.7 兼容测试规划*
*更新日期：2026-06-24*
