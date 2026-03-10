import Subject from "../../../models/subject.model.js";
import Topic from "../../../models/topic.model.js";

// ========== SUBJECT REPOSITORY ==========

export const createSubjectRepo = (data) => Subject.create(data);

export const updateSubjectRepo = (id, data) =>
  Subject.findByIdAndUpdate(id, { ...data, updatedAt: Date.now() }, { new: true });

export const deleteSubjectRepo = (id) => Subject.findByIdAndDelete(id);

export const getSubjectByIdRepo = (id) => Subject.findById(id);

export const getAllSubjectsRepo = () => Subject.find().populate("createdBy", "_id name email");

export const getSubjectByNameRepo = (name) => Subject.findOne({ name });

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

export const getTopicsBySubjectIdRepo = (subjectId) =>
  Topic.find({ subjectId }).populate("createdBy", "_id name email");

export const getTopicByNameAndSubjectRepo = (name, subjectId) =>
  Topic.findOne({ name, subjectId });
