import * as service from "./helpSupport.service.js";
import UserModel from "../../models/user.model.js";

// Fall back to a DB lookup for tokens issued before organizationId was
// embedded in the JWT payload — without this, ORGANIZATION-role requests
// below fell back to the user's own _id (never a real organizationId),
// which silently broke "my org's support tickets" rather than leaking data,
// but is still wrong.
const resolveOrganizationId = async (user) => {
  if (user.organizationId) return user.organizationId;
  const dbUser = await UserModel.findById(user._id).select("organizationId").lean();
  return dbUser?.organizationId ?? null;
};

export const createHelpSupportController = async (req, res) => {
  try {
    const { fullName, email, subject, message } = req.body;
    const studentId = req.user._id;
    const organizationId = await resolveOrganizationId(req.user);

    const query = await service.createHelpSupport({
      studentId,
      organizationId,
      fullName,
      email,
      subject,
      message,
    });

    return res.status(201).json({ success: true, data: query });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getHelpSupportsController = async (req, res) => {
  try {
    const { role, _id } = req.user;
    let filters = {};

    if (role === "STUDENT") {
      filters.studentId = _id;
    } else if (role === "ORGANIZATION") {
      filters.organizationId = await resolveOrganizationId(req.user);
    } else if (role === "IQPATH_ADMIN") {
      // IQPATH_ADMIN sees everything
      filters = {};
    }

    const queries = await service.getHelpSupports(filters);
    return res.json({ success: true, data: queries });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const resolveHelpSupportController = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.user;

    if (role === "STUDENT") {
      return res.status(403).json({ success: false, message: "Forbidden: Students cannot resolve queries" });
    }

    const query = await service.getHelpSupportById(id);
    if (!query) {
      return res.status(404).json({ success: false, message: "Query not found" });
    }

    if (role === "ORGANIZATION") {
      const userOrgId = await resolveOrganizationId(req.user);
      if (!userOrgId || String(query.organizationId) !== String(userOrgId)) {
        return res.status(403).json({ success: false, message: "Forbidden: Not your organization's query" });
      }
    }

    const resolvedQuery = await service.resolveHelpSupport(id);
    return res.json({ success: true, data: resolvedQuery });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
