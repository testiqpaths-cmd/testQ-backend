import { Router } from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import {
  createSubject,
  updateSubject,
  deleteSubject,
  getSubjectById,
  getAllSubjects,
  getMySubjects,
  createTopic,
  updateTopic,
  deleteTopic,
  getTopicById,
  getAllTopics,
  getMyTopics,
  getTopicsBySubjectId,
} from "./subject-topic.controller.js";
import {
  createSubjectSchema,
  updateSubjectSchema,
  createTopicSchema,
  updateTopicSchema,
} from "./schemas/subject-topic.schema.js";

const router = Router();

// ========== SUBJECT ROUTES ==========

// Create subject
router.post(
  "/subjects",
  authMiddleware,
  validate(createSubjectSchema),
  createSubject
);

// Update subject
router.put(
  "/subjects/:id",
  authMiddleware,
  validate(updateSubjectSchema),
  updateSubject
);

// Delete subject
router.delete("/subjects/:id", authMiddleware, deleteSubject);

// Get current user's subjects
router.get("/subjects/me", authMiddleware, getMySubjects);

// Get subject by ID
router.get("/subjects/:id", authMiddleware, getSubjectById);

// Get all subjects
router.get("/subjects", authMiddleware, getAllSubjects);

// ========== TOPIC ROUTES ==========

// Create topic
router.post(
  "/topics",
  authMiddleware,
  validate(createTopicSchema),
  createTopic
);

// Update topic
router.put(
  "/topics/:id",
  authMiddleware,
  validate(updateTopicSchema),
  updateTopic
);

// Delete topic
router.delete("/topics/:id", authMiddleware, deleteTopic);

// Get current user's topics
router.get("/topics/me", authMiddleware, getMyTopics);

// Get topic by ID
router.get("/topics/:id", authMiddleware, getTopicById);

// Get all topics
router.get("/topics", authMiddleware, getAllTopics);

// Get topics by subject ID
router.get("/subjects/:subjectId/topics", authMiddleware, getTopicsBySubjectId);

export default router;
