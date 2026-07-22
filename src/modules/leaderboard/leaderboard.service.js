import mongoose from "mongoose";
import { ApiError } from "../../common/exceptions/ApiError.js";
import {
  countDistinctStudentsForTestRepo,
  getTestLeaderboardItemsRepo,
  getSeriesByIdForLeaderboardRepo,
  countDistinctStudentsForSeriesRepo,
  getSeriesLeaderboardItemsRepo,
} from "./repositories/leaderboard.repository.js";

const normalizePageAndLimit = (query) => {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.max(1, Number(query.limit || 10));

  return { page, limit, skip: (page - 1) * limit };
};

// 🧪 TEST leaderboard
export const getTestLeaderboard = async (testId, query) => {
  if (!mongoose.Types.ObjectId.isValid(testId)) {
    throw new ApiError(400, "Invalid testId");
  }

  const { page, limit, skip } = normalizePageAndLimit(query);

  // Rank by distinct students, not attempts — a student with multiple attempts
  // should occupy one leaderboard row (their best attempt), not one row each.
  const totalPromise = countDistinctStudentsForTestRepo(testId);
  const itemsPromise = getTestLeaderboardItemsRepo(testId, { skip, limit });

  const [results, total] = await Promise.all([itemsPromise, totalPromise]);

  // ✅ manual rank generation
  const leaderboard = results.map((item, index) => ({
    ...item,
    rank: skip + index + 1,
  }));

  return {
    items: leaderboard,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

// 📚 SERIES leaderboard
export const getSeriesLeaderboard = async (seriesId, query) => {
  if (!mongoose.Types.ObjectId.isValid(seriesId)) {
    throw new ApiError(400, "Invalid seriesId");
  }

  const { page, limit, skip } = normalizePageAndLimit(query);

  const series = await getSeriesByIdForLeaderboardRepo(seriesId);
  if (!series) {
    return {
      items: [],
      pagination: { page, limit, total: 0, totalPages: 1 },
    };
  }

  const testIds = series.tests;

  const totalPromise = countDistinctStudentsForSeriesRepo(testIds);
  const itemsPromise = getSeriesLeaderboardItemsRepo(testIds, { skip, limit });

  const [results, total] = await Promise.all([itemsPromise, totalPromise]);

  const items = results.map((item, index) => ({
    ...item,
    rank: skip + index + 1,
  }));

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};
