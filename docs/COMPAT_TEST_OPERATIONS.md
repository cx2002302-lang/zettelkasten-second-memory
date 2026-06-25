# 兼容测试环境操作规范（SOP）

> 本文档规范 Zettelkasten 插件在 OpenClaw / Hermes 多版本环境下的兼容测试操作流程。
> 
> **位置**: `docs/COMPAT_TEST_OPERATIONS.md`  
> **适用**: 项目内 `environments/compat-testing/`，也可通过 `scripts/setup-opt-symlink.sh` 链接到 `/opt/zettelkasten-compat/`

---

## 1. 环境概览

兼容测试环境通过原始 `docker run` 脚本同时运行多个 OpenClaw / Hermes 实例（当前主机的 `docker-compose` v1 与新版 Docker API 不兼容，因此不使用 `docker compose up`）。

每个实例：

- 使用独立 named volume 持久化配置与数据。
- 监听独立端口，避免冲突。
- 挂载同一份 Zettelkasten 项目源码到 `/opt/zettelkasten-source`。

默认实例：

| 服务名 | 容器名 | 外部端口 | 目标版本 |
|--------|--------|----------|----------|
| `openclaw-2026-4-23` | `openclaw-2026-4-23` | `18890` | `ghcr.io/openclaw/openclaw:2026.4.23+` |
| `openclaw-2026-4-24` | `openclaw-2026-4-24` | `18891` | `ghcr.io/openclaw/openclaw:2026.4.24` |
| `openclaw-latest` | `openclaw-latest` | `18892` | `ghcr.io/openclaw/openclaw:latest` |
| `hermes-latest` | `hermes-latest` | `8652` / `9129` | `nousresearch/hermes-agent:latest` |

> 生产环境 OpenClaw 已占用宿主机 18791，因此测试环境使用 18890–18892。

---

## 2. 前置准备

1. 安装 Docker 并将当前用户加入 `docker` 组。
2. （可选）复制 `environments/compat-testing/.env.example` 为 `.env` 并填入 API key；
   或更推荐将 key 写入项目仓库外部：
   `/home/myxia/.openclaw/project/zettelkasten-secrets/<provider>.env`
   （如 `minimax.env`），`start-container.sh` 会自动加载。
   本仓库 `secrets/*.location` 只记录外部文件位置，防止 API Key 泄露。
3. （可选）创建 `/opt/zettelkasten-compat` 符号链接（需要 root）：
   ```bash
   sudo bash environments/compat-testing/scripts/setup-opt-symlink.sh
   ```

---

## 3. 日常操作

### 3.1 启动全部环境

```bash
cd environments/compat-testing

bash scripts/start-container.sh openclaw-2026-4-23
bash scripts/start-container.sh openclaw-2026-4-24
bash scripts/start-container.sh openclaw-latest
bash scripts/start-container.sh hermes-latest
```

### 3.2 部署 Zettelkasten 插件

```bash
bash scripts/deploy-zk-to-container.sh openclaw-2026-4-23
bash scripts/deploy-zk-to-container.sh openclaw-2026-4-24
bash scripts/deploy-zk-to-container.sh openclaw-latest
```

### 3.3 一键检测与关闭

```bash
# 查看所有测试容器状态
bash scripts/manage-test-env.sh status

# 停止所有测试容器（保留数据）
bash scripts/manage-test-env.sh stop

# 停止并删除容器 + 清空数据卷
bash scripts/manage-test-env.sh stop -v
```

### 3.4 停止单个容器

```bash
docker stop openclaw-latest
```

### 3.5 重置单个环境

```bash
# 删除容器和 volume 后重新启动/部署
docker rm -f openclaw-latest
docker volume rm compat-testing_oc-latest-data
bash scripts/start-container.sh openclaw-latest
bash scripts/deploy-zk-to-container.sh openclaw-latest
```

### 3.6 重置全部环境（谨慎）

```bash
bash scripts/reset-all.sh
```

此操作会删除所有 named volume，所有配置、笔记、skill 状态清空，仅保留源码挂载。

---

## 4. 初始化流程

### 4.1 OpenClaw 初始化

2026.4.x 版本使用预置的 `config/openclaw-container.json` 启动，无需交互式 onboard。

`latest`（2026.6.x）版本配置格式有变化，脚本会以 `--allow-unconfigured` 启动后再通过 CLI 注入必要配置。

### 4.2 健康检查

```bash
docker exec openclaw-2026-4-24 openclaw zk doctor
docker exec openclaw-2026-4-24 openclaw zk status
```

必须满足：`17 OK, 0 WARN, 0 FAIL`。

### 4.3 Hermes 探测

Hermes 默认命令为交互式 TUI，测试环境使用 `sleep infinity` 保持容器存活：

```bash
docker exec hermes-latest hermes --version
```

---

## 5. 运行兼容测试

### 5.1 手动运行

```bash
bash scripts/run-compat-tests.sh
```

