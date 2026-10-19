import { z } from "zod";

const colorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const createCompanySchema = z.object({
  name: z.string().min(1, "Company name is required").trim(),
  description: z.string().optional(),
  logo: z.string().url("Invalid logo URL").optional().or(z.literal("")),
  logoUrl: z.string().url("Invalid logo URL").optional().or(z.literal("")),
  primaryColor: z.string().regex(colorRegex, "Invalid hex color").optional().or(z.literal("")).nullable(),
  secondaryColor: z.string().regex(colorRegex, "Invalid hex color").optional().or(z.literal("")).nullable(),
  isActive: z.boolean().optional(),
});

export const updateCompanySchema = z
  .object({
    name: z.string().min(1, "Company name is required").trim().optional(),
    description: z.string().optional(),
    logo: z.string().url("Invalid logo URL").optional().or(z.literal("")),
    logoUrl: z.string().url("Invalid logo URL").optional().or(z.literal("")),
    primaryColor: z.string().regex(colorRegex, "Invalid hex color").optional().or(z.literal("")).nullable(),
    secondaryColor: z.string().regex(colorRegex, "Invalid hex color").optional().or(z.literal("")).nullable(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided to update",
  });

