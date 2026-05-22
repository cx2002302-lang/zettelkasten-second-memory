/**
 * PathFinder 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ensureZettelkastenSchema } from "../../storage/db-schema.js";
import { PathFinder } from "../path-finder.js";

describe("PathFinder", () => {
  let db: DatabaseSync;
  let pathFinder: PathFinder;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureZettelkastenSchema({ db, ftsEnabled: false });
    pathFinder = new PathFinder(db);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * 辅助函数：创建测试笔记
   */
  function createNote(id: string, title: string) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO zettel_notes (id, title, content, type, status, folder, file_path, created_at, updated_at)
       VALUES (?, ?, ?, 'atomic', 'PERMANENT', 'zettels', ?, ?, ?)`
    ).run(id, title, `Content of ${title}`, `/notes/${id}.md`, now, now);
  }

  /**
   * 辅助函数：创建链接
   */
  function createLink(fromId: string, toId: string, type: string = "supports") {
    db.prepare(
      `INSERT INTO zettel_links (from_note_id, to_note_id, type) VALUES (?, ?, ?)`
    ).run(fromId, toId, type);
  }

  describe("findPath", () => {
    it("直接链接：返回单步路径", () => {
      createNote("A", "Note A");
      createNote("B", "Note B");
      createLink("A", "B", "supports");

      const result = pathFinder.findPath("A", "B");
      expect(result).not.toBeNull();
      expect(result!.path).toHaveLength(2);
      expect(result!.path[0].noteId).toBe("A");
      expect(result!.path[1].noteId).toBe("B");
      expect(result!.stepCount).toBe(1);
      expect(result!.explanation).toContain("直接");
    });

    it("间接路径：返回多步路径", () => {
      createNote("A", "Note A");
      createNote("B", "Note B");
      createNote("C", "Note C");
      createLink("A", "C", "supports");
      createLink("C", "B", "refines");

      const result = pathFinder.findPath("A", "B");
      expect(result).not.toBeNull();
      expect(result!.path).toHaveLength(3);
      expect(result!.path[0].noteId).toBe("A");
      expect(result!.path[1].noteId).toBe("C");
      expect(result!.path[2].noteId).toBe("B");
      expect(result!.stepCount).toBe(2);
      expect(result!.explanation).toContain("经过 2 步");
    });

    it("无路径：返回 null", () => {
      createNote("A", "Note A");
      createNote("B", "Note B");
      // 不创建链接

      const result = pathFinder.findPath("A", "B");
      expect(result).toBeNull();
    });

    it("循环链接：不陷入死循环", () => {
      createNote("A", "Note A");
      createNote("B", "Note B");
      createNote("C", "Note C");
      createLink("A", "B", "supports");
      createLink("B", "C", "supports");
      createLink("C", "A", "supports");

      const result = pathFinder.findPath("A", "B");
      expect(result).not.toBeNull();
      expect(result!.path).toHaveLength(2);
    });

    it("maxDepth 限制：超深路径返回 null", () => {
      // A -> B -> C -> D -> E -> F -> G（7 个节点，链长 6）
      const nodes = ["A", "B", "C", "D", "E", "F", "G"];
      for (const id of nodes) {
        createNote(id, `Note ${id}`);
      }
      for (let i = 0; i < nodes.length - 1; i++) {
        createLink(nodes[i], nodes[i + 1], "supports");
      }

      // maxDepth=5 应该找不到（路径长度 6 > maxDepth 5）
      const result = pathFinder.findPath("A", "G", { maxDepth: 5 });
      expect(result).toBeNull();

      // maxDepth=6 应该找到
      const result2 = pathFinder.findPath("A", "G", { maxDepth: 6 });
      expect(result2).not.toBeNull();
      expect(result2!.stepCount).toBe(6);
    });

    it("linkTypeFilter：只返回指定类型的链接", () => {
      createNote("A", "Note A");
      createNote("B", "Note B");
      createNote("C", "Note C");
      createLink("A", "C", "supports");
      createLink("C", "B", "contradicts");

      // 只查 supports 类型，找不到路径（因为 C->B 是 contradicts）
      const result = pathFinder.findPath("A", "B", { linkTypeFilter: ["supports"] });
      expect(result).toBeNull();

      // 查 supports + contradicts，能找到
      const result2 = pathFinder.findPath("A", "B", {
        linkTypeFilter: ["supports", "contradicts"],
      });
      expect(result2).not.toBeNull();
    });

    it("相同节点：返回 null", () => {
      createNote("A", "Note A");
      const result = pathFinder.findPath("A", "A");
      expect(result).toBeNull();
    });

    it("不存在的节点：返回 null", () => {
      createNote("A", "Note A");
      const result = pathFinder.findPath("A", "NONEXISTENT");
      expect(result).toBeNull();
    });

    it("权重计算：总权重正确累加", () => {
      createNote("A", "Note A");
      createNote("B", "Note B");
      createNote("C", "Note C");
      createLink("A", "C", "supports");   // 权重 1.0
      createLink("C", "B", "contradicts"); // 权重 2.0

      const result = pathFinder.findPath("A", "B");
      expect(result).not.toBeNull();
      expect(result!.totalWeight).toBe(3.0); // 1.0 + 2.0
    });
  });

  describe("路径解释", () => {
    it("单步路径解释正确", () => {
      createNote("A", "笔记 A");
      createNote("B", "笔记 B");
      createLink("A", "B", "supports");

      const result = pathFinder.findPath("A", "B");
      expect(result!.explanation).toBe("直接通过「supports」链接");
    });

    it("多步路径解释包含中文", () => {
      createNote("A", "Docker 基础");
      createNote("B", "容器网络");
      createNote("C", "Bridge 模式");
      createLink("A", "B", "extends");
      createLink("B", "C", "refines");

      const result = pathFinder.findPath("A", "C");
      expect(result!.explanation).toContain("从「Docker 基础」extends到「容器网络」");
      expect(result!.explanation).toContain("从「容器网络」refines到「Bridge 模式」");
    });
  });
});
