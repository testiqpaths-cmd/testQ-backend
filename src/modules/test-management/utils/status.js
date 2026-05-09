/**
 * Compute test status based on scheduleType and dates
 * Returns: "DRAFT", "UPCOMING", "ACTIVE", or "COMPLETED"
 */
export const computeTestStatus = (test) => {
  if (!test) return "DRAFT";

  const now = new Date();

  // IMMEDIATE tests
  if (test.scheduleType === "IMMEDIATE") {
    return test.isPublished ? "ACTIVE" : "DRAFT";
  }

  // DELAYED tests (scheduled for later, not yet started)
  if (test.scheduleType === "DELAYED") {
    return "UPCOMING";
  }

  // FIXED schedule tests (specific start/end times)
  if (test.scheduleType === "FIXED") {
    const startTime = test.startTime ? new Date(test.startTime) : null;
    const endTime = test.endTime ? new Date(test.endTime) : null;

    if (!startTime || !endTime) return "DRAFT";

    if (now < startTime) return "UPCOMING";
    if (now >= startTime && now <= endTime) return "ACTIVE";
    if (now > endTime) return "COMPLETED";
  }

  return "DRAFT";
};
