import { ID_REGEX, ISO_DATE_REGEX } from "./constants.js";
import type { ZettelNote, Link } from "./types.js";

/**
 * 生成 Zettel ID (YYYYMMDDHHMMSS + 3位随机数)
 * 添加随机后缀以避免同一秒内创建多个笔记时 ID 冲突
 */
export function generateZettelId(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  
  return `${year}${month}${day}${hours}${minutes}${seconds}${random}`;
}

/**
 * 验证 Zettel ID 格式
 */
export function isValidZettelId(id: string): boolean {
  return ID_REGEX.test(id);
}

/**
 * 格式化日期为 ISO 8601 字符串
 */
export function toISOString(date: Date = new Date()): string {
  return date.toISOString();
}

/**
 * 从 Zettel ID 解析日期
 */
export function parseDateFromId(id: string): Date | null {
  if (!isValidZettelId(id)) {
    return null;
  }
  
  const year = parseInt(id.substring(0, 4), 10);
  const month = parseInt(id.substring(4, 6), 10) - 1; // 0-indexed
  const day = parseInt(id.substring(6, 8), 10);
  const hours = parseInt(id.substring(8, 10), 10);
  const minutes = parseInt(id.substring(10, 12), 10);
  const seconds = parseInt(id.substring(12, 14), 10);
  
  return new Date(Date.UTC(year, month, day, hours, minutes, seconds));
}

/**
 * 获取卡片文件路径
 */
export function getNoteFilePath(
  notesDir: string,
  id: string,
  ext: string = ".md"
): string {
  return `${notesDir}/${id}${ext}`;
}

/**
 * 提取反向链接类型
 */
export function getReverseLinkType(type: string): string {
  const reverseMap: Record<string, string> = {
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
    related: "related",
  };
  
  return reverseMap[type] || type;
}

/**
 * 检查链接是否对称 (双向一致)
 */
export function isSymmetricLink(link1: Link, link2: Link): boolean {
  return (
    link1.to === link2.to &&
    link1.type === getReverseLinkType(link2.type)
  );
}

/**
 * 计算卡片内容的句子数
 */
export function countSentences(text: string): number {
  // 简单句子分割
  const sentences = text.split(/[.!?。！？]+/).filter(s => s.trim().length > 0);
  return sentences.length;
}

/**
 * 计算卡片内容的段落数
 */
export function countParagraphs(text: string): number {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  return paragraphs.length;
}

/**
 * 检测模糊指代 (用于自治性检查)
 */
export function detectAmbiguousReferences(text: string): string[] {
  const patterns = [
    /如上所述/g,
    /见前文/g,
    /前文提到/g,
    /之前说的/g,
    /上文/g,
    /前面/g,
    /这个(?![的])/g, // 排除"这个的"
    /那个(?![的])/g,
  ];
  
  const matches: string[] = [];
  patterns.forEach(pattern => {
    const found = text.match(pattern);
    if (found) {
      matches.push(...found);
    }
  });
  
  return [...new Set(matches)]; // 去重
}

/**
 * 检查卡片是否符合原子化原则
 */
export function checkAtomicity(content: string): {
  isAtomic: boolean;
  issues: string[];
  suggestions: string[];
} {
  const issues: string[] = [];
  const suggestions: string[] = [];
  
  const sentenceCount = countSentences(content);
  const paragraphCount = countParagraphs(content);
  
  if (sentenceCount > 10) {
    issues.push(`句子数过多 (${sentenceCount} > 10)`);
    suggestions.push("考虑拆分为多个原子卡片");
  }
  
  if (paragraphCount > 3) {
    issues.push(`段落数过多 (${paragraphCount} > 3)`);
    suggestions.push("每个段落可能代表一个独立概念");
  }
  
  // 检测信号词
  const signalWords = ["第一", "第二", "第三", "首先", "其次", "另外", "此外", "同时"];
  const foundSignals = signalWords.filter(word => content.includes(word));
  if (foundSignals.length > 0) {
    issues.push(`检测到多概念信号词: ${foundSignals.join(", ")}`);
    suggestions.push("考虑在每个信号词处拆分卡片");
  }
  
  const ambiguousRefs = detectAmbiguousReferences(content);
  if (ambiguousRefs.length > 0) {
    issues.push(`检测到模糊指代: ${ambiguousRefs.join(", ")}`);
    suggestions.push("请确保卡片内容自包含，不需要依赖上下文");
  }
  
  return {
    isAtomic: issues.length === 0,
    issues,
    suggestions,
  };
}

/**
 * 生成卡片摘要 (简化版，后续可集成 AI)
 */
export function generateSummary(content: string, maxLength: number = 280): string {
  // 简单实现：取第一段或前几句话
  const sentences = content.split(/[.!?。！？]+/).filter(s => s.trim().length > 0);
  
  if (sentences.length === 0) {
    return "";
  }
  
  let summary = sentences[0];
  for (let i = 1; i < sentences.length; i++) {
    const nextSentence = ` ${sentences[i]}`;
    if (summary.length + nextSentence.length <= maxLength) {
      summary += nextSentence;
    } else {
      break;
    }
  }
  
  // 确保不超过最大长度
  if (summary.length > maxLength) {
    summary = summary.substring(0, maxLength - 3) + "...";
  }
  
  return summary.trim();
}

/**
 * 提取卡片中的标签引用
 */
export function extractTagsFromContent(content: string): string[] {
  // 匹配 #标签 格式
  const tagRegex = /#([\w\u4e00-\u9fa5\-]+)/g;
  const matches = content.match(tagRegex) || [];
  
  // 去重并移除 #
  return [...new Set(matches.map(tag => tag.substring(1)))];
}

/**
 * 提取卡片中的内部链接引用 [[ID]]
 */
export function extractLinksFromContent(content: string): string[] {
  // 匹配 [[ID]] 或 [[ID|描述]] 格式
  const linkRegex = /\[\[([\w\d]+)(?:\|.*?)?\]\]/g;
  const matches = content.match(linkRegex) || [];
  
  // 提取 ID 部分
  return [...new Set(matches.map(link => {
    const match = link.match(/\[\[([\w\d]+)/);
    return match ? match[1] : "";
  }))].filter(id => id.length > 0);
}

/**
 * 深度比较两个对象是否相等
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return false;

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;

  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual(objA[key], objB[key])) return false;
  }

  return true;
}