# 系统信息图生成提示词

## 用途
用于 AI 生图平台（如 Midjourney、DALL·E、Stable Diffusion、即梦、可灵等）生成 Zettelkasten Second Memory 系统的宣传信息图。

---

## 主提示词（推荐复制到生图平台）

```
一张科技感与知识感融合的系统信息图（Infographic），主题为"Zettelkasten 第二记忆系统"。

画面布局：
- 顶部中央：大脑与神经网络融合的抽象图标，发出淡蓝色光芒，象征"第二记忆"
- 左侧：原子卡片区，展示三张悬浮的 Markdown 卡片，卡片之间有发光的连线（双向链接），标注 "supports / refines / extends / contradicts" 等语义标签
- 右侧：知识蒸馏流水线，用四个相连的透明玻璃管道表示：Inbox → Literature → Zettels → Archive，管道内有发光的粒子流动
- 底部：一个圆形仪表盘，显示 "20,000+ LOC | 20 Tests | 11 Link Types | FTS5 Search | MCP Protocol"
- 背景：深蓝色到深紫色的渐变，点缀着星点般的节点网络，像知识图谱的微观视角

视觉风格：
- 扁平化与微立体结合（Neumorphism + Glassmorphism）
- 主色调：深蓝 (#1a1a2e)、科技蓝 (#0f4c81)、荧光青 (#00d4aa)、暖白文字
- 玻璃质感面板，边缘有柔和发光
- 整体氛围：未来感、理性、智慧、有序

文字元素（中文或中英双语，字体清晰现代）：
- 主标题：Zettelkasten 第二记忆系统
- 副标题：AI 驱动的原子化知识管理
- 特性标签：原子笔记 | 双向链接 | 知识蒸馏 | 全文搜索 | AI 集成

比例：16:9 横版，适合作为 GitHub 仓库头图或文档封面
```

---

## 备选提示词（更简洁版本，适合快速生成）

```
A futuristic infographic for "Zettelkasten Second Memory" knowledge management system. 
Dark blue gradient background with glowing neural network nodes. 
Center: a luminous brain icon connected to floating atomic note cards via bi-directional light beams. 
Right side: a glass pipeline showing knowledge flow from inbox to permanent notes. 
Bottom: tech stats dashboard with neon cyan numbers. 
Glassmorphism UI panels, clean typography, 16:9 aspect ratio, high detail, professional tech illustration style.
```

---

## 生成建议

| 平台 | 建议设置 |
|------|---------|
| **Midjourney** | `--ar 16:9 --v 6 --style raw` |
| **DALL·E 3** | 直接粘贴主提示词，选择 "Vivid" 风格 |
| **即梦 / 可灵** | 中文主提示词 + 选择 "科技/插画" 风格 |
| **Stable Diffusion** | 配合 LoRA: `glassmorphism`, `tech infographic`, `neon glow` |

## 使用位置

生成后请将图片命名为 `zettelkasten-infographic.png`（或 `.jpg`），存放于：

```
docs/assets/zettelkasten-infographic.png
```

并在 `README.md` 顶部引用：

```markdown
![Zettelkasten Second Memory](docs/assets/zettelkasten-infographic.png)
```
