/**
 * LinkService 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LinkService } from "../link-service.js";
import { NoteRepository } from "../../repository/note-repository.js";
import {
  createTestDatabase,
  closeTestDatabase,
  createTestNoteData,
} from "../../repository/__tests__/test-helpers.js";
import { createTestDir, cleanupTestDir } from "../../testing/test-fs.js";
import type { DatabaseSync } from "node:sqlite";
import type { LinkType } from "../../core/types.js";

vi.mock("../../core/utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../core/utils.js")>();
  let counter = 0;
  return {
    ...original,
    generateZettelId: () => {
      counter++;
      return `202401151200${String(counter).padStart(3, "0")}`;
    },
  };
});

describe("LinkService", () => {
  let db: DatabaseSync;
  let linkService: LinkService;
  let noteRepository: NoteRepository;
  let notesDir: string;

  let mockIdCounter = 0;

  beforeEach(() => {
    db = createTestDatabase();
    linkService = new LinkService(db);
    noteRepository = new NoteRepository(db);
    notesDir = createTestDir("zk-link-svc-");
    mockIdCounter = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      mockIdCounter++;
      return mockIdCounter * 0.001;
    });
  });

  afterEach(() => {
    closeTestDatabase(db);
    cleanupTestDir(notesDir);
    vi.restoreAllMocks();
  });

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

  describe("createLink", () => {
    it("should create a basic link between two notes", async () => {
      const [fromId, toId] = await createNotes(2);
      linkService.createLink(fromId, toId, "related");
      const links = linkService.getLinksFrom(fromId);
      expect(links).toHaveLength(1);
      expect(links[0].to).toBe(toId);
      expect(links[0].type).toBe("related");
    });

    it("should create link with context", async () => {
      const [fromId, toId] = await createNotes(2);
      linkService.createLink(fromId, toId, "supports", {
        context: "This note supports the other",
      });
      const links = linkService.getLinksFrom(fromId);
      expect(links[0].context).toBe("This note supports the other");
    });

    it("should auto-create reverse link by default", async () => {
      const [fromId, toId] = await createNotes(2);
      linkService.createLink(fromId, toId, "supports");
      const forwardLinks = linkService.getLinksFrom(fromId);
      expect(forwardLinks).toHaveLength(1);
      expect(forwardLinks[0].type).toBe("supports");
      const reverseLinks = linkService.getLinksFrom(toId);
      expect(reverseLinks).toHaveLength(1);
      expect(reverseLinks[0].type).toBe("supported_by");
      expect(reverseLinks[0].to).toBe(fromId);
    });

    it("should not create reverse link when autoReverse is false", async () => {
      const [fromId, toId] = await createNotes(2);
      linkService.createLink(fromId, toId, "supports", { autoReverse: false });
      const forwardLinks = linkService.getLinksFrom(fromId);
      expect(forwardLinks).toHaveLength(1);
      const reverseLinks = linkService.getLinksFrom(toId);
      expect(reverseLinks).toHaveLength(0);
    });

    it("should not create reverse link when autoBidirectional config is false", async () => {
      const [fromId, toId] = await createNotes(2);
      const serviceNoAuto = new LinkService(db, { autoBidirectional: false });
      serviceNoAuto.createLink(fromId, toId, "supports");
      const forwardLinks = serviceNoAuto.getLinksFrom(fromId);
      expect(forwardLinks).toHaveLength(1);
      const reverseLinks = serviceNoAuto.getLinksFrom(toId);
      expect(reverseLinks).toHaveLength(0);
    });

    it("should throw error when from note does not exist", async () => {
      const [toId] = await createNotes(1);
      expect(() => {
        linkService.createLink("non-existent-id", toId, "related");
      }).toThrow('Note "non-existent-id" does not exist');
    });

    it("should throw error when to note does not exist", async () => {
      const [fromId] = await createNotes(1);
      expect(() => {
        linkService.createLink(fromId, "non-existent-id", "related");
      }).toThrow('Note "non-existent-id" does not exist');
    });

    it("should support all link types", async () => {
      const ids = await createNotes(12);
      const types: LinkType[] = [
        "supports", "supported_by", "refines", "refined_by",
        "extends", "extended_by", "contradicts", "contradicted_by",
        "is_example_of", "has_example", "related",
      ];
      types.forEach((type, i) => {
        linkService.createLink(ids[0], ids[i + 1], type, { autoReverse: false });
      });
      const links = linkService.getLinksFrom(ids[0]);
      expect(links).toHaveLength(types.length);
    });

    it("should map correct reverse link types", async () => {
      const [fromId, toId] = await createNotes(2);
      linkService.createLink(fromId, toId, "supports");
      let reverseLinks = linkService.getLinksFrom(toId);
      expect(reverseLinks[0].type).toBe("supported_by");
      linkService.deleteLink(fromId, toId, "supports");
      linkService.deleteLink(toId, fromId, "supported_by");
      linkService.createLink(fromId, toId, "refines");
      reverseLinks = linkService.getLinksFrom(toId);
      expect(reverseLinks[0].type).toBe("refined_by");
    });

    it("should keep related as symmetric reverse type", async () => {
      const [fromId, toId] = await createNotes(2);
      linkService.createLink(fromId, toId, "related");
      const reverseLinks = linkService.getLinksFrom(toId);
      expect(reverseLinks[0].type).toBe("related");
    });
  });

  describe("deleteLink", () => {
    it("should delete an existing link", async () => {
      const [fromId, toId] = await createNotes(2);
      linkService.createLink(fromId, toId, "related", { autoReverse: false });
      const result = linkService.deleteLink(fromId, toId, "related");
      expect(result).toBe(true);
      const links = linkService.getLinksFrom(fromId);
      expect(links).toHaveLength(0);
    });

    it("should cascade delete reverse link when autoBidirectional is enabled", async () => {
      const [fromId, toId] = await createNotes(2);
      linkService.createLink(fromId, toId, "supports");
      const result = linkService.deleteLink(fromId, toId, "supports");
      expect(result).toBe(true);
      const forwardLinks = linkService.getLinksFrom(fromId);
      expect(forwardLinks).toHaveLength(0);
      const reverseLinks = linkService.getLinksFrom(toId);
      expect(reverseLinks).toHaveLength(0);
    });

    it("should not cascade delete when autoBidirectional is disabled", async () => {
      const [fromId, toId] = await createNotes(2);
      const serviceNoAuto = new LinkService(db, { autoBidirectional: false });
      // When autoBidirectional is false, only forward link is created
      serviceNoAuto.createLink(fromId, toId, "supports");
      const linksBeforeDelete = serviceNoAuto.getLinksFrom(toId);
      // No reverse link was created
      expect(linksBeforeDelete).toHaveLength(0);
      // Delete should only remove forward link
      serviceNoAuto.deleteLink(fromId, toId, "supports");
      const forwardLinks = serviceNoAuto.getLinksFrom(fromId);
      expect(forwardLinks).toHaveLength(0);
    });

    it("should return false for non-existent link", async () => {
      const [fromId, toId] = await createNotes(2);
      const result = linkService.deleteLink(fromId, toId, "related");
      expect(result).toBe(false);
    });
  });

  describe("getLinksFrom", () => {
    it("should get all links from a note", async () => {
      const ids = await createNotes(3);
      linkService.createLink(ids[0], ids[1], "related", { autoReverse: false });
      linkService.createLink(ids[0], ids[2], "supports", { autoReverse: false });
      const links = linkService.getLinksFrom(ids[0]);
      expect(links).toHaveLength(2);
    });

    it("should return empty array when no links", async () => {
      const [id] = await createNotes(1);
      const links = linkService.getLinksFrom(id);
      expect(links).toEqual([]);
    });

    it("should throw error when note does not exist", () => {
      expect(() => {
        linkService.getLinksFrom("non-existent-id");
      }).toThrow('Note "non-existent-id" does not exist');
    });
  });

  describe("getLinksTo", () => {
    it("should get backlinks to a note", async () => {
      const ids = await createNotes(3);
      linkService.createLink(ids[0], ids[2], "related", { autoReverse: false });
      linkService.createLink(ids[1], ids[2], "supports", { autoReverse: false });
      const links = linkService.getLinksTo(ids[2]);
      expect(links).toHaveLength(2);
    });

    it("should return empty array when no backlinks", async () => {
      const [id] = await createNotes(1);
      const links = linkService.getLinksTo(id);
      expect(links).toEqual([]);
    });

    it("should throw error when note does not exist", () => {
      expect(() => {
        linkService.getLinksTo("non-existent-id");
      }).toThrow('Note "non-existent-id" does not exist');
    });
  });

  describe("getLinksBetween", () => {
    it("should get links between two notes", async () => {
      const ids = await createNotes(2);
      linkService.createLink(ids[0], ids[1], "supports", { autoReverse: false });
      linkService.createLink(ids[1], ids[0], "refines", { autoReverse: false });
      const links = linkService.getLinksBetween(ids[0], ids[1]);
      expect(links).toHaveLength(2);
    });

    it("should return empty array when no links between notes", async () => {
      const ids = await createNotes(2);
      const links = linkService.getLinksBetween(ids[0], ids[1]);
      expect(links).toEqual([]);
    });

    it("should throw error when first note does not exist", async () => {
      const [id] = await createNotes(1);
      expect(() => {
        linkService.getLinksBetween("non-existent-id", id);
      }).toThrow('Note "non-existent-id" does not exist');
    });

    it("should throw error when second note does not exist", async () => {
      const [id] = await createNotes(1);
      expect(() => {
        linkService.getLinksBetween(id, "non-existent-id");
      }).toThrow('Note "non-existent-id" does not exist');
    });
  });

  describe("findPath", () => {
    it("should find direct path", async () => {
      const [a, b] = await createNotes(2);
      linkService.createLink(a, b, "related", { autoReverse: false });
      const path = linkService.findPath(a, b);
      expect(path).toEqual([a, b]);
    });

    it("should find indirect path", async () => {
      const [a, b, c] = await createNotes(3);
      linkService.createLink(a, b, "related", { autoReverse: false });
      linkService.createLink(b, c, "related", { autoReverse: false });
      const path = linkService.findPath(a, c);
      expect(path).toContain(a);
      expect(path).toContain(c);
    });

    it("should return null when no path exists", async () => {
      const [a, b] = await createNotes(2);
      const path = linkService.findPath(a, b);
      expect(path).toBeNull();
    });

    it("should respect max depth from config", async () => {
      const ids = await createNotes(8);
      for (let i = 0; i < ids.length - 1; i++) {
        linkService.createLink(ids[i], ids[i + 1], "related", { autoReverse: false });
      }
      const limitedService = new LinkService(db, { maxPathDepth: 3 });
      const path = limitedService.findPath(ids[0], ids[6]);
      expect(path).toBeNull();
    });

    it("should throw error when from note does not exist", async () => {
      const [toId] = await createNotes(1);
      expect(() => {
        linkService.findPath("non-existent-id", toId);
      }).toThrow('Note "non-existent-id" does not exist');
    });

    it("should throw error when to note does not exist", async () => {
      const [fromId] = await createNotes(1);
      expect(() => {
        linkService.findPath(fromId, "non-existent-id");
      }).toThrow('Note "non-existent-id" does not exist');
    });
  });

  describe("getStats", () => {
    it("should return total link count", async () => {
      const ids = await createNotes(4);
      linkService.createLink(ids[0], ids[1], "related", { autoReverse: false });
      linkService.createLink(ids[2], ids[3], "supports", { autoReverse: false });
      const stats = linkService.getStats();
      expect(stats.total).toBe(2);
    });

    it("should count by type", async () => {
      const ids = await createNotes(4);
      linkService.createLink(ids[0], ids[1], "related", { autoReverse: false });
      linkService.createLink(ids[2], ids[3], "related", { autoReverse: false });
      linkService.createLink(ids[0], ids[2], "supports", { autoReverse: false });
      const stats = linkService.getStats();
      expect(stats.byType.related).toBe(2);
      expect(stats.byType.supports).toBe(1);
    });

    it("should return popular sources", async () => {
      const ids = await createNotes(4);
      linkService.createLink(ids[0], ids[1], "related", { autoReverse: false });
      linkService.createLink(ids[0], ids[2], "related", { autoReverse: false });
      linkService.createLink(ids[0], ids[3], "related", { autoReverse: false });
      const stats = linkService.getStats();
      expect(stats.popularSources[0].noteId).toBe(ids[0]);
      expect(stats.popularSources[0].linkCount).toBe(3);
    });

    it("should return popular targets", async () => {
      const ids = await createNotes(4);
      linkService.createLink(ids[0], ids[3], "related", { autoReverse: false });
      linkService.createLink(ids[1], ids[3], "related", { autoReverse: false });
      linkService.createLink(ids[2], ids[3], "related", { autoReverse: false });
      const stats = linkService.getStats();
      expect(stats.popularTargets[0].noteId).toBe(ids[3]);
      expect(stats.popularTargets[0].linkCount).toBe(3);
    });
  });

  describe("batchCreateLinks", () => {
    it("should create multiple links", async () => {
      const ids = await createNotes(4);
      linkService.batchCreateLinks([
        { fromNoteId: ids[0], toNoteId: ids[1], type: "related" },
        { fromNoteId: ids[2], toNoteId: ids[3], type: "supports" },      ]);
      const links0 = linkService.getLinksFrom(ids[0]);
      expect(links0).toHaveLength(1);
      const links2 = linkService.getLinksFrom(ids[2]);
      expect(links2).toHaveLength(1);
    });

    it("should not create duplicate reverse links in batch", async () => {
      const ids = await createNotes(2);
      linkService.batchCreateLinks([
        { fromNoteId: ids[0], toNoteId: ids[1], type: "related" },
        { fromNoteId: ids[1], toNoteId: ids[0], type: "related" },
      ]);
      const links = linkService.getLinksFrom(ids[0]);
      expect(links).toHaveLength(1);
    });

    it("should support context in batch links", async () => {
      const ids = await createNotes(2);
      linkService.batchCreateLinks([
        { fromNoteId: ids[0], toNoteId: ids[1], type: "supports", context: "Batch context" },
      ]);
      const links = linkService.getLinksFrom(ids[0]);
      expect(links[0].context).toBe("Batch context");
    });

    it("should throw error when note does not exist in batch", async () => {
      const [id] = await createNotes(1);
      expect(() => {
        linkService.batchCreateLinks([
          { fromNoteId: "non-existent-id", toNoteId: id, type: "related" },
        ]);
      }).toThrow('Note "non-existent-id" does not exist');
    });
  });

  describe("validateLink", () => {
    it("should return true when both notes exist", async () => {
      const ids = await createNotes(2);
      const result = linkService.validateLink(ids[0], ids[1]);
      expect(result).toBe(true);
    });

    it("should return false when from note does not exist", async () => {
      const [id] = await createNotes(1);
      const result = linkService.validateLink("non-existent-id", id);
      expect(result).toBe(false);
    });

    it("should return false when to note does not exist", async () => {
      const [id] = await createNotes(1);
      const result = linkService.validateLink(id, "non-existent-id");
      expect(result).toBe(false);
    });

    it("should return false when both notes do not exist", () => {
      const result = linkService.validateLink("non-existent-1", "non-existent-2");
      expect(result).toBe(false);
    });
  });

  describe("getLinkDegree", () => {
    it("should return zero for isolated note", async () => {
      const [id] = await createNotes(1);
      const degree = linkService.getLinkDegree(id);
      expect(degree.outDegree).toBe(0);
      expect(degree.inDegree).toBe(0);
    });

    it("should calculate out-degree correctly", async () => {
      const ids = await createNotes(3);
      linkService.createLink(ids[0], ids[1], "related", { autoReverse: false });
      linkService.createLink(ids[0], ids[2], "supports", { autoReverse: false });
      const degree = linkService.getLinkDegree(ids[0]);
      expect(degree.outDegree).toBe(2);
      expect(degree.inDegree).toBe(0);
    });

    it("should calculate in-degree correctly", async () => {
      const ids = await createNotes(3);
      linkService.createLink(ids[1], ids[0], "related", { autoReverse: false });
      linkService.createLink(ids[2], ids[0], "supports", { autoReverse: false });
      const degree = linkService.getLinkDegree(ids[0]);
      expect(degree.outDegree).toBe(0);
      expect(degree.inDegree).toBe(2);
    });

    it("should calculate both degrees correctly", async () => {
      const ids = await createNotes(3);
      linkService.createLink(ids[0], ids[1], "related", { autoReverse: false });
      linkService.createLink(ids[2], ids[0], "supports", { autoReverse: false });
      const degree = linkService.getLinkDegree(ids[0]);
      expect(degree.outDegree).toBe(1);
      expect(degree.inDegree).toBe(1);
    });

    it("should throw error when note does not exist", () => {
      expect(() => {
        linkService.getLinkDegree("non-existent-id");
      }).toThrow('Note "non-existent-id" does not exist');
    });
  });

  describe("getCommunities", () => {
    it("should return empty array by default", () => {
      const communities = linkService.getCommunities();
      expect(communities).toEqual([]);
    });

    it("should accept minSize parameter", () => {
      const communities = linkService.getCommunities(5);
      expect(communities).toEqual([]);
    });
  });

  describe("cleanupOrphanedLinks", () => {
    it("should return 0 by default", () => {
      const result = linkService.cleanupOrphanedLinks();
      expect(result).toBe(0);
    });
  });

  describe("input validation", () => {
    it("should reject self-linking", async () => {
      const [id] = await createNotes(1);
      expect(() => {
        linkService.createLink(id, id, "related");
      }).toThrow("Cannot create a link from a note to itself");
    });

    it("should reject invalid link type", async () => {
      const [fromId, toId] = await createNotes(2);
      expect(() => {
        linkService.createLink(fromId, toId, "invalid_type" as LinkType);
      }).toThrow("Invalid link type: invalid_type");
    });

    it("should accept all valid link types", async () => {
      const ids = await createNotes(12);
      const validTypes: LinkType[] = [
        "supports", "supported_by", "refines", "refined_by",
        "extends", "extended_by", "contradicts", "contradicted_by",
        "is_example_of", "has_example", "related",
      ];
      for (let i = 0; i < validTypes.length; i++) {
        const fromId = ids[i];
        const toId = ids[(i + 1) % ids.length];
        expect(() => {
          linkService.createLink(fromId, toId, validTypes[i], { autoReverse: false });
        }).not.toThrow();
      }
    });
  });
});
