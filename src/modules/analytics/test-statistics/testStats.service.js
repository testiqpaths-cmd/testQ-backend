import { getTestWiseStats } from "../test-attempt/repository/testStats.repository.js";

export const fetchTestWiseStats = async (testId) => {
  const stats = await getTestWiseStats(testId);
  return stats[0] || null;
};
