# 性能基准测试信息图生成提示词

> 基于 `scripts/benchmark.mjs` 实测数据（Node v22.22.2, SQLite, 2026-05-12）
> 目标平台：Midjourney / DALL·E / 即梦 / 可灵 / Stable Diffusion

---

## 🇨🇳 中文版主提示词

```
一张科技感数据可视化信息图（Tech Data Infographic），主题为"Zettelkasten 性能基准测试 — 10,000 笔记实测"。

画面布局（16:9 横版）：
- 顶部中央：大号霓虹青色数字 "10,000"，下方小字"笔记 | 30,000 链接 | 689 Tests Passing"，数字带有发光效果
- 中上部：三个并列的深色玻璃质感数据卡片，分别标注：
  · 卡片1（青色边框）："FTS 全文搜索" — 大字 "1.9ms"，小字"搜索 10,000 笔记，返回 50 条结果"
  · 卡片2（绿色边框）："单条读取" — 大字 "0.08ms"，小字"带链接、标签、元数据完整加载"
  · 卡片3（紫色边框）："知识图谱" — 大字 "5.5ms"，小字"100 节点、72 边、平均度数 3.0"
- 中下部：一条横向渐变进度条式的对比图，展示三种规模的搜索耗时对比（1K:2.8ms → 5K:1.8ms → 10K:1.9ms），用青色发光柱状表示，趋势平稳
- 底部左侧：一个圆形仪表盘，绿色指针指向"PASS"区域，标注"全部 7 项阈值通过"
- 底部右侧：一个⚠️警告提示框（橙色边框），标注"瓶颈识别：发光度重计算 1,013ms — 建议增量更新"
- 背景：深蓝到深紫渐变（#0a0e27 → #1a1a2e），点缀着细密的网格线和节点连线，像数据库索引的微观可视化

视觉风格：
- 扁平化与微立体结合（Glassmorphism + Neon Data Viz）
- 主色调：深蓝背景、霓虹青（#00d4aa）高亮数据、暖白文字、绿色通过标识、橙色警告
- 玻璃质感面板，边缘有柔和发光，数据数字使用等宽科技感字体
- 整体氛围：专业、可信、数据驱动、高性能

文字元素（中英双语，主标题中文、数据英文）：
- 主标题：Zettelkasten 性能基准测试
- 副标题：10,000 笔记 · 30,000 链接 · 全部阈值通过
- 数据来源标签：Node.js 22 | SQLite FTS5 | 内存数据库基准

比例：16:9 横版，适合作为 GitHub README 性能章节头图
```

---

## 🇺🇸 English Version Main Prompt

```
A futuristic tech data visualization infographic titled "Zettelkasten Performance Benchmark — 10,000 Notes Tested".

Layout (16:9 landscape):
- Top center: Large neon cyan number "10,000" with glowing effect, subtitle "Notes | 30,000 Links | 689 Tests Passing" in smaller warm-white text
- Upper middle: Three side-by-side dark glass data cards:
  · Card 1 (cyan border): "FTS Full-Text Search" — big "1.9ms", small "Search 10K notes, 50 results returned"
  · Card 2 (green border): "Single Note Read" — big "0.08ms", small "With links, tags, metadata fully loaded"
  · Card 3 (purple border): "Knowledge Graph" — big "5.5ms", small "100 nodes, 72 edges, avg degree 3.0"
- Lower middle: A horizontal gradient bar chart comparing search latency across scales (1K:2.8ms → 5K:1.8ms → 10K:1.9ms), shown as glowing cyan columns, flat trendline
- Bottom left: A circular gauge with green needle pointing to "PASS" zone, label "All 7 thresholds passed"
- Bottom right: A warning box (orange border) saying "Bottleneck: Glow recalculation 1,013ms — recommend incremental updates"
- Background: Deep blue to deep purple gradient (#0a0e27 → #1a1a2e), with fine grid lines and node connections like a database index visualization

Visual style:
- Flat design with micro-3D (Glassmorphism + Neon Data Viz)
- Color palette: Deep blue bg, neon cyan (#00d4aa) for data highlights, warm white text, green pass indicators, orange warnings
- Glass panels with soft edge glow, monospace tech font for numbers
- Mood: Professional, trustworthy, data-driven, high-performance

Text elements (English primary, Chinese subtitle optional):
- Main title: Zettelkasten Performance Benchmark
- Subtitle: 10,000 Notes · 30,000 Links · All Thresholds Passed
- Data source tag: Node.js 22 | SQLite FTS5 | In-Memory DB Benchmark

Aspect ratio: 16:9, suitable for GitHub README performance section header
```

---

## 🎨 生成建议

| 平台 | 建议设置 |
|------|---------|
| **Midjourney** | `--ar 16:9 --v 6 --style raw` |
| **DALL·E 3** | 直接粘贴英文版提示词，选择 "Vivid" 风格 |
| **即梦 / 可灵** | 中文版提示词 + 选择 "数据可视化/科技" 风格 |
| **Stable Diffusion** | 配合 LoRA: `data visualization`, `glassmorphism`, `neon glow`, `tech infographic` |

---

## 📁 文件存放位置

生成后请将图片命名为 `performance-benchmark-infographic.png`，存放于：

```
docs/assets/performance-benchmark-infographic.png
```

并在 `README.md` 性能相关章节引用：

```markdown
## ⚡ Performance

<p align="center">
  <img src="docs/assets/performance-benchmark-infographic.png" alt="Performance Benchmark" width="100%">
</p>

**Tested on**: Node.js v22.22.2, SQLite `:memory:`, 2026-05-12  
**Scale**: 10,000 notes, 30,000 links  
**All thresholds passed** ✅
```
