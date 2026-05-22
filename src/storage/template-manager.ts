import { join } from "node:path";
import { promises as fs } from "node:fs";
import { DEFAULT_TEMPLATES, TEMPLATE_FILES } from "../core/constants.js";
import type { NoteType } from "../core/types.js";

export interface TemplateVariables {
  /** 卡片ID */
  id: string;
  /** 标题 */
  title: string;
  /** 内容 */
  content: string;
  /** 摘要 */
  summary?: string;
  /** 标签数组 */
  tags: string[];
  /** 创建时间 (ISO 8601) */
  created_at: string;
  /** 更新时间 (ISO 8601) */
  updated_at: string;
  /** 额外变量 */
  [key: string]: any;
}

export class TemplateManager {
  constructor(private templatesDir: string) {}
  
  /**
   * 初始化模板目录
   */
  async init(): Promise<void> {
    try {
      await fs.mkdir(this.templatesDir, { recursive: true });
      
      // 创建默认模板文件
      const atomicPath = join(this.templatesDir, TEMPLATE_FILES.ATOMIC);
      const structurePath = join(this.templatesDir, TEMPLATE_FILES.STRUCTURE);
      const sourcePath = join(this.templatesDir, TEMPLATE_FILES.SOURCE);
      
      // 检查文件是否存在，不存在则创建（非关键路径，允许部分失败）
      const results = await Promise.allSettled([
        this.ensureTemplateFile(atomicPath, DEFAULT_TEMPLATES.ATOMIC),
        this.ensureTemplateFile(structurePath, DEFAULT_TEMPLATES.STRUCTURE),
        this.ensureTemplateFile(sourcePath, DEFAULT_TEMPLATES.ATOMIC), // source 暂时使用 atomic 模板
      ]);
      for (const result of results) {
        if (result.status === "rejected") {
          console.warn(`Template initialization warning: ${result.reason}`);
        }
      }
    } catch (error) {
      console.error(`Failed to initialize template directory: ${error}`);
      throw error;
    }
  }
  
  /**
   * 获取指定类型的模板内容
   */
  async getTemplate(type: NoteType): Promise<string> {
    const filename = this.getTemplateFilename(type);
    const filepath = join(this.templatesDir, filename);
    
    try {
      return await fs.readFile(filepath, "utf-8");
    } catch (error) {
      // 如果文件不存在，返回默认模板
      console.warn(`Template file not found: ${filepath}, using default`);
      return this.getDefaultTemplate(type);
    }
  }
  
  /**
   * 渲染模板
   */
  renderTemplate(template: string, variables: TemplateVariables): string {
    let result = template;
    
    // 简单模板变量替换 {{variable}}
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      
      if (key === "tags") {
        // 特殊处理数组类型
        const tagsValue = Array.isArray(value) 
          ? `[${value.map(tag => `"${tag}"`).join(", ")}]`
          : "[]";
        result = result.replace(new RegExp(placeholder, "g"), tagsValue);
      } else if (value === undefined || value === null) {
        result = result.replace(new RegExp(placeholder, "g"), "");
      } else {
        result = result.replace(new RegExp(placeholder, "g"), String(value));
      }
    }
    
