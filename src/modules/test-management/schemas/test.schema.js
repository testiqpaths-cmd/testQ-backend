import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

export const createTestSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),

    subjectId: objectId,

    visibility: z.enum(["PUBLIC", "ORG_ONLY", "LINK_ONLY"]),
    allowedOrganizations: z.array(objectId).optional(),

    totalQuestions: z.number().positive("Total questions must be > 0"),
    subjectIds: z.array(objectId).min(1, "At least one subject is required"),
    topicIds: z.array(objectId).optional(),
    difficulty: z.array(z.string()).optional(),
    type: z.array(z.string()).optional(),

    duration: z.number().positive("Duration must be > 0"),
    totalMarks: z.number().positive("Total marks must be > 0"),

    scheduleType: z.enum(["IMMEDIATE", "DELAYED", "FIXED"]),
    delayDays: z.number().positive().optional(),
    startTime: z.coerce.date().optional(),
    endTime: z.coerce.date().optional(),

    testSeriesId: objectId.optional(),
    isPublished: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    /* Visibility rules */
    if (
      data.visibility === "ORG_ONLY" &&
      (!data.allowedOrganizations || data.allowedOrganizations.length === 0)
    ) {
      ctx.addIssue({
        path: ["allowedOrganizations"],
        message: "ORG_ONLY requires at least one organization",
      });
    }

    /* Schedule rules */
    if (data.scheduleType === "DELAYED" && !data.delayDays) {
      ctx.addIssue({
        path: ["delayDays"],
        message: "DELAYED schedule requires delayDays",
      });
    }

    if (data.scheduleType === "FIXED" && (!data.startTime || !data.endTime)) {
      ctx.addIssue({
        path: ["startTime"],
        message: "FIXED schedule requires startTime and endTime",
      });
    }
  });
