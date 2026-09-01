import { z } from "zod";
import { QUESTION_TYPES } from "../constants/question.types.js";

// MongoDB ObjectId validation
const objectIdRegex = /^[0-9a-fA-F]{24}$/;

/**
 * Update Question Schema
 * - All fields optional
 * - At least one field must be provided
 */
// validate.middleware.js calls schema.parse(req.body) directly — this schema
// must describe the flat body shape, not a nested `{ body: {...} }` wrapper
// (the previous nested shape meant every update request failed validation,
// since req.body is never itself wrapped in a `body` key).
export const updateQuestionSchema = z
  .object({
    subjectId: z.string().regex(objectIdRegex, "Invalid subject ID").optional(),
    topicId: z.string().regex(objectIdRegex, "Invalid topic ID").optional(),
    questionText: z.string().min(1).optional(),
    type: z.enum(Object.values(QUESTION_TYPES)).optional(),
    options: z.array(z.string()).optional(),
    correctAnswer: z.string().optional(),
    difficulty: z.string().optional(),
    imageUrl: z.string().url("Invalid image URL").optional().or(z.literal("")),
    // ✅ Company-wise: tag a question with the companies it's relevant to.
    // Optional so existing question updates without companyIds are unaffected.
    companyIds: z.array(z.string().regex(objectIdRegex, "Invalid company ID")).optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    {
      message: "At least one field must be provided to update",
    }
  );
