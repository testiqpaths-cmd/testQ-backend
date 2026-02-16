import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

export const saveAnswerSchema = z
  .object({
    questionId: objectId,
    selectedOption: z.string().optional().nullable(),
    textAnswer: z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (!data.selectedOption && !data.textAnswer) {
      ctx.addIssue({
        path: ["selectedOption"],
        message: "Provide selectedOption or textAnswer",
      });
    }
  });

  