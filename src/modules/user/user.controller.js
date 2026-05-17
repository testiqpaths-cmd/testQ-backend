import { User } from "../auth/index.js";
import Organization from "../../models/organization.model.js";
import { asyncHandler as _ } from "../../common/utils/asyncHandler.js";
import {
	createUser,
	getUserById,
	updateUser,
	softDeleteUser,
	listUsers,
	listStudents,
	createStudent,
	createUsersFromArray,
	listOrganizations,
	createOrganization,
	getOrganizationById,
	updateOrganization,
	deleteOrganization,
} from "./user.service.js";
import xlsx from "xlsx";
import { generateUserTemplate } from "./template/generate-userTemplate.js";

// Generic user CRUD
export const createUserController = async (req, res) => {
	const payload = req.body;
	const user = await createUser(payload);
	res.status(201).json({ success: true, user });
};

export const listUsersController = async (req, res) => {
	const users = await listUsers(req.query || {});
	res.json({ success: true, users });
};

export const getUserController = async (req, res) => {
	const { id } = req.params;
	const user = await getUserById(id);
	if (!user) return res.status(404).json({ success: false, message: "User not found" });
	res.json({ success: true, user });
};

export const updateUserController = async (req, res) => {
	const { id } = req.params;
	const updates = req.body;
	const user = await updateUser(id, updates);
	res.json({ success: true, user });
};

export const deleteUserController = async (req, res) => {
	const { id } = req.params;
	await softDeleteUser(id, req.user ? req.user._id : null);
	res.json({ success: true, message: "User deleted" });
};

// Student controllers
export const listStudentsController = async (req, res) => {
	const users = await listStudents(req.query || {});
	res.json({ success: true, users });
};

export const createStudentController = async (req, res) => {
	const requesterRole = req.user?.role;
	const requesterOrganizationId = req.user?.organizationId || null;

	if (requesterRole !== "ORGANIZATION" && requesterRole !== "IQPATH_ADMIN") {
		return res.status(403).json({ success: false, message: "Forbidden" });
	}

	const payload = { ...req.body, role: "STUDENT", status: req.body.status || "ACTIVE" };

	if (requesterRole === "ORGANIZATION") {
		if (!requesterOrganizationId) {
			return res.status(400).json({ success: false, message: "Organization user has no organization mapped" });
		}
		payload.organizationId = requesterOrganizationId;
	}

	if (requesterRole === "IQPATH_ADMIN") {
		payload.organizationId = req.body.organizationId || null;
	}

	if (!payload.email) {
		return res.status(400).json({ success: false, message: "Student email is required" });
	}
	if (!payload.organizationId) {
		return res.status(400).json({ success: false, message: "organizationId is required" });
	}
	const user = await createStudent(payload);
	res.status(201).json({ success: true, user });
};

export const getStudentController = async (req, res) => {
	const { id } = req.params;
	const user = await getUserById(id);
	if (!user || user.role !== "STUDENT") return res.status(404).json({ success: false, message: "Student not found" });
	res.json({ success: true, user });
};

export const updateStudentController = async (req, res) => {
	const { id } = req.params;
	const user = await updateUser(id, req.body);
	res.json({ success: true, user });
};

export const deleteStudentController = async (req, res) => {
	const { id } = req.params;
	await softDeleteUser(id, req.user ? req.user._id : null);
	res.json({ success: true, message: "Student deleted" });
};

// Organization controllers
export const listOrganizationsController = async (req, res) => {
	const orgs = await listOrganizations(req.query || {});
	res.json({ success: true, organizations: orgs });
};

export const createOrganizationController = async (req, res) => {
	const adminId = req.user?._id || req.user?.id;
	const org = await createOrganization({ ...req.body, createdBy: adminId });
	res.status(201).json({ success: true, data: org, organization: org });
};

export const getOrganizationController = async (req, res) => {
	const { id } = req.params;
	const org = await getOrganizationById(id);
	if (!org) return res.status(404).json({ success: false, message: "Organization not found" });
	res.json({ success: true, organization: org });
};

export const updateOrganizationController = async (req, res) => {
	const { id } = req.params;
	const org = await updateOrganization(id, req.body);
	res.json({ success: true, organization: org });
};

export const deleteOrganizationController = async (req, res) => {
	const { id } = req.params;
	await deleteOrganization(id);
	res.json({ success: true, message: "Organization deleted" });
};

// Bulk upload users via Excel
export const bulkUploadUsersController = async (req, res) => {
	const file = req.file || (req.files && req.files.file && req.files.file[0]);
	if (!file || !file.buffer) return res.status(400).json({ success: false, message: "Excel file is required" });

	const requesterRole = req.user?.role;
	const requesterOrganizationId = req.user?.organizationId || null;

	let organizationId = req.body.organizationId || null;
	const organizationCode = req.body.organizationCode || null;

	if (requesterRole === "ORGANIZATION") {
		if (!requesterOrganizationId) {
			return res.status(400).json({ success: false, message: "Organization user has no organization mapped" });
		}
		organizationId = requesterOrganizationId;
	}
	
	// Handle FormData organizationId (string from form field)
	if (organizationId && typeof organizationId === "string" && organizationId.trim()) {
		organizationId = organizationId.trim();
	}

	if (requesterRole === "IQPATH_ADMIN" && !organizationId && !organizationCode) {
		return res.status(400).json({ success: false, message: "organizationId or organizationCode is required" });
	}

	let rows = [];
	try {
		if (file.mimetype === "text/csv" || file.mimetype === "application/csv" || file.originalname.endsWith('.csv')) {
			// Handle CSV
			const csvText = file.buffer.toString('utf-8');
			const workbook = xlsx.read(csvText, { type: "string" });
			const sheet = workbook.Sheets[workbook.SheetNames[0]];
			rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
		} else {
			// Handle Excel
			const workbook = xlsx.read(file.buffer, { type: "buffer" });
			const sheet = workbook.Sheets[workbook.SheetNames[0]];
			rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
		}
	} catch (error) {
		return res.status(400).json({ success: false, message: "Invalid file format" });
	}

	// rows expected to be array of objects with headers: firstName,lastName,email,password,phone,role,organizationCode
	const results = await createUsersFromArray(rows, { organizationId, organizationCode });

	res.status(200).json({ success: true, message: "Bulk upload completed", data: results, results });
};

// Generate and download user template Excel file
export const generateUserTemplateController = async (req, res) => {
	const buffer = generateUserTemplate();

	res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
	res.setHeader("Content-Disposition", "attachment; filename=users_template.xlsx");
	res.send(buffer);
};
