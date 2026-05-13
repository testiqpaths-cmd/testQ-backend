import bcrypt from "bcryptjs";
import UserModel from "../../models/user.model.js";
import Organization from "../../models/organization.model.js";

const hashPassword = async (password) => {
	if (!password) return undefined;
	const salt = await bcrypt.genSalt(10);
	return bcrypt.hash(password, salt);
};

export const createUser = async (payload) => {
	const data = { ...payload };
	if (data.password) data.password = await hashPassword(data.password);
	const user = await UserModel.create(data);
	return user;
};

export const getUserById = async (id) => {
	return UserModel.findById(id).where({ isDeleted: false }).lean();
};

export const updateUser = async (id, updates) => {
	if (updates.password) updates.password = await hashPassword(updates.password);
	return UserModel.findByIdAndUpdate(id, updates, { new: true });
};

export const softDeleteUser = async (id, deletedBy = null) => {
	return UserModel.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date(), deletedBy }, { new: true });
};

// Students are users with role STUDENT
export const listStudents = async (query = {}) => {
	const q = { role: "STUDENT", isDeleted: false };
	if (query.organizationId) q.organizationId = query.organizationId;
	return UserModel.find(q).lean();
};

export const createStudent = async (payload) => {
	return createUser({ ...payload, role: "STUDENT" });
};

// Organizations
export const listOrganizations = async (query = {}) => {
	const q = {};
	if (query.name) q.name = { $regex: query.name, $options: "i" };
	return Organization.find(q).lean();
};

export const createOrganization = async (payload) => {
	const org = await Organization.create(payload);
	return org;
};

export const getOrganizationById = async (id) => {
	return Organization.findById(id).lean();
};

export const updateOrganization = async (id, updates) => {
	return Organization.findByIdAndUpdate(id, updates, { new: true });
};

export const deleteOrganization = async (id) => {
	return Organization.findByIdAndDelete(id);
};

// Bulk create users from parsed rows
export const createUsersFromArray = async (rows = []) => {
	const results = [];
	for (const row of rows) {
		try {
			const firstName = (row.firstName || row.first_name || row.FirstName || "").toString().trim();
			const lastName = (row.lastName || row.last_name || row.LastName || "").toString().trim();
			const email = (row.email || row.Email || "").toString().trim().toLowerCase();
			const password = row.password || "change_me";
			const phone = row.phone || row.mobile || "";
			const role = (row.role || "STUDENT").toString().trim().toUpperCase() || "STUDENT";
			const organizationCode = row.organizationCode || row.organization_code || row.orgCode || null;

			let organizationId = null;
			if (organizationCode) {
				let org = await Organization.findOne({ code: organizationCode });
				if (!org) {
					org = await Organization.create({ name: organizationCode, code: organizationCode });
				}
				organizationId = org._id;
			}

			const user = await createUser({ firstName, lastName, email, password, phone, role, organizationId, status: "ACTIVE", isEmailVerified: true });
			results.push({ email, status: "created", id: user._id });
		} catch (err) {
			results.push({ row, status: "error", message: err.message });
		}
	}
	return results;
};

