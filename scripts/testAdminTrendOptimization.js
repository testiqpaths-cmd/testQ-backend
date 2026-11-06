import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import Test from "../src/models/test.model.js";
import TestAttempt from "../src/models/testAttempt.model.js";
import DailyStudentActivity from "../src/models/dailyStudentActivity.model.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) =>
  new Date(2000, 0, 1, h).toLocaleTimeString("en-US", { hour: "numeric", hour12: true })
);

const getWeekNumber = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
};

const getTrendBucketKey = (date, period) => {
  if (period === "today") {
    const hour = date.getHours();
    return { key: String(hour).padStart(2, "0"), label: HOUR_LABELS[hour] };
  }
  if (period === "weekly") {
    const weekNum = getWeekNumber(date);
    return { key: `${date.getFullYear()}-W${String(weekNum).padStart(2, "0")}`, label: `Week ${weekNum}` };
  }
  if (period === "monthly") {
    return {
      key: `${date.getFullYear()}-${String(date.getMonth()).padStart(2, "0")}`,
      label: date.toLocaleString("en-US", { month: "short", year: "numeric" }),
    };
  }
  return { key: String(date.getFullYear()), label: String(date.getFullYear()) };
};

const TREND_BUCKET_CAPS = { today: 24, weekly: 12, monthly: 12, yearly: 6 };

const getTodayRange = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

// Original raw implementation
async function getRawAdminTrend() {
  const { start: todayStart, end: todayEnd } = getTodayRange();
  const allAttempts = await TestAttempt.find({ status: { $in: ["SUBMITTED", "EVALUATED"] } })
    .select("studentId submittedAt updatedAt createdAt testId")
    .populate({ path: "testId", select: "createdBy isIQRoomTest" })
    .lean();

  const categoryForAttempt = (attempt) => {
    if (attempt.testId?.isIQRoomTest) return "iqRoom";
    const role = attempt.testId?.createdBy?.role;
    if (role === "STUDENT") return "selfCreated";
    if (role === "ORGANIZATION") return "organization";
    if (role === "IQPATH_ADMIN") return "admin";
    return null;
  };

  const events = allAttempts.map((attempt) => ({
    studentId: attempt.studentId,
    date: new Date(attempt.submittedAt || attempt.updatedAt || attempt.createdAt),
    category: categoryForAttempt(attempt),
  }));

  const categories = ["selfCreated", "organization", "admin", "iqRoom"];
  const result = {};

  Object.keys(TREND_BUCKET_CAPS).forEach((period) => {
    const relevant =
      period === "today" ? events.filter((e) => e.date >= todayStart && e.date < todayEnd) : events;

    const buckets = new Map();
    relevant.forEach(({ studentId, date, category }) => {
      if (!category || !studentId) return;
      const { key, label } = getTrendBucketKey(date, period);
      if (!buckets.has(key)) buckets.set(key, { label, sets: {} });
      const entry = buckets.get(key);
      if (!entry.sets[category]) entry.sets[category] = new Set();
      entry.sets[category].add(String(studentId));
    });

    const sortedKeys = Array.from(buckets.keys())
      .sort()
      .slice(-TREND_BUCKET_CAPS[period]);

    result[period] = sortedKeys.map((key) => {
      const { label, sets } = buckets.get(key);
      const row = { label };
      categories.forEach((cat) => {
        row[cat] = sets[cat] ? sets[cat].size : 0;
      });
      return row;
    });
  });

  return {
    series: [
      { key: "selfCreated", label: "Self-Created Tests" },
      { key: "organization", label: "Organization Tests" },
      { key: "admin", label: "Admin Tests" },
      { key: "iqRoom", label: "IQ Room Tests" },
    ],
    ...result,
  };
}

