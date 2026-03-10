import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const createSubjectSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).optional(),
    icon: z.string().trim().url().optional(),
  }),
});

export const updateSubjectSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(2).max(100).optional(),
      description: z.string().trim().max(500).optional(),
      icon: z.string().trim().url().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field must be provided to update",
    }),
});

export const createTopicSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(100),
    subjectId: z.string().regex(objectIdRegex, "Invalid subject ID"),
    description: z.string().trim().max(500).optional(),
    icon: z.string().trim().url().optional(),
  }),
});

export const updateTopicSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(2).max(100).optional(),
      subjectId: z.string().regex(objectIdRegex, "Invalid subject ID").optional(),
      description: z.string().trim().max(500).optional(),
      icon: z.string().trim().url().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field must be provided to update",
    }),
});

