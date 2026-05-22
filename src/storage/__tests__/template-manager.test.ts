/**
 * TemplateManager 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { TemplateManager, type TemplateVariables } from "../template-manager.js";
import { TEMPLATE_FILES } from "../../core/constants.js";

describe("TemplateManager", () => {
  let manager: TemplateManager;
  let TEST_DIR: string;

  beforeEach(async () => {
    TEST_DIR = "/tmp/zettelkasten-test-templates-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9);
    await fs.mkdir(TEST_DIR, { recursive: true });
    manager = new TemplateManager(TEST_DIR);
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("init", () => {
    it("should create template directory", async () => {
      await manager.init();
      const stats = await fs.stat(TEST_DIR);
      expect(stats.isDirectory()).toBe(true);
    });

    it("should create default template files", async () => {
      await manager.init();
      const atomicPath = join(TEST_DIR, TEMPLATE_FILES.ATOMIC);
      const structurePath = join(TEST_DIR, TEMPLATE_FILES.STRUCTURE);
      const sourcePath = join(TEST_DIR, TEMPLATE_FILES.SOURCE);

      const [atomicExists, structureExists, sourceExists] = await Promise.all([
        fs.access(atomicPath).then(() => true).catch(() => false),
        fs.access(structurePath).then(() => true).catch(() => false),
        fs.access(sourcePath).then(() => true).catch(() => false),
      ]);

      expect(atomicExists).toBe(true);
      expect(structureExists).toBe(true);
      expect(sourceExists).toBe(true);
    });
  });

  describe("renderTemplate", () => {
    it("should replace simple variables", () => {
      const template = "Title: {{title}}, ID: {{id}}";
      const variables: TemplateVariables = {
        id: "20240115103045123",
        title: "Test Note",
        content: "Test content",
        tags: ["test"],
        created_at: "2024-01-15T10:30:45Z",
        updated_at: "2024-01-15T10:30:45Z",
      };
      const result = manager.renderTemplate(template, variables);
      expect(result).toBe("Title: Test Note, ID: 20240115103045123");
    });

    it("should format tags array", () => {
      const template = "Tags: {{tags}}";
      const variables: TemplateVariables = {
        id: "20240115103045123",
        title: "Test",
        content: "Content",
        tags: ["tag1", "tag2"],
        created_at: "2024-01-15T10:30:45Z",
        updated_at: "2024-01-15T10:30:45Z",
      };
      const result = manager.renderTemplate(template, variables);
      expect(result).toBe('Tags: ["tag1", "tag2"]');
    });

    it("should handle empty tags", () => {
      const template = "Tags: {{tags}}";
      const variables: TemplateVariables = {
        id: "20240115103045123",
        title: "Test",
        content: "Content",
        tags: [],
        created_at: "2024-01-15T10:30:45Z",
        updated_at: "2024-01-15T10:30:45Z",
      };
      const result = manager.renderTemplate(template, variables);
      expect(result).toBe("Tags: []");
    });
  });

  describe("parseFrontmatter", () => {
    it("should parse YAML frontmatter", () => {
      const content = `---\nid: "20240115103045123"\ntitle: "Test Note"\ntags: ["tag1", "tag2"]\nconfidence: 0.8\nreviewed: true\n---\n\n# Content`;
      const result = manager.parseFrontmatter(content);
      expect(result.id).toBe("20240115103045123");
      expect(result.title).toBe("Test Note");
      expect(result.tags).toEqual(["tag1", "tag2"]);
      expect(result.confidence).toBe(0.8);
      expect(result.reviewed).toBe(true);
    });

    it("should return empty object for no frontmatter", () => {
      const content = "# Just content";
      const result = manager.parseFrontmatter(content);
      expect(result).toEqual({});
    });
  });

  describe("updateFrontmatter", () => {
    it("should update existing frontmatter", () => {
      const content = `---\nid: "20240115103045123"\ntitle: "Old Title"\n---\n\n# Content`;
      const result = manager.updateFrontmatter(content, { title: "New Title" });
      expect(result).toContain('title: "New Title"');
      expect(result).toContain('id: "20240115103045123"');
    });

    it("should add frontmatter if not exists", () => {
      const content = "# Just content";
      const result = manager.updateFrontmatter(content, { title: "New Title" });
      expect(result).toContain("---");
      expect(result).toContain('title: "New Title"');
    });
  });
});