    return result;
  }
  
  /**
   * 创建卡片文件
   */
  async createNoteFile(
    filepath: string,
    type: NoteType,
    variables: TemplateVariables
  ): Promise<void> {
    const template = await this.getTemplate(type);
    const content = this.renderTemplate(template, variables);
    
    await fs.writeFile(filepath, content, "utf-8");
  }
  
  /**
   * 更新现有卡片文件的前置元数据
   */
  async updateNoteFrontmatter(
    filepath: string,
    updates: Partial<TemplateVariables>
  ): Promise<void> {
    const content = await fs.readFile(filepath, "utf-8");
    const updated = this.updateFrontmatter(content, updates);
    await fs.writeFile(filepath, updated, "utf-8");
  }
  
  /**
   * 解析前置元数据
   */
  parseFrontmatter(content: string): Record<string, any> {
    const frontmatter: Record<string, any> = {};
    
    // 简单解析 YAML frontmatter (--- 包围)
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return frontmatter;
    }
    
    const yamlContent = frontmatterMatch[1];
    const lines = yamlContent.split("\n");
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      
      const colonIndex = trimmed.indexOf(":");
      if (colonIndex === -1) {
        continue;
      }
      
      const key = trimmed.substring(0, colonIndex).trim();
      let value: any = trimmed.substring(colonIndex + 1).trim();
      
      // 解析简单值
      if (value.startsWith("[") && value.endsWith("]")) {
        // 数组类型
        try {
          value = JSON.parse(value);
        } catch {
          // 如果解析失败，保持原样
        }
      } else if (value.startsWith('"') && value.endsWith('"')) {
        // 字符串类型 (带引号)
        value = value.substring(1, value.length - 1);
      } else if (value === "true" || value === "false") {
        // 布尔类型
        value = value === "true";
      } else if (!isNaN(Number(value)) && value.trim() !== "") {
        // 数字类型
        value = Number(value);
      }
      
      frontmatter[key] = value;
    }
    
    return frontmatter;
  }
  
  /**
   * 更新前置元数据
   */
  updateFrontmatter(content: string, updates: Record<string, any>): string {
    const frontmatter = this.parseFrontmatter(content);
    const updatedFrontmatter = { ...frontmatter, ...updates };
    
    // 重新生成 YAML frontmatter
    const yamlLines = ["---"];
    
    for (const [key, value] of Object.entries(updatedFrontmatter)) {
      if (Array.isArray(value)) {
        yamlLines.push(`${key}: [${value.map(v => `"${v}"`).join(", ")}]`);
      } else if (typeof value === "string") {
        yamlLines.push(`${key}: "${value}"`);
      } else if (typeof value === "boolean") {
        yamlLines.push(`${key}: ${value ? "true" : "false"}`);
      } else if (typeof value === "number") {
        yamlLines.push(`${key}: ${value}`);
      } else if (value === null || value === undefined) {
        yamlLines.push(`${key}: null`);
      } else {
        yamlLines.push(`${key}: "${String(value)}"`);
      }
    }
    
    yamlLines.push("---");
    
    // 替换原有的 frontmatter 部分
    const frontmatterMatch = content.match(/^---\n[\s\S]*?\n---/);
    if (frontmatterMatch) {
      const beforeFrontmatter = content.substring(0, frontmatterMatch.index!);
      const afterFrontmatter = content.substring(frontmatterMatch.index! + frontmatterMatch[0].length);
      return beforeFrontmatter + yamlLines.join("\n") + afterFrontmatter;
    }
    
    // 如果没有 frontmatter，在开头添加
    return yamlLines.join("\n") + "\n" + content;
  }
  
  /**
   * 获取模板文件名
   */
  private getTemplateFilename(type: NoteType): string {
    switch (type) {
      case "atomic":
        return TEMPLATE_FILES.ATOMIC;
      case "structure":
        return TEMPLATE_FILES.STRUCTURE;
      case "source":
        return TEMPLATE_FILES.SOURCE;
      default:
        return TEMPLATE_FILES.ATOMIC;
    }
  }
  
  /**
   * 获取默认模板内容
   */
  private getDefaultTemplate(type: NoteType): string {
    switch (type) {
      case "atomic":
        return DEFAULT_TEMPLATES.ATOMIC;
      case "structure":
        return DEFAULT_TEMPLATES.STRUCTURE;
      case "source":
        return DEFAULT_TEMPLATES.ATOMIC; // source 暂时使用 atomic 模板
      default:
        return DEFAULT_TEMPLATES.ATOMIC;
    }
  }
  
  /**
   * 确保模板文件存在
   */
  private async ensureTemplateFile(filepath: string, defaultContent: string): Promise<void> {
    try {
      await fs.access(filepath);
    } catch {
      // 文件不存在，创建默认模板
      await fs.writeFile(filepath, defaultContent, "utf-8");
    }
  }
}