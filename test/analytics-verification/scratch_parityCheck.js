import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { calculateAttemptQuestionMetrics } from "../../src/modules/test-attempts/utils/attemptQuestionMetrics.util.js";
import { resolveAttemptAnalyticsMetadata } from "../../src/services/analyticsSummary.service.js";

async function runParityCheck() {
  const conn = await mongoose.connect(process.env.MONGO_URI);
  const db = conn.connection.db;

  const attemptIds = [
    "6a622d45e63c0d5942732bf5",
    "6a62374be63c0d5942733855",
    "6a623768e63c0d59427343e3",
    "6a623b86e63c0d5942749f25",
    "6a648d927971b3b0b7e4dd5f",
    "6a73f850e972feee804d8bd8",
    "6a73f850e972feee804d8be5",
    "6a93c64016a484fd00cf5e21",
    "6a982aaccc0c59832224097d",
  ].map((id) => new mongoose.Types.ObjectId(id));

  const attempts = await db.collection("testattempts").find({ _id: { $in: attemptIds } }).toArray();
  const ledgers = await db.collection("analyticsprocessingrecords").find({ attemptId: { $in: attemptIds } }).toArray();
  const ledgersByAttemptId = new Map(ledgers.map((l) => [String(l.attemptId), l]));

  const parityResults = [];

  for (const a of attempts) {
    const qIds = Array.from(
      new Set([
        ...(a.answers || []).map((ans) => ans.questionId),
        ...(a.questionSnapshots || []).map((s) => s.questionId),
      ].filter(Boolean))
    );

    const questions = await db.collection("questions").find({ _id: { $in: qIds } }).project({ _id: 1, difficulty: 1 }).toArray();

    // Check missing difficulty in questions collection
    const missingDifficultyQIds = questions.filter((q) => !q.difficulty).map((q) => String(q._id));
    const missingQuestionDocs = qIds.filter((id) => !questions.some((q) => String(q._id) === String(id))).map((id) => String(id));

    // Historical difficulty map (defaults missing to EASY)
    const histDiffMap = new Map(questions.map((q) => [String(q._id), String(q.difficulty || "EASY").toUpperCase()]));

    // Current difficulty map (preserves raw difficulty)
    const currentDiffMap = new Map(questions.map((q) => [String(q._id), q.difficulty]));

    // Historical diffCounts (applied during original backfill)
    const histDiff = {
      easy: { correct: 0, wrong: 0, skipped: 0 },
      medium: { correct: 0, wrong: 0, skipped: 0 },
      hard: { correct: 0, wrong: 0, skipped: 0 },
    };
    for (const ans of (a.answers || [])) {
      const raw = histDiffMap.get(String(ans.questionId)) || "EASY";
      const k = raw === "HARD" ? "hard" : raw === "MEDIUM" ? "medium" : "easy";
      if (ans.isCorrect === true) histDiff[k].correct += 1;
      else if (
        (ans.selectedOption !== null && ans.selectedOption !== undefined) ||
        (ans.textAnswer !== null && ans.textAnswer !== undefined && String(ans.textAnswer).trim() !== "")
      ) {
        histDiff[k].wrong += 1;
      } else {
        histDiff[k].skipped += 1;
      }
    }

    // Current utility diffCounts (proposed canonical baseline)
    const currMetrics = calculateAttemptQuestionMetrics({
      answers: a.answers || [],
      questionSnapshots: a.questionSnapshots || [],
      questionDifficultyMap: currentDiffMap,
    });
    const currDiff = {
      easy: currMetrics.difficultyBreakdown.Easy,
      medium: currMetrics.difficultyBreakdown.Medium,
      hard: currMetrics.difficultyBreakdown.Hard,
    };

    // Compare histDiff and currDiff
    const diffMatch = JSON.stringify(histDiff) === JSON.stringify(currDiff);

    // Metadata & scope resolution
    const metadata = await resolveAttemptAnalyticsMetadata(a);
    const ledger = ledgersByAttemptId.get(String(a._id));

    const scopeMatch =
      ledger?.subjectKey === metadata.subjectKey &&
      ledger?.dateKey === metadata.dateKey &&
      String(ledger?.organizationId || "") === String(metadata.organizationId || "") &&
      ledger?.sourceCategory === metadata.sourceCategory;

    parityResults.push({
      attemptId: String(a._id),
      studentId: String(a.studentId),
      missingDifficultyCount: missingDifficultyQIds.length + missingQuestionDocs.length,
      historicalDiff: histDiff,
      currentDiff: currDiff,
      diffParity: diffMatch,
      ledgerScopeExists: !!ledger?.dateKey,
      ledgerScope: {
        subjectKey: ledger?.subjectKey,
        dateKey: ledger?.dateKey,
        organizationId: ledger?.organizationId ? String(ledger.organizationId) : null,
        sourceCategory: ledger?.sourceCategory,
      },
      resolvedScope: {
        subjectKey: metadata.subjectKey,
        dateKey: metadata.dateKey,
        organizationId: metadata.organizationId ? String(metadata.organizationId) : null,
        sourceCategory: metadata.sourceCategory,
      },
      scopeParity: scopeMatch,
      safeForPromotion: diffMatch && scopeMatch,
    });
  }

  console.log(JSON.stringify(parityResults, null, 2));

  await mongoose.disconnect();
}

runParityCheck().catch(console.error);
