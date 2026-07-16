// src/modules/analytics/test-attempt/testAttempt.service.js
import { findAttemptsByStudent } from "./repository/testAttempt.repository.js";
import TestAttempt from "../../../models/testAttempt.model.js";
import { syncMissedAttemptsForStudent } from "../../test-attempts/services/syncMissedAttempts.service.js";

export const getStudentResults = async (studentId) => {
  await syncMissedAttemptsForStudent(studentId);
  return await findAttemptsByStudent(studentId);
};
