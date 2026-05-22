/**
 * Zettelkasten 系统常量
 */

/** 默认数据目录名称 */
export const ZETTELKASTEN_DIR_NAME = ".zettelkasten";

/** 默认数据目录结构 */
export const DEFAULT_DIR_STRUCTURE = {
  /** 卡片存储目录 */
  NOTES_DIR: "notes",
  /** 数据库目录 */
  DB_DIR: "db",
  /** 附件目录 */
  ATTACHMENTS_DIR: "attachments",
  /** 模板目录 */
  TEMPLATES_DIR: "templates",
} as const;

/** 数据库文件名 */
export const DB_FILENAME = "zettelkasten.db";

/** 摘要最大长度 (字符) */
export const SUMMARY_MAX_LENGTH = 280;

/** 默认卡片类型 */
export const DEFAULT_NOTE_TYPE = "atomic" as const;

/** 默认卡片状态 */
export const DEFAULT_NOTE_STATUS = "FLEETING" as const;

/** 默认存储文件夹 */
export const DEFAULT_NOTE_FOLDER = "inbox" as const;

/** 默认置信度 (0-1) */
export const DEFAULT_CONFIDENCE = 0.5;

/** 摘要默认长度 (字符) */
export const DEFAULT_SUMMARY_LENGTH = 280;

/** 默认截断长度 (字符) */
export const DEFAULT_TRUNCATE_LENGTH = 280;

/** 默认分页大小 */
export const DEFAULT_PAGE_SIZE = 50;

/** 默认分页限制 */
export const DEFAULT_PAGE_LIMIT = 20;

/** 最大分页大小 */
export const MAX_PAGE_SIZE = 100;

/** 默认相似度阈值 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

/** 默认置信度阈值 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/** 最小置信度阈值 */
export const MIN_CONFIDENCE_THRESHOLD = 0.4;

/** 最大样本数量 */
export const MAX_SAMPLE_COUNT = 1000;

/** FTS 片段长度 */
export const FTS_SNIPPET_LENGTH = 64;

/** 僵尸笔记天数阈值 */
export const ZOMBIE_DAYS_THRESHOLD = 180;

/** 默认去重候选数 */
export const DEFAULT_DEDUPE_CANDIDATES = 6;

/** 单笔记最大链接数 */
export const MAX_LINKS_PER_NOTE = 100;

/** ID 格式正则表达式 (YYYYMMDDHHMMSS + 3位随机数) */
export const ID_REGEX = /^(\d{17})$/;

/** ISO 8601 时间戳格式正则表达式 */
export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/** 链接类型映射 (正向 -> 反向) */
export const LINK_TYPE_REVERSE_MAP: Record<string, string> = {
  supports: "supported_by",
  supported_by: "supports",
  refines: "refined_by",
  refined_by: "refines",
  extends: "extended_by",
  extended_by: "extends",
  contradicts: "contradicted_by",
  contradicted_by: "contradicts",
  is_example_of: "has_example",
  has_example: "is_example_of",
  related: "related", // 对称关系
} as const;

/** 模糊指代检测模式 (用于自治性检查) */
export const AMBIGUOUS_REFERENCE_PATTERNS = [
  /如上所述/g,
  /见前文/g,
  /前文提到/g,
  /之前说的/g,
  /上文/g,
  /前面/g,
  /这个/g,
  /那个/g,
] as const;

/** 原子化检查阈值 */
export const ATOMICITY_THRESHOLDS = {
  /** 最大句子数 */
  MAX_SENTENCES: 10,
  /** 最大段落数 */
  MAX_PARAGRAPHS: 3,
  /** 信号词检测 */
  SIGNAL_WORDS: ["第一", "第二", "第三", "首先", "其次", "另外", "此外", "同时"],
} as const;

/** 模板文件名 */
export const TEMPLATE_FILES = {
  ATOMIC: "atomic.md",
  STRUCTURE: "structure.md",
  SOURCE: "source.md",
} as const;

/** 默认模板内容 */
export const DEFAULT_TEMPLATES = {
  ATOMIC: `---
id: {{id}}
title: {{title}}
summary: {{summary}}
tags: {{tags}}
type: atomic
status: FLEETING
confidence: 3
links: []
created_at: {{created_at}}
updated_at: {{updated_at}}
---

# {{title}}

{{content}}`,

  STRUCTURE: `---
id: {{id}}
title: {{title}}
summary: {{summary}}
tags: {{tags}}
type: structure
status: PERMANENT
confidence: 4
links: []
created_at: {{created_at}}
updated_at: {{updated_at}}
---

# {{title}}

## 导航

{{navigation}}

## 包含的卡片

{{card_list}}`,
} as const;