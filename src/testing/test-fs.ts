import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 创建一个临时测试目录，避免硬编码 /test 导致权限问题。
 * 调用方应在 afterEach / afterAll 中调用 cleanupTestDir 清理。
 */
export function createTestDir(prefix = "zk-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * 递归删除临时测试目录。
 */
export function cleanupTestDir(dir: string): void {
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // 清理失败不影响测试断言
  }
}
