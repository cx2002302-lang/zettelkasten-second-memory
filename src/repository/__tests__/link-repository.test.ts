/**
 * LinkRepository 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LinkRepository } from "../link-repository.js";
import { NoteRepository } from "../note-repository.js";
import { createTestDatabase, closeTestDatabase, createTestNoteData } from "./test-helpers.js";
import { createTestDir, cleanupTestDir } from "../../testing/test-fs.js";
import type { DatabaseSync } from "node:sqlite";
import type { LinkType } from "../../core/types.js";

describe("LinkRepository", () => {
  let db: DatabaseSync;
  let linkRepository: LinkRepository;
  let noteRepository: NoteRepository;
  let notesDir: string;

  beforeEach(() => {
    db = createTestDatabase();
    linkRepository = new LinkRepository(db);
    noteRepository = new NoteRepository(db);
    notesDir = createTestDir("zk-link-repo-");
  });

  afterEach(() => {
    closeTestDatabase(db);
    cleanupTestDir(notesDir);
  });

  // Helper to create notes for link testing
  async function createNotes(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const note = await noteRepository.create(
        createTestNoteData({ title: `Note ${i}` }),
        notesDir
      );
      ids.push(note.id);
    }
    return ids;
  }

  describe("create", () => {
    it("should create a basic link", async () => {
      const [fromId, toId] = await createNotes(2);
      linkRepository.create(fromId, toId, "related" as LinkType);
      const links = linkRepository.getLinksFrom(fromId);
      expect(links).toHaveLength(1);
      expect(links[0].to).toBe(toId);
      expect(links[0].type).toBe("related");
    });

    it("should create a link with context", async () => {
      const [fromId, toId] = await createNotes(2);
      linkRepository.create(fromId, toId, "supports" as LinkType, "test context");
      const links = linkRepository.getLinksFrom(fromId);
      expect(links[0].context).toBe("test context");
    });

    it("should support all link types", async () => {
      const ids = await createNotes(12);
      const types: LinkType[] = [
        "supports", "supported_by", "refines", "refined_by",
        "extends", "extended_by", "contradicts", "contradicted_by",
        "is_example_of", "has_example", "related"
      ];
      types.forEach((type, i) => {
        linkRepository.create(ids[0], ids[i + 1], type);
      });
      const links = linkRepository.getLinksFrom(ids[0]);
      expect(links).toHaveLength(types.length);
    });

    it("should replace existing link with same type", async () => {
      const [fromId, toId] = await createNotes(2);
      linkRepository.create(fromId, toId, "related" as LinkType, "old context");
      linkRepository.create(fromId, toId, "related" as LinkType, "new context");
      const links = linkRepository.getLinksFrom(fromId);
      expect(links).toHaveLength(1);
      expect(links[0].context).toBe("new context");
    });
  });

  describe("delete", () => {
    it("should delete an existing link", async () => {
      const [fromId, toId] = await createNotes(2);
      linkRepository.create(fromId, toId, "related" as LinkType);
      const result = linkRepository.delete(fromId, toId, "related" as LinkType);
      expect(result).toBe(true);
      const links = linkRepository.getLinksFrom(fromId);
      expect(links).toHaveLength(0);
    });

    it("should return false for non-existent link", () => {
      const result = linkRepository.delete("non-1", "non-2", "related" as LinkType);
      expect(result).toBe(false);
    });
  });

  describe("getLinksFrom", () => {
    it("should get all links from a note", async () => {
      const ids = await createNotes(3);
      linkRepository.create(ids[0], ids[1], "related" as LinkType);
      linkRepository.create(ids[0], ids[2], "supports" as LinkType);
      const links = linkRepository.getLinksFrom(ids[0]);
      expect(links).toHaveLength(2);
    });

    it("should return empty array when no links", async () => {
      const [id] = await createNotes(1);
      const links = linkRepository.getLinksFrom(id);
      expect(links).toEqual([]);
    });
  });

  describe("getLinksTo", () => {
    it("should get backlinks to a note", async () => {
      const ids = await createNotes(3);
      linkRepository.create(ids[0], ids[2], "related" as LinkType);
      linkRepository.create(ids[1], ids[2], "supports" as LinkType);
      const links = linkRepository.getLinksTo(ids[2]);
      expect(links).toHaveLength(2);
    });

    it("should map reverse link types", async () => {
      const [fromId, toId] = await createNotes(2);
      linkRepository.create(fromId, toId, "supports" as LinkType);
      const links = linkRepository.getLinksTo(toId);
      expect(links[0].type).toBe("supported_by");
    });

    it("should keep related as symmetric", async () => {
      const [fromId, toId] = await createNotes(2);
      linkRepository.create(fromId, toId, "related" as LinkType);
      const links = linkRepository.getLinksTo(toId);
      expect(links[0].type).toBe("related");
    });
  });

  describe("getLinksBetween", () => {
    it("should get links between two notes", async () => {
      const ids = await createNotes(2);
      linkRepository.create(ids[0], ids[1], "supports" as LinkType);
      linkRepository.create(ids[1], ids[0], "refines" as LinkType);
      const links = linkRepository.getLinksBetween(ids[0], ids[1]);
      expect(links).toHaveLength(2);
    });
  });

  describe("findPath", () => {
    it("should find direct path", async () => {
      const [a, b] = await createNotes(2);
      linkRepository.create(a, b, "related" as LinkType);
      const path = linkRepository.findPath(a, b);
      expect(path).toEqual([a, b]);
    });

    it("should find indirect path", async () => {
      const [a, b, c] = await createNotes(3);
      linkRepository.create(a, b, "related" as LinkType);
      linkRepository.create(b, c, "related" as LinkType);
      const path = linkRepository.findPath(a, c);
      expect(path).toContain(a);
      expect(path).toContain(c);
    });

    it("should respect max depth", async () => {
      const ids = await createNotes(11);
      for (let i = 0; i < ids.length - 1; i++) {
        linkRepository.create(ids[i], ids[i + 1], "related" as LinkType);
      }
      const path = linkRepository.findPath(ids[0], ids[10], 3);
      expect(path).toBeNull();
    });

    it("should return null when no path exists", async () => {
      const [a, b] = await createNotes(2);
      const path = linkRepository.findPath(a, b);
      expect(path).toBeNull();
    });
  });

  describe("getStats", () => {
    it("should return total link count", async () => {
      const ids = await createNotes(4);
      linkRepository.create(ids[0], ids[1], "related" as LinkType);
      linkRepository.create(ids[2], ids[3], "supports" as LinkType);
      const stats = linkRepository.getStats();
      expect(stats.total).toBe(2);
    });

    it("should count by type", async () => {
      const ids = await createNotes(4);
      linkRepository.create(ids[0], ids[1], "related" as LinkType);
      linkRepository.create(ids[2], ids[3], "related" as LinkType);
      linkRepository.create(ids[0], ids[2], "supports" as LinkType);
      const stats = linkRepository.getStats();
      expect(stats.byType.related).toBe(2);
      expect(stats.byType.supports).toBe(1);
    });

    it("should return popular sources", async () => {
      const ids = await createNotes(4);
      linkRepository.create(ids[0], ids[1], "related" as LinkType);
      linkRepository.create(ids[0], ids[2], "related" as LinkType);
      linkRepository.create(ids[0], ids[3], "related" as LinkType);
      const stats = linkRepository.getStats();
      expect(stats.popularSources[0].noteId).toBe(ids[0]);
      expect(stats.popularSources[0].linkCount).toBe(3);
    });

    it("should return popular targets", async () => {
      const ids = await createNotes(4);
      linkRepository.create(ids[0], ids[3], "related" as LinkType);
      linkRepository.create(ids[1], ids[3], "related" as LinkType);
      linkRepository.create(ids[2], ids[3], "related" as LinkType);
      const stats = linkRepository.getStats();
      expect(stats.popularTargets[0].noteId).toBe(ids[3]);
      expect(stats.popularTargets[0].linkCount).toBe(3);
    });
  });

  describe("deleteBySource", () => {
    it("should delete all links from a note", async () => {
      const ids = await createNotes(3);
      linkRepository.create(ids[0], ids[1], "related" as LinkType);
      linkRepository.create(ids[0], ids[2], "supports" as LinkType);
      const result = linkRepository.deleteBySource(ids[0]);
      expect(result).toBe(true);
      expect(linkRepository.getLinksFrom(ids[0])).toHaveLength(0);
    });
  });

  describe("deleteByTarget", () => {
    it("should delete all links to a note", async () => {
      const ids = await createNotes(3);
      linkRepository.create(ids[0], ids[2], "related" as LinkType);
      linkRepository.create(ids[1], ids[2], "supports" as LinkType);
      const result = linkRepository.deleteByTarget(ids[2]);
      expect(result).toBe(true);
      expect(linkRepository.getLinksTo(ids[2])).toHaveLength(0);
    });
  });
});
