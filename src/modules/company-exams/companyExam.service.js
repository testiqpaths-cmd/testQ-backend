import mongoose from "mongoose";
import Company from "../../models/company.model.js";
import TestSeries from "../../models/testSeries.model.js";
import Test from "../../models/test.model.js";
import Question from "../../models/question.model.js";
import TestAttempt from "../../models/testAttempt.model.js";
import User from "../../models/user.model.js";
import InterviewSession from "../../ai-interview/schemas/interview-session.schema.js";

/**
 * Get all companies with counts of company-series, published tests, and questions.
 */
export const getCompaniesWithStats = async ({ search = "" } = {}) => {
  const filter = {};
  if (search && search.trim()) {
    filter.$or = [
      { name: { $regex: search.trim(), $options: "i" } },
      { description: { $regex: search.trim(), $options: "i" } },
    ];
  }

  const companies = await Company.find(filter).sort({ name: 1 }).lean();

  // Aggregate stats in parallel
  const [seriesCounts, testCounts, questionCounts] = await Promise.all([
    TestSeries.aggregate([
      { $match: { category: "COMPANY", companyId: { $ne: null } } },
      { $group: { _id: "$companyId", count: { $sum: 1 } } },
    ]),
    Test.aggregate([
      { $match: { companyId: { $ne: null }, isDeleted: 0, isPublished: true } },
      { $group: { _id: "$companyId", count: { $sum: 1 } } },
    ]),
    Question.aggregate([
      { $match: { "companyIds.0": { $exists: true } } },
      { $unwind: "$companyIds" },
      { $group: { _id: "$companyIds", count: { $sum: 1 } } },
    ]),
  ]);

  const seriesCountMap = new Map(seriesCounts.map((s) => [String(s._id), s.count]));
  const testCountMap = new Map(testCounts.map((t) => [String(t._id), t.count]));
  const questionCountMap = new Map(questionCounts.map((q) => [String(q._id), q.count]));

  return companies.map((comp) => ({
    _id: comp._id,
    name: comp.name,
    slug: comp.slug,
    logoUrl: comp.logoUrl || null,
    website: comp.website || null,
    description: comp.description || null,
    seriesCount: seriesCountMap.get(String(comp._id)) || 0,
    testsCount: testCountMap.get(String(comp._id)) || 0,
    questionCount: questionCountMap.get(String(comp._id)) || 0,
    createdAt: comp.createdAt,
  }));
};

import CompanyTrackAttempt from "../../models/companyTrackAttempt.model.js";

/**
 * Normalizes both modern hiringRounds and legacy roundsConfig/companyStageOrder
 * into a single unified round definition array.
 */
export const normalizeTrackRounds = (series) => {
  if (!series) return [];

  // 1. Modern hiringRounds representation
  if (Array.isArray(series.hiringRounds) && series.hiringRounds.length > 0) {
    return series.hiringRounds
      .map((r) => {
        const order = Number(r.roundOrder) || 1;
        const key = r.roundKey || `ROUND_${order}`;
        const name = r.roundName || `Round ${order}`;
        const cutoff = r.cutoffPercentage !== undefined ? Number(r.cutoffPercentage) : (series.passingPercentage || 50);
        const weight = r.weight !== undefined ? Number(r.weight) : 100;
        const retakePolicy = r.retakePolicy || (series.mode === "SIMULATION" ? "ALL_TESTS" : "FAILED_ONLY");
        const tests = (r.tests || []).map((t) => (t && typeof t === "object" && t._id ? t : t));

        return {
          roundOrder: order,
          roundKey: key,
          roundName: name,
          roundType: r.roundType || "TESTS",
          cutoffPercentage: cutoff,
          weight,
          retakePolicy,
          tests,
          aiInterviewConfig: r.aiInterviewConfig || null,
        };
      })
      .sort((a, b) => a.roundOrder - b.roundOrder);
  }

  // 2. Legacy representation: group series.tests by companyStageOrder
  const rawTests = Array.isArray(series.tests) ? series.tests : [];
  const roundGroups = new Map();

  for (const test of rawTests) {
    const order = Number(test.companyStageOrder) || 1;
    const stageKey = test.companyStageKey || `ROUND_${order}`;
    const stageName = test.companyStageName || test.companyStage || `Round ${order}`;

    if (!roundGroups.has(order)) {
      roundGroups.set(order, {
        stageKey,
        stageName,
        stageOrder: order,
        tests: [],
      });
    }
    roundGroups.get(order).tests.push(test);
  }

  const sortedOrders = Array.from(roundGroups.keys()).sort((a, b) => a - b);
  return sortedOrders.map((order) => {
    const grp = roundGroups.get(order);
    const roundConf = series.roundsConfig?.find((r) => r.stageOrder === order);
    return {
      roundOrder: order,
      roundKey: grp.stageKey,
      roundName: grp.stageName,
      roundType: "TESTS",
      cutoffPercentage: roundConf?.cutoffPercentage ?? series.passingPercentage ?? 50,
      weight: 100,
      retakePolicy: roundConf?.retakePolicy ?? (series.mode === "SIMULATION" ? "ALL_TESTS" : "FAILED_ONLY"),
      tests: grp.tests,
      aiInterviewConfig: null,
    };
  });
};

/**
 * Start or resume a candidate's company track attempt.
 * Ensures only one active attempt exists, respects progressionMode,
 * initializes round attempts, and handles sequential locking.
 */
export const startOrResumeTrackAttempt = async ({ studentId, trackId }) => {
  if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
    const err = new Error("Invalid student ID");
    err.statusCode = 400;
    throw err;
  }
  if (!trackId || !mongoose.Types.ObjectId.isValid(trackId)) {
    const err = new Error("Invalid track ID");
    err.statusCode = 400;
    throw err;
  }

  const track = await TestSeries.findById(trackId)
    .populate({
      path: "tests",
      match: { isDeleted: 0, isPublished: true },
      select: "title description duration totalQuestions totalMarks companyStage companyStageKey companyStageName companyStageOrder passingPercentage difficulty type scheduleType startTime endTime status secureBrowserRequired",
    })
    .populate({
      path: "hiringRounds.tests",
      match: { isDeleted: 0, isPublished: true },
      select: "title description duration totalQuestions totalMarks companyStage companyStageKey companyStageName companyStageOrder passingPercentage difficulty type scheduleType startTime endTime status secureBrowserRequired",
    })
    .lean();

  if (!track || track.isDeleted) {
    const err = new Error("Hiring track not found");
    err.statusCode = 404;
    throw err;
  }

  if (track.category !== "COMPANY") {
    const err = new Error("The requested series is not a company placement track");
    err.statusCode = 400;
    throw err;
  }

  if (track.isPublished === false) {
    const err = new Error("This hiring track has not been published yet");
    err.statusCode = 400;
    throw err;
  }

  // Check if student already has an IN_PROGRESS attempt
  let trackAttempt = await CompanyTrackAttempt.findOne({
    studentId: new mongoose.Types.ObjectId(studentId),
    trackId: new mongoose.Types.ObjectId(trackId),
    status: "IN_PROGRESS",
  });

  if (trackAttempt) {
    return { trackAttempt, track, isNew: false };
  }

  // Look up max driveAttemptNumber for this student and track
  const latestCompleted = await CompanyTrackAttempt.findOne({
    studentId: new mongoose.Types.ObjectId(studentId),
    trackId: new mongoose.Types.ObjectId(trackId),
  })
    .sort({ driveAttemptNumber: -1 })
    .select("driveAttemptNumber")
    .lean();

  const nextDriveNumber = (latestCompleted?.driveAttemptNumber || 0) + 1;
  const normalizedRounds = normalizeTrackRounds(track);
  const isSequential = (track.progressionMode || "SEQUENTIAL") === "SEQUENTIAL";

  const roundAttempts = normalizedRounds.map((r, idx) => ({
    roundOrder: r.roundOrder,
    roundKey: r.roundKey,
    roundName: r.roundName,
    roundType: r.roundType,
    status: idx === 0 || !isSequential ? "READY" : "LOCKED",
    scoreObtained: 0,
    maxScore: 0,
    percentage: 0,
    cutoffPercentage: r.cutoffPercentage,
    testAttemptIds: [],
    interviewSessionId: null,
    evaluatedAt: null,
  }));

  try {
    trackAttempt = await CompanyTrackAttempt.create({
      studentId: new mongoose.Types.ObjectId(studentId),
      trackId: track._id,
      companyId: track.companyId,
      driveAttemptNumber: nextDriveNumber,
      status: "IN_PROGRESS",
      currentRoundOrder: 1,
      roundAttempts,
      overallScore: 0,
      overallPercentage: 0,
      overallReadinessBand: "Needs More Practice",
      summaryRecommendations: [],
      startedAt: new Date(),
    });
    return { trackAttempt, track, isNew: true };
  } catch (createErr) {
    if (createErr.code === 11000) {
      trackAttempt = await CompanyTrackAttempt.findOne({
        studentId: new mongoose.Types.ObjectId(studentId),
        trackId: new mongoose.Types.ObjectId(trackId),
        status: "IN_PROGRESS",
      });
      if (trackAttempt) {
        return { trackAttempt, track, isNew: false };
      }
    }
    throw createErr;
  }
};

/**
 * Fetch detailed candidate attempt status for a company track.
 */
export const getTrackAttemptStatus = async ({ studentId, trackId }) => {
  if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
    const err = new Error("Invalid student ID");
    err.statusCode = 400;
    throw err;
  }
  if (!trackId || !mongoose.Types.ObjectId.isValid(trackId)) {
    const err = new Error("Invalid track ID");
    err.statusCode = 400;
    throw err;
  }

  const track = await TestSeries.findById(trackId)
    .populate({
      path: "tests",
      match: { isDeleted: 0, isPublished: true },
      select: "title description duration totalQuestions totalMarks companyStage companyStageKey companyStageName companyStageOrder passingPercentage difficulty type scheduleType startTime endTime status secureBrowserRequired",
    })
    .populate({
      path: "hiringRounds.tests",
      match: { isDeleted: 0, isPublished: true },
      select: "title description duration totalQuestions totalMarks companyStage companyStageKey companyStageName companyStageOrder passingPercentage difficulty type scheduleType startTime endTime status secureBrowserRequired",
    })
    .lean();

  if (!track || track.isDeleted) {
    const err = new Error("Hiring track not found");
    err.statusCode = 404;
    throw err;
  }

  const trackAttempt = await CompanyTrackAttempt.findOne({
    studentId: new mongoose.Types.ObjectId(studentId),
    trackId: new mongoose.Types.ObjectId(trackId),
  })
    .sort({ driveAttemptNumber: -1 })
    .populate({
      path: "roundAttempts.testAttemptIds",
      select: "testId status resultStatus totalScore maxScore percentage submittedAt startedAt",
    })
    .lean();

  return { track, trackAttempt };
};

