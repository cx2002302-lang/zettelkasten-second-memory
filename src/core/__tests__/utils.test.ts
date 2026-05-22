/**
 * Zettelkasten Core Utils 单元测试
 */

import { describe, it, expect } from "vitest";
import {
  generateZettelId,
  isValidZettelId,
  toISOString,
  parseDateFromId,
  getNoteFilePath,
  getReverseLinkType,
  isSymmetricLink,
  countSentences,
  countParagraphs,
  detectAmbiguousReferences,
  checkAtomicity,
  generateSummary,
  extractTagsFromContent,
  extractLinksFromContent,
  deepEqual,
} from "../utils.js";
import type { Link } from "../types.js";

describe("generateZettelId", () => {
  it("should generate a valid Zettel ID", () => {
    const id = generateZettelId();
    expect(id).toMatch(/^\d{17}$/); // 14位时间 + 3位随机数
  });

  it("should generate unique IDs", () => {
    const id1 = generateZettelId();
    const id2 = generateZettelId();
    expect(id1).not.toBe(id2);
  });

  it("should use provided date", () => {
    const date = new Date("2024-01-15T10:30:45");
    const id = generateZettelId(date);
    expect(id).toMatch(/^20240115103045\d{3}$/);
  });
});

describe("isValidZettelId", () => {
  it("should return true for valid ID", () => {
    expect(isValidZettelId("20240115103045123")).toBe(true);
  });

  it("should return false for invalid ID", () => {
    expect(isValidZettelId("invalid")).toBe(false);
    expect(isValidZettelId("20240115")).toBe(false);
    expect(isValidZettelId("")).toBe(false);
  });
});

