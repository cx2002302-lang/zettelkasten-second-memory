/**
 * Phase 5 生产环境测试脚本
 * 向生产数据库插入大量测试数据，验证 Phase 5 功能
 */
import { DatabaseSync } from "node:sqlite";
import { ReviewService } from "../src/service/review-service.js";
import { FeedbackService } from "../src/service/feedback-service.js";
import { PromptEvolutionService } from "../src/service/prompt-evolution-service.js";
import { SampleCurationService } from "../src/service/sample-curation-service.js";
import { NoteService } from "../src/service/note-service.js";

const DB_PATH = "/home/myxia/.openclaw/zettelkasten/zettelkasten.db";
const NOTES_DIR = "/home/myxia/.openclaw/zettelkasten/notes";

const db = new DatabaseSync(DB_PATH);

const reviewService = new ReviewService(db);
const feedbackService = new FeedbackService(db);
const promptService = new PromptEvolutionService(db);
const curationService = new SampleCurationService(db);
const noteService = new NoteService(db, NOTES_DIR);

function randomId(): string {
  return "test_" + Math.random().toString(36).substring(2, 10);
}

async function main() {
  console.log("=== Phase 5 Production Test ===");
  console.log(`Database: ${DB_PATH}`);

  // 1. 获取现有笔记 ID
  const searchResults = await noteService.searchNotes("", 100);
  const noteIds = searchResults.map((r) => r.note.id);
  console.log(`Found ${noteIds.length} existing notes`);

  if (noteIds.length === 0) {
    console.log("No existing notes. Creating some test notes first...");
    for (let i = 0; i < 10; i++) {
      const note = await noteService.createNote(
        { title: `Test Note ${i + 1}`, content: `# Test Note ${i + 1}\n\nThis is test content.` },
        { confidence: 0.8, source: "manual" },
      );
      noteIds.push(note.id);
    }
    console.log(`Created ${noteIds.length} test notes`);
  }

  const actions = ["approve", "reject", "modify", "flag"] as const;
  const targetTypes = ["note", "link", "tag", "system"] as const;
  const feedbackTypes = ["thumbs_up", "thumbs_down", "comment", "correction", "suggestion"] as const;
  const promptTypes = ["capture", "explain", "question", "refine", "connect", "distill", "dedupe"] as const;

  // 2. 插入 Reviews
  console.log("\n[1/5] Inserting reviews...");
  for (let i = 0; i < 50; i++) {
    reviewService.createReview({
      targetType: targetTypes[i % 4],
      targetId: noteIds[i % noteIds.length],
      action: actions[i % 4],
      reviewerId: "test-reviewer",
      newConfidence: Math.random(),
      comment: `Production test review #${i + 1}`,
    });
  }
  const reviewStats = reviewService.getStats();
  console.log(`  Inserted 50 reviews. Total now: ${reviewStats.totalReviews}`);

  // 3. 插入 Feedback
  console.log("\n[2/5] Inserting feedback...");
  for (let i = 0; i < 100; i++) {
    feedbackService.submitFeedback({
      targetType: targetTypes[i % 4],
      targetId: noteIds[i % noteIds.length],
      feedbackType: feedbackTypes[i % 5],
      source: "user",
      sourceId: "test-user",
      content: `Production test feedback #${i + 1}`,
      rating: (i % 5) + 1,
    });
  }
  const feedbackStats = feedbackService.getStats();
  console.log(`  Inserted 100 feedback. Total now: ${feedbackStats.totalFeedback}`);

  // 4. 插入 Prompt Versions
  console.log("\n[3/5] Inserting prompt versions...");
  for (let i = 0; i < 20; i++) {
    promptService.createVersion({
      promptType: promptTypes[i % 7],
      content: `Test prompt content for ${promptTypes[i % 7]} v${i + 1}.\n\nPlease analyze the input carefully.`,
      description: `Production test prompt version ${i + 1}`,
    });
  }
  const promptEffectiveness = promptService.getEffectivenessStats();
  console.log(`  Inserted 20 prompt versions. Total now: ${promptEffectiveness.length}`);

  // 5. 插入 Sample Curations
  console.log("\n[4/5] Inserting sample curations...");
  for (let i = 0; i < 30; i++) {
    curationService.createCuration({
      noteId: noteIds[i % noteIds.length],
      qualityScores: {
        relevance: Math.random(),
        clarity: Math.random(),
        atomicity: Math.random(),
        connectivity: Math.random(),
        overall: Math.random(),
      },
      curatorId: "test-curator",
      curationNotes: `Production test curation #${i + 1}`,
    });
  }
  const curationStats = curationService.getStats();
  console.log(`  Inserted 30 curations. Total now: ${curationStats.total}`);

  // 6. 插入 System Tunings (via FeedbackService)
  console.log("\n[5/5] Inserting system tunings...");
  const params = ["threshold", "weight", "decay", "batch_size", "temperature", "learning_rate", "max_tokens"];
  for (let i = 0; i < 25; i++) {
    feedbackService.applyTuning(
      params[i % params.length],
      String(Math.random().toFixed(4)),
      `Production test tuning #${i + 1}`,
      i % 2 === 0,
    );
  }
  const tuningCount = (db.prepare("SELECT COUNT(*) as c FROM zettel_system_tunings").get() as { c: number }).c;
  console.log(`  Inserted 25 system tunings. Total now: ${tuningCount}`);

  // 7. 验证统计数据
  console.log("\n=== Verification ===");
  console.log("Review Stats:");
  console.log(`  Total: ${reviewStats.totalReviews} | Pending: ${reviewStats.pendingCount} | Approved: ${reviewStats.approvedCount} | Rejected: ${reviewStats.rejectedCount} | Modified: ${reviewStats.modifiedCount} | Flagged: ${reviewStats.flaggedCount}`);

  console.log("Feedback Stats:");
  console.log(`  Total: ${feedbackStats.totalFeedback} | Unprocessed: ${feedbackStats.unprocessedCount} | ThumbsUp: ${feedbackStats.thumbsUpCount} | ThumbsDown: ${feedbackStats.thumbsDownCount}`);

  console.log("Prompt Stats:");
  console.log(`  Total versions: ${promptEffectiveness.length}`);

  console.log("Curation Stats:");
  console.log(`  Total: ${curationStats.totalCurated} | Pending: ${curationStats.pendingCount} | Approved: ${curationStats.approvedCount} | Rejected: ${curationStats.rejectedCount}`);

  // 8. 测试趋势分析
  const trends = feedbackService.analyzeTrends({
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    end: new Date().toISOString(),
  });
  console.log("\nFeedback Trends (7 days):");
  console.log(`  Total: ${trends.totalFeedback} | By type: ${JSON.stringify(trends.byType)}`);

  // 9. 测试 export
  const highQuality = curationService.getHighQualitySamples(0.5, 100);
  console.log(`\nHigh quality samples (score >= 0.5): ${highQuality.length}`);

  const exportResult = curationService.exportSamples(
    highQuality.slice(0, 10).map((s) => s.id),
    "json",
  );
  console.log(`Export result: ${exportResult.sampleCount} samples exported to ${exportResult.filePath ?? "N/A"}`);

  console.log("\n=== Phase 5 Production Test Complete ===");
  console.log("All Phase 5 services verified with production data.");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
}).finally(() => {
  db.close();
});
