import bcrypt from "bcryptjs";
import crypto from "crypto";
import UserModel from "../../models/user.model.js";
import Organization from "../../models/organization.model.js";
import UserSubscription from "../subscription/models/UserSubscription.model.js";

const hashPassword = async (password) => {
	if (!password) return undefined;
	const salt = await bcrypt.genSalt(10);
	return bcrypt.hash(password, salt);
};

const generateOrganizationCode = (name = "ORG") => {
	const codeBase = name
		.toString()
		.trim()
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toUpperCase() || "ORG";
	return `${codeBase}_${crypto.randomBytes(3).toString("hex")}`;
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

export const listUsers = async (query = {}) => {
	const q = { isDeleted: false };
	if (query.role && query.role !== "all") {
		if (Array.isArray(query.role)) {
			q.role = { $in: query.role };
		} else {
			q.role = query.role;
		}
	}
	if (query.status && query.status !== "all") q.status = query.status;
	if (query.organizationId) q.organizationId = query.organizationId;
	if (query.search) {
		const search = new RegExp(query.search, "i");
		q.$or = [
			{ firstName: search },
			{ lastName: search },
			{ email: search },
		];
	}
	if (query.planId) {
		const subs = await UserSubscription.find({ planId: query.planId, status: "ACTIVE" }).select("userId").lean();
		const filterUserIds = subs.map(s => s.userId);
		q._id = { $in: filterUserIds };
	}
	
	const users = await UserModel.find(q).lean();
	
	const userIds = users.map(u => u._id);
	const activeSubs = await UserSubscription.find({ userId: { $in: userIds }, status: "ACTIVE" }).populate("planId", "name").lean();
	
	const subMap = {};
	activeSubs.forEach(sub => {
		subMap[sub.userId] = sub;
	});

	return users.map(u => ({
		...u,
		activePlanName: subMap[u._id]?.planId?.name || "Free/Default"
	}));
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
	if (query.planId) {
		const subs = await UserSubscription.find({ planId: query.planId, status: "ACTIVE" }).select("userId").lean();
		const filterUserIds = subs.map(s => s.userId);
		q._id = { $in: filterUserIds };
	}
	
	const users = await UserModel.find(q).lean();
	
	const userIds = users.map(u => u._id);
	const activeSubs = await UserSubscription.find({ userId: { $in: userIds }, status: "ACTIVE" }).populate("planId", "name").lean();
	
	const subMap = {};
	activeSubs.forEach(sub => {
		subMap[sub.userId] = sub;
	});

	return users.map(u => ({
		...u,
		activePlanName: subMap[u._id]?.planId?.name || "Free/Default"
	}));
};

export const createStudent = async (payload) => {
	const data = { 
		...payload, 
		role: "STUDENT", 
		password: payload.password || "change_me",
		status: payload.status || "ACTIVE"
	};
	return createUser(data);
};

// Organizations
export const listOrganizations = async (query = {}) => {
	const q = {};
	if (query.name) q.name = { $regex: query.name, $options: "i" };
	return Organization.find(q).lean();
};

export const createOrganization = async (payload) => {
	const data = { ...payload };
	if (!data.name && data.organizationName) {
		data.name = data.organizationName;
	}
	if (!data.code) {
		data.code = generateOrganizationCode(data.name || "ORG");
	}
	if (!data.createdBy) {
		delete data.createdBy;
	}
	const org = await Organization.create(data);
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
export const createUsersFromArray = async (rows = [], options = {}) => {
	const { organizationId: overrideOrganizationId = null, organizationCode: overrideOrganizationCode = null } = options;
	const results = [];
	for (const row of rows) {
		try {
			const firstName = (row.firstName || row.first_name || row.FirstName || "").toString().trim();
			const lastName = (row.lastName || row.last_name || row.LastName || "").toString().trim();
			const email = (row.email || row.Email || "").toString().trim().toLowerCase();
			const password = row.password || "change_me";
			const phone = row.phone || row.mobile || "";
			const role = (row.role || "STUDENT").toString().trim().toUpperCase() || "STUDENT";
			const organizationCode = overrideOrganizationCode || row.organizationCode || row.organization_code || row.orgCode || null;
			let organizationId = overrideOrganizationId;

			// Additional fields from template
			const plan = (row.plan || "FREE").toString().trim().toUpperCase();
			const isEmailVerified = (row.isEmailVerified || row.isEmailVerified === "TRUE" || row.isEmailVerified === true) ? true : false;

			// Address fields
			const address = {};
			if (row.address_line1) address.line1 = row.address_line1.toString().trim();
			if (row.address_city) address.city = row.address_city.toString().trim();
			if (row.address_state) address.state = row.address_state.toString().trim();
			if (row.address_country) address.country = row.address_country.toString().trim();
			if (row.address_zipCode) address.zipCode = row.address_zipCode.toString().trim();

			// Education fields
			const education = {};
			if (row.education_qualification) education.qualification = row.education_qualification.toString().trim();
			if (row.education_stream) education.stream = row.education_stream.toString().trim();
			if (row.education_passingYear) {
				const year = parseInt(row.education_passingYear);
				if (!isNaN(year) && year >= 1950 && year <= new Date().getFullYear() + 5) {
					education.passingYear = year;
				}
			}
			if (row.education_college) education.college = row.education_college.toString().trim();

			if (!organizationId && organizationCode) {
				let org = await Organization.findOne({ code: organizationCode });
				if (!org) {
					org = await Organization.create({ name: organizationCode, code: organizationCode });
				}
				organizationId = org._id;
			}

			const userPayload = {
				firstName,
				lastName,
				email,
				password,
				phone,
				role,
				organizationId,
				status: "ACTIVE",
				isEmailVerified,
				plan
			};

			// Only add address if it has values
			if (Object.keys(address).length > 0) {
				userPayload.address = address;
			}

			// Only add education if it has values
			if (Object.keys(education).length > 0) {
				userPayload.education = education;
			}

			const user = await createUser(userPayload);
			results.push({ email, status: "created", id: user._id });
		} catch (err) {
			results.push({ row, status: "error", message: err.message });
		}
	}
	return results;
};

