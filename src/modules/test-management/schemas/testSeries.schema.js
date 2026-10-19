import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

export const aiInterviewConfigSchema = z.object({
  role: z.string().optional().nullable(),
  experienceLevel: z.enum(["FRESHER", "MID", "SENIOR", "LEAD"]).optional().nullable(),
  interviewTypes: z.array(z.enum(["TECHNICAL", "BEHAVIORAL", "SYSTEM_DESIGN", "HR"])).optional().default([]),
  topics: z.array(z.string()).optional().default([]),
  durationMinutes: z.number().min(5).max(180).optional().default(30),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional().default("MEDIUM"),
  customRubric: z.any().optional().nullable(),
});

export const hiringRoundSchema = z.object({
  roundOrder: z.number().int().min(1, "Round order must be at least 1"),
  roundKey: z.string().min(1, "Round key is required").trim(),
  roundName: z.string().min(1, "Round name is required").trim(),
  roundType: z.enum(["TESTS", "AI_INTERVIEW"], {
    errorMap: () => ({ message: "Round type must be TESTS or AI_INTERVIEW" }),
  }),
  cutoffPercentage: z.number().min(0).max(100).optional().default(50),
  weight: z.number().min(0).optional().default(100),
  retakePolicy: z.enum(["ALL_TESTS", "FAILED_ONLY"]).optional().default("ALL_TESTS"),
  tests: z.array(objectId).optional().default([]),
  aiInterviewConfig: aiInterviewConfigSchema.optional().nullable(),
});

const validateHiringRounds = (rounds) => {
  if (!Array.isArray(rounds) || rounds.length === 0) return true;

  const orders = new Set();
  const keys = new Set();

  for (const round of rounds) {
    if (orders.has(round.roundOrder)) {
      return false;
    }
    orders.add(round.roundOrder);

    const normKey = round.roundKey?.toLowerCase?.();
    if (keys.has(normKey)) {
      return false;
    }
    keys.add(normKey);

    if (round.roundType === "TESTS" && (!Array.isArray(round.tests) || round.tests.length === 0)) {
      return false;
    }
  }

  return true;
};

export const baseTestSeriesSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),

  visibility: z.enum(["PUBLIC", "ORG_ONLY", "LINK_ONLY", "SELECT_STUDENT"]),

  allowedOrganizations: z.array(objectId).optional(),
  allowedStudents: z.array(objectId).optional(),

  category: z.enum(["GENERAL", "COMPANY"]).optional().default("GENERAL"),
  companyId: objectId.optional().nullable(),
  mode: z.enum(["PRACTICE", "SIMULATION"]).optional().default("SIMULATION"),
  progressionMode: z.enum(["SEQUENTIAL", "OPEN"]).optional().default("SEQUENTIAL"),
  patternVersion: z.string().optional().default("2026"),
  passingPercentage: z.number().min(0).max(100).optional().default(50),
  plannedTestCount: z.number().int().min(0).optional().nullable(),
  isPublished: z.boolean().optional().default(true),
  isDeleted: z.boolean().optional().default(false),

  // New experience-track and hiring simulation fields
  experienceLevel: z.enum(["FRESHER", "EXPERIENCED_1_3", "EXPERIENCED_3_PLUS", "ALL"]).optional().default("ALL"),
  targetRole: z.string().optional().nullable(),
  hiringRounds: z.array(hiringRoundSchema).optional().default([]),

  // Legacy roundsConfig support
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

  tests: z.array(objectId).optional().default([]),
});

export const createTestSeriesSchema = baseTestSeriesSchema.refine(
  (data) => {
    if (data.hiringRounds && data.hiringRounds.length > 0) {
      return validateHiringRounds(data.hiringRounds);
    }
    return true;
  },
  {
    message: "Invalid hiring rounds: ensure unique round orders and keys, and at least one test for TESTS rounds",
    path: ["hiringRounds"],
  }
);

export const updateTestSeriesSchema = baseTestSeriesSchema.partial().refine(
  (data) => {
    if (data.hiringRounds && data.hiringRounds.length > 0) {
      return validateHiringRounds(data.hiringRounds);
    }
    return true;
  },
  {
    message: "Invalid hiring rounds: ensure unique round orders and keys, and at least one test for TESTS rounds",
    path: ["hiringRounds"],
  }
);
