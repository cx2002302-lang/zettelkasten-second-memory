import { DatabaseSync } from "node:sqlite";
import type { LLMProvider, ZettelNote } from "../core/types.js";
import { NoteService } from "../service/note-service.js";
import { LinkService } from "../service/link-service.js";
import { CEQRCEngine } from "../service/ceqrc-engine.js";
import { DistillerService } from "../service/distiller-service.js";
import { GlowCalculator } from "../engine/glow-calculator.js";
import { PathFinder } from "../engine/path-finder.js";
import { ArchiveService } from "../service/archive-service.js";
import { KnowledgeHeatmapService } from "../service/heatmap-service.js";
import { ReviewService } from "../service/review-service.js";
import { FeedbackService } from "../service/feedback-service.js";
import { PromptEvolutionService } from "../service/prompt-evolution-service.js";
import { SampleCurationService } from "../service/sample-curation-service.js";
import { SerendipityService } from "../service/phase6/serendipity-service.js";
import { MOCService } from "../service/phase6/moc-service.js";
import { KnowledgeAuditService } from "../service/phase6/audit-service.js";
import type { ZettelkastenPluginConfig } from "./config.js";

export interface ZettelkastenServices {
  noteService: NoteService;
  linkService: LinkService;
  glowCalculator: GlowCalculator;
  pathFinder: PathFinder;
  archiveService: ArchiveService;
  heatmapService: KnowledgeHeatmapService;
  reviewService: ReviewService;
  feedbackService: FeedbackService;
  promptEvolutionService: PromptEvolutionService;
  sampleCurationService: SampleCurationService;
  ceqrcEngine: CEQRCEngine;
  distillerService: DistillerService;
  serendipityService: SerendipityService | null;
  mocService: MOCService | null;
  auditService: KnowledgeAuditService | null;
}

function nullLLMProvider(): LLMProvider {
  return {
    async generateSummary() {
      throw new Error("LLM provider not configured for Zettelkasten");
    },
    async judgeDuplicate() {
      throw new Error("LLM provider not configured for Zettelkasten");
    },
    async generateEmbedding() {
      throw new Error("LLM provider not configured for Zettelkasten");
    },
    async processCEQRCPhase() {
      throw new Error("LLM provider not configured for Zettelkasten");
    },
  };
}

export function initializeServices(
  db: DatabaseSync,
  config: ZettelkastenPluginConfig,
): ZettelkastenServices {
  const confidenceConfig = {
    highConfidenceThreshold: config.confidenceThreshold.zettels,
    mediumConfidenceThreshold: config.confidenceThreshold.references,
  };
  const noteService = new NoteService(db, config.notesDir, confidenceConfig);
  const linkService = new LinkService(db);
  const glowCalculator = new GlowCalculator(db);
  const pathFinder = new PathFinder(db);
  const archiveService = new ArchiveService(db);
  const heatmapService = new KnowledgeHeatmapService(db);
  const reviewService = new ReviewService(db, {
    autoReviewThreshold: 0.7,
    staleReviewDays: config.staleReviewDays,
  });
  const feedbackService = new FeedbackService(db);
  const promptEvolutionService = new PromptEvolutionService(db);
  const sampleCurationService = new SampleCurationService(db);

  const nullLLM = nullLLMProvider();
  const ceqrcEngine = new CEQRCEngine(nullLLM);
  const distillerService = new DistillerService(nullLLM, noteService, linkService);

  // Phase 6 服务初始化（非耦合，可独立开关）
  const serendipityService = config.phase6.serendipity.enabled
    ? new SerendipityService(db, config.phase6.serendipity)
    : null;
  const mocService = config.phase6.autoMOC.enabled
    ? new MOCService(db, config.phase6.autoMOC)
    : null;
  const auditService = config.phase6.knowledgeAudit.enabled
    ? new KnowledgeAuditService(db, config.phase6.knowledgeAudit)
    : null;

  return {
    noteService,
    linkService,
    glowCalculator,
    pathFinder,
    archiveService,
    heatmapService,
    reviewService,
    feedbackService,
    promptEvolutionService,
    sampleCurationService,
    ceqrcEngine,
    distillerService,
    serendipityService,
    mocService,
    auditService,
  };
}

