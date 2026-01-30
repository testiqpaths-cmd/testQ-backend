import { z } from "zod";
import { QUESTION_TYPES } from "../constants/question.types.js";

/**
 * Update Question Schema
 * - All fields optional
 * - At least one field must be provided
 */
export const updateQuestionSchema = z
  .object({
    topic: z.string().min(1).optional(),
    subTopic: z.string().optional(),
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
  );
