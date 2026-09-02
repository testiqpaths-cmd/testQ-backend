import { z } from "zod";

export const createCompanySchema = z.object({
  name: z.string().min(1, "Company name is required"),
  description: z.string().optional(),
  logo: z.string().url("Invalid logo URL").optional().or(z.literal("")),
  isActive: z.boolean().optional(),
});

export const updateCompanySchema = z
  .object({
    name: z.string().min(1, "Company name is required").optional(),
    description: z.string().optional(),
    logo: z.string().url("Invalid logo URL").optional().or(z.literal("")),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided to update",
  });
