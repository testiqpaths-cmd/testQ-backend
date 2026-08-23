import { User } from "../auth/index.js";
import Organization from "../../models/organization.model.js";
import Test from "../../models/test.model.js";
import TestSeries from "../../models/testSeries.model.js";
import TestAttempt from "../../models/testAttempt.model.js";
import { findAttemptsByStudent } from "../analytics/test-attempt/repository/testAttempt.repository.js";
import { syncMissedAttemptsForStudent } from "../test-attempts/services/syncMissedAttempts.service.js";
import { computeTestStatus } from "../test-management/utils/status.js";
import { asyncHandler as _ } from "../../common/utils/asyncHandler.js";
import {
	createUser,
	getUserById,
	updateUser,
	softDeleteUser,
	listUsers,
	listStudents,
	getStudentEducationFilterOptions,
	createStudent,
	createUsersFromArray,
	listOrganizations,
	createOrganization,
	getOrganizationById,
	updateOrganization,
	deleteOrganization,
	assertStudentLimitNotExceeded,
} from "./user.service.js";
import xlsx from "xlsx";
import { generateUserTemplate } from "./template/generate-userTemplate.js";
import sendEmail from "../../config/email.js";
import { loginTemplate } from "../../template/login.template.js";
import env from "../../config/env.js";

// Resolve the requester's own organizationId, falling back to a DB lookup
// for tokens issued before organizationId was embedded in the JWT payload.
const resolveRequesterOrgId = async (req) => {
	if (req.user?.organizationId) return String(req.user.organizationId);
	const dbUser = await getUserById(req.user._id);
	return dbUser?.organizationId ? String(dbUser.organizationId._id || dbUser.organizationId) : null;
};

// A caller may access a given target user record only if: they are a
// platform admin, the record is their own, or they are the ORGANIZATION
// account that the target STUDENT is registered under. This is the single
// place that enforces org-to-org data isolation for the generic/student
// by-id endpoints below — every GET/PUT/DELETE on a specific user must run
// through it before touching the record.
const assertUserAccess = async (req, res, targetUser) => {
	if (!targetUser) {
		res.status(404).json({ success: false, message: "User not found" });
		return false;
	}
	if (req.user.role === "IQPATH_ADMIN") return true;
	if (String(req.user._id) === String(targetUser._id)) return true;
	if (req.user.role === "ORGANIZATION" && targetUser.role === "STUDENT") {
		const requesterOrgId = await resolveRequesterOrgId(req);
		const targetOrgId = targetUser.organizationId
			? String(targetUser.organizationId._id || targetUser.organizationId)
			: null;
		if (requesterOrgId && targetOrgId && requesterOrgId === targetOrgId) return true;
	}
	res.status(403).json({ success: false, message: "Forbidden" });
	return false;
};

// Fields only IQPATH_ADMIN may set via update — otherwise a self-edit or an
// org editing "their" student could escalate role or move the record into a
// different organization's scope.
const stripPrivilegedFields = (updates, requesterRole) => {
	if (requesterRole === "IQPATH_ADMIN") return updates;
	const { role, organizationId, isDeleted, deletedAt, deletedBy, ...safeUpdates } = updates || {};
	return safeUpdates;
};

const sendWelcomeEmail = async (user, password) => {
	if (!user?.email) return;
	const loginUrl = (env.CORS_ORIGIN || "http://localhost:5173") + "/login";
	const emailHtml = loginTemplate({
		firstName: user.firstName,
		email: user.email,
		password: password || "change_me",
		loginUrl,
	});
	const textContent = `Welcome to TestQ!\n\nEmail: ${user.email}\nPassword: ${password || "change_me"}\nLogin: ${loginUrl}`;

	await sendEmail({
		to: user.email,
		subject: "Welcome to TestQ - Your Account Credentials",
		html: emailHtml,
		textContent,
	});
};

