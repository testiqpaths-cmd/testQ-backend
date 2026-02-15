import { z } from "zod";
import { QUESTION_TYPES } from "../constants/question.types.js";

// MongoDB ObjectId validation
const objectIdRegex = /^[0-9a-fA-F]{24}$/;

/**
 * Update Question Schema
 * - All fields optional
 * - At least one field must be provided
 */
export const updateQuestionSchema = z.object({
  body: z
    .object({
      subjectId: z.string().regex(objectIdRegex, "Invalid subject ID").optional(),
      topicId: z.string().regex(objectIdRegex, "Invalid topic ID").optional(),
      questionText: z.string().min(1).optional(),
      type: z.enum(Object.values(QUESTION_TYPES)).optional(),
      options: z.array(z.string()).optional(),
      correctAnswer: z.string().optional(),
      marks: z.number().positive().optional(),
      difficulty: z.string().optional(),
    })
    .refine(
      (data) => Object.keys(data).length > 0,
      {
        message: "At least one field must be provided to update",
      }
    ),
});