脚本会对每个 OpenClaw / Hermes 实例执行：
1. `openclaw plugins list` / `hermes --version`
2. `openclaw zk doctor`
3. `openclaw zk search` / `openclaw zk new` / `openclaw zk show`
4. 检查 `tools.alsoAllow`、`agents.defaults.skills`、`systemPromptOverride`
5. 生成 Markdown 报告到 `reports/<timestamp>/`

### 5.2 Agent 项目内容测试

使用容器内 agent CLI，结合挂载的项目源码和 MiniMax API Key，对项目进行健康度/审查测试。

> **注意**：
> - OpenClaw 2026.6.x+ 内置 minimax provider 默认走 Anthropic 适配，与 `sk-cp-` 前缀的 CN key 不兼容。`deploy-zk-to-container.sh` 会自动为 `latest` 配置 `minimax-openai` 自定义 provider（OpenAI-compatible，baseUrl `https://api.minimaxi.com/v1`）。
> - OpenClaw 2026.4.24 的 `openclaw agent --local` 存在挂起问题（codex catalog fallback 后卡住），生产环境同样复现。Agent CLI 测试建议优先使用 `openclaw-latest`。

```bash

```bash
# 健康度模式：阅读 AGENTS.md、plugin manifest，并调用 zk 工具审计知识库
bash scripts/run-agent-project-test.sh openclaw-2026-4-24 health

# 审查模式：阅读核心代码并调用 zk 搜索，给出代码评估
bash scripts/run-agent-project-test.sh openclaw-2026-4-24 review

# 自定义 prompt
bash scripts/run-agent-project-test.sh openclaw-2026-4-24 "请检查..."
```

报告输出到 `reports/agent-tests/<container>-<timestamp>.md`。

### 5.3 查看报告

```bash
ls -lt reports/ | head
# 查看最新兼容测试报告
cat reports/$(ls -t reports/ | head -1)/summary.md

# 查看最新 agent 测试报告
ls -lt reports/agent-tests/ | head
```

### 5.3 持续集成运行

CI 中直接调用：

```bash
bash scripts/run-compat-tests.sh --ci
```

`--ci` 模式下：
- 任意实例 `zk doctor` 失败即返回非零退出码。
- 报告输出到 `reports/<timestamp>/`。
- 不启动交互式 onboard。

---

## 6. 版本更新操作

详见 `docs/COMPAT_TEST_VERSION_POLICY.md`。简版流程：

1. 在 `scripts/start-container.sh` 中新增/修改服务。
2. 更新 `.env` 中对应的 API key / token。
3. 拉取新镜像（代理不稳定时可用 `scripts/retry-pull.sh`）。
4. 执行初始化与部署脚本。
5. 跑通 `run-compat-tests.sh`。
6. 更新 `docs/COMPAT_TEST_VERSION_POLICY.md` 中的版本矩阵。

---

## 7. 故障排查

### 7.1 容器无法启动

```bash
docker logs openclaw-latest
```

### 7.2 `openclaw zk doctor` 失败

```bash
# 重新部署插件
bash scripts/deploy-zk-to-container.sh openclaw-latest

# 或进入容器手动修复
docker exec -it openclaw-latest bash
```

### 7.3 工具不可见

检查：
```bash
docker exec openclaw-latest openclaw config get tools.alsoAllow
docker exec openclaw-latest openclaw config get plugins.entries.zettelkasten
docker exec openclaw-latest openclaw config get agents.defaults.skills
```

### 7.4 端口冲突

```bash
ss -tlnp | grep 18789
ss -tlnp | grep 1889
# 修改 scripts/start-container.sh 中的外部端口后重启
```

### 7.5 数据卷损坏

直接重置：
```bash
docker rm -f openclaw-latest
docker volume rm compat-testing_oc-latest-data
bash scripts/start-container.sh openclaw-latest
bash scripts/deploy-zk-to-container.sh openclaw-latest
```

### 7.6 拉取镜像被代理重置

```bash
bash scripts/retry-pull.sh ghcr.io/openclaw/openclaw:latest 30
bash scripts/retry-pull.sh nousresearch/hermes-agent:latest 30
```

---

## 8. 安全规范

- **API key 不得硬编码**：仅通过 `.env` 注入，`.env` 必须加入 `.gitignore`。
- **网关 token 定期轮换**：建议每 90 天更新。
- **测试数据隔离**：所有自动生成的测试笔记标题带 `[TEST]` 前缀，便于清理。
- **不暴露管理端口到公网**：若需远程访问，必须通过反向代理 + HTTPS，并限制 IP。

---

## 9. 检查清单

每次发布新版 Zettelkasten 插件前，必须完成：

- [ ] 所有 OpenClaw 版本实例 `openclaw zk doctor` 通过
- [ ] `zk_search`、`zk_new`、`zk_show` 均可调用
- [ ] `tools.alsoAllow` 包含 `zettelkasten`
- [ ] `agents.defaults.skills` 包含 `zettelkasten-brain`
- [ ] `systemPromptOverride` 已设置或已记录为已知差异（OpenClaw >= 2026.6.x）
- [ ] 报告已归档到 `reports/`
- [ ] Hermes 探测结果已记录

---

*版本：v1.0.0-beta.8.1*  
*更新日期：2026-06-24*
