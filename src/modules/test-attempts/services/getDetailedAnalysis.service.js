import TestAttempt from "../../../models/testAttempt.model.js";
import { getAttemptResult } from "./getAttemptResult.service.js";

export const getDetailedAnalysis = async (attemptId) => {
  // 1. Get base attempt data
  const result = await getAttemptResult(attemptId);
  if (!result) return null;

  const { attempt, analysis } = result;
  const { perQuestion = [], topicBreakdown = [], percentage, testId } = analysis;

  // 2. Compute Strength and Weak Areas
  const strengthAreas = [];
  const weakAreas = [];
  const topicWiseAnalysis = topicBreakdown.map((topic) => {
    if (topic.total > 0) {
      if (topic.accuracy >= 70) {
        strengthAreas.push(topic.topic);
      } else {
        weakAreas.push(topic.topic);
      }
    }
    return {
      name: topic.topic,
      correct: topic.correct,
      total: topic.total,
      accuracy: topic.accuracy,
    };
  });

  // 3. Compute Time Analysis
  let totalTimeMs = 0;
  let fastestQuestion = null;
  let slowestQuestion = null;
  let minTime = Infinity;
  let maxTime = -1;

  perQuestion.forEach((pq, index) => {
    const timeMs = pq.timeSpentMs || 0;
    totalTimeMs += timeMs;

    if (timeMs > 0 && timeMs < minTime) {
      minTime = timeMs;
      fastestQuestion = index + 1; // 1-based index
    }
    if (timeMs > maxTime) {
      maxTime = timeMs;
      slowestQuestion = index + 1;
    }
  });

  const averageTimePerQuestion = perQuestion.length > 0 
    ? Math.round((totalTimeMs / perQuestion.length) / 1000) 
    : 0;

  const timeAnalysis = {
    averageTimePerQuestion,
    fastestQuestion,
    slowestQuestion,
  };

  // 4. Compute Comparison with Average (Class Average & Percentile)
  // Fetch all other submitted/evaluated attempts for this test
  const allAttempts = await TestAttempt.find({
    testId: testId || attempt.testId?._id || attempt.testId,
    status: { $in: ["SUBMITTED", "EVALUATED"] },
  }).select("percentage").lean();

  let classAverage = 0;
  let percentile = 0;

  if (allAttempts.length > 0) {
    const totalClassScore = allAttempts.reduce((sum, a) => sum + (a.percentage || 0), 0);
    classAverage = Math.round(totalClassScore / allAttempts.length);

    // Percentile = (Number of scores below this score / Total scores) * 100
    const scoresBelow = allAttempts.filter(a => (a.percentage || 0) < percentage).length;
    percentile = Math.round((scoresBelow / allAttempts.length) * 100);
  } else {
    classAverage = percentage; // If it's the only attempt
    percentile = 100;
  }

  const comparisonWithAverage = {
    yourScore: percentage,
    classAverage,
    percentile,
  };

  // 5. Build final response
  const seriesRef = attempt.testId?.testSeriesId || null;
  const seriesName = seriesRef?.title || seriesRef?.name || null;
  const testType = seriesRef ? 'Test Series' : 'Single Test';

  return {
    resultId: attemptId,
    testType,
    seriesName,
    strengthAreas,
    weakAreas,
    timeAnalysis,
    comparisonWithAverage,
    topicWiseAnalysis,
  };
};
