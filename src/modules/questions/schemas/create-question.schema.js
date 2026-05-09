// modules/questions/schemas/create-question.schema.js
import { z } from "zod";
import { QUESTION_TYPES } from "../constants/question.types.js";

// MongoDB ObjectId validation
const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const createQuestionSchema = z.object({
  body: z.object({
    subjectId: z.string().regex(objectIdRegex, "Invalid subject ID"),
    topicId: z.string().regex(objectIdRegex, "Invalid topic ID"),
    questionText: z.string().min(1),
    type: z.enum([QUESTION_TYPES.MCQ, QUESTION_TYPES.TRUE_FALSE]),
    options: z.array(z.string()).optional(),
    correctAnswer: z.string().optional(),
    marks: z.number().positive(),
    difficulty: z.string().optional(),
  }),
});
