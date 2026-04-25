import Subject from "../../../models/subject.model.js";
import Topic from "../../../models/topic.model.js";

const escapeRegex = (value) => String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ========== SUBJECT REPOSITORY ==========

export const createSubjectRepo = (data) => Subject.create(data);

export const updateSubjectRepo = (id, data) =>
  Subject.findByIdAndUpdate(id, { ...data, updatedAt: Date.now() }, { new: true });

export const deleteSubjectRepo = (id) => Subject.findByIdAndDelete(id);

export const getSubjectByIdRepo = (id) => Subject.findById(id);

export const getAllSubjectsRepo = () => Subject.find().populate("createdBy", "_id name email");

export const getSubjectsByUserRepo = (userId) =>
  Subject.find({ createdBy: userId })
    .populate("createdBy", "_id name email")
    .sort({ updatedAt: -1, createdAt: -1 });

export const getSubjectByNameRepo = (name, userId = null) => {
  const normalizedName = String(name ?? "").trim();

  if (!normalizedName) {
    return null;
  }

  const filters = {
    name: new RegExp(`^${escapeRegex(normalizedName)}$`, "i"),
  };

  if (userId) {
    filters.createdBy = userId;
  }

  return Subject.findOne(filters);
};

// ========== TOPIC REPOSITORY ==========

export const createTopicRepo = (data) => Topic.create(data);

export const updateTopicRepo = (id, data) =>
  Topic.findByIdAndUpdate(id, { ...data, updatedAt: Date.now() }, { new: true });

export const deleteTopicRepo = (id) => Topic.findByIdAndDelete(id);

export const getTopicByIdRepo = (id) =>
  Topic.findById(id).populate("subjectId", "_id name").populate("createdBy", "_id name email");

export const getAllTopicsRepo = () =>
  Topic.find()
    .populate("subjectId", "_id name")
    .populate("createdBy", "_id name email");

export const getTopicsByUserRepo = (userId) =>
  Topic.find({ createdBy: userId })
    .populate("subjectId", "_id name")
    .populate("createdBy", "_id name email")
    .sort({ updatedAt: -1, createdAt: -1 });

export const getTopicsBySubjectIdRepo = (subjectId, userId = null) => {
  const filters = { subjectId };
  if (userId) {
    filters.createdBy = userId;
  }

  return Topic.find(filters).populate("createdBy", "_id name email");
};

export const getTopicByNameAndSubjectRepo = (name, subjectId) =>
  Topic.findOne({
    name: new RegExp(`^${escapeRegex(String(name ?? "").trim())}$`, "i"),
    subjectId,
  });
