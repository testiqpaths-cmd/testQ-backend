import express from "express";
import {
  listOrgStudents,
  createOrgStudent,
  updateOrgStudent,
  deleteOrgStudent
} from "../controllers/organization.controller.js";
import { rbacAccess } from "../../../../src/common/middlewares/rbac.js";
import { authMiddleware } from "../../../../src/common/middlewares/auth.middleware.js";
import { upload } from "../../../../src/common/middlewares/upload.middleware.js";
import { bulkUploadStudents } from "../controllers/organization.controller.js";
import multer from "multer";
const router = express.Router();

// Organization can only manage its own students
router.get("/students", authMiddleware, rbacAccess("ORGANIZATION"), listOrgStudents);
router.post("/students", authMiddleware, rbacAccess("ORGANIZATION"), createOrgStudent);
router.put("/students/:id", authMiddleware, rbacAccess("ORGANIZATION"), updateOrgStudent);
router.delete("/students/:id", authMiddleware, rbacAccess("ORGANIZATION"), deleteOrgStudent);

// ✅ Bulk Upload Route
router.post(
  "/students/bulk-upload",
  authMiddleware,
  rbacAccess("ORGANIZATION"),
  upload.single("file"),
  bulkUploadStudents
);
export default router;