export function registerServices(
  api: any,
  services: ZettelkastenServices,
  config: ZettelkastenPluginConfig,
  db: DatabaseSync,
) {
  const {
    distillerService,
    archiveService,
    reviewService,
    serendipityService,
    mocService,
    auditService,
  } = services;

  if (config.sessionHook.enabled) {
    api.on("session_end", async (event: any, _ctx: any) => {
      api.logger.info(
        `[zettelkasten] Session ended: ${event.sessionId}, messages: ${event.messageCount}`,
      );
    });
  }

  if (config.nightlyDistill.enabled) {
    let timer: ReturnType<typeof setInterval> | undefined;
    api.registerService({
      id: "zettelkasten-nightly-distill",
      start(_ctx: any) {
        api.logger.info("[zettelkasten] Nightly service started (distill + auto-archive)");
        const intervalMs = 60 * 60 * 1000;
        async function runNightlyTasks() {
          const now = new Date();
          if (now.getHours() === 2 && now.getMinutes() === 0) {
            // 1. Nightly distillation
            api.logger.info("[zettelkasten] Running nightly distillation...");
            try {
              const existingNotes: ZettelNote[] = [];
              const job = await distillerService.distillYesterday(existingNotes);
              api.logger.info(
                `[zettelkasten] Nightly distill complete: created=${job.createdCount} merged=${job.mergedCount} skipped=${job.skippedCount}`,
              );
            } catch (err) {
              api.logger.error(`[zettelkasten] Nightly distill failed: ${err instanceof Error ? err.message : String(err)}`);
            }

            // 2. Auto-archive zombies
            api.logger.info("[zettelkasten] Running nightly auto-archive...");
            try {
              const result = archiveService.autoArchiveZombies();
              if (result.archived > 0) {
                api.logger.info(
                  `[zettelkasten] Auto-archive complete: ${result.archived} zombie(s) archived`,
                );
                for (const n of result.notes) {
                  api.logger.info(`  - ${n.title}: ${n.reason}`);
                }
              } else {
                api.logger.info("[zettelkasten] Auto-archive: no zombies found");
              }
            } catch (err) {
              api.logger.error(`[zettelkasten] Auto-archive failed: ${err instanceof Error ? err.message : String(err)}`);
            }

            // 3. Auto-review inbox notes
            api.logger.info("[zettelkasten] Running nightly auto-review...");
            try {
              const stats = reviewService.autoReviewInbox();
              api.logger.info(
                `[zettelkasten] Auto-review complete: ${stats.approved} approved, ${stats.flagged} flagged, ${stats.skipped} pending (total: ${stats.total})`,
              );
            } catch (err) {
              api.logger.error(`[zettelkasten] Auto-review failed: ${err instanceof Error ? err.message : String(err)}`);
            }

            // 4. Auto-review stale inbox notes (> staleReviewDays)
            api.logger.info("[zettelkasten] Running stale inbox cleanup...");
            try {
              const staleStats = reviewService.autoReviewStaleInbox();
              if (staleStats.total > 0) {
                api.logger.info(
                  `[zettelkasten] Stale inbox cleanup: ${staleStats.approved} approved, ${staleStats.archived} archived, ${staleStats.flagged} flagged (total: ${staleStats.total})`,
                );
              } else {
                api.logger.info("[zettelkasten] No stale inbox notes found");
              }
            } catch (err) {
              api.logger.error(`[zettelkasten] Stale inbox cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
            }

            // 5. Feishu notification (if configured and inbox has backlog)
            if (config.feishuWebhook) {
              try {
                const digest = reviewService.getInboxDigest();
                if (digest.total > 0) {
                  const feishuMsg = {
                    msg_type: "text",
                    content: {
                      text: `📥 Zettelkasten Inbox 提醒\n\n您有 ${digest.total} 条笔记待审核（最久 ${digest.oldestDays} 天前）\n\n${digest.topItems.map((item: any, i: number) => `${i + 1}. [conf ${item.confidence.toFixed(2)}] ${item.title} (${item.ageDays}天前)`).join("\n")}\n\n💡 提示：高质量笔记会被自动通过，低质量笔记会被自动归档。积压超过 ${config.staleReviewDays} 天的笔记将自动处理。`,
                    },
                  };
                  const resp = await fetch(config.feishuWebhook, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(feishuMsg),
                  });
                  if (!resp.ok) {
                    api.logger.warn(`[zettelkasten] Feishu webhook failed: ${resp.status}`);
                  } else {
                    api.logger.info(`[zettelkasten] Feishu notification sent: ${digest.total} pending notes`);
                  }
                }
              } catch (err) {
                api.logger.error(`[zettelkasten] Feishu notification failed: ${err instanceof Error ? err.message : String(err)}`);
              }
            }

            // 6. Phase 6: Serendipity Discovery
            if (serendipityService) {
              api.logger.info("[zettelkasten] Running Phase 6: Serendipity discovery...");
              try {
                const result = serendipityService.runDiscovery();
                api.logger.info(`[zettelkasten] Serendipity: ${result.discovered} discovered, ${result.saved} saved`);
              } catch (err) {
                api.logger.error(`[zettelkasten] Serendipity failed: ${err instanceof Error ? err.message : String(err)}`);
              }
            }

            // 7. Phase 6: Auto-MOC Scan
            if (mocService) {
              api.logger.info("[zettelkasten] Running Phase 6: MOC scan...");
              try {
                const result = mocService.scanAndSuggest();
                api.logger.info(`[zettelkasten] MOC scan: ${result.communities} communities, ${result.saved} suggestions`);
              } catch (err) {
                api.logger.error(`[zettelkasten] MOC scan failed: ${err instanceof Error ? err.message : String(err)}`);
              }
            }

            // 8. Phase 6: Knowledge Audit (weekly)
            if (auditService) {
              const dayOfWeek = now.getDay();
              const shouldRun =
                config.phase6.knowledgeAudit.schedule === "daily" ||
                (config.phase6.knowledgeAudit.schedule === "weekly" && dayOfWeek === 1) ||
                (config.phase6.knowledgeAudit.schedule === "monthly" && now.getDate() === 1);

              if (shouldRun) {
                api.logger.info("[zettelkasten] Running Phase 6: Knowledge audit...");
                try {
                  const report = auditService.generateReport();
                  api.logger.info(`[zettelkasten] Audit: ${report.totalNotes} notes, ${report.connectionRate}% connected, ${report.orphanCount} orphans`);
                  for (const rec of report.recommendations) {
                    api.logger.info(`  • ${rec}`);
                  }
                } catch (err) {
                  api.logger.error(`[zettelkasten] Audit failed: ${err instanceof Error ? err.message : String(err)}`);
                }
              }
            }
          }
        }
        timer = setInterval(() => {
          runNightlyTasks().catch((err: any) => {
            api.logger?.error?.("[zettelkasten] Nightly cron error:", err);
          });
        }, intervalMs);
      },
      stop(_ctx: any) {
        if (timer) {
          clearInterval(timer);
          timer = undefined;
        }
        try {
          db.close();
          api.logger.info("[zettelkasten] Database connection closed");
        } catch {
          // 可能已经关闭
        }
        api.logger.info("[zettelkasten] Nightly service stopped");
      },
    });
  }

  // 数据库生命周期管理
  api.registerService({
    id: "zettelkasten-db-lifecycle",
    start() {},
    stop() {
      try {
        db.close();
        api.logger.info("[zettelkasten] Database connection closed");
      } catch {
        // 可能已经关闭
      }
    },
  });
}

export function stopServices(_api: any) {
  // Service 停止由 OpenClaw 框架通过 registerService 的 stop 回调自动管理
  // 此函数保留为显式停止入口，当前为空操作
}
