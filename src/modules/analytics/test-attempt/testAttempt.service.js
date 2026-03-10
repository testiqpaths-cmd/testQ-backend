// src/modules/analytics/test-attempt/testAttempt.service.js
import { findAttemptsByStudent } from "./repository/testAttempt.repository.js";
import TestAttempt from "../../../models/testAttempt.model.js";
export const getStudentResults = async (studentId) => {
  return await findAttemptsByStudent(studentId);
};