/**
 * Retake a candidate's company track attempt.
 * In SIMULATION mode, closes existing attempt as NOT_QUALIFIED and starts a fresh drive.
 * In PRACTICE mode, can reset a specific round or start a fresh drive.
 */
export const retakeTrackAttempt = async ({ studentId, trackId, roundOrder = null }) => {
  if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
    const err = new Error("Invalid student ID");
    err.statusCode = 400;
    throw err;
  }
  if (!trackId || !mongoose.Types.ObjectId.isValid(trackId)) {
    const err = new Error("Invalid track ID");
    err.statusCode = 400;
    throw err;
  }

  const track = await TestSeries.findById(trackId).lean();
  if (!track || track.isDeleted) {
    const err = new Error("Hiring track not found");
    err.statusCode = 404;
    throw err;
  }

  if (track.isPublished === false) {
    const err = new Error("This hiring track has not been published yet");
    err.statusCode = 400;
    throw err;
  }

  const latestAttempt = await CompanyTrackAttempt.findOne({
    studentId: new mongoose.Types.ObjectId(studentId),
    trackId: new mongoose.Types.ObjectId(trackId),
  }).sort({ driveAttemptNumber: -1 });

  // If latest attempt is IN_PROGRESS and candidate requests retaking a specific failed round in PRACTICE mode:
  if (latestAttempt && latestAttempt.status === "IN_PROGRESS" && roundOrder && track.mode !== "SIMULATION") {
    const rAtt = latestAttempt.roundAttempts.find((r) => r.roundOrder === Number(roundOrder));
    if (rAtt) {
      const normalizedRounds = normalizeTrackRounds(track);
      const roundDef = normalizedRounds.find((r) => r.roundOrder === Number(roundOrder));

      rAtt.status = "READY";
      rAtt.scoreObtained = 0;
      rAtt.percentage = 0;
      rAtt.evaluatedAt = null;

      if (roundDef?.roundType === "AI_INTERVIEW") {
        // Clear active session pointer; historical InterviewSession documents are preserved in DB
        rAtt.interviewSessionId = null;
      } else {
        // Retake policy enforcement: ALL_TESTS vs FAILED_ONLY
        if (roundDef?.retakePolicy === "ALL_TESTS") {
          rAtt.testAttemptIds = [];
        } else if (roundDef?.retakePolicy === "FAILED_ONLY") {
          // Keep only passed test attempts, allowing candidate to retake only failed tests
          const existingAttempts = await TestAttempt.find({
            _id: { $in: rAtt.testAttemptIds || [] },
          }).lean();
          const passedIds = existingAttempts
            .filter((a) => (a.percentage || 0) >= (roundDef.cutoffPercentage || 50))
            .map((a) => a._id);
          rAtt.testAttemptIds = passedIds;
        }
      }

      await latestAttempt.save();
      return { trackAttempt: latestAttempt, isNewDrive: false };
    }
  }

  // If latest attempt is IN_PROGRESS (e.g. failed in SIMULATION or student wants a fresh drive):
  if (latestAttempt && latestAttempt.status === "IN_PROGRESS") {
    latestAttempt.status = "NOT_QUALIFIED";
    latestAttempt.completedAt = new Date();
    await latestAttempt.save();
  }

  const nextDriveNumber = (latestAttempt?.driveAttemptNumber || 0) + 1;
  const normalizedRounds = normalizeTrackRounds(track);
  const isSequential = (track.progressionMode || "SEQUENTIAL") === "SEQUENTIAL";

  const roundAttempts = normalizedRounds.map((r, idx) => ({
    roundOrder: r.roundOrder,
    roundKey: r.roundKey,
    roundName: r.roundName,
    roundType: r.roundType,
    status: idx === 0 || !isSequential ? "READY" : "LOCKED",
    scoreObtained: 0,
    maxScore: 0,
    percentage: 0,
    cutoffPercentage: r.cutoffPercentage,
    testAttemptIds: [],
    interviewSessionId: null,
    evaluatedAt: null,
  }));

  const newAttempt = await CompanyTrackAttempt.create({
    studentId: new mongoose.Types.ObjectId(studentId),
    trackId: track._id,
    companyId: track.companyId,
    driveAttemptNumber: nextDriveNumber,
    status: "IN_PROGRESS",
    currentRoundOrder: 1,
    roundAttempts,
    overallScore: 0,
    overallPercentage: 0,
    overallReadinessBand: "Needs More Practice",
    summaryRecommendations: [],
    startedAt: new Date(),
  });

  return { trackAttempt: newAttempt, isNewDrive: true };
};

/**
 * Updates the candidate's CompanyTrackAttempt when a test attempt finishes evaluation.
 * Calculates round progress, applies cutoff rules, and unlocks the next round in sequential progression.
 */
export const updateTrackAttemptProgress = async (attemptOrId) => {
  let attempt = attemptOrId;
  if (!attempt || !attempt._id) {
    attempt = await TestAttempt.findById(attemptOrId);
  }
  if (!attempt) return null;

  // Resolve trackAttempt
  let trackAttempt = null;
  if (attempt.companyTrackAttemptId) {
    trackAttempt = await CompanyTrackAttempt.findById(attempt.companyTrackAttemptId);
  }
  if (!trackAttempt && attempt.companyTrackId) {
    trackAttempt = await CompanyTrackAttempt.findOne({
      studentId: attempt.studentId,
      trackId: attempt.companyTrackId,
      status: "IN_PROGRESS",
    });
  }
  if (!trackAttempt) {
    const Test = (await import("../../models/test.model.js")).default;
    const testDoc = await Test.findById(attempt.testId).select("testSeriesId companyStageOrder").lean();
    if (testDoc?.testSeriesId) {
      trackAttempt = await CompanyTrackAttempt.findOne({
        studentId: attempt.studentId,
        trackId: testDoc.testSeriesId,
        status: "IN_PROGRESS",
      });
    }
  }

  if (!trackAttempt) return null;
  // Closed attempt isolation safeguard: do not mutate completed or disqualified drive attempts
  if (trackAttempt.status !== "IN_PROGRESS") return trackAttempt;

  const track = await TestSeries.findById(trackAttempt.trackId).lean();
  if (!track) return null;

  const normalizedRounds = normalizeTrackRounds(track);

  // Match round definition
  let roundDef = null;
  if (attempt.companyRoundOrder) {
    roundDef = normalizedRounds.find((r) => r.roundOrder === attempt.companyRoundOrder);
  }
  if (!roundDef) {
    roundDef = normalizedRounds.find((r) =>
      r.tests.some((t) => String(t?._id || t) === String(attempt.testId))
    );
  }
  if (!roundDef) {
    const Test = (await import("../../models/test.model.js")).default;
    const testDoc = await Test.findById(attempt.testId).select("companyStageOrder").lean();
    const stOrder = testDoc?.companyStageOrder || 1;
    roundDef = normalizedRounds.find((r) => r.roundOrder === stOrder);
  }
  if (!roundDef) return null;

  // Find or create the roundAttempt in trackAttempt.roundAttempts
  let roundAttempt = trackAttempt.roundAttempts.find((r) => r.roundOrder === roundDef.roundOrder);
  if (!roundAttempt) {
    trackAttempt.roundAttempts.push({
      roundOrder: roundDef.roundOrder,
      roundKey: roundDef.roundKey,
      roundName: roundDef.roundName,
      roundType: roundDef.roundType,
      status: "IN_PROGRESS",
      scoreObtained: 0,
      maxScore: 0,
      percentage: 0,
      cutoffPercentage: roundDef.cutoffPercentage,
      testAttemptIds: [attempt._id],
    });
    roundAttempt = trackAttempt.roundAttempts[trackAttempt.roundAttempts.length - 1];
  } else {
    if (!roundAttempt.testAttemptIds.some((id) => String(id) === String(attempt._id))) {
      roundAttempt.testAttemptIds.push(attempt._id);
    }
  }

  // Load all test attempts recorded for this round
  const roundTestIds = (roundDef.tests || []).map((t) => String(t?._id || t));
  const attemptsInRound = await TestAttempt.find({
    _id: { $in: roundAttempt.testAttemptIds },
  }).lean();

  // Find best submitted/evaluated attempt for each required test
  const bestAttemptByTest = new Map();
  for (const att of attemptsInRound) {
    const tId = String(att.testId);
    if (!bestAttemptByTest.has(tId) || (att.totalScore || 0) > (bestAttemptByTest.get(tId).totalScore || 0)) {
      bestAttemptByTest.set(tId, att);
    }
  }

  // Check if all required tests for this round are completed
  const allTestsDone = roundTestIds.length > 0 && roundTestIds.every((tId) => {
    const att = bestAttemptByTest.get(tId);
    return att && (att.status === "SUBMITTED" || att.status === "EVALUATED");
  });

  if (allTestsDone) {
    let obtained = 0;
    let max = 0;
    for (const tId of roundTestIds) {
      const att = bestAttemptByTest.get(tId);
      obtained += att?.totalScore || 0;
      max += att?.maxScore || 0;
    }
    const pct = max > 0 ? Math.round((obtained / max) * 100) : 0;
    roundAttempt.scoreObtained = obtained;
    roundAttempt.maxScore = max;
    roundAttempt.percentage = pct;
    roundAttempt.evaluatedAt = new Date();

    const isCutoffMet = pct >= roundAttempt.cutoffPercentage;

    if (isCutoffMet) {
      roundAttempt.status = "PASSED";

      // Unlock next round if sequential
      const nextRound = trackAttempt.roundAttempts.find(
        (r) => r.roundOrder === roundAttempt.roundOrder + 1
      );
      if (nextRound) {
        if (nextRound.status === "LOCKED") {
          nextRound.status = "READY";
        }
        trackAttempt.currentRoundOrder = nextRound.roundOrder;
      } else {
        // Final round! Check if all normalized rounds in track are passed
        const allRoundsPassed =
          normalizedRounds.length > 0 &&
          normalizedRounds.every((tr) => {
            const ra = trackAttempt.roundAttempts.find((r) => r.roundOrder === tr.roundOrder);
            return ra && ra.status === "PASSED";
          });
        if (allRoundsPassed) {
          trackAttempt.status = "QUALIFIED";
          trackAttempt.completedAt = new Date();
        }
      }
    } else {
      roundAttempt.status = "FAILED";
      if (track.mode === "SIMULATION") {
        trackAttempt.status = "NOT_QUALIFIED";
        trackAttempt.completedAt = new Date();
      }
    }
  } else {
    if (roundAttempt.status === "READY") {
      roundAttempt.status = "IN_PROGRESS";
    }
  }

  // Calculate overall track progress across completed rounds using configured round weights
  let weightedPctSum = 0;
  let totalWeight = 0;
  let totalScore = 0;
  let totalMax = 0;
  for (const tr of normalizedRounds) {
    const ra = trackAttempt.roundAttempts.find((r) => r.roundOrder === tr.roundOrder);
    if (ra && (ra.status === "PASSED" || ra.status === "FAILED")) {
      const weight = Number(tr.weight) > 0 ? Number(tr.weight) : 100;
      const roundPct =
        typeof ra.percentage === "number" && !isNaN(ra.percentage)
          ? ra.percentage
          : ra.maxScore > 0
          ? Math.round(((ra.scoreObtained || 0) / ra.maxScore) * 100)
          : 0;
      weightedPctSum += roundPct * weight;
      totalWeight += weight;
      totalScore += ra.scoreObtained || 0;
      totalMax += ra.maxScore || 0;
    }
  }
  trackAttempt.overallScore = totalScore;
  trackAttempt.overallPercentage =
    totalWeight > 0
      ? Math.round(weightedPctSum / totalWeight)
      : totalMax > 0
      ? Math.round((totalScore / totalMax) * 100)
      : 0;

  if (trackAttempt.overallPercentage >= 85) {
    trackAttempt.overallReadinessBand = "Advanced Placement Readiness";
  } else if (trackAttempt.overallPercentage >= 70) {
    trackAttempt.overallReadinessBand = "Strong Placement Readiness";
  } else if (trackAttempt.overallPercentage >= 50) {
    trackAttempt.overallReadinessBand = "Developing Placement Readiness";
  } else {
    trackAttempt.overallReadinessBand = "Needs More Practice";
  }

  await trackAttempt.save();
  return trackAttempt;
};

