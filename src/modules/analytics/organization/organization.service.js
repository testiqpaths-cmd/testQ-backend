import crypto from "crypto";
import { getOrganizationAnalyticsRepo } from "../repository/organization.repository.js";
import Organization from "../../../models/organization.model.js";
import { createUser } from "../../user/user.service.js";
import { ApiError } from "../../../common/exceptions/ApiError.js";

export const getOrganizationAnalyticsService = async ({ orgId, startDate, endDate }) => {
  try {
    const analytics = await getOrganizationAnalyticsRepo({
      orgId,
      startDate,
      endDate,
    });

    return analytics;
  } catch (error) {
    console.error("Error in getOrganizationAnalyticsService:", error);
    throw new Error("Failed to fetch organization analytics");
  }
};

export const createOrganizationService = async (payload) => {
  const {
    organizationName,
    contactPerson,
    contactEmail,
    businessPhone,
    plan,
    createdBy,
    password,
    studentLimit,
  } = payload;

  // The "Create Organization" form collects a login password and sends it
  // here — without this check, a missing password was silently replaced
  // with an unguessable random string that was never shown or emailed to
  // anyone, so the org could never log in no matter what they typed.
  if (!contactEmail || !password) {
    throw new ApiError(400, "A contact email and password are required to create the organization's login account.");
  }

  const codeBase = (organizationName || "org").trim().replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "ORG";
  const code = `${codeBase}_${crypto.randomBytes(3).toString("hex")}`;

  // Empty string / undefined means "no limit set" (unlimited) — only reject
  // an actual invalid number, don't force every org creator to pick one.
  let normalizedStudentLimit = null;
  if (studentLimit !== undefined && studentLimit !== null && studentLimit !== "") {
    const parsed = Number(studentLimit);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new ApiError(400, "Student limit must be a non-negative number.");
    }
    normalizedStudentLimit = Math.floor(parsed);
  }

  const organization = await Organization.create({
    name: organizationName,
    contactEmail,
    contactPerson,
    businessPhone,
    code,
    studentLimit: normalizedStudentLimit,
    createdBy: createdBy || undefined,
  });

  const [firstName, ...rest] = (contactPerson || "").trim().split(" ");
  const lastName = rest.join(" ");

  const organizationUser = await createUser({
    firstName: firstName || organizationName,
    lastName,
    email: contactEmail,
    password,
    phone: businessPhone || "",
    role: "ORGANIZATION",
    status: "ACTIVE",
    organizationId: organization._id,
    plan: plan || "FREE",
    isEmailVerified: false,
  });

  organization.admins = [organizationUser._id];
  await organization.save();

  return organization;
};