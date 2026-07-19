# Zettelkasten 使用场景

> 4 个典型场景的完整对话示例。核心 .md 文件不展开。

---

## 场景 1：知识检索

```
用户：我之前是怎么配 Docker 网络的？
AI：
🔍 知识库检索：找到 2 条相关笔记
- Docker Bridge 配置（ID: 20260510...）
- Docker Compose 网络设置（ID: 20260510...）

根据你的记录，你之前用的是 bridge 模式：
```yaml
networks:
  mynet:
    driver: bridge
    subnet: 172.18.0.0/16
```
需要查看完整配置吗？
```

**AI 内部动作**：
1. 提取关键词 ["Docker", "网络", "network"]
2. `zk_search_notes` 搜
3. `zk_get_note` 看详情
4. 引用 + 告知 ID

---

## 场景 2：知识健康度报告

```
用户：我的知识库健康状况怎么样？
AI：
📊 知识库健康报告
- 总笔记: 31 | Evergreen: 0 | Active: 0 | Stable: 28 | Zombie: 3
- 僵尸笔记候选: [列表]
- 建议: 3 条僵尸笔记可归档；Evergreen 为 0，建议补充高引用核心笔记
```

**AI 内部动作**：
1. `zk_glow_ranking` 获取分布
2. `zk_find_zombies` 列候选
3. 给出建议

---

## 场景 3：自动记录

```
用户：我发现用 pnpm 的 workspace 功能比 lerna 好用多了
AI：
📝 检测到新知识点，已保存：
"pnpm workspace vs lerna"（ID: 20260511123456）
标签: pnpm, workspace, monorepo, lerna
置信度: 0.7（用户经验分享）

🔗 检测到关联，建议链接：
"Node.js 包管理工具对比" --supports--> 新笔记（关联度 0.78）
要我帮你建链吗？
```

**AI 内部动作**：
1. 触发词检测（"我发现" + 工具对比）
2. 置信度 0.7（经验分享）
3. `zk_create_note` 创建
4. 搜索相关笔记，**建议**链接

---

## 场景 4：归档管理

```
用户：归档那条旧笔记
AI：
📦 已归档
笔记: 旧版 API 设计草案（ID: 20260511...）
说明: 归档数据保留，可通过 zk_search_archived 专门检索
```

**AI 内部动作**：
1. `zk_archive_note` 归档
2. 告知用户

---

## 场景 5：发现笔记矛盾/需更新（R09）

```
用户：不对，那个工具不是 lerna，是 pnpm
AI：
📝 已记录修正
原笔记: "Node.js 工具链"（ID: ...）
修正: 工具名 lerna → pnpm
已标记为需更新，建议你查收
```

**AI 内部动作**：
1. R09 触发
2. 找原笔记
3. `zk_update_note` 更新（**注意：必须传 tags 否则被清空**）
4. 告知用户
