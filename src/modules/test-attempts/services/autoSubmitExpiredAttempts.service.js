import TestAttempt from "../../../models/testAttempt.model.js";

export const autoSubmitExpiredAttempts = async () => {
  const now = new Date();

  // Atomic: only updates attempts still IN_PROGRESS and already expired
  const result = await TestAttempt.updateMany(
    {
      status: "IN_PROGRESS",
      endsAt: { $lte: now },
    },
    {
      $set: {
        status: "SUBMITTED",
        submittedAt: now,
        expireReason: "TIME_EXPIRED_AUTO_SUBMIT",
      },
    }
  );

  return { matched: result.matchedCount ?? result.n, modified: result.modifiedCount ?? result.nModified };
};