/**
 * Updates the candidate's CompanyTrackAttempt when an AI interview finishes evaluation.
 * Extracts the 0-100 score, applies cutoffs, unlocks the next round in sequential progression,
 * and qualifies the track only when all rounds (tests + interview) are passed.
 */
export const updateTrackAttemptFromInterviewSession = async (sessionOrId, resultsSummary = null) => {
  let session = sessionOrId;
  if (!session || !session.interviewId) {
    const InterviewSession = (await import("../../ai-interview/schemas/interview-session.schema.js")).default;
    session = await InterviewSession.findOne({
      $or: [
        { interviewId: String(sessionOrId) },
        { _id: mongoose.Types.ObjectId.isValid(sessionOrId) ? sessionOrId : null },
      ].filter(Boolean),
    });
  }
  if (!session) return null;

  // Standalone interviews without track metadata are completely ignored
  if (!session.trackAttemptId && !session.trackId) {
    return null;
  }

  // Resolve trackAttempt
  let trackAttempt = null;
  if (session.trackAttemptId) {
    trackAttempt = await CompanyTrackAttempt.findById(session.trackAttemptId);
  }
  if (!trackAttempt && session.trackId) {
    trackAttempt = await CompanyTrackAttempt.findOne({
      studentId: session.userId,
      trackId: session.trackId,
      status: "IN_PROGRESS",
    });
  }
  if (!trackAttempt) return null;
  // Closed attempt isolation safeguard: do not mutate completed or disqualified drive attempts
  if (trackAttempt.status !== "IN_PROGRESS") return trackAttempt;

  // Validate ownership
  if (String(trackAttempt.studentId) !== String(session.userId)) {
    const err = new Error("Candidate does not own this hiring track attempt");
    err.statusCode = 403;
    throw err;
  }

  // Terminal state check: only evaluate when session has ended
  const terminalStates = ["COMPLETED", "EVALUATED"];
  if (!terminalStates.includes(session.interviewState)) {
    return trackAttempt;
  }

  const track = await TestSeries.findById(trackAttempt.trackId).lean();
  if (!track) return null;

  const normalizedRounds = normalizeTrackRounds(track);

  // Match target AI_INTERVIEW round definition
  let roundDef = null;
  if (session.companyRoundOrder) {
    roundDef = normalizedRounds.find(
      (r) => r.roundOrder === session.companyRoundOrder && r.roundType === "AI_INTERVIEW"
    );
  }
  if (!roundDef) {
    roundDef = normalizedRounds.find((r) => r.roundType === "AI_INTERVIEW");
  }
  if (!roundDef) return null;

  let roundAttempt = trackAttempt.roundAttempts.find((r) => r.roundOrder === roundDef.roundOrder);
  if (!roundAttempt) {
    trackAttempt.roundAttempts.push({
      roundOrder: roundDef.roundOrder,
      roundKey: roundDef.roundKey,
      roundName: roundDef.roundName,
      roundType: "AI_INTERVIEW",
      status: "IN_PROGRESS",
      scoreObtained: 0,
      maxScore: 100,
      percentage: 0,
      cutoffPercentage: roundDef.cutoffPercentage,
      interviewSessionId: session.interviewId,
    });
    roundAttempt = trackAttempt.roundAttempts[trackAttempt.roundAttempts.length - 1];
  }

  // Retake isolation check: if the round was retaken and assigned a newer interview session, ignore superseded session callbacks
  if (roundAttempt.interviewSessionId && roundAttempt.interviewSessionId !== session.interviewId) {
    return trackAttempt;
  }

  // Extract score (authoritative 0-100 scale)
  const results = resultsSummary || session.resultsSummary || null;
  const scoreVal = typeof results?.score === "number" ? results.score : null;

  if (scoreVal === null) {
    // Evaluation pending or failed — do not advance or mark passed
    if (roundAttempt.status === "READY") {
      roundAttempt.status = "IN_PROGRESS";
    }
    roundAttempt.interviewSessionId = session.interviewId;
    await trackAttempt.save();
    return trackAttempt;
  }

  const percentage = Math.max(0, Math.min(100, Math.round(scoreVal)));
  roundAttempt.interviewSessionId = session.interviewId;
  roundAttempt.scoreObtained = percentage;
  roundAttempt.maxScore = 100;
  roundAttempt.percentage = percentage;
  roundAttempt.evaluatedAt = new Date();

  const cutoff = roundAttempt.cutoffPercentage ?? roundDef.cutoffPercentage ?? 50;
  const isCutoffMet = percentage >= cutoff;

  if (isCutoffMet) {
    roundAttempt.status = "PASSED";

    // Unlock next round if sequential
    const nextRound = trackAttempt.roundAttempts.find(
      (r) => r.roundOrder === roundAttempt.roundOrder + 1
    );
    if (nextRound) {
      if (nextRound.status === "LOCKED") {
        nextRound.status = "READY";
      }
      trackAttempt.currentRoundOrder = nextRound.roundOrder;
    } else {
      // Final round! Check if ALL normalized rounds in track are passed
      const allRoundsPassed =
        normalizedRounds.length > 0 &&
        normalizedRounds.every((tr) => {
          const ra = trackAttempt.roundAttempts.find((r) => r.roundOrder === tr.roundOrder);
          return ra && ra.status === "PASSED";
        });
      if (allRoundsPassed) {
        trackAttempt.status = "QUALIFIED";
        trackAttempt.completedAt = new Date();
      }
    }
  } else {
    roundAttempt.status = "FAILED";
    if (track.mode === "SIMULATION") {
      trackAttempt.status = "NOT_QUALIFIED";
      trackAttempt.completedAt = new Date();
    }
  }

  // Calculate overall track progress across completed rounds using configured round weights
  let weightedPctSum = 0;
  let totalWeight = 0;
  let totalScore = 0;
  let totalMax = 0;
  for (const tr of normalizedRounds) {
    const ra = trackAttempt.roundAttempts.find((r) => r.roundOrder === tr.roundOrder);
    if (ra && (ra.status === "PASSED" || ra.status === "FAILED")) {
      const weight = Number(tr.weight) > 0 ? Number(tr.weight) : 100;
      const roundPct =
        typeof ra.percentage === "number" && !isNaN(ra.percentage)
          ? ra.percentage
          : ra.maxScore > 0
          ? Math.round(((ra.scoreObtained || 0) / ra.maxScore) * 100)
          : 0;
      weightedPctSum += roundPct * weight;
      totalWeight += weight;
      totalScore += ra.scoreObtained || 0;
      totalMax += ra.maxScore || 0;
    }
  }
  trackAttempt.overallScore = totalScore;
  trackAttempt.overallPercentage =
    totalWeight > 0
      ? Math.round(weightedPctSum / totalWeight)
      : totalMax > 0
      ? Math.round((totalScore / totalMax) * 100)
      : 0;

  if (trackAttempt.overallPercentage >= 85) {
    trackAttempt.overallReadinessBand = "Advanced Placement Readiness";
  } else if (trackAttempt.overallPercentage >= 70) {
    trackAttempt.overallReadinessBand = "Strong Placement Readiness";
  } else if (trackAttempt.overallPercentage >= 50) {
    trackAttempt.overallReadinessBand = "Developing Placement Readiness";
  } else {
    trackAttempt.overallReadinessBand = "Needs More Practice";
  }

  await trackAttempt.save();
  return trackAttempt;
};

/**
 * Launch or resume a candidate's AI Interview round on a company hiring track.
 * Enforces sequential gating, validates ownership, checks publishing and accessible status,
 * maps round aiInterviewConfig, and prevents duplicate session creation.
 */
