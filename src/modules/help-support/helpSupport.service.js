import HelpSupport from "./helpSupport.model.js";
import { dispatchNotificationToAdminsAndOrgs } from "../notification/notification.service.js";
import Notification from "../notification/notification.model.js";

export const createHelpSupport = async (data) => {
  const helpSupport = await HelpSupport.create(data);

  dispatchNotificationToAdminsAndOrgs(helpSupport.organizationId || null, {
    title: "New Help & Support Query",
    message: `A new query has been raised regarding: ${helpSupport.subject || "General Inquiry"}.`,
    type: "SYSTEM",
    link: `/dashboard/help-support`,
    metadata: { helpSupportId: helpSupport._id }
  });

  return helpSupport;
};

export const getHelpSupports = async (filters) => {
  return await HelpSupport.find(filters)
    .populate("studentId", "firstName lastName email")
    .populate("organizationId", "name")
    .sort({ createdAt: -1 })
    .lean();
};

export const getHelpSupportById = async (id) => {
  return await HelpSupport.findById(id).lean();
};

export const resolveHelpSupport = async (id) => {
  const helpSupport = await HelpSupport.findByIdAndUpdate(
    id,
    { status: "resolved" },
    { new: true }
  );

  if (helpSupport && helpSupport.studentId) {
    await Notification.create({
      userId: helpSupport.studentId,
      title: "Query Resolved",
      message: `Your help & support query regarding "${helpSupport.subject || "General Inquiry"}" has been resolved.`,
      type: "SYSTEM",
      link: null,
      metadata: { helpSupportId: helpSupport._id }
    });
  }

  return helpSupport;
};
