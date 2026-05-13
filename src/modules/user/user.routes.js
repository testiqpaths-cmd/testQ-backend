import express from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import {
	createUserController,
	getUserController,
	updateUserController,
	deleteUserController,
	listStudentsController,
	createStudentController,
	getStudentController,
	updateStudentController,
	deleteStudentController,
	listOrganizationsController,
	createOrganizationController,
	getOrganizationController,
	updateOrganizationController,
	deleteOrganizationController,
	bulkUploadUsersController,
} from "./user.controller.js";
import { upload } from "../../common/middlewares/upload.middleware.js";

const router = express.Router();

// Generic user CRUD
router.post("/", asyncHandler(createUserController));
router.get("/:id", asyncHandler(getUserController));
router.put("/:id", asyncHandler(updateUserController));
router.delete("/:id", asyncHandler(deleteUserController));

// Student CRUD (role = STUDENT)
router.get("/students", asyncHandler(listStudentsController));
router.post("/students", asyncHandler(createStudentController));
router.get("/students/:id", asyncHandler(getStudentController));
router.put("/students/:id", asyncHandler(updateStudentController));
router.delete("/students/:id", asyncHandler(deleteStudentController));

// Organization CRUD (mounted under /user/organizations to avoid collision)
router.get("/organizations", asyncHandler(listOrganizationsController));
router.post("/organizations", asyncHandler(createOrganizationController));
router.get("/organizations/:id", asyncHandler(getOrganizationController));
router.put("/organizations/:id", asyncHandler(updateOrganizationController));
router.delete("/organizations/:id", asyncHandler(deleteOrganizationController));

// Bulk upload users via Excel (field name: file)
router.post("/bulk-upload", upload.single("file"), asyncHandler(bulkUploadUsersController));

export default router;
