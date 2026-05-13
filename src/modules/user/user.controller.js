import { User } from "../auth/index.js";
import Organization from "../../models/organization.model.js";
import { asyncHandler as _ } from "../../common/utils/asyncHandler.js";
import {
	createUser,
	getUserById,
	updateUser,
	softDeleteUser,
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

// Generic user CRUD
export const createUserController = async (req, res) => {
	const payload = req.body;
	const user = await createUser(payload);
	res.status(201).json({ success: true, user });
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
	const payload = { ...req.body, role: "STUDENT" };
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
	const org = await createOrganization(req.body);
	res.status(201).json({ success: true, organization: org });
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
	if (!req.file || !req.file.buffer) return res.status(400).json({ success: false, message: "Excel file is required" });

	const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
	const sheet = workbook.Sheets[workbook.SheetNames[0]];
	const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

	// rows expected to be array of objects with headers: firstName,lastName,email,password,phone,role,organizationCode
	const results = await createUsersFromArray(rows);

	res.json({ success: true, results });
};
