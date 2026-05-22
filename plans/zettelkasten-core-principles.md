# Zettelkasten 核心原理与系统约束

> 基于用户提供的五大原则，定义系统的核心行为约束

---

## 1. 原子化原则 (Atomicity)

### 定义
每张卡片只记录一个独立的观点或概念。

### 系统约束

**创建时强制检查**:
```typescript
interface AtomicityCheck {
  // 检测内容复杂度
  sentenceCount: number;      // 句子数 > 5 警告
  paragraphCount: number;     // 段落数 > 3 警告
  conceptIndicators: string[]; // "第一/第二/第三", "此外", "另外" 等信号词
}

// AI 辅助检测
async function checkAtomicity(content: string): Promise<{
  isAtomic: boolean;
  suggestions: string[];      // 建议拆分的点
  confidence: number;
}>;
```

**UI/UX 提示**:
- 创建卡片时显示"原子度评分"
- 检测到多概念时提示"是否需要拆分？"
- 提供"一键拆分"功能（AI 辅助）

---

## 2. 自治原则 (Autonomy)

### 定义
每一张卡片必须是"自解释"的。即使脱离上下文，依然能看懂。

### 系统约束

**禁用模糊指代检测**:
```typescript
const AMBIGUOUS_REFERENCES = [
  /如上所述/g,
  /见前文/g,
  /前文提到/g,
  /之前说的/g,
  /上文/g,
  /前面/g,
  /这个/g,      // 需要上下文
  /那个/g,
];

function checkAutonomy(content: string): {
  violations: string[];
  suggestions: string[];
};
```

**强制字段**:
```yaml
---
id: "202604200930"
title: "数据库驱动卡片盒的性能优势"  # 必须能独立理解
content: |
  # 完整自包含的内容
  传统基于文件系统的卡片盒...
---
```

---

## 3. 永远建立链接 (Always Link)

### 定义
添加新卡片时，必须与库中至少一张旧卡片建立联系。

### 系统约束

**强制链接验证**:
```typescript
interface LinkRequirement {
  minLinks: 1;              // 至少1个链接
  maxLinks: 10;             // 最多10个（防止过度链接）
  requireContext: true;     // 必须提供上下文描述
}

// 创建卡片时的验证
async function validateLinks(note: NewNote): Promise<{
  valid: boolean;
  missing: string[];
}> {
  if (note.links.length === 0) {
    // 强制搜索相关卡片
    const suggestions = await findRelatedNotes(note.content);
    return {
      valid: false,
      missing: ["必须至少链接到一张已有卡片"],
      suggestions
    };
  }
}
```

**链接上下文模板**:
```typescript
interface LinkContext {
  fromId: string;
  toId: string;
  relationship: 
    | "supports"      // 支持/证实
    | "contradicts"   // 反驳/对比
    | "extends"       // 扩展/深化
    | "is_example_of" // 是...的实例
    | "refines"       // 细化/改进
    | "related";      // 相关
  description: string; // 为什么链接？（强制）
}
```

---

## 4. 索引与结构化笔记 (Structure Notes / MOC)

### 定义
建立"地图卡片"（Map of Content），只存储指向其他卡片的链接，不存储具体知识。

### 系统约束

**Structure Note 特殊规则**:
```typescript
interface StructureNote {
  type: "structure";
  
  // 限制：不能包含具体知识内容
  content: string;  // 只允许标题、链接列表、简短描述
  
  // 必须包含导航结构
  sections: {
    title: string;
    links: string[];  // 指向的卡片ID列表
  }[];
  
  // 自动生成反向索引
  autoIndex: boolean; // 是否自动收集相关卡片
}

// 验证 Structure Note
function validateStructureNote(note: Note): {
  isValid: boolean;
  knowledgeViolations: string[];  // 检测到的具体知识内容
};
```

**MOC 自动生成**:
```typescript
// 当某个主题簇的卡片数量 > N 时，提示创建 MOC
async function suggestMOC(): Promise<{
  topic: string;
  cardCount: number;
  density: number;      // 链接密度
  suggestedCards: string[];
}>;
```

---

## 5. 放弃分类，拥抱演化 (Evolution over Classification)

### 定义
严禁预设文件夹。知识根据链接密度"自下而上"生长。

### 系统约束

**禁止预设分类**:
```typescript
// 系统层面：不允许创建分类文件夹
// 只有时间维度的目录结构（用于物理存储，非逻辑分类）

// 允许的操作
const ALLOWED_ORGANIZATION = [
  "time",           // 按时间（物理存储）
  "link",           // 按链接（知识图谱）
  "tag",            // 按标签（松散关联）
  "search",         // 按搜索（动态聚合）
];

// 禁止的操作
const FORBIDDEN_ORGANIZATION = [
  "folder",         // 文件夹分类
  "category",       // 预设分类
  "hierarchy",      // 层级目录
];
```

**主题簇自动发现**:
```typescript
interface TopicCluster {
  id: string;
  name: string;           // 自动生成或用户命名
  centroid: string[];     // 中心卡片
  members: string[];      // 成员卡片
  density: number;        // 内部链接密度
  formedAt: Date;         // 形成时间
}

// 基于图算法自动发现主题簇
async function discoverTopicClusters(): Promise<TopicCluster[]>;
```

---

## 系统行为矩阵

| 用户行为 | 系统响应 | 原理依据 |
|---------|---------|---------|
| 创建长内容卡片 | 警告 + 拆分建议 | 原子化原则 |
| 使用模糊指代 | 高亮提示 + 改写建议 | 自治原则 |
| 保存无链接卡片 | 阻止 + 推荐相关卡片 | 永远建立链接 |
| 创建 Structure Note | 验证无具体知识内容 | 索引与结构化笔记 |
| 尝试创建文件夹 | 拒绝 + 引导使用标签/链接 | 放弃分类 |
| 卡片数量增长 | 自动提示创建 MOC | 索引与结构化笔记 |

---

## AI 增强功能设计

### 1. 原子化辅助
```typescript
// AI 分析内容，建议拆分点
async function suggestAtomicSplit(content: string): Promise<{
  splitPoints: number[];      // 建议拆分的位置
  proposedNotes: string[];    // 拆分后的内容预览
}>;
```

### 2. 自治性检查
```typescript
// AI 检测模糊指代，建议改写
async function improveAutonomy(content: string): Promise<{
  improved: string;
  changes: string[];
}>;
```

### 3. 智能链接推荐
```typescript
// AI 分析内容，推荐相关卡片
async function suggestLinks(content: string): Promise<{
  candidates: {
    noteId: string;
    relevance: number;
    suggestedContext: string;
    relationship: LinkType;
  }[];
}>;
```

### 4. MOC 自动生成
```typescript
// AI 分析主题簇，生成 MOC 草稿
async function generateMOCDraft(cluster: TopicCluster): Promise<{
  title: string;
  sections: {
    title: string;
    description: string;
    cards: string[];
  }[];
}>;
```

### 5. 主题簇命名
```typescript
// AI 为主题簇生成有意义的名称
async function nameTopicCluster(cards: string[]): Promise<{
  name: string;
  alternatives: string[];
}>;
```

---

## 实现优先级

**P0 - 核心约束