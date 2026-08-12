import bcrypt from "bcryptjs";
import crypto from "crypto";
import UserModel from "../../models/user.model.js";
import Organization from "../../models/organization.model.js";
import UserSubscription from "../subscription/models/UserSubscription.model.js";
import sendEmail from "../../config/email.js";
import { loginTemplate } from "../../template/login.template.js";
import env from "../../config/env.js";
import { ApiError } from "../../common/exceptions/ApiError.js";

const hashPassword = async (password) => {
	if (!password) return undefined;
	// Must match login()'s normalizeRequiredString (auth.service.js), which
	// trims the password before bcrypt.compare. Without trimming here too,
	// any accidental leading/trailing whitespace (very easy to introduce via
	// copy-paste, which is how an admin is likely to enter a generated
	// password when creating an organization/user account) gets baked into
	// the hash but stripped at login — a guaranteed "Invalid credentials"
	// even with the "same" password.
	const trimmed = String(password).trim();
	const salt = await bcrypt.genSalt(10);
	return bcrypt.hash(trimmed, salt);
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
	return UserModel.create(data);
};

// Organization student caps are a direct per-org number set at creation time
// (Organization.studentLimit), not the subscription/plan system — plans only
// govern independent students. A null/unset limit means unlimited, so
// existing organizations created before this field existed keep working
// exactly as before.
export const assertStudentLimitNotExceeded = async (organizationId, additionalCount = 1) => {
	if (!organizationId) return;

	const org = await Organization.findById(organizationId).select("studentLimit name").lean();
	if (!org || org.studentLimit === null || org.studentLimit === undefined) return;

	const currentCount = await UserModel.countDocuments({
		organizationId,
		role: "STUDENT",
		status: "ACTIVE",
	});

	if (currentCount + additionalCount > org.studentLimit) {
		const remaining = Math.max(0, org.studentLimit - currentCount);
		throw new ApiError(
			402,
			`Student limit reached for ${org.name || "this organization"}. You can add ${remaining} more student${remaining === 1 ? "" : "s"} (limit: ${org.studentLimit}).`
		);
	}
};

export const getUserById = async (id) => {
	return UserModel.findById(id)
		.where({ isDeleted: false })
		.populate("organizationId", "name code address contactEmail contactPerson businessPhone")
		.lean();
};

export const listUsers = async (query = {}) => {
	const q = { isDeleted: false };
	if (query.role && query.role !== "all") {
		q.role = Array.isArray(query.role) ? { $in: query.role } : query.role;
	}
	if (query.status && query.status !== "all") q.status = query.status;
	if (query.organizationId) q.organizationId = query.organizationId;
	if (query.search) {
		const search = new RegExp(query.search, "i");
		q.$or = [{ firstName: search }, { lastName: search }, { email: search }];
	}
	if (query.planId) {
		const subs = await UserSubscription.find({ planId: query.planId, status: "ACTIVE" }).select("userId").lean();
		q._id = { $in: subs.map((sub) => sub.userId) };
	}

	// Populate the organization's own name — for ORGANIZATION-role users, the
	// User document's firstName is the contact person's name, not the
	// organization's name, and the frontend list falls back to that name
	// whenever organizationId isn't populated with a `name`.
	const users = await UserModel.find(q).populate("organizationId", "name").lean();
	const activeSubs = await UserSubscription.find({ userId: { $in: users.map((u) => u._id) }, status: "ACTIVE" })
		.populate("planId", "name")
		.lean();

	const subMap = {};
	activeSubs.forEach((sub) => {
		subMap[sub.userId] = sub;
	});

	return users.map((u) => ({
		...u,
		activePlanName: subMap[u._id]?.planId?.name || "Free/Default",
	}));
};

export const updateUser = async (id, updates) => {
	if (updates.password) updates.password = await hashPassword(updates.password);
	return UserModel.findByIdAndUpdate(id, updates, { new: true });
};

export const softDeleteUser = async (id, deletedBy = null) => {
	return UserModel.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date(), deletedBy }, { new: true });
};

