import { z } from "zod";

export const submitAnswerSchema = z
  .object({
    answer: z.string().trim().optional(),
    transcript: z.string().trim().optional(),
    questionId: z.string().trim().optional(),
    timeTakenSeconds: z.coerce.number().min(0).max(7200).optional(),
    audioReference: z.string().trim().optional(),
  })
  .refine(
    (data) => Boolean((data.answer && data.answer.trim().length > 0) || (data.transcript && data.transcript.trim().length > 0)),
    {
      message: "Candidate answer or transcript cannot be empty.",
      path: ["answer"],
    }
  );

export default submitAnswerSchema;