export const launchCompanyInterviewRound = async ({ studentId, trackId, roundOrder }) => {
  if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
    const err = new Error("Invalid student ID");
    err.statusCode = 400;
    throw err;
  }
  if (!trackId || !mongoose.Types.ObjectId.isValid(trackId)) {
    const err = new Error("Invalid track ID");
    err.statusCode = 400;
    throw err;
  }
  const order = Number(roundOrder);
  if (!order || order < 1) {
    const err = new Error("Invalid round order");
    err.statusCode = 400;
    throw err;
  }

  const track = await TestSeries.findById(trackId)
    .populate({ path: "companyId", select: "name slug logo" })
    .lean();

  if (!track || track.isDeleted) {
    const err = new Error("Hiring track not found");
    err.statusCode = 404;
    throw err;
  }

  if (track.category !== "COMPANY") {
    const err = new Error("The requested series is not a company placement track");
    err.statusCode = 400;
    throw err;
  }

  if (!track.isPublished) {
    const err = new Error("This hiring track has not been published yet");
    err.statusCode = 400;
    throw err;
  }

  const normalizedRounds = normalizeTrackRounds(track);
  const roundDef = normalizedRounds.find((r) => r.roundOrder === order);
  if (!roundDef) {
    const err = new Error(`Round ${order} not found in hiring track`);
    err.statusCode = 404;
    throw err;
  }

  if (roundDef.roundType !== "AI_INTERVIEW") {
    const err = new Error(`Round ${order} is not an AI Interview stage (roundType: ${roundDef.roundType})`);
    err.statusCode = 400;
    throw err;
  }

  // Start or resume candidate's active track attempt
  const { trackAttempt } = await startOrResumeTrackAttempt({ studentId, trackId });
  if (!trackAttempt) {
    const err = new Error("Failed to initialize track attempt");
    err.statusCode = 500;
    throw err;
  }

  // Validate ownership
  if (String(trackAttempt.studentId) !== String(studentId)) {
    const err = new Error("Unauthorized: Track attempt ownership mismatch");
    err.statusCode = 403;
    throw err;
  }

  const roundAttempt = trackAttempt.roundAttempts.find((r) => r.roundOrder === order);
  if (!roundAttempt) {
    const err = new Error("Round attempt state not found");
    err.statusCode = 500;
    throw err;
  }

  // Enforce sequential progression rules
  if (track.progressionMode !== "OPEN" && roundAttempt.status === "LOCKED") {
    const prevRound = trackAttempt.roundAttempts.find((r) => r.roundOrder === order - 1);
    if (prevRound?.status === "FAILED") {
      const err = new Error(
        `Round ${prevRound.roundOrder} cutoff not met (${Math.round(prevRound.percentage || 0)}% / Required ${prevRound.cutoffPercentage || 50}%). Retake Round ${prevRound.roundOrder} to unlock this stage.`
      );
      err.statusCode = 403;
      throw err;
    }
    const err = new Error(
      `This stage is locked. Please complete all requirements in Round ${order - 1} first.`
    );
    err.statusCode = 403;
    throw err;
  }

  // Enforce simulation completion
  if (roundAttempt.status === "PASSED" && track.mode === "SIMULATION") {
    const err = new Error("This round has already been completed and passed");
    err.statusCode = 400;
    throw err;
  }

  const InterviewSession = (await import("../../ai-interview/schemas/interview-session.schema.js")).default;
  const { interviewSessionService } = await import("../../ai-interview/services/interview-session.service.js");

  // Prevent duplicate sessions / resume existing eligible session
  if (roundAttempt.interviewSessionId) {
    const existing = await InterviewSession.findOne({
      interviewId: roundAttempt.interviewSessionId,
      userId: studentId,
    });
    if (existing && ["CREATED", "READY", "IN_PROGRESS", "WAITING"].includes(existing.interviewState)) {
      return {
        session: existing,
        interviewId: existing.interviewId,
        isResumed: true,
        trackAttemptId: trackAttempt._id,
        roundOrder: order,
      };
    }
  }

  // Create new session mapped with company aiInterviewConfig
  const cfg = roundDef.aiInterviewConfig || {};
  const role = cfg.role || track.targetRole || "Software Engineer";
  const experienceLevel = cfg.experienceLevel || track.experienceLevel || "1-3 Years";
  const duration = Number(cfg.duration) || 30;
  const difficulty = cfg.difficulty || "MEDIUM";
  const interviewTypes =
    Array.isArray(cfg.interviewTypes) && cfg.interviewTypes.length > 0
      ? cfg.interviewTypes
      : ["technical"];
  const topics = Array.isArray(cfg.topics) && cfg.topics.length > 0 ? cfg.topics : [];
  const customRubric = cfg.customRubric || null;

  const session = await interviewSessionService.createCustomInterview(studentId, {
    role,
    experienceLevel,
    duration,
    difficulty,
    interviewTypes,
    topics,
    focusTopics: topics,
    customRubric,
    company: track.companyId?.name || "",
    companyId: track.companyId?._id || track.companyId,
    trackId: track._id,
    trackAttemptId: trackAttempt._id,
    companyRoundOrder: order,
    companyRoundKey: roundDef.roundKey,
  });

  // Link to track attempt and transition round to IN_PROGRESS
  roundAttempt.interviewSessionId = session.interviewId;
  roundAttempt.status = "IN_PROGRESS";
  await trackAttempt.save();

  return {
    session,
    interviewId: session.interviewId,
    isResumed: false,
    trackAttemptId: trackAttempt._id,
    roundOrder: order,
  };
};

/**
 * Get company tracks (TestSeries) and tests by company slug with student attempt status.
 */