// Generic user CRUD
export const createUserController = async (req, res) => {
	const payload = { ...req.body };

	// The "Create User" page is also how an ORGANIZATION admin adds a
	// student — without this, the request went straight to createUser()
	// with whatever role/organizationId the client sent (or none at all),
	// so the new user was saved with organizationId: null and could never
	// match the org-scoped filter listUsersController applies, making it
	// permanently invisible on the User Management page despite the create
	// succeeding. Force it the same way createStudentController already does.
	if (req.user?.role === "ORGANIZATION") {
		let requesterOrganizationId = req.user.organizationId || null;
		if (!requesterOrganizationId) {
			const dbUser = await getUserById(req.user._id);
			requesterOrganizationId = dbUser?.organizationId?._id ?? dbUser?.organizationId ?? null;
		}
		if (!requesterOrganizationId) {
			return res.status(400).json({ success: false, message: "Organization user has no organization mapped" });
		}

		await assertStudentLimitNotExceeded(requesterOrganizationId, 1);

		payload.role = "STUDENT";
		payload.organizationId = requesterOrganizationId;
	}

	const user = await createUser(payload);
	try {
		await sendWelcomeEmail(user, payload.password);
	} catch (emailErr) {
		console.error(`Failed to send welcome email to ${user.email}:`, emailErr);
	}
	res.status(201).json({ success: true, user });
};

export const listUsersController = async (req, res) => {
	const query = req.query || {};
	
	// Role-based scoping
	if (req.user && req.user.role === "ORGANIZATION") {
		// Organizations can only list their own students
		let orgId = req.user.organizationId || null;
		// Fallback: if organizationId not in token, fetch from DB
		if (!orgId) {
			const dbUser = await getUserById(req.user._id);
			orgId = dbUser?.organizationId ?? null;
		}
		query.organizationId = orgId;
		query.role = "STUDENT";
	}

	const users = await listUsers(query);
	res.json({ success: true, users });
};

export const getUserController = async (req, res) => {
	const { id } = req.params;
	const user = await getUserById(id);
	if (!(await assertUserAccess(req, res, user))) return;

	const data = { ...user };

	if (user.role === "STUDENT") {
		// Sync missed attempts first
		await syncMissedAttemptsForStudent(id);
		// Get all attempts/tests given
		const attempts = await findAttemptsByStudent(id, { includeIQRoom: true });
		data.attempts = attempts || [];
		data.testsGivenCount = (attempts || []).filter(a => a.status !== "missed").length;
	} else if (user.role === "ORGANIZATION") {
		const orgId = user.organizationId;
		// These three don't depend on each other — fetch in parallel instead
		// of one round-trip at a time.
		const [orgStudents, orgTests, orgSeries] = await Promise.all([
			// Students registered in organization
			User.find({
				role: "STUDENT",
				organizationId: orgId,
				isDeleted: false
			}).select("firstName lastName email status createdAt").lean(),

			// Tests created by organization user — the full docs (not just a
			// count), so admin can drill into "which tests are active/upcoming"
			// without a second round-trip.
			Test.find({
				"createdBy.userId": user._id,
				isDeleted: { $ne: 1 }
			}).select("title scheduleType startTime endTime isPublished createdAt").sort({ createdAt: -1 }).lean(),

			// Series created by organization user
			TestSeries.find({
				"createdBy.userId": user._id
			}).select("title tests createdAt").sort({ createdAt: -1 }).lean(),
		]);

		data.students = orgStudents || [];

		// `status` on the Test doc is only (re)computed at create/publish/
		// update time (see computeTestStatus) — nothing recomputes it as real
		// time passes, so a FIXED-schedule test whose window opened/closed
		// since it was last saved would sit with a stale status here. Derive
		// it fresh instead, same as the dashboard's live counts do.
		const testsWithLiveStatus = orgTests.map((test) => ({
			id: test._id,
			title: test.title,
			status: computeTestStatus(test),
			scheduleType: test.scheduleType,
			startTime: test.startTime,
			endTime: test.endTime,
			createdAt: test.createdAt,
		}));

		const countByStatus = (list, status) => list.filter((item) => item.status === status).length;

		data.testReport = {
			totals: {
				total: testsWithLiveStatus.length,
				active: countByStatus(testsWithLiveStatus, "ACTIVE"),
				upcoming: countByStatus(testsWithLiveStatus, "UPCOMING"),
				completed: countByStatus(testsWithLiveStatus, "COMPLETED"),
				draft: countByStatus(testsWithLiveStatus, "DRAFT"),
			},
			tests: testsWithLiveStatus,
		};
		data.testsCreatedCount = testsWithLiveStatus.length;

		// A TestSeries has no status of its own — roll one up from its member
		// tests' live status: ACTIVE if anything in it is happening right now,
		// else UPCOMING if something hasn't started yet, else COMPLETED once
		// everything in it has finished, else DRAFT (nothing published yet).
		const testStatusById = new Map(testsWithLiveStatus.map((test) => [String(test.id), test.status]));
		const seriesWithLiveStatus = orgSeries.map((s) => {
			const memberStatuses = (s.tests || [])
				.map((testId) => testStatusById.get(String(testId)))
				.filter(Boolean);

			let status = "DRAFT";
			if (memberStatuses.includes("ACTIVE")) status = "ACTIVE";
			else if (memberStatuses.includes("UPCOMING")) status = "UPCOMING";
			else if (memberStatuses.length > 0 && memberStatuses.every((st) => st === "COMPLETED")) status = "COMPLETED";

			return {
				id: s._id,
				title: s.title,
				testCount: (s.tests || []).length,
				status,
				createdAt: s.createdAt,
			};
		});

		data.seriesReport = {
			totals: {
				total: seriesWithLiveStatus.length,
				active: countByStatus(seriesWithLiveStatus, "ACTIVE"),
				upcoming: countByStatus(seriesWithLiveStatus, "UPCOMING"),
				completed: countByStatus(seriesWithLiveStatus, "COMPLETED"),
				draft: countByStatus(seriesWithLiveStatus, "DRAFT"),
			},
			series: seriesWithLiveStatus,
		};
		data.seriesCreatedCount = seriesWithLiveStatus.length;
	}

	res.json({ success: true, user: data });
};

