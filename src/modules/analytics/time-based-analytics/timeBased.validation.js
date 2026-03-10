import { DEFAULT_TREND_LIMIT } from "../constants/timeBased.constants.js";

export const validateTrendFilters = (query) => {
  const { from, to, testId, organizationId, limit } = query;

  return {
    from: from ? new Date(from) : null,
    to: to ? new Date(to) : null,
    testId: testId || null,
    organizationId: organizationId || null,
    limit: limit ? parseInt(limit, 10) : DEFAULT_TREND_LIMIT,
  };
};
