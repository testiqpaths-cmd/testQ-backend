import { getTestWiseStats } from "../test-attempt/repository/testStats.repository.js";

export const fetchTestWiseStats = async (testId) => {
  const stats = await getTestWiseStats(testId);

  // Always return a consistent object
  return stats[0] || {
    totalAttempts: 0,
    averageScore: null,
    highestScore: null,
    lowestScore: null,
    passCount: 0,
    failCount: 0,
  };
};
