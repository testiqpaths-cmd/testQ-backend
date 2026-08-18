import mongoose from "mongoose";
import UserModel from "../../../models/user.model.js";

// An ORGANIZATION creator building an ORG_ONLY test/series picks organizations
// from a global "who can access this" list — nothing about that UI implies
// "add my own org too", so in practice an org almost never selects itself,
// and its own students then fail every "is my org in allowedOrganizations?"
// check (assigned-tests session grouping, visibility.middleware.js) even
// though the org obviously intends its own students to see it. Force the
// creator's own org into the list whenever it's missing, so "created by my
// org" always implies "visible to my org" without every consumer needing a
// separate "or same org as creator" special case.
export const ensureCreatorOrgIncluded = async (doc) => {
  if (!doc || doc.visibility !== "ORG_ONLY" || doc.createdBy?.role !== "ORGANIZATION") {
    return;
  }

  const creatorUserId = doc.createdBy?.userId;
  if (!creatorUserId) return;

  const creator = await UserModel.findById(creatorUserId).select("organizationId").lean();
  const orgId = creator?.organizationId ? String(creator.organizationId) : null;
  if (!orgId) return;

  const current = Array.isArray(doc.allowedOrganizations) ? doc.allowedOrganizations.map(String) : [];
  if (!current.includes(orgId)) {
    doc.allowedOrganizations = [...current, orgId];
  }
};

// SELECT_STUDENT visibility targets specific students the creator chose.
// An ORGANIZATION creator may only ever target its own org's students — the
// frontend already restricts the picker to the org's roster, but a crafted
// request could still name another org's student ids, so re-verify
// server-side instead of trusting whatever ids were sent. IQPATH_ADMIN may
// target any student. Returns the sanitized/verified id list to persist.
export const resolveAllowedStudents = async (visibility, allowedStudents, user) => {
  if (visibility !== "SELECT_STUDENT") return [];

  const ids = Array.isArray(allowedStudents)
    ? allowedStudents.filter((id) => mongoose.Types.ObjectId.isValid(id))
    : [];
  if (!ids.length) {
    throw new Error("Select at least one student for the 'Select Student' visibility option.");
  }

  const query = { _id: { $in: ids }, role: "STUDENT", isDeleted: false };

  if (user?.role === "ORGANIZATION") {
    let orgId = user.organizationId || null;
    if (!orgId) {
      const dbUser = await UserModel.findById(user._id || user.id).select("organizationId").lean();
      orgId = dbUser?.organizationId || null;
    }
    if (!orgId) throw new Error("Organization has no organization mapped.");
    query.organizationId = orgId;
  }

  const validIds = await UserModel.find(query).distinct("_id");
  if (!validIds.length) {
    throw new Error("None of the selected students are valid for your account.");
  }
  return validIds;
};

// A student registered under an organization must take every test that
// organization publishes — there's no opt-out, so the accept/decline choice
// (meant for tests the student was individually invited to) doesn't apply to
// these. This resolves, in one batched pass (no per-test lookup, since a
// student's assigned-tests list can be long), which of a given set of tests
// were created by the student's OWN organization: creatorUserId -> creator's
// organizationId (same id space an ORGANIZATION account's own User doc uses,
// see user.service.js's createOrganization) compared against the student's
// organizationId. Returns a Set of matching test id strings.
export const resolveMandatoryOrgTestIds = async (tests, studentOrganizationId) => {
  if (!studentOrganizationId) return new Set();

  const orgTests = tests.filter((t) => t.createdBy?.role === "ORGANIZATION" && t.createdBy?.userId);
  if (!orgTests.length) return new Set();

  const creatorUserIds = [...new Set(orgTests.map((t) => String(t.createdBy.userId)))];
  const creators = await UserModel.find({ _id: { $in: creatorUserIds } })
    .select("organizationId")
    .lean();
  const creatorOrgMap = new Map(
    creators.map((c) => [String(c._id), c.organizationId ? String(c.organizationId) : null])
  );

  const studentOrgId = String(studentOrganizationId);
  return new Set(
    orgTests
      .filter((t) => creatorOrgMap.get(String(t.createdBy.userId)) === studentOrgId)
      .map((t) => String(t._id))
  );
};

// Single-test version of resolveMandatoryOrgTestIds, for the decline/hide
// endpoints — a crafted request could call these directly, bypassing the
// list view's auto-accept, so the "no opt-out" rule needs to be re-checked
// server-side rather than relying on the UI hiding the buttons.
export const isTestMandatoryForStudent = async (test, studentOrganizationId) => {
  if (!studentOrganizationId || test?.createdBy?.role !== "ORGANIZATION" || !test.createdBy?.userId) {
    return false;
  }
  const creator = await UserModel.findById(test.createdBy.userId).select("organizationId").lean();
  return Boolean(creator?.organizationId) && String(creator.organizationId) === String(studentOrganizationId);
};
