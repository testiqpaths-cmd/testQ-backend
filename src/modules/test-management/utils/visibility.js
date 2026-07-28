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
