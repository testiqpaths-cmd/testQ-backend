import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/);

export const createTestSeriesSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),

  visibility: z.enum(["PUBLIC", "ORG_ONLY", "LINK_ONLY"]),

  allowedOrganizations: z.array(objectId).optional(),

  category: z.enum(["GENERAL", "COMPANY"]).optional().default("GENERAL"),
  companyId: objectId.optional().nullable(),
  mode: z.enum(["PRACTICE", "SIMULATION"]).optional().default("SIMULATION"),
  progressionMode: z.enum(["SEQUENTIAL", "OPEN"]).optional().default("SEQUENTIAL"),
  patternVersion: z.string().optional().default("2026"),
  passingPercentage: z.number().optional().default(50),
  roundsConfig: z
    .array(
      z.object({
        stageOrder: z.number(),
        stageKey: z.string(),
        stageName: z.string().optional(),
        cutoffPercentage: z.number().optional().default(50),
        retakePolicy: z.enum(["ALL_TESTS", "FAILED_ONLY"]).optional().default("ALL_TESTS"),
      })
    )
    .optional(),

  tests: z.array(objectId).optional(),
});

export const updateTestSeriesSchema = createTestSeriesSchema.partial();