export const updateUserController = async (req, res) => {
	const { id } = req.params;
	const target = await getUserById(id);
	if (!(await assertUserAccess(req, res, target))) return;

	const updates = stripPrivilegedFields(req.body, req.user.role);

	// Admin accounts are never blockable — enforced here (not just hidden in
	// the UI) since this is the actual authority boundary; a crafted request
	// straight to this endpoint must be rejected the same way.
	if (target.role === "IQPATH_ADMIN" && updates.status && updates.status !== "ACTIVE") {
		return res.status(403).json({ success: false, message: "Admin accounts cannot be blocked." });
	}

	const user = await updateUser(id, updates);
	res.json({ success: true, user });
};

export const deleteUserController = async (req, res) => {
	const { id } = req.params;
	const target = await getUserById(id);
	if (!(await assertUserAccess(req, res, target))) return;

	await softDeleteUser(id, req.user ? req.user._id : null);
	res.json({ success: true, message: "User deleted" });
};

export const listStudentsController = async (req, res) => {
	const query = req.query || {};
	
	if (req.user && req.user.role === "ORGANIZATION") {
		let orgId = req.user.organizationId || null;
		// Fallback: if organizationId not in token, fetch from DB
		if (!orgId) {
			const dbUser = await getUserById(req.user._id);
			orgId = dbUser?.organizationId ?? null;
		}
		query.organizationId = orgId;
	}

	const users = await listStudents(query);
	res.json({ success: true, users });
};

export const getStudentEducationFilterOptionsController = async (req, res) => {
	let organizationId = null;

	if (req.user && req.user.role === "ORGANIZATION") {
		organizationId = req.user.organizationId || null;
		if (!organizationId) {
			const dbUser = await getUserById(req.user._id);
			organizationId = dbUser?.organizationId ?? null;
		}
	}

	const options = await getStudentEducationFilterOptions(organizationId);
	res.json({ success: true, data: options });
};

