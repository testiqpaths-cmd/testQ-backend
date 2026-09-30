import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/);

export const createTestSeriesSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),

  visibility: z.enum(["PUBLIC", "ORG_ONLY", "LINK_ONLY"]),

  allowedOrganizations: z.array(objectId).optional(),

  category: z.enum(["GENERAL", "COMPANY"]).optional().default("GENERAL"),
  companyId: objectId.optional().nullable(),

  tests: z.array(objectId).optional(),
});

export const updateTestSeriesSchema = createTestSeriesSchema.partial();
