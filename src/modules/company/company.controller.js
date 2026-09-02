import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { ApiError } from "../../common/exceptions/ApiError.js";
import Company from "../../models/company.model.js";
import Question from "../../models/question.model.js";
import Test from "../../models/test.model.js";

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

export const createCompany = asyncHandler(async (req, res) => {
  const { name, description, logo, isActive } = req.body;

  const existing = await Company.findOne({
    name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
  });
  if (existing) {
    throw new ApiError(409, `A company named "${name}" already exists`);
  }

  const company = await Company.create({
    name,
    description,
    logo: logo || null,
    isActive: isActive ?? true,
  });

  res.status(201).json({ success: true, data: company });
});

export const updateCompany = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, description, logo, isActive } = req.body;

  if (name) {
    const existing = await Company.findOne({
      _id: { $ne: id },
      name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    });
    if (existing) {
      throw new ApiError(409, `A company named "${name}" already exists`);
    }
  }

  const update = {};
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  if (logo !== undefined) update.logo = logo || null;
  if (isActive !== undefined) update.isActive = isActive;

  const company = await Company.findByIdAndUpdate(id, update, { new: true, runValidators: true });
  if (!company) {
    throw new ApiError(404, "Company not found");
  }

  res.json({ success: true, data: company });
});

export const deleteCompany = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const company = await Company.findById(id);
  if (!company) {
    throw new ApiError(404, "Company not found");
  }

  const [questionCount, testCount] = await Promise.all([
    Question.countDocuments({ companyIds: id }),
    // Test deletion is soft (isDeleted flips to 1, the row stays) — a
    // soft-deleted test no longer meaningfully "uses" this company.
    Test.countDocuments({ companyIds: id, isDeleted: { $ne: 1 } }),
  ]);

  if (questionCount > 0 || testCount > 0) {
    throw new ApiError(
      409,
      `Cannot delete "${company.name}" — it's tagged on ${questionCount} question(s) and ${testCount} test(s). Deactivate it instead to hide it from new selections.`
    );
  }

  await Company.findByIdAndDelete(id);

  res.json({ success: true, message: "Company deleted" });
});