export const createStudentController = async (req, res) => {
	const requesterRole = req.user?.role;
	let requesterOrganizationId = req.user?.organizationId || null;

	if (requesterRole !== "ORGANIZATION" && requesterRole !== "IQPATH_ADMIN") {
		return res.status(403).json({ success: false, message: "Forbidden" });
	}

	const payload = { ...req.body, role: "STUDENT", status: req.body.status || "ACTIVE" };

	if (requesterRole === "ORGANIZATION") {
		// Fallback: resolve organizationId from DB if not present in token
		if (!requesterOrganizationId) {
			const dbUser = await getUserById(req.user._id);
			requesterOrganizationId = dbUser?.organizationId ?? null;
		}
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
	if (!payload.organizationId && requesterRole !== "IQPATH_ADMIN") {
		return res.status(400).json({ success: false, message: "organizationId is required" });
	}

	// Applies regardless of whether it's the org itself or an admin adding a
	// student on the org's behalf — the cap is on the organization, not on
	// who's doing the adding.
	if (payload.organizationId) {
		await assertStudentLimitNotExceeded(payload.organizationId, 1);
	}

	const user = await createStudent(payload);
	try {
		await sendWelcomeEmail(user, payload.password);
	} catch (emailErr) {
		console.error(`Failed to send welcome email to ${user.email}:`, emailErr);
	}
	res.status(201).json({ success: true, user });
};

export const getStudentController = async (req, res) => {
	const { id } = req.params;
	const user = await getUserById(id);
	if (!user || user.role !== "STUDENT") return res.status(404).json({ success: false, message: "Student not found" });
	if (!(await assertUserAccess(req, res, user))) return;
	res.json({ success: true, user });
};

export const updateStudentController = async (req, res) => {
	const { id } = req.params;
	const target = await getUserById(id);
	if (!target || target.role !== "STUDENT") return res.status(404).json({ success: false, message: "Student not found" });
	if (!(await assertUserAccess(req, res, target))) return;

	const updates = stripPrivilegedFields(req.body, req.user.role);
	const user = await updateUser(id, updates);
	res.json({ success: true, user });
};

export const deleteStudentController = async (req, res) => {
	const { id } = req.params;
	const target = await getUserById(id);
	if (!target || target.role !== "STUDENT") return res.status(404).json({ success: false, message: "Student not found" });
	if (!(await assertUserAccess(req, res, target))) return;

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
	let requesterOrganizationId = req.user?.organizationId || null;

	let organizationId = req.body.organizationId || null;
	const organizationCode = req.body.organizationCode || null;

	if (requesterRole === "ORGANIZATION") {
		// Fallback: resolve organizationId from DB if not present in token (handles old tokens)
		if (!requesterOrganizationId) {
			const dbUser = await getUserById(req.user._id);
			requesterOrganizationId = dbUser?.organizationId ?? null;
		}
		if (!requesterOrganizationId) {
			return res.status(400).json({ success: false, message: "Organization user has no organization mapped" });
		}
		organizationId = requesterOrganizationId;
	}
	
	// Handle FormData organizationId (string from form field)
	if (organizationId && typeof organizationId === "string" && organizationId.trim()) {
		organizationId = organizationId.trim();
	}

	// IQPATH_ADMIN is allowed to upload users without an organization Code/Id

	let rows = [];
	try {
		if (file.mimetype === "text/csv" || file.mimetype === "application/csv" || file.originalname.endsWith('.csv')) {
			// Handle CSV
			const csvText = file.buffer.toString('utf-8');
			const workbook = xlsx.read(csvText, { type: "string" });
			const sheet = workbook.Sheets[workbook.SheetNames[0]];
			// raw:false — read each cell's display text rather than letting xlsx
			// reinterpret numeric-looking values (a password or phone number
			// typed with a leading zero, e.g. "0912345") as a JS number, which
			// silently drops the leading zero and changes the actual value.
			rows = xlsx.utils.sheet_to_json(sheet, { defval: "", raw: false });
		} else {
			// Handle Excel
			const workbook = xlsx.read(file.buffer, { type: "buffer" });
			const sheet = workbook.Sheets[workbook.SheetNames[0]];
			// raw:false — read each cell's display text rather than letting xlsx
			// reinterpret numeric-looking values (a password or phone number
			// typed with a leading zero, e.g. "0912345") as a JS number, which
			// silently drops the leading zero and changes the actual value.
			rows = xlsx.utils.sheet_to_json(sheet, { defval: "", raw: false });
		}
	} catch (error) {
		return res.status(400).json({ success: false, message: "Invalid file format" });
	}

	// Enforce the organization's student limit for bulk uploads
	if (requesterRole === "ORGANIZATION") {
		await assertStudentLimitNotExceeded(requesterOrganizationId, rows.length);
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
