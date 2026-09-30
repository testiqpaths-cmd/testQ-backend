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
      select: "title description duration totalQuestions totalMarks companyStage difficulty type scheduleType startTime endTime status secureBrowserRequired createdAt",
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
    .select("title description duration totalQuestions totalMarks companyStage difficulty type scheduleType startTime endTime status secureBrowserRequired createdAt")
    .sort({ createdAt: -1 })
    .lean();

  // If studentId provided, fetch attempts to show progress
  let attemptMap = new Map();
  if (studentId && mongoose.Types.ObjectId.isValid(studentId)) {
    const attempts = await TestAttempt.find({
      studentId: new mongoose.Types.ObjectId(studentId),
      $or: [
        { companyId: company._id },
        { testCategory: "COMPANY" },
      ],
      status: { $in: ["IN_PROGRESS", "SUBMITTED", "EVALUATED", "MISSED"] },
    })
      .select("testId status resultStatus totalScore maxScore percentage submittedAt startedAt")
      .sort({ submittedAt: -1, startedAt: -1 })
      .lean();

    for (const att of attempts) {
      const tId = String(att.testId);
      if (!attemptMap.has(tId)) {
        attemptMap.set(tId, {
          attemptId: String(att._id),
          status: att.status,
          resultStatus: att.resultStatus || null,
          score: att.totalScore || 0,
          maxScore: att.maxScore || 0,
          percentage: Number.isFinite(att.percentage) ? Math.round(att.percentage) : 0,
          submittedAt: att.submittedAt || null,
          startedAt: att.startedAt || null,
        });
      }
    }
  }

  const attachAttemptInfo = (test) => {
    const att = attemptMap.get(String(test._id)) || null;
    return {
      ...test,
      attempt: att,
    };
  };

  const processedSeries = seriesList.map((s) => ({
    ...s,
    tests: Array.isArray(s.tests) ? s.tests.map(attachAttemptInfo) : [],
  }));

  const processedStandalone = standaloneTests.map(attachAttemptInfo);

  // Calculate student summary
  let totalTests = 0;
  let completedTests = 0;
  let totalPercentage = 0;

  const countTest = (t) => {
    totalTests++;
    if (t.attempt && (t.attempt.status === "SUBMITTED" || t.attempt.status === "EVALUATED")) {
      completedTests++;
      totalPercentage += t.attempt.percentage || 0;
    }
  };

  processedSeries.forEach((s) => s.tests.forEach(countTest));
  processedStandalone.forEach(countTest);

  const averageScore = completedTests > 0 ? Math.round(totalPercentage / completedTests) : 0;

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
    standaloneTests: processedStandalone,
    studentStats: {
      totalTests,
      completedTests,
      averageScore,
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