export const listStudents = async (query = {}) => {
	const q = { role: "STUDENT", isDeleted: false };
	if (query.organizationId) q.organizationId = query.organizationId;
	if (query.planId) {
		const subs = await UserSubscription.find({ planId: query.planId, status: "ACTIVE" }).select("userId").lean();
		q._id = { $in: subs.map((sub) => sub.userId) };
	}
	if (query.status) q.status = query.status;
	if (query.qualification) q["education.qualification"] = query.qualification;
	if (query.stream) q["education.stream"] = query.stream;
	if (query.college) q["education.college"] = query.college;
	if (query.search) {
		const search = new RegExp(query.search, "i");
		q.$or = [{ firstName: search }, { lastName: search }, { email: search }];
	}

	// Used unpaginated everywhere today (org/admin rosters, the test-visibility
	// student picker) — capped defensively so a very large org/admin roster
	// can't return an unbounded result set.
	const users = await UserModel.find(q).limit(1000).lean();
	const activeSubs = await UserSubscription.find({ userId: { $in: users.map((u) => u._id) }, status: "ACTIVE" })
		.populate("planId", "name")
		.lean();

	const subMap = {};
	activeSubs.forEach((sub) => {
		subMap[sub.userId] = sub;
	});

	return users.map((u) => ({
		...u,
		activePlanName: subMap[u._id]?.planId?.name || "Free/Default",
	}));
};

// Distinct education field values, used to populate the student-picker's
// filter dropdowns (test/series "Select Student" visibility) — scoped to an
// organization's own students when one is passed, or platform-wide for an
// admin's unrestricted picker.
export const getStudentEducationFilterOptions = async (organizationId = null) => {
	const match = { role: "STUDENT", isDeleted: false };
	if (organizationId) match.organizationId = organizationId;

	const [qualifications, streams, colleges] = await Promise.all([
		UserModel.distinct("education.qualification", { ...match, "education.qualification": { $nin: [null, ""] } }),
		UserModel.distinct("education.stream", { ...match, "education.stream": { $nin: [null, ""] } }),
		UserModel.distinct("education.college", { ...match, "education.college": { $nin: [null, ""] } }),
	]);

	return {
		qualifications: qualifications.sort(),
		streams: streams.sort(),
		colleges: colleges.sort(),
	};
};

export const createStudent = async (payload) => {
	return createUser({
		...payload,
		role: "STUDENT",
		password: payload.password || "change_me",
		status: payload.status || "ACTIVE",
	});
};

export const listOrganizations = async (query = {}) => {
	const q = {};
	if (query.name) q.name = { $regex: query.name, $options: "i" };
	return Organization.find(q).lean();
};

