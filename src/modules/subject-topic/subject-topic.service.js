import {
  createSubjectRepo,
  updateSubjectRepo,
  deleteSubjectRepo,
  getSubjectByIdRepo,
  getAllSubjectsRepo,
  getSubjectsByUserRepo,
  getSubjectByNameRepo,
  createTopicRepo,
  updateTopicRepo,
  deleteTopicRepo,
  getTopicByIdRepo,
  getAllTopicsRepo,
  getTopicsByUserRepo,
  getTopicsBySubjectIdRepo,
  getTopicByNameAndSubjectRepo,
} from "./repositories/subject-topic.repository.js";
import { ApiError } from "../../common/exceptions/ApiError.js";

// ========== SUBJECT SERVICES ==========

export const createSubjectService = async (payload) => {
  // Check if subject already exists
  const existingSubject = await getSubjectByNameRepo(payload.name, payload.createdBy);
  if (existingSubject) {
    throw new ApiError(409, "Subject already exists with this name");
  }
  try {
    return await createSubjectRepo(payload);
  } catch (error) {
    if (error?.code === 11000) {
      throw new ApiError(409, "Subject already exists with this name");
    }
    throw error;
  }
};

export const updateSubjectService = async (id, payload) => {
  // If name is being updated, check if it already exists
  if (payload.name) {
    const subject = await getSubjectByIdRepo(id);
    const existingSubject = await getSubjectByNameRepo(payload.name, subject?.createdBy);
    if (existingSubject && existingSubject._id.toString() !== id) {
      throw new ApiError(409, "Subject already exists with this name");
    }
  }
  try {
    return await updateSubjectRepo(id, payload);
  } catch (error) {
    if (error?.code === 11000) {
      throw new ApiError(409, "Subject already exists with this name");
    }
    throw error;
  }
};

export const deleteSubjectService = async (id) => {
  return deleteSubjectRepo(id);
};

export const getSubjectByIdService = async (id) => {
  return getSubjectByIdRepo(id);
};

export const getAllSubjectsService = async () => {
  return getAllSubjectsRepo();
};

export const getMySubjectsService = async (userId) => {
  return getSubjectsByUserRepo(userId);
};

// ========== TOPIC SERVICES ==========

export const createTopicService = async (payload) => {
  // Check if topic already exists for the subject
  const existingTopic = await getTopicByNameAndSubjectRepo(
    payload.name,
    payload.subjectId
  );
  if (existingTopic) {
    throw new ApiError(409, "Topic already exists with this name in the subject");
  }
  try {
    return await createTopicRepo(payload);
  } catch (error) {
    if (error?.code === 11000) {
      throw new ApiError(409, "Topic already exists with this name in the subject");
    }
    throw error;
  }
};

export const updateTopicService = async (id, payload) => {
  // If name is being updated, check for duplicates
  if (payload.name) {
    const topic = await getTopicByIdRepo(id);
    const subjectId = payload.subjectId || topic.subjectId;
    const existingTopic = await getTopicByNameAndSubjectRepo(
      payload.name,
      subjectId
    );
    if (existingTopic && existingTopic._id.toString() !== id) {
      throw new ApiError(409, "Topic already exists with this name in the subject");
    }
  }
  try {
    return await updateTopicRepo(id, payload);
  } catch (error) {
    if (error?.code === 11000) {
      throw new ApiError(409, "Topic already exists with this name in the subject");
    }
    throw error;
  }
};

export const deleteTopicService = async (id) => {
  return deleteTopicRepo(id);
};

export const getTopicByIdService = async (id) => {
  return getTopicByIdRepo(id);
};

export const getAllTopicsService = async () => {
  return getAllTopicsRepo();
};

export const getMyTopicsService = async (userId) => {
  return getTopicsByUserRepo(userId);
};

export const getTopicsBySubjectIdService = async (subjectId, userId = null) => {
  return getTopicsBySubjectIdRepo(subjectId, userId);
};