export const getCompanyTracksBySlug = async (slug, { studentId = null } = {}) => {
  const company = await Company.findOne({ slug: slug.toLowerCase() }).lean();
  if (!company) {
    const error = new Error("Company not found");
    error.statusCode = 404;
    throw error;
  }

  // Fetch TestSeries for this company
  const seriesList = await TestSeries.find({
    category: "COMPANY",
    companyId: company._id,
  })
    .populate({
      path: "tests",
      match: { isDeleted: 0, isPublished: true },
      select: "title description duration totalQuestions totalMarks companyStage companyStageKey companyStageName companyStageOrder passingPercentage difficulty type scheduleType startTime endTime status secureBrowserRequired createdAt",
    })
    .populate({
      path: "hiringRounds.tests",
      match: { isDeleted: 0, isPublished: true },
      select: "title description duration totalQuestions totalMarks companyStage companyStageKey companyStageName companyStageOrder passingPercentage difficulty type scheduleType startTime endTime status secureBrowserRequired createdAt",
    })
    .sort({ createdAt: -1 })
    .lean();

  // Fetch standalone company tests not part of any series
  const standaloneTests = await Test.find({
    companyId: company._id,
    isDeleted: 0,
    isPublished: true,
    isSeriesTest: { $ne: true },
  })
    .select("title description duration totalQuestions totalMarks companyStage companyStageKey companyStageName companyStageOrder passingPercentage difficulty type scheduleType startTime endTime status secureBrowserRequired createdAt")
    .sort({ createdAt: -1 })
    .lean();

  // If studentId provided, fetch attempts to show progress
  let studentAttempts = [];
  let studentTrackAttempts = [];
  if (studentId && mongoose.Types.ObjectId.isValid(studentId)) {
    const [attempts, trackAttempts] = await Promise.all([
      TestAttempt.find({
        studentId: new mongoose.Types.ObjectId(studentId),
        $or: [
          { companyId: company._id },
          { testCategory: "COMPANY" },
        ],
        status: { $in: ["IN_PROGRESS", "SUBMITTED", "EVALUATED", "MISSED"] },
      })
        .select("testId status resultStatus totalScore maxScore percentage submittedAt startedAt companyStageKey roundAttemptId roundAttemptNumber isCompleted isPassed companyTrackAttemptId")
        .sort({ submittedAt: -1, startedAt: -1 })
        .lean(),
      CompanyTrackAttempt.find({
        studentId: new mongoose.Types.ObjectId(studentId),
        companyId: company._id,
      })
        .sort({ driveAttemptNumber: -1 })
        .lean(),
    ]);
    studentAttempts = attempts;
    studentTrackAttempts = trackAttempts;
  }

  // Group attempts by testId: track latest attempt and best completed attempt
  const testAttemptMap = new Map();
  for (const att of studentAttempts) {
    const tId = String(att.testId);
    if (!testAttemptMap.has(tId)) {
      testAttemptMap.set(tId, {
        latest: att,
        bestCompleted: null,
      });
    }
    const entry = testAttemptMap.get(tId);
    if (att.status === "SUBMITTED" || att.status === "EVALUATED") {
      if (!entry.bestCompleted || (att.totalScore || 0) > (entry.bestCompleted.totalScore || 0)) {
        entry.bestCompleted = att;
      }
    }
  }

  let totalAvailableTests = 0;
  let totalCompletedTests = 0;
  let totalWeightedMarksObtained = 0;
  let totalWeightedMaxMarks = 0;
  let totalRoundsCount = 0;
  let clearedRoundsCount = 0;

  // Process series into structured rounds
  const processedSeries = seriesList.map((series) => {
    const progressionMode = series.progressionMode || "SEQUENTIAL";
    const seriesCutoff = series.passingPercentage || 50;
    const trackAttempt = studentTrackAttempts.find((ta) => String(ta.trackId) === String(series._id)) || null;

    let rounds = [];

    // Modern hiringRounds processing
    if (Array.isArray(series.hiringRounds) && series.hiringRounds.length > 0) {
      rounds = series.hiringRounds.map((hr) => {
        const order = Number(hr.roundOrder) || 1;
        totalRoundsCount++;
        const roundCutoff = hr.cutoffPercentage !== undefined ? Number(hr.cutoffPercentage) : seriesCutoff;
        const retakePolicy = hr.retakePolicy || (series.mode === "SIMULATION" ? "ALL_TESTS" : "FAILED_ONLY");
        const rAtt = trackAttempt?.roundAttempts?.find((ra) => ra.roundOrder === order) || null;

        let roundStatus = "READY";
        if (rAtt) {
          roundStatus = rAtt.status;
        } else if (progressionMode === "SEQUENTIAL" && order > 1) {
          roundStatus = "LOCKED";
        }

        const isLocked = roundStatus === "LOCKED";
        let lockReason = null;
        if (isLocked) {
          const prevRAtt = trackAttempt?.roundAttempts?.find((ra) => ra.roundOrder === order - 1);
          if (prevRAtt && prevRAtt.status === "FAILED") {
            lockReason = `Round ${prevRAtt.roundOrder} cutoff not met (${Math.round(prevRAtt.percentage || 0)}% / Required ${prevRAtt.cutoffPercentage}%). Retake Round ${prevRAtt.roundOrder} to qualify.`;
          } else if (prevRAtt && prevRAtt.status === "IN_PROGRESS") {
            lockReason = `Complete and clear all tests in Round ${prevRAtt.roundOrder} (${prevRAtt.roundName || `Round ${prevRAtt.roundOrder}`}) to unlock.`;
          } else {
            lockReason = `Previous round qualification required to unlock this stage.`;
          }
        }

        const isRoundPassed = roundStatus === "PASSED";
        if (isRoundPassed) clearedRoundsCount++;

        let roundTotalMarks = 0;
        const rawRoundTests = Array.isArray(hr.tests) ? hr.tests : [];
        const processedTests = rawRoundTests.map((test) => {
          totalAvailableTests++;
          const attemptEntry = testAttemptMap.get(String(test._id));
          const latestAtt = attemptEntry?.latest || null;
          const bestAtt = attemptEntry?.bestCompleted || null;

          const isTestCompleted = Boolean(bestAtt);
          const testCutoff = test.passingPercentage || roundCutoff;
          const isTestPassed = isTestCompleted && (bestAtt.percentage >= testCutoff || (bestAtt.totalScore / (test.totalMarks || 1)) * 100 >= testCutoff);

          roundTotalMarks += test.totalMarks || 0;
          if (isTestCompleted) {
            totalCompletedTests++;
            totalWeightedMarksObtained += bestAtt.totalScore || 0;
            totalWeightedMaxMarks += test.totalMarks || 0;
          }

          return {
            _id: test._id,
            title: test.title,
            description: test.description,
            duration: test.duration,
            totalQuestions: test.totalQuestions,
            totalMarks: test.totalMarks,
            difficulty: test.difficulty,
            companyStage: test.companyStage,
            companyStageKey: test.companyStageKey || hr.roundKey,
            companyStageName: test.companyStageName || hr.roundName,
            companyStageOrder: order,
            passingPercentage: testCutoff,
            secureBrowserRequired: test.secureBrowserRequired,
            isCompleted: isTestCompleted,
            isPassed: isTestPassed,
            attempt: latestAtt
              ? {
                  attemptId: String(latestAtt._id),
                  status: latestAtt.status,
                  resultStatus: latestAtt.resultStatus || null,
                  score: bestAtt?.totalScore || latestAtt.totalScore || 0,
                  maxScore: bestAtt?.maxScore || latestAtt.maxScore || test.totalMarks,
                  percentage: bestAtt ? Math.round(bestAtt.percentage || 0) : Math.round(latestAtt.percentage || 0),
                  roundAttemptNumber: latestAtt.roundAttemptNumber || 1,
                  submittedAt: latestAtt.submittedAt || null,
                }
              : null,
          };
        });

        return {
          roundOrder: order,
          roundKey: hr.roundKey,
          roundName: hr.roundName,
          roundType: hr.roundType || "TESTS",
          stageOrder: order,
          stageKey: hr.roundKey,
          stageName: hr.roundName,
          isLocked,
          lockReason,
          status: roundStatus,
          isCompleted: roundStatus === "PASSED" || roundStatus === "FAILED",
          isPassed: isRoundPassed,
          retakePolicy,
          roundScore: rAtt?.scoreObtained || 0,
          roundTotalMarks: rAtt?.maxScore || roundTotalMarks,
          roundPercentage: rAtt?.percentage || 0,
          cutoffPercentage: roundCutoff,
          passingPercentage: roundCutoff,
          weight: hr.weight || 100,
          tests: processedTests,
          aiInterviewConfig: hr.aiInterviewConfig || null,
          interviewSessionId: rAtt?.interviewSessionId || null,
        };
      });
    } else {
      // Legacy roundsConfig / companyStageOrder processing
      const rawTests = Array.isArray(series.tests) ? series.tests : [];
      const roundGroups = new Map();

      for (const test of rawTests) {
        const order = Number(test.companyStageOrder) || 1;
        const stageKey = test.companyStageKey || `ROUND_${order}`;
        const stageName = test.companyStageName || test.companyStage || `Round ${order}`;

        if (!roundGroups.has(order)) {
          roundGroups.set(order, {
            stageKey,
            stageName,
            stageOrder: order,
            tests: [],
          });
        }
        roundGroups.get(order).tests.push(test);
      }

      const sortedRoundOrders = Array.from(roundGroups.keys()).sort((a, b) => a - b);
      let previousRoundPassed = true;
      let previousRoundInfo = null;

      rounds = sortedRoundOrders.map((order) => {
        const round = roundGroups.get(order);
        totalRoundsCount++;

        const roundConf = series.roundsConfig?.find((r) => r.stageOrder === order);
        const roundCutoff = roundConf?.cutoffPercentage ?? seriesCutoff;
        const retakePolicy = roundConf?.retakePolicy ?? (series.mode === "SIMULATION" ? "ALL_TESTS" : "FAILED_ONLY");

        let roundTotalMarks = 0;
        let hasAnyTestStarted = false;

        const processedTests = round.tests.map((test) => {
          totalAvailableTests++;
          const attemptEntry = testAttemptMap.get(String(test._id));
          const latestAtt = attemptEntry?.latest || null;
          const bestAtt = attemptEntry?.bestCompleted || null;

          const isTestCompleted = Boolean(bestAtt);
          const testCutoff = test.passingPercentage || roundCutoff;
          const isTestPassed = isTestCompleted && (bestAtt.percentage >= testCutoff || (bestAtt.totalScore / (test.totalMarks || 1)) * 100 >= testCutoff);

          if (latestAtt?.status === "IN_PROGRESS") {
            hasAnyTestStarted = true;
          }

          roundTotalMarks += test.totalMarks || 0;

          return {
            _id: test._id,
            title: test.title,
            description: test.description,
            duration: test.duration,
            totalQuestions: test.totalQuestions,
            totalMarks: test.totalMarks,
            difficulty: test.difficulty,
            companyStage: test.companyStage,
            companyStageKey: test.companyStageKey,
            companyStageName: test.companyStageName,
            companyStageOrder: test.companyStageOrder,
            passingPercentage: testCutoff,
            secureBrowserRequired: test.secureBrowserRequired,
            isCompleted: isTestCompleted,
            isPassed: isTestPassed,
            attempt: latestAtt
              ? {
                  attemptId: String(latestAtt._id),
                  status: latestAtt.status,
                  resultStatus: latestAtt.resultStatus || null,
                  score: bestAtt?.totalScore || latestAtt.totalScore || 0,
                  maxScore: bestAtt?.maxScore || latestAtt.maxScore || test.totalMarks,
                  percentage: bestAtt ? Math.round(bestAtt.percentage || 0) : Math.round(latestAtt.percentage || 0),
                  roundAttemptNumber: latestAtt.roundAttemptNumber || 1,
                  submittedAt: latestAtt.submittedAt || null,
                }
              : null,
          };
        });

        // Determine round qualification & status
        const roundTestIds = new Set(round.tests.map((t) => String(t._id)));
        const roundAttempts = studentAttempts.filter((a) => roundTestIds.has(String(a.testId)));

        const roundAttemptSessions = new Map();
        for (const a of roundAttempts) {
          const rKey = a.roundAttemptId || `SESSION_${a.roundAttemptNumber || 1}`;
          if (!roundAttemptSessions.has(rKey)) {
            roundAttemptSessions.set(rKey, new Map());
          }
          const sessionMap = roundAttemptSessions.get(rKey);
          if (
            !sessionMap.has(String(a.testId)) ||
            (a.totalScore || 0) > (sessionMap.get(String(a.testId)).totalScore || 0)
          ) {
            sessionMap.set(String(a.testId), a);
          }
        }

        let bestCompleteRoundScore = 0;
        let bestCompleteRoundMax = roundTotalMarks;
        let bestCompleteRoundPct = 0;
        let hasAnyCompleteRound = false;

        for (const sessionMap of roundAttemptSessions.values()) {
          const allCompletedInSession = round.tests.every(
            (t) =>
              sessionMap.has(String(t._id)) &&
              (sessionMap.get(String(t._id)).status === "SUBMITTED" ||
                sessionMap.get(String(t._id)).status === "EVALUATED")
          );

          if (allCompletedInSession) {
            hasAnyCompleteRound = true;
            let sessionObtained = 0;
            let sessionMax = 0;
            for (const t of round.tests) {
              const att = sessionMap.get(String(t._id));
              sessionObtained += att.totalScore || 0;
              sessionMax += t.totalMarks || att.maxScore || 0;
            }
            const sessionPct = sessionMax > 0 ? Math.round((sessionObtained / sessionMax) * 100) : 0;
            if (sessionPct > bestCompleteRoundPct || !bestCompleteRoundScore) {
              bestCompleteRoundPct = sessionPct;
              bestCompleteRoundScore = sessionObtained;
              bestCompleteRoundMax = sessionMax;
            }
          }
        }

        if (!hasAnyCompleteRound) {
          const allTestsCompletedIndependently = round.tests.every((t) =>
            testAttemptMap.get(String(t._id))?.bestCompleted
          );
          if (allTestsCompletedIndependently) {
            hasAnyCompleteRound = true;
            let indepObtained = 0;
            for (const t of round.tests) {
              indepObtained += testAttemptMap.get(String(t._id))?.bestCompleted?.totalScore || 0;
            }
            bestCompleteRoundScore = indepObtained;
            bestCompleteRoundMax = roundTotalMarks;
            bestCompleteRoundPct = roundTotalMarks > 0 ? Math.round((indepObtained / roundTotalMarks) * 100) : 0;
          }
        }

        let roundStatus = "NOT_STARTED";
        const isRoundPassed = hasAnyCompleteRound && bestCompleteRoundPct >= roundCutoff;

        if (isRoundPassed) {
          roundStatus = "PASSED";
          clearedRoundsCount++;
        } else if (hasAnyCompleteRound) {
          roundStatus = "FAILED";
        } else if (hasAnyTestStarted || roundAttempts.length > 0) {
          roundStatus = "IN_PROGRESS";
        }

        if (hasAnyCompleteRound) {
          totalWeightedMarksObtained += bestCompleteRoundScore;
          totalWeightedMaxMarks += bestCompleteRoundMax;
          totalCompletedTests += round.tests.length;
        } else {
          for (const pt of processedTests) {
            if (pt.isCompleted) {
              totalCompletedTests++;
              totalWeightedMarksObtained += pt.attempt?.score || 0;
              totalWeightedMaxMarks += pt.totalMarks || 0;
            }
          }
        }

        let isLocked = false;
        let lockReason = null;

        if (progressionMode === "SEQUENTIAL" && order > 1) {
          if (!previousRoundPassed) {
            isLocked = true;
            if (previousRoundInfo && previousRoundInfo.status === "FAILED") {
              lockReason = `Round ${previousRoundInfo.stageOrder} cutoff not met (${previousRoundInfo.roundPercentage}% / Required ${previousRoundInfo.cutoff}%). Retake Round ${previousRoundInfo.stageOrder} to qualify.`;
            } else if (previousRoundInfo && previousRoundInfo.status === "IN_PROGRESS") {
              lockReason = `Complete and clear all tests in Round ${previousRoundInfo.stageOrder} (${previousRoundInfo.stageName}) to unlock.`;
            } else {
              lockReason = `Previous round qualification required to unlock this stage.`;
            }
          }
        }

        previousRoundPassed = isRoundPassed;
        previousRoundInfo = {
          stageOrder: order,
          stageName: round.stageName,
          status: roundStatus,
          roundPercentage: bestCompleteRoundPct,
          cutoff: roundCutoff,
        };

        return {
          roundOrder: order,
          roundKey: round.stageKey,
          roundName: round.stageName,
          roundType: "TESTS",
          stageKey: round.stageKey,
          stageName: round.stageName,
          stageOrder: order,
          isLocked,
          lockReason,
          status: roundStatus,
          isCompleted: hasAnyCompleteRound,
          isPassed: isRoundPassed,
          retakePolicy,
          roundScore: bestCompleteRoundScore,
          roundTotalMarks: bestCompleteRoundMax,
          roundPercentage: bestCompleteRoundPct,
          cutoffPercentage: roundCutoff,
          passingPercentage: roundCutoff,
          weight: 100,
          tests: processedTests,
          aiInterviewConfig: null,
        };
      });
    }

    return {
      _id: series._id,
      title: series.title,
      description: series.description,
      experienceLevel: series.experienceLevel || "FRESHER",
      targetRole: series.targetRole || "Software Engineer",
      mode: series.mode || "SIMULATION",
      progressionMode,
      patternVersion: series.patternVersion || "2026",
      passingPercentage: seriesCutoff,
      roundsConfig: series.roundsConfig || [],
      hiringRounds: series.hiringRounds || [],
      rounds,
      trackAttempt: trackAttempt
        ? {
            _id: trackAttempt._id,
            driveAttemptNumber: trackAttempt.driveAttemptNumber,
            status: trackAttempt.status,
            currentRoundOrder: trackAttempt.currentRoundOrder,
            overallScore: trackAttempt.overallScore,
            overallPercentage: trackAttempt.overallPercentage,
            overallReadinessBand: trackAttempt.overallReadinessBand,
            startedAt: trackAttempt.startedAt,
            completedAt: trackAttempt.completedAt,
            roundAttempts: trackAttempt.roundAttempts,
          }
        : null,
    };
  });

  // Calculate overall weighted readiness
  const overallPercentage =
    totalWeightedMaxMarks > 0
      ? Math.round((totalWeightedMarksObtained / totalWeightedMaxMarks) * 100)
      : 0;

  let readinessBand = "Needs More Practice";
  if (overallPercentage >= 85) {
    readinessBand = "Advanced Placement Readiness";
  } else if (overallPercentage >= 70) {
    readinessBand = "Strong Placement Readiness";
  } else if (overallPercentage >= 50) {
    readinessBand = "Developing Placement Readiness";
  }

  return {
    company: {
      _id: company._id,
      name: company.name,
      slug: company.slug,
      logoUrl: company.logoUrl || null,
      website: company.website || null,
      description: company.description || null,
    },
    series: processedSeries,
    standaloneTests,
    studentStats: {
      totalTests: totalAvailableTests,
      completedTests: totalCompletedTests,
      totalWeightedMarksObtained,
      totalWeightedMaxMarks,
      overallPercentage,
      readinessBand,
      totalRounds: totalRoundsCount,
      clearedRounds: clearedRoundsCount,
    },
  };
};

