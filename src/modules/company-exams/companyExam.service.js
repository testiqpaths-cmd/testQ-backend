import mongoose from "mongoose";
import Company from "../../models/company.model.js";
import TestSeries from "../../models/testSeries.model.js";
import Test from "../../models/test.model.js";
import Question from "../../models/question.model.js";
import TestAttempt from "../../models/testAttempt.model.js";

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
  if (studentId && mongoose.Types.ObjectId.isValid(studentId)) {
    studentAttempts = await TestAttempt.find({
      studentId: new mongoose.Types.ObjectId(studentId),
      $or: [
        { companyId: company._id },
        { testCategory: "COMPANY" },
      ],
      status: { $in: ["IN_PROGRESS", "SUBMITTED", "EVALUATED", "MISSED"] },
    })
      .select("testId status resultStatus totalScore maxScore percentage submittedAt startedAt companyStageKey")
      .sort({ submittedAt: -1, startedAt: -1 })
      .lean();
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
    const rawTests = Array.isArray(series.tests) ? series.tests : [];
    const progressionMode = series.progressionMode || "SEQUENTIAL";
    const seriesCutoff = series.passingPercentage || 50;

    // Group tests by companyStageOrder / companyStageKey
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

    // Sort rounds by stageOrder ascending
    const sortedRoundOrders = Array.from(roundGroups.keys()).sort((a, b) => a - b);

    // Track sequential qualification state across rounds
    let previousRoundPassed = true;
    let previousRoundInfo = null;

    const rounds = sortedRoundOrders.map((order) => {
      const round = roundGroups.get(order);
      totalRoundsCount++;

      let roundTotalMarks = 0;
      let roundObtainedMarks = 0;
      let allTestsCompleted = true;
      let hasAnyTestStarted = false;

      const processedTests = round.tests.map((test) => {
        totalAvailableTests++;
        const attemptEntry = testAttemptMap.get(String(test._id));
        const latestAtt = attemptEntry?.latest || null;
        const bestAtt = attemptEntry?.bestCompleted || null;

        const isTestCompleted = Boolean(bestAtt);
        if (isTestCompleted) {
          totalCompletedTests++;
          totalWeightedMarksObtained += bestAtt.totalScore || 0;
          totalWeightedMaxMarks += test.totalMarks || bestAtt.maxScore || 0;
          roundObtainedMarks += bestAtt.totalScore || 0;
        } else {
          allTestsCompleted = false;
        }

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
          passingPercentage: test.passingPercentage || seriesCutoff,
          secureBrowserRequired: test.secureBrowserRequired,
          isCompleted: isTestCompleted,
          attempt: latestAtt
            ? {
                attemptId: String(latestAtt._id),
                status: latestAtt.status,
                resultStatus: latestAtt.resultStatus || null,
                score: bestAtt?.totalScore || latestAtt.totalScore || 0,
                maxScore: bestAtt?.maxScore || latestAtt.maxScore || test.totalMarks,
                percentage: bestAtt ? Math.round(bestAtt.percentage || 0) : Math.round(latestAtt.percentage || 0),
                submittedAt: latestAtt.submittedAt || null,
              }
            : null,
        };
      });

      const roundPercentage = roundTotalMarks > 0 ? Math.round((roundObtainedMarks / roundTotalMarks) * 100) : 0;
      const isRoundPassed = allTestsCompleted && roundPercentage >= seriesCutoff;

      if (isRoundPassed) {
        clearedRoundsCount++;
      }

      // Progression lock logic
      let isLocked = false;
      let lockReason = null;

      if (progressionMode === "SEQUENTIAL" && order > 1) {
        if (!previousRoundPassed) {
          isLocked = true;
          if (previousRoundInfo && !previousRoundInfo.allTestsCompleted) {
            lockReason = `Complete all tests in Round ${previousRoundInfo.stageOrder} (${previousRoundInfo.stageName}) to unlock.`;
          } else if (previousRoundInfo) {
            lockReason = `Round ${previousRoundInfo.stageOrder} cutoff not met (${previousRoundInfo.roundPercentage}% / Required ${seriesCutoff}%). Retake Round ${previousRoundInfo.stageOrder} to qualify.`;
          } else {
            lockReason = `Previous round qualification required to unlock this stage.`;
          }
        }
      }

      // Update state for next round
      previousRoundPassed = isRoundPassed;
      previousRoundInfo = {
        stageOrder: order,
        stageName: round.stageName,
        allTestsCompleted,
        roundPercentage,
      };

      return {
        stageKey: round.stageKey,
        stageName: round.stageName,
        stageOrder: order,
        isLocked,
        lockReason,
        isCompleted: allTestsCompleted,
        isPassed: isRoundPassed,
        hasInProgress: hasAnyTestStarted,
        roundScore: roundObtainedMarks,
        roundTotalMarks,
        roundPercentage,
        passingPercentage: seriesCutoff,
        tests: processedTests,
      };
    });

    return {
      _id: series._id,
      title: series.title,
      description: series.description,
      progressionMode,
      patternVersion: series.patternVersion || "2026",
      passingPercentage: seriesCutoff,
      rounds,
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
 * Get company exam results for a student.
 */
export const getCompanyResultsByStudent = async (studentId, { companyId = null, slug = null } = {}) => {
  if (!mongoose.Types.ObjectId.isValid(studentId)) {
    throw new Error("Invalid student id");
  }

  let filterCompanyId = companyId;
  if (!filterCompanyId && slug) {
    const comp = await Company.findOne({ slug: slug.toLowerCase() }).select("_id").lean();
    if (comp) filterCompanyId = comp._id;
  }

  const query = {
    studentId: new mongoose.Types.ObjectId(studentId),
    testCategory: "COMPANY",
    status: { $in: ["SUBMITTED", "EVALUATED", "MISSED"] },
  };

  if (filterCompanyId && mongoose.Types.ObjectId.isValid(filterCompanyId)) {
    query.companyId = new mongoose.Types.ObjectId(filterCompanyId);
  }

  const attempts = await TestAttempt.find(query)
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

  return attempts.map((a) => {
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
};
