# Zettelkasten 部署测试计划

## 概述

本计划指导如何在测试机上进行 Zettelkasten 模块的部署测试。

## 前置条件

- Linux/macOS 测试机
- Docker 20.10+
- Docker Compose 2.0+
- 至少 2GB 可用内存
- 至少 10GB 磁盘空间

## 部署测试步骤

### Phase 1: 环境准备

1. **备份现有环境**（如果有）
   ```bash
   # 备份现有 OpenClaw 数据
   tar -czf openclaw-backup-$(date +%Y%m%d).tar.gz /opt/openclaw
   ```

2. **准备测试目录**
   ```bash
   mkdir -p /opt/openclaw-test/{config,workspace,logs}
   ```

### Phase 2: 源码部署

1. **复制 Zettelkasten 源码**
   ```bash
   # 将 src/zettelkasten/ 复制到 OpenClaw 项目
   rsync -av src/ /opt/openclaw-test/src/zettelkasten/
   ```

2. **安装依赖并编译**
   ```bash
   cd /opt/openclaw-test
   npm install
   npm run build
   ```

### Phase 3: 配置部署

1. **配置环境变量**
   ```bash
   cp openclaw/deploy-package/.env.example /opt/openclaw-test/config/.env
   # 编辑 .env 文件，设置测试环境配置
   ```

2. **部署 Zettelkasten 配置**
   ```bash
   cp openclaw/deploy-package/config/zettelkasten.json /opt/openclaw-test/config/
   ```

### Phase 4: 服务启动

1. **启动 Docker 服务**
   ```bash
   cd /opt/openclaw-test
   docker-compose up -d
   ```

2. **查看日志**
   ```bash
   docker-compose logs -f
   ```

### Phase 5: 验证测试

1. **运行健康检查**
   ```bash
   ./openclaw/deploy-package/scripts/health-check.sh
   ```

2. **验证 MCP 工具**
   ```bash
   curl http://localhost:18789/api/mcp/tools
   ```

3. **验证 Zettelkasten 核心功能**
   ```bash
   # 创建测试笔记
   curl -X POST http://localhost:18789/api/zettelkasten/notes \
     -H "Content-Type: application/json" \
     -d '{"title":"测试笔记","content":"这是一个测试"}'
   
   # 查询笔记
   curl http://localhost:18789/api/zettelkasten/notes
   ```

## 验收标准

- [ ] 所有源码文件复制完成
- [ ] 编译成功，无错误
- [ ] 配置文件部署到位
- [ ] 数据库初始化成功
- [ ] MCP 工具可用
- [ ] 健康检查通过
- [ ] 服务正常重启

## 回滚方案

如果部署失败：

```bash
# 停止服务
docker-compose down

# 恢复备份（如果有）
tar -xzf openclaw-backup-YYYYMMDD.tar.gz -C /

# 重启服务
docker-compose up -d
```

## 测试完成后的工作

1. 记录测试结果
2. 更新部署清单状态
3. 准备生产环境部署计划
