import TestAttempt from "../../../models/testAttempt.model.js";
import { evaluateObjectiveForAttempt } from "./evaluateObjectiveAttempts.service.js";

export const autoSubmitExpiredAttempts = async () => {
  const now = new Date();

  // 1) Find expired active attempts
  const expiredAttempts = await TestAttempt.find({
    status: "IN_PROGRESS",
    endsAt: { $lte: now },
  }).select("_id");

  let processed = 0;

  for (const a of expiredAttempts) {
    // 2) Submit (atomic guard)
    await TestAttempt.updateOne(
      { _id: a._id, status: "IN_PROGRESS" },
      {
        $set: {
          status: "SUBMITTED",
          submittedAt: now,
          expireReason: "TIME_EXPIRED_AUTO_SUBMIT",
        },
      }
    );

    // 3) ✅ SCRUM-21: evaluate objective questions
    await evaluateObjectiveForAttempt(a._id);

    processed++;
  }

  return { processed };
};
