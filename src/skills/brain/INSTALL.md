# Zettelkasten Brain Skill — 安装指南

**版本**: 1.0.0  
**适用于**: OpenClaw >= 2026.4.23  
**依赖**: Zettelkasten 插件已安装并启用

---

## 快速安装（3步）

### 第1步：复制 Skill

**选择 A：Workspace skills（推荐）**

如果你的 OpenClaw workspace 在 `~/.openclaw/workspace/`：

```bash
# 复制到 workspace skills 目录
cp -r zettelkasten-skill ~/.openclaw/workspace/skills/zettelkasten-brain
```

**选择 B：Global skills（需要 extraDirs）**

```bash
# 创建全局 skills 目录
mkdir -p ~/.openclaw/skills

# 复制本 skill
cp -r zettelkasten-skill ~/.openclaw/skills/zettelkasten-brain
```

### 第2步：激活 Skill

**如果选择了 A（Workspace skills）**：

```bash
# 只需设置系统提示词和注册 skill
openclaw config set agents.defaults.systemPromptOverride "file:~/.openclaw/workspace/skills/zettelkasten-brain/PROMPT.md"
openclaw config set agents.defaults.skills '["zettelkasten-brain"]'
```

**如果选择了 B（Global skills）**：

```bash
# 1. 注册 skill 目录
openclaw config set skills.load.extraDirs '["~/.openclaw/skills"]'

# 2. 设置系统提示词
openclaw config set agents.defaults.systemPromptOverride "file:~/.openclaw/skills/zettelkasten-brain/PROMPT.md"

# 3. 注册 skill
openclaw config set agents.defaults.skills '["zettelkasten-brain"]'
```

### 第3步：设置自动备份

```bash
# 添加 cron 任务（每周日凌晨2点自动快照）
(crontab -l 2>/dev/null; echo "0 2 * * 0 bash ~/.openclaw/skills/zettelkasten-brain/snapshot.sh") | crontab -

# 验证
 crontab -l | grep zettelkasten
```

### 重启 Gateway

```bash
openclaw gateway restart
```

---

## 验证安装

```bash
# 1. 检查 skill 是否注册
openclaw config get agents.defaults.skills

# 2. 检查 Zettelkasten 插件
openclaw zk doctor

# 3. 测试知识库功能
openclaw zk new --title "Skill Test" --content "Testing Zettelkasten Brain"
openclaw zk list

# 4. 检查进化管理器
bash ~/.openclaw/skills/zettelkasten-brain/evolve.sh current
```

---

## 文件权限

确保脚本可执行：

```bash
chmod +x ~/.openclaw/skills/zettelkasten-brain/snapshot.sh
chmod +x ~/.openclaw/skills/zettelkasten-brain/evolve.sh
```

---

## 卸载

```bash
# 1. 移除 skill 配置
openclaw config set agents.defaults.skills '[]'
openclaw config set agents.defaults.systemPromptOverride ""

# 2. 删除文件
rm -rf ~/.openclaw/skills/zettelkasten-brain

# 3. 移除 cron
crontab -l | grep -v zettelkasten | crontab -

# 4. 重启
openclaw gateway restart
```

---

## 故障排除

### "Config validation failed: agents.defaults: Unrecognized key: systemPrompt"
**原因**: OpenClaw 2026.4.24 的配置字段是 `systemPromptOverride`，不是 `systemPrompt`。  
**解决**: 使用 `agents.defaults.systemPromptOverride`。

### "skill not found"
检查路径是否正确：
```bash
ls ~/.openclaw/skills/zettelkasten-brain/SKILL.md
```

### "zk commands not available"
确保 Zettelkasten 插件已安装：
```bash
openclaw zk doctor
```

### "snapshot.sh permission denied"
```bash
chmod +x ~/.openclaw/skills/zettelkasten-brain/snapshot.sh
```

### "cron not running"
检查 cron 服务：
```bash
systemctl status cron  # Linux
sudo launchctl list | grep cron  # macOS
```

---

**安装完成后，AI 代理将自动开始管理你的知识库。**
