import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

export const evaluateAttemptSchema = z.object({
  evaluations: z.array(
    z.object({
      questionId: objectId,
      marksObtained: z.number().min(0, "marksObtained must be >= 0"),
      feedback: z.string().optional(),
    })
  ).min(1, "At least one evaluation is required"),
});
