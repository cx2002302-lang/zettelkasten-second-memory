# 兼容测试目标 Agent 版本更新维护策略

> 本文档定义兼容测试环境中 OpenClaw / Hermes 版本的选择、新增、淘汰与更新规则，确保测试矩阵既覆盖用户实际版本，又不过度膨胀。

---

## 1. 版本分类

### 1.1 OpenClaw 版本

| 类别 | 定义 | 数量上限 | 示例 |
|------|------|----------|------|
| **Minimum Supported** | 插件声明支持的最低 OpenClaw 版本 | 1 | `2026.4.23` |
| **Current Production** | 当前用户/组织实际运行的版本 | 1–2 | `2026.4.24` |
| **Latest Stable** | 镜像仓库的 `latest` 标签 | 1 | `latest` |
| **Preview / Edge** | 官方 pre-release、nightly、RC | 可选 1 | `2026.5.x-rc` |

### 1.2 Hermes Agent 版本

| 类别 | 定义 | 数量上限 | 示例 |
|------|------|----------|------|
| **Reference Classic** | 早期稳定版本，用于长期兼容基线 | 1 | `v1.0` 系列 |
| **Latest Stable** | 镜像仓库的 `latest` 标签 | 1 | `latest` |

---

## 2. 新增版本的流程

当 OpenClaw 或 Hermes 发布新版本，需要纳入测试矩阵时：

1. **评估必要性**
   - 是否修复了影响 Zettelkasten 的 bug？
   - 是否改变了插件配置字段、MCP 工具暴露机制或 Skill 注入方式？
   - 是否有用户准备升级到该版本？

2. **创建测试 Issue**
   - 标题：`[compat-test] Add OpenClaw 2026.x.x to matrix`
   - 内容：版本号、变更日志链接、预期影响、计划测试时间。

3. **修改配置**
   - 在 `docker-compose.yml` 新增服务。
   - 在 `scripts/run-compat-tests.sh` 的 `VERSIONS` 数组中新增容器名。
   - 在 `docs/COMPAT_TEST_REPORT_TEMPLATE.md` 的矩阵表中新增行。

4. **拉取并初始化镜像**
   ```bash
   docker compose pull <new-service>
   docker compose up -d <new-service>
   docker exec -it <new-service> openclaw onboard
   ./scripts/deploy-zk-to-container.sh <new-service>
   ./scripts/run-compat-tests.sh
   ```

5. **审查报告**
   - 若全部通过：更新本文档版本矩阵，合并配置。
   - 若失败：创建修复 Issue，暂不计入“支持版本”，直至修复。

---

## 3. 版本淘汰规则

当版本矩阵需要瘦身时，按以下优先级淘汰：

1. **End-of-Life（EOL）版本优先淘汰**
   - OpenClaw 官方不再维护的版本。
   - Hermes 官方标记为 deprecated 的版本。

2. **无用户使用的版本次优先淘汰**
   - 超过 6 个月没有生产环境使用的版本。

3. **保留策略**
   - 必须始终保留 **Minimum Supported** 版本，直到插件明确放弃支持。
   - 必须始终保留 **Current Production** 版本。
   - 必须始终保留 **Latest Stable** 版本。

4. **淘汰操作**
   - 在 `docker-compose.yml` 中移除服务。
   - 在测试脚本中移除对应容器名。
   - 删除对应 named volume：`docker volume rm oc-<version>-data`。
   - 在本文档中标记为“已淘汰”并注明淘汰日期。

---

## 4. 镜像更新策略

### 4.1 `latest` 标签的更新

`latest` 会随官方发布滚动更新，必须定期同步：

```bash
# 每周一执行
cd /opt/zettelkasten-compat
docker compose pull openclaw-latest hermes-latest
docker compose up -d openclaw-latest hermes-latest
./scripts/run-compat-tests.sh
```

如果 `latest` 导致测试失败：
1. 立即回滚到上一个已知可用镜像：
   ```bash
   docker pull ghcr.io/openclaw/openclaw:<last-known-sha>
   ```
2. 创建 Issue 跟踪兼容性问题。
3. 在修复前，将 `latest` 固定到上一个可用 digest。

### 4.2 固定版本标签的更新

`2026.4.23`、`2026.4.24` 等固定标签不会自动变化，仅在以下情况更新：

- 官方发布该标签的补丁版本（如 `2026.4.24` 更新 digest）。
- 安全漏洞修复需要强制更新。

更新流程：
```bash
docker compose pull openclaw-2026-4-24
docker compose up -d openclaw-2026-4-24
./scripts/run-compat-tests.sh --service openclaw-2026-4-24
```

---

## 5. Zettelkasten 插件版本矩阵

兼容测试不仅测试 OpenClaw / Hermes 版本，还要测试 Zettelkasten 插件本身的不同版本：

| 插件版本 | 来源 | 测试目的 |
|----------|------|----------|
| `current` | 当前工作目录 bind mount | 验证开发中的改动 |
| `last-release` | 上一个 release tarball | 回归测试 |
| `target-release` | 待发布版本 | 发布前 gate |

切换插件版本的脚本：

```bash
# 切换到 beta.7 release
./scripts/switch-zk-version.sh v1.0.0-beta.7

# 切换回 current
./scripts/switch-zk-version.sh current
```

---

## 6. 版本矩阵维护责任人

| 职责 | 负责人 | 频率 |
|------|--------|------|
| 检查 OpenClaw 新版本发布 | 测试负责人 | 每周 |
| 检查 Hermes 新版本发布 | 测试负责人 | 每月 |
| 更新 docker-compose.yml 与测试脚本 | 开发人员 | 按需 |
| 运行全矩阵测试 | CI / 测试负责人 | 每周 |
| 审批版本淘汰 | 项目经理 | 每季度 |

---

## 7. 当前版本矩阵（基线）

### OpenClaw

| 版本 | 状态 | 加入日期 | 计划淘汰日期 |
|------|------|----------|--------------|
| `2026.4.23` | Minimum Supported | 2026-06-24 | 当插件放弃支持时 |
| `2026.4.24` | Current Production | 2026-06-24 | 生产环境升级后 |
| `latest` | Latest Stable | 2026-06-24 | 持续滚动 |

### Hermes

| 版本 | 状态 | 加入日期 | 计划淘汰日期 |
|------|------|----------|--------------|
| `latest` | Preview / Probing | 2026-06-24 | 持续滚动 |

> Hermes 当前处于“探测差异”阶段，不强制要求功能完全对齐。

---

*版本：v1.0.0-beta.7*  
*更新日期：2026-06-24*
