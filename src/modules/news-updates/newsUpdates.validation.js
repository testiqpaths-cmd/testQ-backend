import { z } from "zod";

export const createNewsSchema = z.object({
  title: z
    .string()
    .min(2, "Title is required")
    .max(50),

  description: z
    .string()
    .min(5, "Description is required")
    .max(500),

  priority: z.enum([
    "HIGH",
    "MEDIUM",
    "LOW",
  ]),

  color: z.enum([
    "blue",
    "green",
    "red",
    "orange",
    "purple",
    "yellow",
  ]),

  visibleFrom: z.string(),

  visibleTill: z.string(),

  audience: z.enum([
    "ALL",
    "ORGANIZATION",
    "ASSIGNED_TEST",
  ]),

  organizations: z.array(z.string()).optional(),

  assignedTests: z.array(z.string()).optional(),

  pinned: z.boolean().optional(),

  isActive: z.boolean().optional(),
});

export const updateNewsSchema =
  createNewsSchema.partial();