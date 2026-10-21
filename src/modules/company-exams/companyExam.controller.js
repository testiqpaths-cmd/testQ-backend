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

    const { companyId, slug, trackId } = req.query;
    const results = await companyExamService.getCompanyResultsByStudent(studentId, { companyId, slug, trackId });
    return res.status(200).json({
      success: true,
      data: results,
    });
  } catch (err) {
    logger.error(`getCompanyResults error: ${err.message}`);
    next(err);
  }
};

/**
 * GET /api/company-exams/attempts/:attemptId
 */
export const getCompanyTrackAttemptById = async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const attempt = await companyExamService.getCompanyTrackAttemptById({
      attemptId,
      requestingUser: req.user,
    });
    return res.status(200).json({
      success: true,
      data: attempt,
    });
  } catch (err) {
    logger.error(`getCompanyTrackAttemptById error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: err.message || "Failed to fetch company track attempt",
    });
  }
};

/**
 * GET /api/company-exams/admin/analytics
 */
export const getCompanyTrackAdminAnalytics = async (req, res, next) => {
  try {
    const data = await companyExamService.getCompanyTrackAdminAnalytics(req.user, req.query);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    logger.error(`getCompanyTrackAdminAnalytics error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: err.message || "Failed to fetch company track analytics",
    });
  }
};

/**
 * POST /api/company-exams/tracks/:trackId/start
 */
export const startCompanyTrackAttempt = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    if (!studentId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const { trackId } = req.params;
    const result = await companyExamService.startOrResumeTrackAttempt({ studentId, trackId });
    return res.status(200).json({
      success: true,
      message: result.isNew ? "Started company placement track drive" : "Resumed company placement track drive",
      data: result,
    });
  } catch (err) {
    logger.error(`startCompanyTrackAttempt error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: err.message || "Failed to start or resume company track attempt",
    });
  }
};

/**
 * GET /api/company-exams/tracks/:trackId/attempt
 */
export const getCompanyTrackAttempt = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    if (!studentId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const { trackId } = req.params;
    const data = await companyExamService.getTrackAttemptStatus({ studentId, trackId });
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    logger.error(`getCompanyTrackAttempt error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: err.message || "Failed to fetch company track attempt",
    });
  }
};

/**
 * POST /api/company-exams/tracks/:trackId/retake
 */
export const retakeCompanyTrackAttempt = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    if (!studentId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const { trackId } = req.params;
    const { roundOrder } = req.body || {};
    const result = await companyExamService.retakeTrackAttempt({ studentId, trackId, roundOrder });
    return res.status(200).json({
      success: true,
      message: result.isNewDrive ? "New company placement drive initialized" : "Round retake initiated",
      data: result,
    });
  } catch (err) {
    logger.error(`retakeCompanyTrackAttempt error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: err.message || "Failed to retake company track attempt",
    });
  }
};

/**
 * POST /api/company-exams/tracks/:trackId/rounds/:roundOrder/interview/launch
 * POST /api/company-exams/tracks/:trackId/interview/launch
 */
export const launchCompanyInterviewRound = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    if (!studentId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const { trackId } = req.params;
    const roundOrder = req.params.roundOrder || req.body?.roundOrder;
    if (!roundOrder) {
      return res.status(400).json({ success: false, message: "Round order is required" });
    }
    const result = await companyExamService.launchCompanyInterviewRound({
      studentId,
      trackId,
      roundOrder,
      file: req.file || null,
      body: req.body || {},
    });
    return res.status(200).json({
      success: true,
      message: result.isResumed ? "Resumed existing interview session" : "AI Interview round launched successfully",
      data: result,
    });
  } catch (err) {
    logger.error(`launchCompanyInterviewRound error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: err.message || "Failed to launch AI Interview round",
    });
  }
};
