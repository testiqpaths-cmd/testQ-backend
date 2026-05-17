import express from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import {
	createUserController,
	listUsersController,
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
	generateUserTemplateController,
} from "./user.controller.js";
import { upload } from "../../common/middlewares/upload.middleware.js";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../common/middlewares/role.middleware.js";

const router = express.Router();

// Specific routes MUST come before generic /:id routes
// Student CRUD (role = STUDENT)
router.get("/students", asyncHandler(listStudentsController));
router.post(
	"/students",
	authMiddleware,
	roleMiddleware("ORGANIZATION", "IQPATH_ADMIN"),
	asyncHandler(createStudentController)
);
router.get("/students/:id", asyncHandler(getStudentController));
router.put("/students/:id", asyncHandler(updateStudentController));
router.delete("/students/:id", asyncHandler(deleteStudentController));

// Organization CRUD (mounted under /users/organizations to avoid collision)
router.get("/organizations", asyncHandler(listOrganizationsController));
router.post(
	"/organizations",
	authMiddleware,
	roleMiddleware("IQPATH_ADMIN"),
	asyncHandler(createOrganizationController)
);
router.get("/organizations/:id", asyncHandler(getOrganizationController));
router.put("/organizations/:id", asyncHandler(updateOrganizationController));
router.delete("/organizations/:id", asyncHandler(deleteOrganizationController));

// Bulk upload users via Excel (field name: file)
router.post(
	"/bulk-upload",
	authMiddleware,
	roleMiddleware("ORGANIZATION", "IQPATH_ADMIN"),
	upload.single("file"),
	asyncHandler(bulkUploadUsersController)
);

// Generate and download user template Excel file
router.get("/bulk-import/template", asyncHandler(generateUserTemplateController));

// Generic user CRUD
router.get("/", asyncHandler(listUsersController));
router.post("/", asyncHandler(createUserController));
router.get("/:id", asyncHandler(getUserController));
router.put("/:id", asyncHandler(updateUserController));
router.delete("/:id", asyncHandler(deleteUserController));

export default router;
