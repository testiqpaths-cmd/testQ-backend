// modules/questions/schemas/create-question.schema.js
import { z } from "zod";
import { QUESTION_TYPES } from "../constants/question.types.js";

export const createQuestionSchema = z.object({
  topic: z.string().min(1),
  subTopic: z.string().optional(),
  questionText: z.string().min(1),
  type: z.enum(Object.values(QUESTION_TYPES)),
  options: z.array(z.string()).optional(),
  correctAnswer: z.string().optional(),
  marks: z.number().positive(),
  difficulty: z.string().optional(),
});
