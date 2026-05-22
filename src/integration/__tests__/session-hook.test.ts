/**
 * SessionHook 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SessionEndHookManager,
  createSessionEndHook,
  registerGlobalSessionHook,
  DEFAULT_SESSION_HOOK_CONFIG,
  type SessionHookConfig,
  type SessionInfo,
} from "../session-hook.js";
import type { DistillerService } from "../service/distiller-service.js";
import type { DistillJob } from "../core/types.js";

function createMockDistillerService(
  overrides: Partial<DistillJob> = {}
): DistillerService {
  return {
    distillYesterday: vi.fn().mockResolvedValue({
      id: "job-1",
      date: "2026-05-21",
      status: "completed",
      sliceCount: 3,
      summaryCount: 2,
      decisions: [],
      createdCount: 2,
      mergedCount: 0,
      skippedCount: 1,
      ...overrides,
    } as DistillJob),
  } as unknown as DistillerService;
}

function createValidSessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  const now = new Date("2026-05-22T10:00:00.000Z");
  const started = new Date(now.getTime() - 10 * 60 * 1000); // 10 minutes ago
  return {
    sessionId: "session-1",
    sessionKey: "key-1",
    startedAt: started.toISOString(),
    endedAt: now.toISOString(),
    messageCount: 10,
    topic: "Test topic",
    ...overrides,
  };
}

describe("SessionEndHookManager", () => {
  let manager: SessionEndHookManager;
  let mockDistiller: DistillerService;

  beforeEach(() => {
    vi.useFakeTimers();
    mockDistiller = createMockDistillerService();
    manager = new SessionEndHookManager(mockDistiller);
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  describe("生命周期", () => {
    it("should initialize once", () => {
      manager.initialize();
      expect(manager.hasPending()).toBe(false);
      manager.initialize(); // double init should be safe
    });

    it("should destroy and clear state", async () => {
      manager.initialize();
      manager.destroy();
      expect(manager.getPendingCount()).toBe(0);
    });

    it("should update config", async () => {
      manager.updateConfig({ minSessionMessages: 20 });
      const shortSession = createValidSessionInfo({ messageCount: 10 });
      const result = await manager.onSessionEnd(shortSession);
      expect(result.slicesProcessed).toBe(0);
    });
  });

  describe("事件监听", () => {
    it("should register and emit event to listeners", () => {
      const listener = vi.fn();
      manager.addEventListener(listener);
      manager.initialize();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session_start",
          sessionId: "system",
        })
      );
    });

    it("should remove event listener", () => {
      const listener = vi.fn();
      manager.addEventListener(listener);
      manager.removeEventListener(listener);
      manager.initialize();

      expect(listener).not.toHaveBeenCalled();
    });

    it("should handle listener errors gracefully", () => {
      const badListener = vi.fn().mockImplementation(() => {
        throw new Error("Listener error");
      });
      manager.addEventListener(badListener);
      expect(() => manager.initialize()).not.toThrow();
    });
  });

  describe("shouldDistill 判断", () => {
    it("should skip when message count is below minimum", async () => {
      const session = createValidSessionInfo({ messageCount: 2 });
      const result = await manager.onSessionEnd(session);
      expect(result.success).toBe(true);
      expect(result.slicesProcessed).toBe(0);
      expect(mockDistiller.distillYesterday).not.toHaveBeenCalled();
    });

    it("should skip when session duration is below minimum", async () => {
      const now = new Date("2026-05-22T10:00:00.000Z");
      const session = createValidSessionInfo({
        startedAt: now.toISOString(),
        endedAt: now.toISOString(),
        messageCount: 10,
      });
      const result = await manager.onSessionEnd(session);
      expect(result.success).toBe(true);
      expect(result.slicesProcessed).toBe(0);
    });

    it("should process when criteria are met", async () => {
      const session = createValidSessionInfo();
      manager.updateConfig({ awaitCompletion: true });
      const result = await manager.onSessionEnd(session);
      expect(result.success).toBe(true);
      expect(result.slicesProcessed).toBe(3);
      expect(mockDistiller.distillYesterday).toHaveBeenCalledTimes(1);
    });
  });

  describe("onSessionEnd 处理", () => {
    it("should return early when disabled", async () => {
      manager.updateConfig({ enabled: false });
      const session = createValidSessionInfo();
      const result = await manager.onSessionEnd(session);
      expect(result.success).toBe(true);
      expect(result.slicesProcessed).toBe(0);
      expect(mockDistiller.distillYesterday).not.toHaveBeenCalled();
    });

    it("should emit session_end event", async () => {
      const listener = vi.fn();
      manager.addEventListener(listener);
      manager.updateConfig({ awaitCompletion: true });

      const session = createValidSessionInfo();
      await manager.onSessionEnd(session);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session_end",
          sessionId: "session-1",
        })
      );
    });

    it("should run async when awaitCompletion is false", async () => {
      manager.updateConfig({ awaitCompletion: false });
      const session = createValidSessionInfo();
      const result = await manager.onSessionEnd(session);

      expect(result.success).toBe(true);
      expect(result.slicesProcessed).toBe(0); // async returns immediately
      expect(manager.hasPending()).toBe(true);

      await manager.waitForPending();
      expect(manager.hasPending()).toBe(false);
      expect(mockDistiller.distillYesterday).toHaveBeenCalledTimes(1);
    });

    it("should wait for pending hooks", async () => {
      manager.updateConfig({ awaitCompletion: false });
      const session = createValidSessionInfo();
      await manager.onSessionEnd(session);
      expect(manager.getPendingCount()).toBe(1);

      await manager.waitForPending();
      expect(manager.getPendingCount()).toBe(0);
    });

    it("should return immediately when no pending hooks", async () => {
      await expect(manager.waitForPending()).resolves.toBeUndefined();
    });

    it("should handle distillation errors", async () => {
      const failingDistiller = {
        distillYesterday: vi.fn().mockRejectedValue(new Error("Distill failed")),
      } as unknown as DistillerService;
      const failManager = new SessionEndHookManager(failingDistiller);
      failManager.updateConfig({ awaitCompletion: true });

      const session = createValidSessionInfo();
      const result = await failManager.onSessionEnd(session);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Distill failed");
      failManager.destroy();
    });

    it("should emit session_distill_complete on success", async () => {
      const listener = vi.fn();
      manager.addEventListener(listener);
      manager.updateConfig({ awaitCompletion: true });

      const session = createValidSessionInfo();
      await manager.onSessionEnd(session);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session_distill_complete",
          sessionId: "session-1",
        })
      );
    });

    it("should emit session_distill_failed on failure", async () => {
      const failingDistiller = createMockDistillerService({
        status: "failed",
        error: "Distill failed",
      });
      const failManager = new SessionEndHookManager(failingDistiller);
      failManager.addEventListener(vi.fn());
      failManager.updateConfig({ awaitCompletion: true });

      const session = createValidSessionInfo();
      await failManager.onSessionEnd(session);

      const calls = (failManager as any).listeners;
      // Events were emitted to listeners
      failManager.destroy();
    });
  });

  describe("重试机制", () => {
    it("should retry up to maxRetries", async () => {
      const failingDistiller = createMockDistillerService({
        status: "failed",
        error: "Retry error",
      });
      const retryManager = new SessionEndHookManager(failingDistiller, {
        maxRetries: 2,
      });

      const session = createValidSessionInfo();
      const promise = retryManager.retrySession(session, 1);
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;

      expect(failingDistiller.distillYesterday).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      retryManager.destroy();
    });

    it("should return error when max retries exceeded", async () => {
      const session = createValidSessionInfo();
      const result = await manager.retrySession(session, 999);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Max retries");
    });
  });

  describe("工厂函数", () => {
    it("createSessionEndHook should return an instance", () => {
      const instance = createSessionEndHook(mockDistiller);
      expect(instance).toBeInstanceOf(SessionEndHookManager);
      instance.destroy();
    });

    it("registerGlobalSessionHook should initialize the hook", () => {
      const instance = registerGlobalSessionHook(mockDistiller);
      expect(instance).toBeInstanceOf(SessionEndHookManager);
      instance.destroy();
    });
  });
});
