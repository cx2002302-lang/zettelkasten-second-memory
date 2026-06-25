# Zettelkasten 项目优化建议

> 本文档由 open-upsp 团队在集成测试过程中整理。  
> 基于 open-upsp v0.3.0 + ZK v1.0.0-beta.4 的实际交互经验。

---

## 1. 发布包体积优化（高优先级）

### 问题

ZK 插件发布包 `zettelkasten-plugin-v1.0.0-beta.4.tar.gz` 体积达 **15MB**，其中：

| 文件 | 大小 | 占比 |
|------|------|------|
| `zettelkasten-infographic.png` | 5.17MB | 34% |
| `performance-benchmark-infographic-EN.png` | 4.94MB | 33% |
| `performance-benchmark-infographic-CN.png` | 4.79MB | 32% |
| 实际代码（src/ + plugin/） | ~200KB | 1% |

**三个 PNG 信息图占了发布包的 99%。**

### 影响

- npm 包体积膨胀：open-upsp 因打包 ZK 插件，发布包从 ~1MB 膨胀到 ~16MB
- 安装时间增加：网络不佳时，`npm install -g open-upsp` 需要下载 16MB
- 对 CI/CD 不友好：每次构建都下载大量非必要资源

### 建议

**方案 A（推荐）：发布时自动压缩图片**

在 ZK 的 `scripts/publish.sh` 中添加图片压缩步骤：

```bash
# 在打包前压缩 docs/assets/*.png
for img in docs/assets/*.png; do
  # 缩放到 1200px 宽度 + Pillow 优化
  python3 -c "
from PIL import Image
img = Image.open('$img')
img.resize((1200, int(img.height * 1200 / img.width)), Image.LANCZOS).save('$img', optimize=True, compress_level=9)
"
done
```

**效果**：15MB → ~3MB（节省 80%），图片尺寸从 2752px → 1200px（适合 GitHub 网页展示）。

**方案 B：分离文档资源**

- 核心发布包只包含代码（~200KB）
- 图片、信息图等文档资源放在单独的 `zettelkasten-docs` 包或 CDN 上
- README.md 中的图片引用改为 CDN 链接

**方案 C：多分辨率发布**

```
docs/assets/
├── zettelkasten-infographic.png          # 1200px 网页版（~1MB）
├── zettelkasten-infographic@2x.png       # 2752px 高清版（~5MB）
└── zettelkasten-infographic-thumb.png    # 400px 缩略图（~100KB）
```

---

## 2. Schema 版本兼容性管理（高优先级）

### 问题

open-upsp 通过只读 SQLite 查询访问 ZK 数据库，硬编码了以下表名：

```sql
zettel_notes, zettel_links, zettel_tags, zettel_note_tags, zettel_fts, zettel_meta
```

**如果 ZK 未来版本重命名表（如 `zettel_notes` → `notes`），open-upsp 会直接崩溃。**

当前 open-upsp 的缓解措施：
- 运行时检查 `zettel_meta.schema_version`
- 默认只接受 `"2.0.0"` 精确匹配
- 不匹配时抛出 `ZettelkastenVersionError`

### 建议

**2.1 提供 Schema 兼容性声明**

在 ZK 的 `openclaw.plugin.json` 中增加 schema 兼容性字段：

```json
{
  "schema": {
    "version": "2.0.0",
    "compatibleVersions": ["2.0.0", "2.0.1"],
    "breakingChanges": {
      "3.0.0": ["zettel_notes → notes", "dropped zettel_meta table"]
    }
  }
}
```

**2.2 提供 Schema 变更通知机制**

ZK 更新 Schema 时，通过某种方式通知下游项目：

```bash
# 方案 1: 发布时生成 schema-diff.json
openclaw zk schema-diff --from 2.0.0 --to 2.1.0

# 方案 2: 在 plugin.json 中声明兼容性
"schemaCompatibility": {
  "2.0.x": "fully compatible",
  "2.1.0": "new columns added (backward compatible)",
  "3.0.0": "breaking changes"
}
```

**2.3 提供表名抽象层（长期）**

如果 ZK 计划未来重构表结构，建议提供一个**视图层**或**配置层**：

```sql
-- 兼容性视图，保持旧表名可用
CREATE VIEW zettel_notes AS SELECT * FROM notes;
CREATE VIEW zettel_links AS SELECT * FROM note_links;
```

这样下游项目可以在一段时间内逐步迁移。

---

## 3. CLI 接口稳定性（中优先级）

### 问题

open-upsp 通过 CLI 子进程向 ZK 写入数据：

```bash
openclaw zk new --title "..." --content "..." --tags "..."
```

**如果 ZK 的 CLI 参数格式变更（如 `--title` 改为 `--name`），open-upsp 的写入功能会静默失败或报错。**

### 建议

**3.1 CLI 版本声明**

在 `openclaw zk --version` 或 `openclaw zk doctor` 输出中包含 CLI 接口版本：

```
ZK CLI v1.0.0-beta.4
CLI API version: 2024-05-01
Supported commands: new, update, search, delete, init, doctor, status
```

**3.2 提供程序化 API（推荐）**

与其依赖 CLI 子进程，不如提供一个 Node.js API 包：

```bash
npm install zettelkasten-api
```

```typescript
import { NoteService } from "zettelkasten-api";
const note = await NoteService.create({ title, content, tags });
```

