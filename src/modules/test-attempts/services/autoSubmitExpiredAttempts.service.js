import {
  findExpiredInProgressAttemptsRepo,
  submitExpiredAttemptRepo,
} from "../repositories/testAttempt.repository.js";
import { evaluateObjectiveForAttempt } from "./evaluateObjectiveAttempts.service.js";

export const autoSubmitExpiredAttempts = async () => {
  const now = new Date();

  // 1) Find expired active attempts
  const expiredAttempts = await findExpiredInProgressAttemptsRepo(now);

  let processed = 0;

  for (const a of expiredAttempts) {
    // 2) Submit (atomic guard)
    await submitExpiredAttemptRepo(a._id, now);

    // 3) ✅ SCRUM-21: evaluate objective questions
    await evaluateObjectiveForAttempt(a._id);

    processed++;
  }

  return { processed };
};
