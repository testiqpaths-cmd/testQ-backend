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
