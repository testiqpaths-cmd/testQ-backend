import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { ApiError } from "../../common/exceptions/ApiError.js";
import Company from "../../models/company.model.js";
import Question from "../../models/question.model.js";
import Test from "../../models/test.model.js";
import TestSeries from "../../models/testSeries.model.js";
import CompanyTrackAttempt from "../../models/companyTrackAttempt.model.js";
import { uploadBufferToCloudinary } from "../../common/utils/cloudinary.js";
import { generateSlug } from "../../models/company.model.js";

// Company list supporting active filtering for students and full listing/search for admin
export const getAllCompanies = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.includeInactive === "true" && req.user?.role === "IQPATH_ADMIN") {
    // Admin can view all companies including inactive
  } else {
    filter.isActive = true;
  }

  if (req.query.search) {
    const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.name = { $regex: escaped, $options: "i" };
  }

  const companies = await Company.find(filter)
    .select("name slug description logo primaryColor secondaryColor isActive createdAt")
    .sort({ name: 1 })
    .lean();

  res.json({ success: true, data: companies });
});

export const getCompanyBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const company = await Company.findOne({ slug, isActive: true }).lean();
  if (!company) {
    throw new ApiError(404, "Company not found");
  }
  res.json({ success: true, data: company });
});

export const getCompanyById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const company = await Company.findById(id).lean();
  if (!company) {
    throw new ApiError(404, "Company not found");
  }
  res.json({ success: true, data: company });
});

// Validate real image magic bytes to prevent spoofed content types
export const isValidImageBuffer = (buffer) => {
  if (!buffer || buffer.length < 12) return false;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) return true;
  // GIF: GIF87a or GIF89a (47 49 46 38)
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) return true;
  // WEBP: RIFF....WEBP (52 49 46 46 .... 57 45 42 50)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) return true;

  return false;
};

export const uploadCompanyLogo = asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file) {
    throw new ApiError(400, "No logo image file provided");
  }

  if (!isValidImageBuffer(file.buffer)) {
    throw new ApiError(400, "Invalid image format: file contents do not match supported image types (JPEG, PNG, WEBP, GIF)");
  }

  try {
    const result = await uploadBufferToCloudinary(file.buffer, file.mimetype, "company-logos");
    res.json({
      success: true,
      data: {
        url: result.secure_url,
        public_id: result.public_id,
      },
    });
  } catch (error) {
    throw new ApiError(502, `Logo upload failed: ${error.message}`);
  }
});

export const createCompany = asyncHandler(async (req, res) => {
  const { name, description, logo, logoUrl, primaryColor, secondaryColor, isActive } = req.body;

  const existing = await Company.findOne({
    name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
  });
  if (existing) {
    throw new ApiError(409, `A company named "${name}" already exists`);
  }

  const company = await Company.create({
    name,
    description,
    logo: logo || logoUrl || null,
    primaryColor: primaryColor || null,
    secondaryColor: secondaryColor || null,
    isActive: isActive ?? true,
  });

  res.status(201).json({ success: true, data: company });
});

export const updateCompany = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, description, logo, logoUrl, primaryColor, secondaryColor, isActive } = req.body;

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
  if (name !== undefined) {
    update.name = name;
    update.slug = generateSlug(name);
  }
  if (description !== undefined) update.description = description;
  if (logo !== undefined || logoUrl !== undefined) {
    update.logo = logo !== undefined ? (logo || null) : (logoUrl || null);
  }
  if (primaryColor !== undefined) update.primaryColor = primaryColor || null;
  if (secondaryColor !== undefined) update.secondaryColor = secondaryColor || null;
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

  const [questionCount, testCount, seriesCount, attemptCount] = await Promise.all([
    Question.countDocuments({ companyIds: id }),
    Test.countDocuments({ companyIds: id, isDeleted: { $ne: 1 } }),
    TestSeries.countDocuments({ companyId: id }),
    CompanyTrackAttempt.countDocuments({ companyId: id }),
  ]);

  if (questionCount > 0 || testCount > 0 || seriesCount > 0 || attemptCount > 0) {
    const reasons = [];
    if (questionCount > 0) reasons.push(`${questionCount} question(s)`);
    if (testCount > 0) reasons.push(`${testCount} test(s)`);
    if (seriesCount > 0) reasons.push(`${seriesCount} hiring track(s)`);
    if (attemptCount > 0) reasons.push(`${attemptCount} candidate attempt(s)`);

    throw new ApiError(
      409,
      `Cannot delete "${company.name}" — it is referenced by ${reasons.join(", ")}. Deactivate it instead to preserve historical records.`
    );
  }

  await Company.findByIdAndDelete(id);

  res.json({ success: true, message: "Company deleted" });
});
