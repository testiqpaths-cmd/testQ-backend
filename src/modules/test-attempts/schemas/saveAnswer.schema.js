import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

export const saveAnswerSchema = z
  .object({
    questionId: objectId,
    selectedOption: z.union([z.string(), z.number()]).optional().nullable(),
    textAnswer: z.string().optional().nullable(),
    timeSpentMs: z.number().nonnegative().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.selectedOption && !data.textAnswer && !data.timeSpentMs) {
      ctx.addIssue({
        path: ["selectedOption"],
        message: "Provide selectedOption, textAnswer, or timeSpentMs",
      });
    }
  });

  