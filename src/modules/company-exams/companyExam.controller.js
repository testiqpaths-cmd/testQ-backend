import * as companyExamService from "./companyExam.service.js";
import logger from "../../config/logger.js";

/**
 * GET /api/company-exams/companies
 */
export const getCompanies = async (req, res, next) => {
  try {
    const { search } = req.query;
    const companies = await companyExamService.getCompaniesWithStats({ search });
    return res.status(200).json({
      success: true,
      data: companies,
    });
  } catch (err) {
    logger.error(`getCompanies error: ${err.message}`);
    next(err);
  }
};

/**
 * GET /api/company-exams/company/:slug/tracks
 */
export const getCompanyTracks = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const studentId = req.user?._id || req.user?.id;
    const data = await companyExamService.getCompanyTracksBySlug(slug, { studentId });
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    logger.error(`getCompanyTracks error: ${err.message}`);
    next(err);
  }
};

/**
 * GET /api/company-exams/results
 */
export const getCompanyResults = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    if (!studentId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { companyId, slug } = req.query;
    const results = await companyExamService.getCompanyResultsByStudent(studentId, { companyId, slug });
    return res.status(200).json({
      success: true,
      data: results,
    });
  } catch (err) {
    logger.error(`getCompanyResults error: ${err.message}`);
    next(err);
  }
};