// Optimized implementation
async function getOptimizedAdminTrend() {
  const { start: todayStart, end: todayEnd } = getTodayRange();
  const categories = ["selfCreated", "organization", "admin", "iqRoom"];

  // 1. Calculate minimumDateKey for 6 years back (covering yearly/monthly/weekly)
  const minDate = new Date();
  minDate.setFullYear(minDate.getFullYear() - 6);
  const minimumDateKey = minDate.toISOString().slice(0, 10);

  // 2. Query today's attempts (tiny query, indexed on submittedAt)
  const todayAttemptsPromise = TestAttempt.find({
    status: { $in: ["SUBMITTED", "EVALUATED"] },
    submittedAt: { $gte: todayStart, $lt: todayEnd },
  })
    .select("studentId submittedAt updatedAt createdAt testId")
    .populate({ path: "testId", select: "createdBy isIQRoomTest" })
    .lean();

  // 3. Query DailyStudentActivity for weekly, monthly, yearly
  const activitiesPromise = DailyStudentActivity.find({
    dateKey: { $gte: minimumDateKey },
  })
    .select("dateKey studentId sourceCategory")
    .lean();

  const [todayAttempts, activities] = await Promise.all([
    todayAttemptsPromise,
    activitiesPromise,
  ]);

  // Build today hourly trend from today's attempts
  const categoryForAttempt = (attempt) => {
    if (attempt.testId?.isIQRoomTest) return "iqRoom";
    const role = attempt.testId?.createdBy?.role;
    if (role === "STUDENT") return "selfCreated";
    if (role === "ORGANIZATION") return "organization";
    if (role === "IQPATH_ADMIN") return "admin";
    return null;
  };

  const todayBuckets = new Map();
  for (const attempt of todayAttempts) {
    const category = categoryForAttempt(attempt);
    if (!category || !attempt.studentId) continue;
    const date = new Date(attempt.submittedAt || attempt.updatedAt || attempt.createdAt);
    const { key, label } = getTrendBucketKey(date, "today");
    if (!todayBuckets.has(key)) todayBuckets.set(key, { label, sets: {} });
    const entry = todayBuckets.get(key);
    if (!entry.sets[category]) entry.sets[category] = new Set();
    entry.sets[category].add(String(attempt.studentId));
  }

  const todayResult = Array.from(todayBuckets.keys())
    .sort()
    .slice(-TREND_BUCKET_CAPS.today)
    .map((key) => {
      const { label, sets } = todayBuckets.get(key);
      const row = { label };
      categories.forEach((cat) => {
        row[cat] = sets[cat] ? sets[cat].size : 0;
      });
      return row;
    });

  // Build weekly, monthly, yearly from activities
  const result = { today: todayResult };

  for (const period of ["weekly", "monthly", "yearly"]) {
    const buckets = new Map();

    for (const activity of activities) {
      if (!activity.studentId || !activity.sourceCategory) continue;
      const date = new Date(`${activity.dateKey}T00:00:00`);
      if (Number.isNaN(date.getTime())) continue;

      const { key, label } = getTrendBucketKey(date, period);
      if (!buckets.has(key)) buckets.set(key, { label, sets: {} });
      const entry = buckets.get(key);
      if (!entry.sets[activity.sourceCategory]) entry.sets[activity.sourceCategory] = new Set();
      entry.sets[activity.sourceCategory].add(String(activity.studentId));
    }

    result[period] = Array.from(buckets.keys())
      .sort()
      .slice(-TREND_BUCKET_CAPS[period])
      .map((key) => {
        const { label, sets } = buckets.get(key);
        const row = { label };
        categories.forEach((cat) => {
          row[cat] = sets[cat] ? sets[cat].size : 0;
        });
        return row;
      });
  }

  return {
    series: [
      { key: "selfCreated", label: "Self-Created Tests" },
      { key: "organization", label: "Organization Tests" },
      { key: "admin", label: "Admin Tests" },
      { key: "iqRoom", label: "IQ Room Tests" },
    ],
    ...result,
  };
}

async function main() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for trend comparison.\n");

  const startRaw = performance.now();
  const rawTrend = await getRawAdminTrend();
  const rawDuration = (performance.now() - startRaw).toFixed(2);

  const startOpt = performance.now();
  const optTrend = await getOptimizedAdminTrend();
  const optDuration = (performance.now() - startOpt).toFixed(2);

  console.log(`Execution Time: Raw=${rawDuration}ms | Optimized=${optDuration}ms`);
  console.log(`Speedup: ${(rawDuration / optDuration).toFixed(2)}x faster\n`);

  for (const period of ["today", "weekly", "monthly", "yearly"]) {
    const rawRows = rawTrend[period];
    const optRows = optTrend[period];
    const matches = JSON.stringify(rawRows) === JSON.stringify(optRows);
    console.log(`Period [${period}]: rawRows=${rawRows.length}, optRows=${optRows.length}, match=${matches}`);
    if (!matches) {
      console.log("Raw samples:", JSON.stringify(rawRows.slice(0, 3)));
      console.log("Opt samples:", JSON.stringify(optRows.slice(0, 3)));
    }
  }

  await mongoose.disconnect();
}

main().catch(console.error);