describe("toISOString", () => {
  it("should format date to ISO string", () => {
    const date = new Date("2024-01-15T10:30:45.000Z");
    expect(toISOString(date)).toBe("2024-01-15T10:30:45.000Z");
  });

  it("should use current date by default", () => {
    const result = toISOString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe("parseDateFromId", () => {
  it("should parse date from valid ID", () => {
    const date = parseDateFromId("20240115103045123");
    expect(date).not.toBeNull();
    expect(date?.getUTCFullYear()).toBe(2024);
    expect(date?.getUTCMonth()).toBe(0); // January
    expect(date?.getUTCDate()).toBe(15);
    expect(date?.getUTCHours()).toBe(10);
    expect(date?.getUTCMinutes()).toBe(30);
    expect(date?.getUTCSeconds()).toBe(45);
  });

  it("should return null for invalid ID", () => {
    expect(parseDateFromId("invalid")).toBeNull();
  });
});

describe("getNoteFilePath", () => {
  it("should generate file path with default extension", () => {
    expect(getNoteFilePath("/notes", "20240115103045123")).toBe(
      "/notes/20240115103045123.md"
    );
  });

  it("should generate file path with custom extension", () => {
    expect(getNoteFilePath("/notes", "20240115103045123", ".txt")).toBe(
      "/notes/20240115103045123.txt"
    );
  });
});

describe("getReverseLinkType", () => {
  it("should return correct reverse types", () => {
    expect(getReverseLinkType("supports")).toBe("supported_by");
    expect(getReverseLinkType("supported_by")).toBe("supports");
    expect(getReverseLinkType("refines")).toBe("refined_by");
    expect(getReverseLinkType("refined_by")).toBe("refines");
    expect(getReverseLinkType("extends")).toBe("extended_by");
    expect(getReverseLinkType("extended_by")).toBe("extends");
    expect(getReverseLinkType("contradicts")).toBe("contradicted_by");
    expect(getReverseLinkType("contradicted_by")).toBe("contradicts");
    expect(getReverseLinkType("is_example_of")).toBe("has_example");
    expect(getReverseLinkType("has_example")).toBe("is_example_of");
  });

  it("should return same type for symmetric links", () => {
    expect(getReverseLinkType("related")).toBe("related");
  });

  it("should return same type for unknown types", () => {
    expect(getReverseLinkType("unknown")).toBe("unknown");
  });
});

describe("isSymmetricLink", () => {
  it("should return true for symmetric links", () => {
    // link1: A -> B (supports)
    // link2: A -> B (supported_by is reverse of supports)
    const link1: Link = {
      to: "note-b",
      type: "supports",
      createdAt: "2024-01-01",
    };
    const link2: Link = {
      to: "note-b",
      type: "supported_by",
      createdAt: "2024-01-01",
    };
    expect(isSymmetricLink(link1, link2)).toBe(true);
  });

  it("should return false for non-symmetric links", () => {
    const link1: Link = {
      to: "note-b",
      type: "supports",
      createdAt: "2024-01-01",
    };
    const link2: Link = {
      to: "note-b",
      type: "extends",
      createdAt: "2024-01-01",
    };
    expect(isSymmetricLink(link1, link2)).toBe(false);
  });
});

describe("countSentences", () => {
  it("should count English sentences", () => {
    expect(countSentences("Hello world. This is a test.")).toBe(2);
  });

  it("should count Chinese sentences", () => {
    expect(countSentences("你好世界。这是一个测试。")).toBe(2);
  });

  it("should handle mixed punctuation", () => {
    expect(countSentences("Hello! How are you? I'm fine.")).toBe(3);
  });

  it("should return 0 for empty text", () => {
    expect(countSentences("")).toBe(0);
  });
});

describe("countParagraphs", () => {
  it("should count paragraphs", () => {
    expect(countParagraphs("Para 1\n\nPara 2\n\nPara 3")).toBe(3);
  });

  it("should handle single paragraph", () => {
    expect(countParagraphs("Single paragraph")).toBe(1);
  });

  it("should return 0 for empty text", () => {
    expect(countParagraphs("")).toBe(0);
  });
});

describe("detectAmbiguousReferences", () => {
  it("should detect Chinese ambiguous references", () => {
    const text = "如上所述，这个问题很重要。";
    const refs = detectAmbiguousReferences(text);
    expect(refs).toContain("如上所述");
  });

  it("should detect multiple references", () => {
    const text = "见前文，前文提到这个。这个很重要。";
    const refs = detectAmbiguousReferences(text);
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  it("should return empty array for clean text", () => {
    const text = "这是一个自包含的句子，不需要上下文。";
    const refs = detectAmbiguousReferences(text);
    expect(refs).toHaveLength(0);
  });
});

describe("checkAtomicity", () => {
  it("should pass for short atomic content", () => {
    const result = checkAtomicity("这是一个简单的句子。");
    expect(result.isAtomic).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("should detect too many sentences", () => {
    const content = "句子1。句子2。句子3。句子4。句子5。句子6。句子7。句子8。句子9。句子10。句子11。";
    const result = checkAtomicity(content);
    expect(result.isAtomic).toBe(false);
    expect(result.issues.some(i => i.includes("句子数过多"))).toBe(true);
  });

  it("should detect too many paragraphs", () => {
    const content = "P1\n\nP2\n\nP3\n\nP4";
    const result = checkAtomicity(content);
    expect(result.isAtomic).toBe(false);
    expect(result.issues.some(i => i.includes("段落数过多"))).toBe(true);
  });

  it("should detect signal words", () => {
    const result = checkAtomicity("首先，这是第一点。其次，这是第二点。");
    expect(result.isAtomic).toBe(false);
    expect(result.issues.some(i => i.includes("多概念信号词"))).toBe(true);
  });

  it("should detect ambiguous references", () => {
    const result = checkAtomicity("如上所述，这个问题很重要。");
    expect(result.isAtomic).toBe(false);
    expect(result.issues.some(i => i.includes("模糊指代"))).toBe(true);
  });
});

describe("generateSummary", () => {
  it("should return summary within maxLength", () => {
    const content = "这是第一句。这是第二句。这是第三句。";
    const summary = generateSummary(content, 280);
    // 函数会在句子之间添加空格，所以输出包含多个句子
    expect(summary).toBe("这是第一句 这是第二句 这是第三句");
  });

  it("should respect maxLength and truncate", () => {
    const content = "这是一个很长的句子，包含了很多内容。第二句内容。";
    const summary = generateSummary(content, 10);
    expect(summary.length).toBeLessThanOrEqual(10);
    expect(summary.endsWith("...")).toBe(true);
  });

  it("should return empty string for empty content", () => {
    expect(generateSummary("")).toBe("");
  });

  it("should handle single sentence", () => {
    const content = "短内容。";
    const summary = generateSummary(content, 100);
    expect(summary).toBe("短内容");
  });
});

describe("extractTagsFromContent", () => {
  it("should extract tags from content", () => {
    const content = "这是一篇关于 #编程 和 #人工智能 的文章。";
    const tags = extractTagsFromContent(content);
    expect(tags).toContain("编程");
    expect(tags).toContain("人工智能");
  });

  it("should handle multiple occurrences", () => {
    const content = "#tag 出现了两次 #tag";
    const tags = extractTagsFromContent(content);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toBe("tag");
  });

  it("should return empty array for no tags", () => {
    expect(extractTagsFromContent("没有标签的内容")).toHaveLength(0);
  });
});

describe("extractLinksFromContent", () => {
  it("should extract links from content", () => {
    const content = "参见 [[20240115103045123]] 和 [[20240115103045124|描述]]";
    const links = extractLinksFromContent(content);
    expect(links).toContain("20240115103045123");
    expect(links).toContain("20240115103045124");
  });

  it("should handle multiple occurrences", () => {
    const content = "[[id1]] [[id1]] [[id2]]";
    const links = extractLinksFromContent(content);
    expect(links).toHaveLength(2);
  });

  it("should return empty array for no links", () => {
    expect(extractLinksFromContent("没有链接的内容")).toHaveLength(0);
  });
});

describe("deepEqual", () => {
  it("should return true for equal primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
  });

  it("should return false for different primitives", () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual("a", "b")).toBe(false);
  });

  it("should return true for equal objects", () => {
    expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it("should return false for different objects", () => {
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  it("should return true for null values", () => {
    expect(deepEqual(null, null)).toBe(true);
  });

  it("should handle nested objects", () => {
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });
});