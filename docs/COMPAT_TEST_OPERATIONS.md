# 兼容测试环境操作规范（SOP）

> 本文档规范 Zettelkasten 插件在 OpenClaw / Hermes 多版本环境下的兼容测试操作流程。
> 
> **位置**: `docs/COMPAT_TEST_OPERATIONS.md`  
> **适用**: 测试主机 `/opt/zettelkasten-compat/` 或项目内 `environments/compat-testing/`

---

## 1. 环境概览

兼容测试环境通过 Docker Compose 同时运行多个 OpenClaw / Hermes 实例，每个实例：

- 使用独立 named volume 持久化配置与数据。
- 监听独立端口，避免冲突。
- 挂载同一份 Zettelkasten 插件源码（`plugins/zettelkasten-current`）。

默认实例：

| 服务名 | 容器名 | 外部端口 | 目标版本 |
|--------|--------|----------|----------|
| `openclaw-2026-4-23` | `openclaw-2026-4-23` | `18790` | `ghcr.io/openclaw/openclaw:2026.4.23` |
| `openclaw-2026-4-24` | `openclaw-2026-4-24` | `18791` | `ghcr.io/openclaw/openclaw:2026.4.24` |
| `openclaw-latest` | `openclaw-latest` | `18792` | `ghcr.io/openclaw/openclaw:latest` |
| `hermes-latest` | `hermes-latest` | `8642` / `9119` | `nousresearch/hermes-agent:latest` |

---

## 2. 日常操作

### 2.1 启动全部环境

```bash
cd /opt/zettelkasten-compat
docker compose up -d
```

首次启动后，OpenClaw 实例尚未完成 `onboard`，需要按 2.3 节初始化。

### 2.2 停止全部环境

```bash
cd /opt/zettelkasten-compat
docker compose down
```

> 数据保留在 named volume 中，下次 `up` 可直接恢复。

### 2.3 重置单个环境

```bash
# 停止并删除指定容器及其 volume
docker compose down -v openclaw-latest

# 重新启动
docker compose up -d openclaw-latest

# 重新初始化
docker exec -it openclaw-latest openclaw onboard
```

### 2.4 重置全部环境（谨慎）

```bash
./scripts/reset-all.sh
```

此操作会删除所有 named volume，所有配置、笔记、skill 状态清空，仅保留源码挂载。

---

## 3. 初始化流程

### 3.1 OpenClaw 初始化

首次启动后，必须进入容器完成 `onboard`：

```bash
docker exec -it openclaw-2026-4-24 openclaw onboard \
  --workspace /root/.openclaw/workspace \
  --gateway-port 18789 \
  --gateway-bind 0.0.0.0
```

按提示配置：
- 模型 provider（MiniMax / OpenAI / Anthropic 等）
- API key
- gateway token
- allowed origins

### 3.2 部署 Zettelkasten 插件

```bash
./scripts/deploy-zk-to-container.sh openclaw-2026-4-24
```

脚本内部执行：
1. 在容器内运行插件部署脚本。
2. 设置 `tools.alsoAllow`。
3. 设置 `agents.defaults.skills`。
4. 注入 `systemPromptOverride`。
5. 重启 gateway。

### 3.3 健康检查

```bash
docker exec openclaw-2026-4-24 openclaw zk doctor
docker exec openclaw-2026-4-24 openclaw zk status
```

必须满足：`17 OK, 0 WARN, 0 FAIL`。

### 3.4 Hermes 初始化

```bash
docker exec -it hermes-latest hermes setup --non-interactive \
  --provider anthropic \
  --api-key $ANTHROPIC_API_KEY
```

---

## 4. 运行兼容测试

### 4.1 手动运行

```bash
./scripts/run-compat-tests.sh
```

脚本会对每个 OpenClaw / Hermes 实例执行：
1. `openclaw plugin list` / `hermes --version`
2. `openclaw zk doctor`
3. 调用 `zk_search_notes`、`zk_create_note`、`zk_get_note`
4. 检查 `tools.alsoAllow`、`agents.defaults.skills`、`systemPromptOverride`
5. 生成 Markdown 报告到 `reports/<timestamp>/`

### 4.2 查看报告

```bash
ls -lt reports/ | head
# 查看最新报告
cat reports/$(ls -t reports/ | head -1)/summary.md
```

### 4.3 持续集成运行

CI 中直接调用：

```bash
./scripts/run-compat-tests.sh --ci
```

`--ci` 模式下：
- 任意实例 `zk doctor` 失败即返回非零退出码。
- 报告输出到 `reports/ci-<run-id>/`。
- 不启动交互式 onboard。

---

## 5. 版本更新操作

详见 `docs/COMPAT_TEST_VERSION_POLICY.md`。简版流程：

1. 在 `docker-compose.yml` 中新增/修改服务。
2. 更新 `.env` 中对应的 API key / token。
3. 运行 `docker compose pull <service>`。
4. 执行初始化与部署脚本。
5. 跑通 `run-compat-tests.sh`。
6. 更新 `docs/COMPAT_TEST_VERSION_POLICY.md` 中的版本矩阵。

---

## 6. 故障排查

### 6.1 容器无法启动

```bash
docker logs openclaw-latest
docker compose config  # 检查配置语法
```

### 6.2 `openclaw zk doctor` 失败

```bash
# 查看插件日志
docker exec openclaw-latest openclaw plugin logs zettelkasten

# 重新部署插件
docker exec openclaw-latest bash /root/.openclaw/zettelkasten-plugin/scripts/deploy.sh

# 重启 gateway
docker exec openclaw-latest openclaw gateway restart
```

### 6.3 工具不可见

检查：
```bash
docker exec openclaw-latest openclaw config get tools.alsoAllow
docker exec openclaw-latest openclaw config get plugins.entries.zettelkasten
```

### 6.4 端口冲突

```bash
ss -tlnp | grep 1879
# 修改 docker-compose.yml 的外部端口后重启
```

### 6.5 数据卷损坏

直接重置：
```bash
docker compose down -v <service>
docker compose up -d <service>
```

---

## 7. 安全规范

- **API key 不得硬编码**：仅通过 `.env` 注入，`.env` 必须加入 `.gitignore`。
- **网关 token 定期轮换**：建议每 90 天通过 `openclaw config set gateway.auth.token` 更新。
- **测试数据隔离**：所有自动生成的测试笔记标题必须带 `[TEST]` 前缀，便于清理。
- **不暴露管理端口到公网**：若需远程访问，必须通过反向代理 + HTTPS，并限制 IP。

---

## 8. 检查清单

每次发布新版 Zettelkasten 插件前，必须完成：

- [ ] 所有 OpenClaw 版本实例 `openclaw zk doctor` 通过
- [ ] `zk_search_notes`、`zk_create_note`、`zk_get_note` 三工具可调用
- [ ] `tools.alsoAllow` 包含 `zettelkasten`
- [ ] `agents.defaults.skills` 包含 `zettelkasten-brain`
- [ ] `systemPromptOverride` 非空且工具名正确
- [ ] 报告已归档到 `reports/`
- [ ] Hermes 探测结果已记录（即使不支持也须说明）

---

*版本：v1.0.0-beta.7*  
*更新日期：2026-06-24*
