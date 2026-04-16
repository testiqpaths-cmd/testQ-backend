import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

// ========== SUBJECT SCHEMAS ==========

export const createSubjectSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  description: z.string().trim().max(500).optional(),
  icon: z.string().trim().url("Icon must be a valid URL").optional(),
});

export const updateSubjectSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    icon: z.string().trim().url("Icon must be a valid URL").optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided to update",
  });

// ========== TOPIC SCHEMAS ==========

export const createTopicSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  subjectId: z.string().regex(objectIdRegex, "Invalid subject ID"),
  description: z.string().trim().max(500).optional(),
  icon: z.string().trim().url("Icon must be a valid URL").optional(),
});

export const updateTopicSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    subjectId: z.string().regex(objectIdRegex, "Invalid subject ID").optional(),
    description: z.string().trim().max(500).optional(),
    icon: z.string().trim().url("Icon must be a valid URL").optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided to update",
  });