/**
 * Summarize test-level and question/topic level performance from test attempts.
 */
export const summarizeTestPerformance = (testAttempts = []) => {
  let totalScore = 0;
  let maxScore = 0;
  let totalQuestions = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;

  const topicStatsMap = new Map();

  for (const att of testAttempts) {
    totalScore += Number(att.totalScore) || 0;
    maxScore += Number(att.maxScore) || 0;

    const answers = Array.isArray(att.answers) ? att.answers : [];
    const snapshots = Array.isArray(att.questionSnapshots) ? att.questionSnapshots : [];
    const qCount = snapshots.length || att.totalQuestions || answers.length || 0;
    totalQuestions += qCount;

    let attCorrect = 0;
    let attIncorrect = 0;

    for (const ans of answers) {
      if (ans.isCorrect) {
        attCorrect++;
      } else if (ans.selectedOption || ans.textAnswer) {
        attIncorrect++;
      }
    }

    correctCount += attCorrect;
    incorrectCount += attIncorrect;
    unansweredCount += Math.max(0, qCount - (attCorrect + attIncorrect));

    // Topic grouping from question snapshots or test title
    if (snapshots.length > 0) {
      for (const snap of snapshots) {
        const tName = snap.topicName || snap.topic || snap.subjectName || (att.testId?.title ? `${att.testId.title}` : "General Assessment");
        if (!topicStatsMap.has(tName)) {
          topicStatsMap.set(tName, { topic: tName, total: 0, correct: 0 });
        }
        const stat = topicStatsMap.get(tName);
        stat.total++;
        const matchingAns = answers.find(
          (a) => String(a.questionId) === String(snap.questionId) || String(a._id) === String(snap._id)
        );
        if (matchingAns?.isCorrect) {
          stat.correct++;
        }
      }
    } else if (att.testId?.title) {
      const tName = att.testId.title;
      if (!topicStatsMap.has(tName)) {
        topicStatsMap.set(tName, { topic: tName, total: 0, correct: 0 });
      }
      const stat = topicStatsMap.get(tName);
      stat.total += qCount;
      stat.correct += attCorrect;
    }
  }

  const topicBreakdown = Array.from(topicStatsMap.values()).map((t) => ({
    topic: t.topic,
    totalQuestions: t.total,
    correctAnswers: t.correct,
    accuracy: t.total > 0 ? Math.round((t.correct / t.total) * 100) : 0,
  }));

  const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  const weakTopics = topicBreakdown.filter((t) => t.accuracy < 60).map((t) => t.topic);

  return {
    totalScore,
    maxScore,
    percentage,
    totalQuestions,
    correctAnswers: correctCount,
    incorrectAnswers: incorrectCount,
    unansweredQuestions: unansweredCount,
    topicBreakdown,
    weakTopics,
    topicDataAvailable: topicBreakdown.length > 0,
  };
};

/**
 * Derives a clear scoring and readiness calculation explanation for candidate dashboard.
 */
export const deriveScoringExplanation = (track, trackAttempt) => {
  const normalizedRounds = normalizeTrackRounds(track);
  let totalWeight = 0;
  const roundContributions = [];

  for (const tr of normalizedRounds) {
    const ra = (trackAttempt.roundAttempts || []).find((r) => r.roundOrder === tr.roundOrder);
    const weight = Number(tr.weight) > 0 ? Number(tr.weight) : 100;
    const isEvaluated = ra && (ra.status === "PASSED" || ra.status === "FAILED");
    const roundPct = isEvaluated
      ? (typeof ra.percentage === "number" && !isNaN(ra.percentage) ? ra.percentage : 0)
      : 0;

    totalWeight += weight;
    roundContributions.push({
      roundOrder: tr.roundOrder,
      roundName: tr.roundName,
      roundType: tr.roundType,
      weight,
      cutoffPercentage: tr.cutoffPercentage,
      status: ra?.status || "LOCKED",
      percentage: isEvaluated ? roundPct : null,
      scoreObtained: isEvaluated ? ra.scoreObtained : null,
      maxScore: isEvaluated ? ra.maxScore : null,
      effectiveWeightPercentage: 0,
    });
  }

  for (const rc of roundContributions) {
    rc.effectiveWeightPercentage = totalWeight > 0 ? Math.round((rc.weight / totalWeight) * 100) : 0;
  }

  return {
    formula: "Weighted score = Sum(Round Percentage * Round Weight) / Sum(Round Weights)",
    totalWeight,
    overallPercentage: trackAttempt.overallPercentage || 0,
    overallReadinessBand: trackAttempt.overallReadinessBand || "Needs More Practice",
    roundContributions,
    readinessCriteria: [
      { band: "Advanced Placement Readiness", minPercentage: 85, description: "Exceptional mastery across assessment and technical interview stages." },
      { band: "Strong Placement Readiness", minPercentage: 70, description: "Consistently exceeds standard placement cutoffs; ready for direct drives." },
      { band: "Developing Placement Readiness", minPercentage: 50, description: "Meets basic qualification thresholds; targeted revision recommended." },
      { band: "Needs More Practice", minPercentage: 0, description: "Foundational gaps detected in assessments or interview competencies." },
    ],
  };
};

/**
 * Build consolidated recommendations grounded only in real assessment and interview evidence.
 */
export const buildUnifiedRecommendations = ({ testPerformance = {}, interviewEvaluation = null, roundName = "" }) => {
  const recommendations = [];

  // 1. From Assessment / Tests
  if (Array.isArray(testPerformance.weakTopics) && testPerformance.weakTopics.length > 0) {
    for (const topic of testPerformance.weakTopics) {
      recommendations.push({
        id: `rec-test-${topic.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
        category: "ASSESSMENT",
        sourceRound: roundName || "Assessment Round",
        title: `Practice ${topic}`,
        suggestion: `Strengthen fundamental problem solving and accuracy in ${topic} (measured accuracy: <60%).`,
        type: "EVIDENCE_BASED",
      });
    }
  }

  // 2. From AI Interview
  if (interviewEvaluation) {
    const gaps = interviewEvaluation.weaknesses || [];
    const recommended = interviewEvaluation.recommendedPractice || [];
    const allIntRecs = Array.from(new Set([...gaps, ...recommended]));

    for (const item of allIntRecs) {
      const cleanText = String(item).trim();
      if (!cleanText) continue;
      const exists = recommendations.some(
        (r) => r.title.toLowerCase() === cleanText.toLowerCase() || r.suggestion.toLowerCase().includes(cleanText.toLowerCase())
      );
      if (!exists) {
        recommendations.push({
          id: `rec-int-${cleanText.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
          category: "INTERVIEW",
          sourceRound: roundName || "AI Interview Stage",
          title: cleanText,
          suggestion: `Focus on demonstrating deeper architectural trade-offs and practical depth in ${cleanText}.`,
          type: "AI_EVALUATION",
        });
      }
    }
  }

  return recommendations;
};

/**
 * Get comprehensive candidate company exam results, including hiring drive histories,
 * round-wise scorecards, interview feedback, readiness bands, and individual test attempts.
 */
