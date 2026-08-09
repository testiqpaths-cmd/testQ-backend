import express from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import {
	createUserController,
	listUsersController,
	getUserController,
	updateUserController,
	deleteUserController,
	listStudentsController,
	getStudentEducationFilterOptionsController,
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
import { featureMiddleware } from "../../common/middlewares/feature.middleware.js";

const router = express.Router();

// Specific routes MUST come before generic /:id routes
// Student CRUD (role = STUDENT)
router.get("/students", authMiddleware, featureMiddleware("USER_MANAGEMENT"), asyncHandler(listStudentsController));
// Must come before /students/:id — see comment above.
router.get(
	"/students/filter-options",
	authMiddleware,
	featureMiddleware("USER_MANAGEMENT"),
	asyncHandler(getStudentEducationFilterOptionsController)
);
router.post(
	"/students",
	authMiddleware,
	roleMiddleware("ORGANIZATION", "IQPATH_ADMIN"),
	featureMiddleware("USER_MANAGEMENT"),
	asyncHandler(createStudentController)
);
router.get("/students/:id", authMiddleware, asyncHandler(getStudentController));
router.put("/students/:id", authMiddleware, asyncHandler(updateStudentController));
router.delete("/students/:id", authMiddleware, asyncHandler(deleteStudentController));

// Organization CRUD (mounted under /users/organizations to avoid collision)
// Listing/managing organization records is an admin-only capability — an
// ORGANIZATION-role account has no legitimate reason to browse or edit other
// organizations' records (their own org-scoped student data goes through the
// /students routes above, which are org-ownership-checked in the controller).
router.get("/organizations", authMiddleware, roleMiddleware("IQPATH_ADMIN"), featureMiddleware("USER_MANAGEMENT"), asyncHandler(listOrganizationsController));
router.post(
	"/organizations",
	authMiddleware,
	roleMiddleware("IQPATH_ADMIN"),
	featureMiddleware("USER_MANAGEMENT"),
	asyncHandler(createOrganizationController)
);
router.get("/organizations/:id", authMiddleware, roleMiddleware("IQPATH_ADMIN"), asyncHandler(getOrganizationController));
router.put("/organizations/:id", authMiddleware, roleMiddleware("IQPATH_ADMIN"), asyncHandler(updateOrganizationController));
router.delete("/organizations/:id", authMiddleware, roleMiddleware("IQPATH_ADMIN"), asyncHandler(deleteOrganizationController));

// Bulk upload users via Excel (field name: file)
router.post(
	"/bulk-upload",
	authMiddleware,
	roleMiddleware("ORGANIZATION", "IQPATH_ADMIN"),
	featureMiddleware("USER_MANAGEMENT"),
	upload.single("file"),
	asyncHandler(bulkUploadUsersController)
);

// Generate and download user template Excel file
router.get("/bulk-import/template", asyncHandler(generateUserTemplateController));

// Generic user CRUD
router.get("/", authMiddleware, featureMiddleware("USER_MANAGEMENT"), asyncHandler(listUsersController));
router.post("/", authMiddleware, featureMiddleware("USER_MANAGEMENT"), asyncHandler(createUserController));
router.get("/:id", authMiddleware, asyncHandler(getUserController));
router.put("/:id", authMiddleware, asyncHandler(updateUserController));
router.delete("/:id", authMiddleware, asyncHandler(deleteUserController));

export default router;