export const createOrganization = async (payload) => {
	const data = { ...payload };
	if (!data.name && data.organizationName) data.name = data.organizationName;
	if (!data.code) data.code = generateOrganizationCode(data.name || "ORG");
	if (!data.createdBy) delete data.createdBy;

	// Without both of these, no login-capable User document gets created below
	// — the Organization record would exist with no way to ever log in, and
	// the only symptom later is a generic "Invalid credentials" at login time
	// with no indication that no account was ever created. Fail loudly here
	// instead of silently producing an unusable organization.
	if (!data.contactEmail || !data.password) {
		throw new ApiError(
			400,
			"A contact email and password are required to create the organization's login account."
		);
	}

	const org = await Organization.create(data);

	await createUser({
		firstName: data.contactPerson || data.name,
		email: data.contactEmail,
		password: data.password,
		role: "ORGANIZATION",
		organizationId: org._id,
		status: "ACTIVE",
		plan: data.plan || "FREE",
	});

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

export const createUsersFromArray = async (rows = [], options = {}) => {
	const { organizationId: overrideOrganizationId = null, organizationCode: overrideOrganizationCode = null } = options;
	const results = [];

	for (const row of rows) {
		let rowEmail = "";
		try {
			const firstName = (row.firstName || row.first_name || row.FirstName || "").toString().trim();
			const lastName = (row.lastName || row.last_name || row.LastName || "").toString().trim();
			rowEmail = (row.email || row.Email || "").toString().trim().toLowerCase();

			if (!rowEmail && !firstName) continue;

			// Excel/CSV parsing (xlsx, raw mode) returns numeric-looking cells as
			// JS numbers, not strings — a password like "0912345" silently loses
			// its leading zero, and one that parses to exactly 0 (e.g. "000000")
			// would fail the old `row.password || "change_me"` truthiness check
			// and silently fall back to the placeholder instead. Stringify
			// explicitly and only fall back when the cell is genuinely empty.
			const password =
				row.password !== undefined && row.password !== null && row.password !== ""
					? String(row.password).trim()
					: "change_me";
			const phone = (row.phone || row.mobile || "").toString().trim();
			const role = (row.role || "STUDENT").toString().trim().toUpperCase() || "STUDENT";
			const organizationCode = overrideOrganizationCode || row.organizationCode || row.organization_code || row.orgCode || null;
			let organizationId = overrideOrganizationId;

			const plan = (row.plan || "FREE").toString().trim().toUpperCase();
			const rawVerified = row.isEmailVerified;
			const isEmailVerified = rawVerified === true || String(rawVerified).trim().toUpperCase() === "TRUE";

			const address = {};
			if (row.address_line1) address.line1 = row.address_line1.toString().trim();
			if (row.address_city) address.city = row.address_city.toString().trim();
			if (row.address_state) address.state = row.address_state.toString().trim();
			if (row.address_country) address.country = row.address_country.toString().trim();
			if (row.address_zipCode) address.zipCode = row.address_zipCode.toString().trim();

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
				if (!org) org = await Organization.create({ name: organizationCode, code: organizationCode });
				organizationId = org._id;
			}

			const userPayload = {
				firstName,
				lastName,
				email: rowEmail,
				password,
				role,
				organizationId,
				status: "ACTIVE",
				isEmailVerified,
				plan,
			};

			if (phone) userPayload.phone = phone;
			if (Object.keys(address).length > 0) userPayload.address = address;
			if (Object.keys(education).length > 0) userPayload.education = education;

			const existingUser = rowEmail
				? await UserModel.findOne({ email: rowEmail }).setOptions({ includeDeleted: true })
				: null;

			let user;
			let status = "created";

			if (existingUser?.isDeleted) {
				await UserModel.updateOne(
					{ _id: existingUser._id },
					{
						$set: {
							...userPayload,
							isDeleted: false,
							deletedAt: null,
							deletedBy: null,
						},
					},
				);
				user = await UserModel.findById(existingUser._id).lean();
				status = "restored";
			} else if (existingUser) {
				throw new Error(`Email "${rowEmail}" is already registered`);
			} else {
				user = await createUser(userPayload);
			}

			// Previously swallowed entirely (only console.error'd) — a bulk upload
			// would report every row as "created" with no way for the admin to
			// know a student's welcome email never went out (e.g. the email
			// provider rate-limiting mid-batch, which is very plausible sending
			// many transactional emails in a tight loop). Surface it per-row
			// instead so a failed send is visible and the admin knows who still
			// needs their credentials resent.
			let emailSent = false;
			let emailError = undefined;
			try {
				const loginUrl = (env.CORS_ORIGIN || "http://localhost:5173") + "/login";
				const emailHtml = loginTemplate({
					firstName: user.firstName,
					email: user.email,
					password,
					loginUrl,
				});
				const textContent = `Welcome to TestQ!\n\nEmail: ${user.email}\nPassword: ${password}\nLogin: ${loginUrl}`;

				await sendEmail({
					to: user.email,
					subject: "Welcome to TestQ - Your Account Credentials",
					html: emailHtml,
					textContent,
				});
				emailSent = true;
			} catch (emailErr) {
				console.error(`Failed to send email to ${user.email}:`, emailErr);
				emailError = emailErr.message || "Failed to send welcome email";
			}

			results.push({ email: rowEmail, status, id: user._id, emailSent, emailError });
		} catch (err) {
			let friendlyMessage = err.message;

			if (err.code === 11000) {
				const field = Object.keys(err.keyPattern || {})[0] || "";
				if (field === "email") {
					friendlyMessage = `Email "${rowEmail}" is already registered`;
				} else if (field === "phone") {
					friendlyMessage = `Phone number is already in use by another account`;
				} else {
					friendlyMessage = `A user with this ${field} already exists`;
				}
			}

			if (err.name === "ValidationError") {
				const fields = Object.keys(err.errors).join(", ");
				friendlyMessage = `Missing or invalid fields: ${fields}`;
			}

			results.push({ email: rowEmail, status: "error", message: friendlyMessage });
		}
	}

	return results;
};