export const getCompanyResultsByStudent = async (studentId, { companyId = null, slug = null, trackId = null } = {}) => {
  if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
    throw new Error("Invalid student id");
  }

  let filterCompanyId = companyId;
  if (!filterCompanyId && slug) {
    const comp = await Company.findOne({ slug: slug.toLowerCase() }).select("_id").lean();
    if (comp) filterCompanyId = comp._id;
  }

  // 1. Fetch Candidate's CompanyTrackAttempt records (all drive attempts isolated)
  const trackQuery = {
    studentId: new mongoose.Types.ObjectId(studentId),
  };
  if (filterCompanyId && mongoose.Types.ObjectId.isValid(filterCompanyId)) {
    trackQuery.companyId = new mongoose.Types.ObjectId(filterCompanyId);
  }
  if (trackId && mongoose.Types.ObjectId.isValid(trackId)) {
    trackQuery.trackId = new mongoose.Types.ObjectId(trackId);
  }

  const rawTrackAttempts = await CompanyTrackAttempt.find(trackQuery)
    .populate({
      path: "trackId",
      select: "title description category experienceLevel targetRole mode progressionMode passingPercentage hiringRounds tests",
      populate: [
        { path: "companyId", select: "name slug logoUrl description website" },
        { path: "tests", select: "title duration totalMarks totalQuestions companyStage" },
      ],
    })
    .populate({
      path: "companyId",
      select: "name slug logoUrl description website",
    })
    .populate({
      path: "roundAttempts.testAttemptIds",
      select: "testId status resultStatus totalScore maxScore percentage submittedAt evaluatedAt totalQuestions duration answers questionSnapshots",
      populate: { path: "testId", select: "title duration totalMarks totalQuestions" },
    })
    .sort({ createdAt: -1 })
    .lean();

  const trackAttempts = [];

  for (const att of rawTrackAttempts) {
    const track = att.trackId || {};
    const company = att.companyId || track.companyId || {};
    const normalizedRounds = normalizeTrackRounds(track);

    const enrichedRounds = [];
    const allUnifiedRecs = [];

    for (const r of att.roundAttempts || []) {
      const roundDef = normalizedRounds.find((nr) => nr.roundOrder === r.roundOrder);
      const roundWeight = roundDef?.weight !== undefined ? Number(roundDef.weight) : 100;

      if (r.roundType === "TESTS") {
        const testAttempts = Array.isArray(r.testAttemptIds) ? r.testAttemptIds : [];
        const testSummary = summarizeTestPerformance(testAttempts);

        const recs = buildUnifiedRecommendations({
          testPerformance: testSummary,
          roundName: r.roundName,
        });
        allUnifiedRecs.push(...recs);

        enrichedRounds.push({
          roundOrder: r.roundOrder,
          roundKey: r.roundKey,
          roundName: r.roundName,
          roundType: "TESTS",
          status: r.status,
          scoreObtained: r.scoreObtained || testSummary.totalScore,
          maxScore: r.maxScore || testSummary.maxScore,
          percentage: r.percentage || testSummary.percentage,
          cutoffPercentage: r.cutoffPercentage,
          weight: roundWeight,
          evaluatedAt: r.evaluatedAt,
          testSummary,
          testAttempts: testAttempts.map((ta) => ({
            id: String(ta._id),
            testId: String(ta.testId?._id || ta.testId),
            testTitle: ta.testId?.title || "Assessment Test",
            score: ta.totalScore || 0,
            maxScore: ta.maxScore || 0,
            percentage: ta.percentage || 0,
            status: ta.status,
            resultStatus: ta.resultStatus,
            submittedAt: ta.submittedAt,
            detailUrl: `/student/dashboard/result/${ta._id}`,
          })),
        });
      } else if (r.roundType === "AI_INTERVIEW") {
        let interviewEvaluation = null;
        if (r.interviewSessionId) {
          const session = await InterviewSession.findOne({ interviewId: r.interviewSessionId }).lean();
          if (session) {
            const results = session.resultsSummary || {};
            interviewEvaluation = {
              sessionId: session.interviewId,
              sessionState: session.interviewState,
              score: results.score ?? r.scoreObtained ?? null,
              readinessScore: results.readinessScore ?? null,
              cutoffPercentage: r.cutoffPercentage,
              isCutoffMet: (results.score ?? r.scoreObtained ?? 0) >= r.cutoffPercentage,
              competencyScores: results.competencyScores || {},
              strengths: results.strengths || [],
              weaknesses: results.weaknesses || [],
              topicBreakdown: results.topicBreakdown || [],
              actionableRecommendations: results.recommendedPractice || [],
              overallFeedback: results.overallFeedback || "",
              detailUrl: `/student/dashboard/ai-interview/details/${session.interviewId}`,
            };

            const recs = buildUnifiedRecommendations({
              interviewEvaluation,
              roundName: r.roundName,
            });
            allUnifiedRecs.push(...recs);
          }
        }

        enrichedRounds.push({
          roundOrder: r.roundOrder,
          roundKey: r.roundKey,
          roundName: r.roundName,
          roundType: "AI_INTERVIEW",
          status: r.status,
          scoreObtained: r.scoreObtained,
          maxScore: r.maxScore || 100,
          percentage: r.percentage,
          cutoffPercentage: r.cutoffPercentage,
          weight: roundWeight,
          evaluatedAt: r.evaluatedAt,
          interviewSessionId: r.interviewSessionId,
          interviewEvaluation,
        });
      }
    }

    const scoringExplanation = deriveScoringExplanation(track, att);

    // Deduplicate recommendations by id
    const seenRecIds = new Set();
    const deduplicatedRecs = [];
    for (const rec of allUnifiedRecs) {
      if (!seenRecIds.has(rec.id)) {
        seenRecIds.add(rec.id);
        deduplicatedRecs.push(rec);
      }
    }

    trackAttempts.push({
      id: String(att._id),
      trackId: String(track._id || att.trackId),
      trackTitle: track.title || "Company Placement Track",
      targetRole: track.targetRole || "Software Engineer",
      experienceLevel: track.experienceLevel || "1-3 Years",
      company: {
        id: String(company._id || ""),
        name: company.name || "Company",
        slug: company.slug || "",
        logoUrl: company.logoUrl || null,
        description: company.description || null,
      },
      driveAttemptNumber: att.driveAttemptNumber || 1,
      status: att.status, // IN_PROGRESS, QUALIFIED, NOT_QUALIFIED
      isIncomplete: att.status === "IN_PROGRESS",
      isQualified: att.status === "QUALIFIED",
      isFailed: att.status === "NOT_QUALIFIED",
      currentRoundOrder: att.currentRoundOrder || 1,
      overallScore: att.overallScore || 0,
      overallPercentage: att.overallPercentage || 0,
      overallReadinessBand: att.overallReadinessBand || "Needs More Practice",
      roundAttempts: enrichedRounds,
      scoringExplanation,
      unifiedRecommendations: deduplicatedRecs,
      startedAt: att.startedAt || att.createdAt,
      completedAt: att.completedAt || null,
    });
  }

  // 2. Fetch individual test attempts for backward compatibility
  const testQuery = {
    studentId: new mongoose.Types.ObjectId(studentId),
    testCategory: "COMPANY",
    status: { $in: ["SUBMITTED", "EVALUATED", "MISSED"] },
  };
  if (filterCompanyId && mongoose.Types.ObjectId.isValid(filterCompanyId)) {
    testQuery.companyId = new mongoose.Types.ObjectId(filterCompanyId);
  }

  const attempts = await TestAttempt.find(testQuery)
    .select("testId iqRoomId testCategory companyId totalScore maxScore percentage resultStatus status submittedAt evaluatedAt totalQuestions duration")
    .populate({
      path: "testId",
      select: "title duration totalQuestions testSeriesId totalMarks createdBy companyId companyStage",
      populate: [
        { path: "testSeriesId", select: "title category companyId" },
        { path: "companyId", select: "name slug logoUrl" },
      ],
    })
    .populate({
      path: "companyId",
      select: "name slug logoUrl",
    })
    .sort({ submittedAt: -1 })
    .lean();

  const testAttempts = attempts.map((a) => {
    const test = a.testId || {};
    const testName = test.title || "Untitled Company Test";
    const testType = test.testSeriesId ? "Company Track Test" : "Company Mock Test";
    const seriesName = test.testSeriesId ? test.testSeriesId.title || null : null;
    const company = a.companyId || (test.companyId && typeof test.companyId === "object" ? test.companyId : null);

    const resolvedTotalMarks =
      Number.isFinite(a.maxScore) && a.maxScore > 0
        ? a.maxScore
        : (Number.isFinite(test.totalMarks) ? test.totalMarks : 0);
    let resolvedScore = Number.isFinite(a.totalScore) ? a.totalScore : 0;
    if (resolvedScore <= 0 && Number.isFinite(a.percentage) && a.percentage > 0 && resolvedTotalMarks > 0) {
      resolvedScore = Math.round((a.percentage / 100) * resolvedTotalMarks);
    }
    const resolvedPercentage = Number.isFinite(a.percentage)
      ? Math.round(a.percentage)
      : (resolvedTotalMarks > 0 ? Math.round((resolvedScore / resolvedTotalMarks) * 100) : 0);

    return {
      id: String(a._id),
      testId: String(test._id || a.testId),
      testName,
      testType,
      seriesName,
      testCategory: "COMPANY",
      company: company ? { id: String(company._id), name: company.name, slug: company.slug, logoUrl: company.logoUrl } : null,
      companyStage: test.companyStage || null,
      attemptDate: a.submittedAt ? new Date(a.submittedAt).toISOString().split("T")[0] : null,
      attemptTime: a.submittedAt ? new Date(a.submittedAt).toISOString().split("T")[1]?.slice(0, 5) : null,
      totalQuestions: test.totalQuestions || a.totalQuestions || 0,
      duration: test.duration ? `${test.duration} mins` : (a.duration ? `${a.duration} mins` : ""),
      score: resolvedScore,
      totalMarks: resolvedTotalMarks,
      percentage: resolvedPercentage,
      status: a.status === "MISSED" ? "missed" : (a.resultStatus || "").toLowerCase(),
      allowDownload: a.status !== "MISSED",
      createdBy: (test.createdBy && test.createdBy.role) || "",
      submittedAt: a.submittedAt,
      evaluatedAt: a.evaluatedAt,
    };
  });

  return {
    trackAttempts,
    testAttempts,
  };
};

/**
 * Fetch a single candidate company track attempt by ID with candidate ownership verification.
 */
export const getCompanyTrackAttemptById = async ({ attemptId, requestingUser }) => {
  if (!attemptId || !mongoose.Types.ObjectId.isValid(attemptId)) {
    const err = new Error("Invalid attempt ID");
    err.statusCode = 400;
    throw err;
  }
  if (!requestingUser) {
    const err = new Error("Unauthorized");
    err.statusCode = 401;
    throw err;
  }

  const trackAttempt = await CompanyTrackAttempt.findById(attemptId)
    .populate({
      path: "trackId",
      select: "title description category experienceLevel targetRole mode progressionMode passingPercentage hiringRounds tests",
      populate: [
        { path: "companyId", select: "name slug logoUrl description website" },
        { path: "tests", select: "title duration totalMarks totalQuestions companyStage" },
      ],
    })
    .populate({ path: "companyId", select: "name slug logoUrl description website" })
    .populate({ path: "roundAttempts.testAttemptIds" })
    .lean();

  if (!trackAttempt) {
    const err = new Error("Company track attempt not found");
    err.statusCode = 404;
    throw err;
  }

  // Candidate ownership verification
  const isPrivileged = ["IQPATH_ADMIN", "ORGANIZATION", "admin"].includes(requestingUser.role);
  if (!isPrivileged && String(trackAttempt.studentId) !== String(requestingUser._id || requestingUser.id)) {
    const err = new Error("Forbidden: You do not have permission to view this attempt");
    err.statusCode = 403;
    throw err;
  }

  return trackAttempt;
};

/**
 * Admin and Organization aggregate analytics for company placement tracks.
 * Computes participation, completion, qualification, score distribution,
 * and round-wise pass/failure metrics with strict multi-tenant scoping.
 */
