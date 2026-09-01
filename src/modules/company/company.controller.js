import { asyncHandler } from "../../common/utils/asyncHandler.js";
import Company from "../../models/company.model.js";

// Read-only list for the Company-wise Test dropdown — reuses the existing
// Company model (see src/models/company.model.js), same as
// subject-topic.controller.js's getAllSubjects for Subjects.
export const getAllCompanies = asyncHandler(async (req, res) => {
  const companies = await Company.find({ isActive: true })
    .select("name description logo isActive")
    .sort({ name: 1 })
    .lean();

  res.json({ success: true, data: companies });
});