这样下游项目可以直接调用函数，而不是解析 CLI 输出：
- 类型安全
- 错误处理更优雅
- 性能更好（无子进程开销）
- 接口变更时 TypeScript 编译器会直接报错

**3.3 CLI 输出添加机器可读格式**

如果必须保持 CLI 接口，建议添加 `--json` 选项：

```bash
openclaw zk new --title "test" --json
# 输出: {"id": "20260513...", "success": true}
```

---

## 4. 插件打包规范（中优先级）

### 问题

ZK 的发布包 `tar.gz` 包含了一些可能不需要的文件：

```
plans/                    # 内部开发计划（是否应该发布？）
scripts/e2e-tool-test.mjs # 测试脚本
scripts/benchmark.mjs     # 基准测试脚本
docs/assets/infographic-prompt.md  # 提示词文件
```

### 建议

**4.1 清理发布包内容**

在 `scripts/publish.sh` 中明确排除开发文件：

```bash
# 不发布到生产包的内容
EXCLUDE=(
  "plans/"
  "scripts/e2e-tool-test.mjs"
  "scripts/benchmark.mjs"
  "scripts/test-*.mjs"
  "docs/assets/*-prompt.md"
  "src/**/__tests__/"
)
```

**4.2 提供 `.npmignore` 或发布清单**

类似 npm 包的 `.npmignore`，定义哪些文件不应进入发布包。

---

## 5. 错误信息优化（低优先级）

### 问题

在 open-upsp 的错误恢复测试中，观察到以下场景：

| 场景 | ZK 报错 | 问题 |
|------|---------|------|
| ZK 数据库不存在 | `Error: Zettelkasten database not found. Run "zk init" first.` | ✅ 清晰 |
| ZK 插件未启用 | （无明确提示）| ❌ 用户不知道需要 `openclaw plugins enable zettelkasten` |
| Schema 版本不匹配 | 无版本号信息 | ❌ 用户不知道当前是什么版本 |

### 建议

**5.1 统一错误码**

```json
{
  "error": "ZK_DATABASE_NOT_FOUND",
  "message": "Zettelkasten database not found at ~/.openclaw/zettelkasten/zettelkasten.db",
  "suggestion": "Run 'openclaw zk init' to initialize",
  "docs": "https://docs.zettelkasten.ai/quickstart"
}
```

**5.2 `zk doctor` 增强**

`openclaw zk doctor` 目前功能有限，建议增加：

```bash
$ openclaw zk doctor
✓ Database file exists
✓ Schema version: 2.0.0 (compatible)
✓ Plugin enabled in openclaw.json
✓ Notes directory writable
✗ Nightly distillation cron job missing
  Suggestion: Run 'openclaw zk config set nightlyDistill.enabled true'
```

---

## 6. 与下游项目的协作建议

### 6.1 提供集成测试套件

ZK 可以提供一个标准的集成测试包，供下游项目验证兼容性：

```bash
npm install --save-dev zettelkasten-integration-tests
```

```typescript
import { runCompatibilityTests } from "zettelkasten-integration-tests";
await runCompatibilityTests({ schemaVersion: "2.0.0" });
// 输出: ✓ All 15 integration tests passed
```

### 6.2 发布预通知

在重大版本发布前，提前通知下游项目：

```markdown
## ZK v3.0.0 发布预告（30 天后）

### 破坏性变更
- `zettel_notes` 表重命名为 `notes`
- `confidence` 字段类型从 INTEGER 改为 REAL

### 迁移指南
```sql
-- 兼容性视图（将在 v3.1 中移除）
CREATE VIEW zettel_notes AS SELECT * FROM notes;
```

### 受影响项目
- open-upsp (confirmed)
- zettelkasten-brain (confirmed)
```

---

## 附录：open-upsp 的 ZK 使用方式

供 ZK 团队参考，了解下游项目如何与 ZK 交互：

```
┌─────────────────┐
│   open-upsp     │
│                 │
│  SQLiteBridge   │──→ 只读查询 zettelkasten.db（FTS5 + JOIN）
│  (readonly)     │
│                 │
│  CliBridge      │──→ 子进程: openclaw zk new ...
│  (write only)   │
└─────────────────┘
```

**查询频率**：
- `searchNotes()`：每次用户提问时调用（高频）
- `createNote()`：每次 session-end 时调用（中频）

---

---

## 后续更新记录

> 2026-06-25

当前插件版本已推进至 **v1.0.0-beta.8.1**，以下优化建议已落地或发生变化：

- **发布包体积**：性能基准信息图已从发布包移除，当前发布包仅含代码、README、AGENTS、LICENSE、docs/COMPATIBILITY.md 和主信息图，体积极大降低。
- **测试**：测试数从 689 提升至 **1724**，硬编码 `/test` 路径已替换为临时目录。
- **兼容性**：新增 `scripts/lib/compat.sh` 统一处理 OpenClaw 2026.4.x / 2026.6.x+ 差异；插件 manifest 已声明 `contracts.tools`。
- **Hermes 支持**：新增 `src/mcp/http-bridge.ts`，通过 Streamable HTTP 暴露 MCP 工具。
- **文档**：README、AGENTS、COMPATIBILITY 已同步当前版本；内部 PHASE*/INTEGRATION/TESTING_GUIDE/CHANGELOG/DEVELOPMENT 不再进入发布包。

*原始文档版本: v1.0 | 生成日期: 2026-05-13 | 来源项目: open-upsp v0.3.0*
