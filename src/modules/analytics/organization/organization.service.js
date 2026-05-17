import crypto from "crypto";
import { getOrganizationAnalyticsRepo } from "../repository/organization.repository.js";
import Organization from "../../../models/organization.model.js";
import { createUser } from "../../user/user.service.js";

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
  } = payload;

  const codeBase = (organizationName || "org").trim().replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "ORG";
  const code = `${codeBase}_${crypto.randomBytes(3).toString("hex")}`;

  const organization = await Organization.create({
    name: organizationName,
    contactEmail,
    code,
    createdBy: createdBy || undefined,
  });

  const [firstName, ...rest] = (contactPerson || "").trim().split(" ");
  const lastName = rest.join(" ");
  const defaultPassword = crypto.randomBytes(8).toString("hex");

  const organizationUser = await createUser({
    firstName: firstName || organizationName,
    lastName,
    email: contactEmail,
    password: defaultPassword,
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