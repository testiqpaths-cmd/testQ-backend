import * as service from "./contactUs.service.js";
import UserModel from "../../models/user.model.js";

const resolveOrganizationId = async (user) => {
  if (!user) return null;
  if (user.organizationId) return user.organizationId;
  const dbUser = await UserModel.findById(user._id).select("organizationId").lean();
  return dbUser?.organizationId ?? null;
};

export const createContactUsController = async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    const userId = req.user?._id ?? null;
    const organizationId = await resolveOrganizationId(req.user);

    const entry = await service.createContactUs({ name, email, subject, message, userId, organizationId });
    return res.status(201).json({ success: true, data: entry });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getContactUsController = async (req, res) => {
  try {
    const { role, _id } = req.user;
    let filters = {};

    if (role === "ORGANIZATION") {
      filters.organizationId = await resolveOrganizationId(req.user);
    } else if (role === "STUDENT") {
      // Students can only see messages they created
      filters.userId = _id;
    }

    const items = await service.getContactUs(filters);
    return res.json({ success: true, data: items });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteContactUsController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await service.deleteContactUsById(id);
    if (!deleted) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: deleted });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
