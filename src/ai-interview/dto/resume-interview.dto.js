import { z } from "zod";

export const resumeInterviewSchema = z.object({
  resumeId: z.string().trim().optional(),
  role: z.string().trim().min(2, "Target role must be at least 2 characters").optional(),
  roles: z.array(z.string().trim()).optional(),
  experienceLevel: z.string().trim().optional(),
  experience: z.string().trim().optional(),
  company: z.string().trim().optional(),
  duration: z.coerce.number().min(5).max(120).optional(),
  durationMinutes: z.coerce.number().min(5).max(120).optional(),
  difficulty: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(["EASY", "MEDIUM", "HARD", "ADAPTIVE"]))
    .optional()
    .default("ADAPTIVE"),
  interviewType: z.string().trim().optional(),
  interviewTypes: z.array(z.string().trim()).optional(),
  resumeData: z
    .object({
      name: z.string().optional(),
      skills: z.array(z.string()).optional(),
      projects: z.array(z.any()).optional(),
      experience: z.array(z.any()).optional(),
      education: z.array(z.any()).optional(),
    })
    .optional(),
});

export default resumeInterviewSchema;
