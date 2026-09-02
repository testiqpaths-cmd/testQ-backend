// modules/questions/schemas/create-question.schema.js
import { z } from "zod";
import { QUESTION_TYPES } from "../constants/question.types.js";

// MongoDB ObjectId validation
const objectIdRegex = /^[0-9a-fA-F]{24}$/;

// validate.middleware.js calls schema.parse(req.body) directly — this schema
// must describe the flat body shape, not a nested `{ body: {...} }` wrapper
// (the previous nested shape meant every request failed validation, since
// req.body is never itself wrapped in a `body` key).
export const createQuestionSchema = z.object({
  // Not required: questions.validator.js's business rule allows a question
  // tagged with Subject/Topic OR Company (or both) — requiring these here
  // unconditionally would reject a valid company-only question before it
  // ever reaches that check.
  subjectId: z.string().regex(objectIdRegex, "Invalid subject ID").optional(),
  topicId: z.string().regex(objectIdRegex, "Invalid topic ID").optional(),
  questionText: z.string().min(1),
  type: z.enum([QUESTION_TYPES.MCQ, QUESTION_TYPES.TRUE_FALSE]),
  options: z.array(z.string()).optional(),
  correctAnswer: z.string().optional(),
  difficulty: z.string().optional(),
  imageUrl: z.string().url("Invalid image URL").optional().or(z.literal("")),
  // ✅ Company-wise: tag a question with the companies it's relevant to.
  // Optional so existing question creation without companyIds is unaffected.
  companyIds: z.array(z.string().regex(objectIdRegex, "Invalid company ID")).optional(),
});
