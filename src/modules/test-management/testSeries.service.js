import mongoose from "mongoose";
import crypto from "crypto";
import logger from "../../config/logger.js";
import { computeTestStatus } from "./utils/status.js";
import {
  createSeriesRepo,
  findSeriesByTitleRepo,
  updateSeriesByIdRepo,
  deleteSeriesByIdRepo,
  getSeriesByIdRepo,
  getSeriesListRepo,
  aggregateLeaderboardSeriesRepo,
  addTestToSeriesRepo,
} from "./repositories/testSeries.repository.js";
import { createTestRepo, saveTestRepo, findTestByIdRepo } from "./repositories/test.repository.js";

const toIdArray = (...values) =>
  values
    .flatMap((value) => {
      if (Array.isArray(value)) return value;
      return value ? [value] : [];
    })
    .map((value) => String(value))
    .filter(Boolean);

const normalizeSeriesTestPayload = (data) => {
  const subjectIds = toIdArray(data.subjectIds, data.subjectId);
  const topicIds = toIdArray(data.topicIds, data.topicId);

  if (data.questionSource !== "EXCEL" && !subjectIds.length) {
    throw new Error("At least one subject is required");
  }

  return {
    ...data,
    subjectId: subjectIds[0] || data.subjectId,
    subjectIds,
    topicIds,
  };
};


export const createSeries = async (data, user) => {
  logger.debug(`Creating series for user: ${JSON.stringify(user)}`);

  console.log("Checking duplicate title:", data.title);

  const existingSeries = await findSeriesByTitleRepo(data.title);

  console.log("Existing Series:", existingSeries);

  if (existingSeries) {
    throw new Error("Test series with this title already exists");
  }
  const seriesCode =
    data.visibility === "LINK_ONLY"
      ? crypto.randomBytes(4).toString("hex")
      : undefined;

  return createSeriesRepo({
    ...data,
    seriesCode,
    createdBy: {
      userId: new mongoose.Types.ObjectId(user._id || user.id),
      role: user.role,
    },
  });
};

export const updateSeries = async (id, payload) => {
  const series = await updateSeriesByIdRepo(id, payload);

  // If client requested schedule update, compute start/end for tests
  if (Array.isArray(payload.tests) && payload.scheduleStart) {
    // parse scheduleStart
    let cursor = new Date(payload.scheduleStart);
    if (Number.isNaN(cursor.getTime())) cursor = new Date();

    for (const testId of payload.tests) {
      try {
        const test = await findTestByIdRepo(testId);
        if (!test) continue;

        const durationMinutes = Number(test.duration) || 0;
        const startTime = new Date(cursor);
        const endTime = new Date(cursor.getTime() + durationMinutes * 60 * 1000);

        test.startTime = startTime;
        test.endTime = endTime;
        await saveTestRepo(test);

        // advance cursor
        cursor = endTime;
      } catch (e) {
        // continue on per-test error
        logger.error(`updateSeries: failed to update schedule for test ${testId}: ${e.message}`);
      }
    }
  }

  return series;
};

export const deleteSeries = (id) => deleteSeriesByIdRepo(id);

export const getSeriesById = (id) => getSeriesByIdRepo(id);

export const getSeriesList = async ({ userId, search = "" } = {}) =>
  getSeriesListRepo({ userId, search });

export const getLeaderboardSeriesList = async () => aggregateLeaderboardSeriesRepo();

// Create a new test that belongs to a series. The test will be marked as a series test
// and linked to the series' tests array.
export const createSeriesTest = async (seriesId, data, user) => {
  const payload = {
    ...normalizeSeriesTestPayload(data),
    testSeriesId: seriesId,
    isSeriesTest: true,
    maxAttempts: Number(data.maxAttempts) || 1,
    testCode: data.visibility === 'LINK_ONLY' ? crypto.randomBytes(4).toString('hex') : null,
    createdBy: { userId: user._id || user.id, role: user.role },
  };

  const test = await createTestRepo(payload);

  // add to series tests array
  await addTestToSeriesRepo(seriesId, test._id);

  // Compute and persist status for the created series test
  test.status = computeTestStatus(test);
  await saveTestRepo(test);

  return test;
};