export const getCompanyTrackAdminAnalytics = async (requestingUser, query = {}) => {
  if (!requestingUser) {
    const err = new Error("Unauthorized");
    err.statusCode = 401;
    throw err;
  }
  const allowedRoles = ["IQPATH_ADMIN", "ORGANIZATION", "admin"];
  if (!allowedRoles.includes(requestingUser.role)) {
    const err = new Error("Forbidden: Admin or Organization access required");
    err.statusCode = 403;
    throw err;
  }

  const {
    companyId,
    trackId,
    experienceLevel,
    timeRange = "all",
    startDate,
    endDate,
    search,
    page = 1,
    limit = 20,
    organizationId,
  } = query;

  // Multi-tenant student scoping
  let studentScopeFilter = null;
  if (requestingUser.role === "ORGANIZATION") {
    let orgId = requestingUser.organizationId;
    if (!orgId) {
      const dbUser = await User.findById(requestingUser._id || requestingUser.id).select("organizationId").lean();
      orgId = dbUser?.organizationId;
    }
    if (!orgId) {
      const err = new Error("Organization account not linked to an organization.");
      err.statusCode = 403;
      throw err;
    }
    const studentIds = await User.find({
      role: "STUDENT",
      organizationId: orgId,
      isDeleted: { $ne: true },
    }).distinct("_id");
    studentScopeFilter = { $in: studentIds };
  } else if (organizationId && mongoose.Types.ObjectId.isValid(organizationId)) {
    const studentIds = await User.find({
      role: "STUDENT",
      organizationId,
      isDeleted: { $ne: true },
    }).distinct("_id");
    studentScopeFilter = { $in: studentIds };
  }

  // Base match filter
  const matchFilter = {};
  if (studentScopeFilter !== null) {
    matchFilter.studentId = studentScopeFilter;
  }
  if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
    matchFilter.companyId = new mongoose.Types.ObjectId(companyId);
  }
  if (trackId && mongoose.Types.ObjectId.isValid(trackId)) {
    matchFilter.trackId = new mongoose.Types.ObjectId(trackId);
  }

  // Date range filter
  const now = Date.now();
  if (timeRange === "7d") {
    matchFilter.createdAt = { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) };
  } else if (timeRange === "30d") {
    matchFilter.createdAt = { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) };
  } else if (timeRange === "90d") {
    matchFilter.createdAt = { $gte: new Date(now - 90 * 24 * 60 * 60 * 1000) };
  } else if (startDate || endDate) {
    matchFilter.createdAt = {};
    if (startDate) matchFilter.createdAt.$gte = new Date(startDate);
    if (endDate) matchFilter.createdAt.$lte = new Date(endDate);
  }

  // Experience level filter
  if (experienceLevel && experienceLevel !== "ALL") {
    const matchingTracks = await TestSeries.find({
      category: "COMPANY",
      experienceLevel,
    }).distinct("_id");
    if (matchFilter.trackId) {
      if (!matchingTracks.some((id) => String(id) === String(matchFilter.trackId))) {
        matchFilter.trackId = new mongoose.Types.ObjectId();
      }
    } else {
      matchFilter.trackId = { $in: matchingTracks };
    }
  }

  // Load matching attempts for aggregation
  const attempts = await CompanyTrackAttempt.find(matchFilter)
    .populate({ path: "studentId", select: "firstName lastName email" })
    .populate({ path: "trackId", select: "title targetRole experienceLevel category mode hiringRounds" })
    .populate({ path: "companyId", select: "name slug logoUrl" })
    .sort({ createdAt: -1 })
    .lean();

  const totalTrackAttempts = attempts.length;
  const uniqueStudents = new Set();
  let completedAttempts = 0;
  let inProgressAttempts = 0;
  let qualificationCount = 0;
  let overallScoreSum = 0;
  let assessmentScoreSum = 0;
  let assessmentCount = 0;
  let interviewScoreSum = 0;
  let interviewCount = 0;

  const distributionBuckets = {
    under50: 0,
    range50to69: 0,
    range70to84: 0,
    range85plus: 0,
  };

  const roundMetricsMap = new Map();

  for (const att of attempts) {
    if (att.studentId) {
      uniqueStudents.add(String(att.studentId._id || att.studentId));
    }

    const isCompleted = att.status === "QUALIFIED" || att.status === "NOT_QUALIFIED";
    if (isCompleted) {
      completedAttempts++;
      const score = Number.isFinite(att.overallPercentage) ? att.overallPercentage : 0;
      overallScoreSum += score;

      if (score >= 85) distributionBuckets.range85plus++;
      else if (score >= 70) distributionBuckets.range70to84++;
      else if (score >= 50) distributionBuckets.range50to69++;
      else distributionBuckets.under50++;
    } else {
      inProgressAttempts++;
    }

    if (att.status === "QUALIFIED") {
      qualificationCount++;
    }

    // Accumulate round metrics
    for (const r of att.roundAttempts || []) {
      const key = `${r.roundOrder}_${r.roundName || "Round"}`;
      if (!roundMetricsMap.has(key)) {
        roundMetricsMap.set(key, {
          roundOrder: r.roundOrder,
          roundName: r.roundName || `Round ${r.roundOrder}`,
          roundType: r.roundType || "TESTS",
          attemptsCount: 0,
          passedCount: 0,
          failedCount: 0,
          inProgressCount: 0,
          scoreSum: 0,
          scoreCount: 0,
        });
      }
      const rm = roundMetricsMap.get(key);
      rm.attemptsCount++;
      if (r.status === "PASSED") {
        rm.passedCount++;
      } else if (r.status === "FAILED") {
        rm.failedCount++;
      } else {
        rm.inProgressCount++;
      }

      if (r.status === "PASSED" || r.status === "FAILED") {
        const pct = Number.isFinite(r.percentage) ? r.percentage : 0;
        rm.scoreSum += pct;
        rm.scoreCount++;

        if (r.roundType === "TESTS") {
          assessmentScoreSum += pct;
          assessmentCount++;
        } else if (r.roundType === "AI_INTERVIEW") {
          interviewScoreSum += pct;
          interviewCount++;
        }
      }
    }
  }

  const qualificationRate = completedAttempts > 0 ? Math.round((qualificationCount / completedAttempts) * 100) : 0;
  const completionRate = totalTrackAttempts > 0 ? Math.round((completedAttempts / totalTrackAttempts) * 100) : 0;
  const averageOverallScore = completedAttempts > 0 ? Math.round(overallScoreSum / completedAttempts) : 0;
  const averageAssessmentScore = assessmentCount > 0 ? Math.round(assessmentScoreSum / assessmentCount) : 0;
  const averageInterviewScore = interviewCount > 0 ? Math.round(interviewScoreSum / interviewCount) : 0;

  const scoreDistribution = [
    {
      range: "< 50%",
      label: "Needs Practice (<50%)",
      count: distributionBuckets.under50,
      percentage: completedAttempts > 0 ? Math.round((distributionBuckets.under50 / completedAttempts) * 100) : 0,
    },
    {
      range: "50 - 69%",
      label: "Developing (50-69%)",
      count: distributionBuckets.range50to69,
      percentage: completedAttempts > 0 ? Math.round((distributionBuckets.range50to69 / completedAttempts) * 100) : 0,
    },
    {
      range: "70 - 84%",
      label: "Strong (70-84%)",
      count: distributionBuckets.range70to84,
      percentage: completedAttempts > 0 ? Math.round((distributionBuckets.range70to84 / completedAttempts) * 100) : 0,
    },
    {
      range: "85 - 100%",
      label: "Advanced (85-100%)",
      count: distributionBuckets.range85plus,
      percentage: completedAttempts > 0 ? Math.round((distributionBuckets.range85plus / completedAttempts) * 100) : 0,
    },
  ];

  const roundWiseMetrics = Array.from(roundMetricsMap.values())
    .sort((a, b) => a.roundOrder - b.roundOrder)
    .map((rm) => {
      const finished = rm.passedCount + rm.failedCount;
      return {
        roundOrder: rm.roundOrder,
        roundName: rm.roundName,
        roundType: rm.roundType,
        totalAttempts: rm.attemptsCount,
        passedCount: rm.passedCount,
        failedCount: rm.failedCount,
        inProgressCount: rm.inProgressCount,
        passRate: finished > 0 ? Math.round((rm.passedCount / finished) * 100) : 0,
        averageScore: rm.scoreCount > 0 ? Math.round(rm.scoreSum / rm.scoreCount) : 0,
      };
    });

  // Candidate search & pagination
  let filteredAttempts = attempts;
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    filteredAttempts = filteredAttempts.filter((att) => {
      const student = att.studentId || {};
      const name = `${student.firstName || ""} ${student.lastName || ""}`.toLowerCase();
      const email = (student.email || "").toLowerCase();
      const companyName = (att.companyId?.name || "").toLowerCase();
      const trackTitle = (att.trackId?.title || "").toLowerCase();
      return name.includes(q) || email.includes(q) || companyName.includes(q) || trackTitle.includes(q);
    });
  }

  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const totalTableItems = filteredAttempts.length;
  const totalPages = Math.ceil(totalTableItems / parsedLimit) || 1;
  const startIndex = (parsedPage - 1) * parsedLimit;
  const pagedItems = filteredAttempts.slice(startIndex, startIndex + parsedLimit);

  const tableData = pagedItems.map((att) => {
    const student = att.studentId || {};
    const track = att.trackId || {};
    const company = att.companyId || {};
    const rounds = att.roundAttempts || [];
    const passedRounds = rounds.filter((r) => r.status === "PASSED").length;

    return {
      id: String(att._id),
      studentId: String(student._id || ""),
      studentName: [student.firstName, student.lastName].filter(Boolean).join(" ") || "Unknown Candidate",
      studentEmail: student.email || "No email",
      companyName: company.name || "Company",
      companySlug: company.slug || "",
      companyLogoUrl: company.logoUrl || null,
      trackTitle: track.title || "Placement Track",
      targetRole: track.targetRole || "Software Engineer",
      experienceLevel: track.experienceLevel || "1-3 Years",
      driveAttemptNumber: att.driveAttemptNumber || 1,
      status: att.status,
      overallPercentage: att.overallPercentage || 0,
      overallReadinessBand: att.overallReadinessBand || "Needs More Practice",
      roundsPassed: passedRounds,
      totalRounds: rounds.length,
      startedAt: att.startedAt || att.createdAt,
      completedAt: att.completedAt || null,
    };
  });

  return {
    summary: {
      totalCandidatesStarted: uniqueStudents.size,
      totalTrackAttempts,
      completedAttempts,
      inProgressAttempts,
      qualificationCount,
      qualificationRate,
      completionRate,
      averageOverallScore,
      averageAssessmentScore,
      averageInterviewScore,
    },
    scoreDistribution,
    roundWiseMetrics,
    table: {
      data: tableData,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total: totalTableItems,
        totalPages,
      },
    },
  };
};
