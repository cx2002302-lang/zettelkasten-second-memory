# 兼容测试报告模板

> 每次运行 `scripts/run-compat-tests.sh` 后，按此模板生成报告。

---

## 1. 基本信息

| 字段 | 内容 |
|------|------|
| 报告日期 | `2026-06-24` |
| 测试执行人 | CI / 手动 |
| Zettelkasten 插件版本 | `current` / `v1.0.0-beta.7` |
| 测试环境主机 | `hostname` |

---

## 2. 版本矩阵结果

### OpenClaw

| 版本 | 容器名 | zk doctor | plugin list | alsoAllow | skills | systemPromptOverride | zk_search_notes | zk_create_note | zk_get_note | 结果 |
|------|--------|-----------|-------------|-----------|--------|----------------------|-----------------|----------------|-------------|------|
| `2026.4.23` | `openclaw-2026-4-23` | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | PASS/FAIL |
| `2026.4.24` | `openclaw-2026-4-24` | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | PASS/FAIL |
| `latest` | `openclaw-latest` | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | PASS/FAIL |

### Hermes

| 版本 | 容器名 | 启动 | 版本号 | 工具发现 | zk_search_notes | 备注 |
|------|--------|------|--------|----------|-----------------|------|
| `latest` | `hermes-latest` | ✅/❌ | | ✅/❌/N/A | ✅/❌/N/A | |

---

## 3. 详细日志

### OpenClaw 2026.4.24

#### 3.1 插件加载

```text
# docker exec openclaw-2026-4-24 openclaw plugin list
```

#### 3.2 zk doctor

```text
# docker exec openclaw-2026-4-24 openclaw zk doctor
```

#### 3.3 工具调用

```text
# zk_search_notes
```

#### 3.4 配置检查

```json
{
  "tools.alsoAllow": [],
  "agents.defaults.skills": [],
  "agents.defaults.systemPromptOverride": "..."
}
```

---

## 4. 发现的问题

| 问题 ID | 影响版本 | 严重程度 | 描述 | 跟踪 Issue |
|---------|----------|----------|------|------------|
| | | | | |

---

## 5. 结论与建议

- **是否可发布 Zettelkasten 插件当前版本**：是 / 否
- **是否需要更新 Minimum Supported OpenClaw 版本**：是 / 否，建议更新到：
- **下一步行动**：

---

## 6. 附件

- 原始日志：`reports/<timestamp>/raw.log`
- 各版本详细报告：`reports/<timestamp>/<container>.md`

---

*模板版本：v1.0.0-beta.7*  
*更新日期：2026-06-24*
