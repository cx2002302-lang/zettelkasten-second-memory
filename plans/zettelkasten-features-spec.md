# Zettelkasten 数据库驱动特效功能规格

> 将五大"特效"转化为可实现的系统功能

---

## 1. 动态拓扑组合 (Dynamic Composition)

### 1.1 即时视图重构

**功能**: 通过查询语言动态组合卡片

**接口设计**:
```typescript
interface ViewCompositionQuery {
  filter: {
    tags?: string[];
    keywords?: string[];
    importance?: { min: number; max: number };
    confidence?: { min: number; max: number };
    createdAfter?: Date;
    createdBefore?: Date;
    linkedTo?: string[];
    notLinkedTo?: string[];
  };
  sortBy: "causal" | "temporal" | "importance" | "confidence" | "centrality" | "random";
  output: {
    format: "linear" | "tree" | "graph" | "moc";
    maxDepth?: number;
    maxNodes?: number;
  };
}
```

### 1.2 虚拟镜像 (Virtual Transclusion)

**功能**: 同一张卡片存在于多个视图中，修改同步

**实现要点**:
- 视图只存储查询条件，不存储卡片副本
- 每次访问时动态计算包含的卡片
- 卡片修改时自动通知所有相关视图

---

## 2. 自动化关联发现 (Automated Linking)

### 2.1 语义吸附 (Semantic Gravity)

**功能**: 编辑时自动推荐相关卡片

**技术栈**:
- 向量搜索：sqlite-vec
- 图距离：SQLite 递归查询
- 混合排序：相似度 + 1/(距离+1)

### 2.2 知识断层检测

**功能**: 发现知识集群间的逻辑断层

**算法**: 社区发现 + 语义相似度检测

---

## 3. 多维属性过滤与特效表现

### 3.1 时间轴回溯与热力图

**功能**: 可视化知识演化

**指标**:
- 长青笔记（Evergreen）：引用持续增长
- 僵尸笔记（Zombie）：长期未被引用

### 3.2 知识发光度 (Decay & Glow)

**功能**: 基于引用频率和网络中心性的视觉反馈

**计算公式**:
```
brightness = (centrality * 0.4 + citation * 0.3 + recency * 0.3) * (1 - decay)
```

---

## 4. 图谱演算与路径搜索

### 4.1 最短路径探测

**功能**: 发现两张卡片间的逻辑路径

**示例**: 量子物理 -> 古典文学

### 4.2 社区发现 (Clustering)

**算法**: Louvain 算法（模块度优化）

---

## 5. 组合"化学反应"特效

### 5.1 层叠组合 (Stacking)

**功能**: 自动提取多张卡片摘要，生成 MOC

### 5.2 逻辑碰撞 (Collision)

**功能**: 提取两张观点相反的卡片，生成对比视图

### 5.3 随机漫步 (Random Walk)

**功能**: 基于图算法进行灵感跳转

### 5.4 版本分支 (Branching)

**功能**: 像 Git 一样对卡片进行分支试验
