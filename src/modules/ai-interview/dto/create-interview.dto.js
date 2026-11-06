import { z } from "zod";

export const createCustomInterviewSchema = z
  .object({
    role: z.string().trim().min(2, "Role must be at least 2 characters").optional(),
    roles: z.array(z.string().trim()).optional(),
    experienceLevel: z.string().trim().optional(),
    experience: z.string().trim().optional(),
    company: z.string().trim().optional(),
    technologies: z.array(z.string().trim()).optional(),
    techStack: z.array(z.string().trim()).optional(),
    difficulty: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(z.enum(["EASY", "MEDIUM", "HARD", "ADAPTIVE"]))
      .optional()
      .default("ADAPTIVE"),
    duration: z.coerce.number().min(5).max(120).optional(),
    durationMinutes: z.coerce.number().min(5).max(120).optional(),
    interviewType: z.string().trim().optional(),
    interviewTypes: z.array(z.string().trim()).optional(),
    questionCount: z.coerce.number().min(3).max(30).optional(),
  })
  .refine(
    (data) => Boolean(data.role || (data.roles && data.roles.length > 0)),
    {
      message: "Target role is required.",
      path: ["role"],
    }
  );

export default createCustomInterviewSchema;
