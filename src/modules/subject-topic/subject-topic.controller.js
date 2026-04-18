import { asyncHandler } from "../../common/utils/asyncHandler.js";
import * as subjectTopicService from "./subject-topic.service.js";

const resolveOwnerId = (entity) => {
  const createdBy = entity?.createdBy;
  if (!createdBy) return null;
  if (typeof createdBy === "object" && createdBy._id) {
    return String(createdBy._id);
  }
  return String(createdBy);
};

// ========== SUBJECT CONTROLLERS ==========

export const createSubject = asyncHandler(async (req, res) => {
  const payload = {
    ...req.body,
    createdBy: req.user._id,
  };
  const subject = await subjectTopicService.createSubjectService(payload);
  res.status(201).json({ success: true, data: subject });
});

export const updateSubject = asyncHandler(async (req, res) => {
  const existingSubject = await subjectTopicService.getSubjectByIdService(req.params.id);
  if (!existingSubject) {
    return res.status(404).json({ success: false, message: "Subject not found" });
  }

  if (resolveOwnerId(existingSubject) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: "You can update only your own subjects" });
  }

  const subject = await subjectTopicService.updateSubjectService(
    req.params.id,
    req.body
  );
  res.json({ success: true, data: subject });
});

export const deleteSubject = asyncHandler(async (req, res) => {
  const existingSubject = await subjectTopicService.getSubjectByIdService(req.params.id);
  if (!existingSubject) {
    return res.status(404).json({ success: false, message: "Subject not found" });
  }

  if (resolveOwnerId(existingSubject) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: "You can delete only your own subjects" });
  }

  await subjectTopicService.deleteSubjectService(req.params.id);
  res.json({ success: true, message: "Subject deleted successfully" });
});

export const getSubjectById = asyncHandler(async (req, res) => {
  const subject = await subjectTopicService.getSubjectByIdService(req.params.id);
  if (!subject) {
    return res.status(404).json({ success: false, message: "Subject not found" });
  }
  res.json({ success: true, data: subject });
});

export const getAllSubjects = asyncHandler(async (req, res) => {
  const subjects = await subjectTopicService.getMySubjectsService(req.user._id);
  res.json({ success: true, data: subjects });
});

export const getMySubjects = asyncHandler(async (req, res) => {
  const subjects = await subjectTopicService.getMySubjectsService(req.user._id);
  res.json({ success: true, data: subjects });
});

// ========== TOPIC CONTROLLERS ==========

export const createTopic = asyncHandler(async (req, res) => {
  const payload = {
    ...req.body,
    createdBy: req.user._id,
  };
  const topic = await subjectTopicService.createTopicService(payload);
  res.status(201).json({ success: true, data: topic });
});

export const updateTopic = asyncHandler(async (req, res) => {
  const existingTopic = await subjectTopicService.getTopicByIdService(req.params.id);
  if (!existingTopic) {
    return res.status(404).json({ success: false, message: "Topic not found" });
  }

  if (resolveOwnerId(existingTopic) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: "You can update only your own topics" });
  }

  const topic = await subjectTopicService.updateTopicService(
    req.params.id,
    req.body
  );
  res.json({ success: true, data: topic });
});

export const deleteTopic = asyncHandler(async (req, res) => {
  const existingTopic = await subjectTopicService.getTopicByIdService(req.params.id);
  if (!existingTopic) {
    return res.status(404).json({ success: false, message: "Topic not found" });
  }

  if (resolveOwnerId(existingTopic) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: "You can delete only your own topics" });
  }

  await subjectTopicService.deleteTopicService(req.params.id);
  res.json({ success: true, message: "Topic deleted successfully" });
});

export const getTopicById = asyncHandler(async (req, res) => {
  const topic = await subjectTopicService.getTopicByIdService(req.params.id);
  if (!topic) {
    return res.status(404).json({ success: false, message: "Topic not found" });
  }
  res.json({ success: true, data: topic });
});

export const getAllTopics = asyncHandler(async (req, res) => {
  const topics = await subjectTopicService.getMyTopicsService(req.user._id);
  res.json({ success: true, data: topics });
});

export const getMyTopics = asyncHandler(async (req, res) => {
  const topics = await subjectTopicService.getMyTopicsService(req.user._id);
  res.json({ success: true, data: topics });
});

export const getTopicsBySubjectId = asyncHandler(async (req, res) => {
  const topics = await subjectTopicService.getTopicsBySubjectIdService(
    req.params.subjectId,
    req.user._id
  );
  res.json({ success: true, data: topics });
});
