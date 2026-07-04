import Notification from "./notification.model.js";
import { listStudents, listUsers } from "../user/user.service.js";

export const createNotification = async (data) => {
  return await Notification.create(data);
};

export const getNotifications = async (userId) => {
  return await Notification.find({ userId }).sort({ createdAt: -1 });
};

// Secure version (IMPORTANT FIX)
export const markNotificationRead = async (id, userId) => {
  return await Notification.findOneAndUpdate(
    { _id: id, userId },   // 👈 ownership check added
    { isRead: true },
    { new: true }
  );
};

// Optional (recommended for your project)
export const markAllNotificationsRead = async (userId) => {
  return await Notification.updateMany(
    { userId, isRead: false },
    { isRead: true }
  );
};

export const deleteNotification = async (id, userId) => {
  return await Notification.findOneAndDelete({ _id: id, userId });
};

export const deleteAllNotifications = async (userId) => {
  return await Notification.deleteMany({ userId });
};

/**
 * Generic helper to dispatch notifications to students
 * Call this when a Test, Test Series, or Result is published.
 * 
 * @param {Object} creator - The user who triggered the event (must have role and optionally organizationId)
 * @param {Object} notificationPayload - { title, message, type, link, metadata }
 */
export const dispatchNotificationToStudents = async (creator, notificationPayload) => {
  try {
    if (!creator || !creator.role) return;

    let students = [];

    // If the creator is an organization, notify their students
    if (creator.role === "ORGANIZATION") {
      // If organizationId is missing, fallback to the creator's ID (assuming creator is the organization)
      const orgId = creator.organizationId || creator._id;
      students = await listStudents({ organizationId: orgId });
    }
    // If the creator is an Admin, notify all students
    else if (creator.role === "IQPATH_ADMIN") {
      students = await listStudents({});
    }

    if (students.length === 0) return;

    // Build the bulk array
    const notifications = students.map(student => ({
      userId: student._id,
      title: notificationPayload.title,
      message: notificationPayload.message,
      type: notificationPayload.type || "SYSTEM",
      link: notificationPayload.link || null,
      metadata: notificationPayload.metadata || {},
    }));

    // Bulk insert (using unordered to avoid stopping on a single failure if one occurs)
    await Notification.insertMany(notifications, { ordered: false });
  } catch (error) {
    console.error("Failed to dispatch bulk notifications:", error);
  }
};

/**
 * Generic helper to dispatch notifications to admins and specific organization.
 * 
 * @param {String|null} organizationId - The organization ID related to the event, or null if N/A.
 * @param {Object} notificationPayload - { title, message, type, link, metadata }
 */
export const dispatchNotificationToAdminsAndOrgs = async (organizationId, notificationPayload) => {
  try {
    // Fetch all admins
    const admins = await listUsers({ role: "IQPATH_ADMIN" });
    
    // Fetch org users if an organizationId is provided
    let orgs = [];
    if (organizationId) {
      orgs = await listUsers({ role: "ORGANIZATION", organizationId });
    }

    const targetUsers = [...admins, ...orgs];
    if (targetUsers.length === 0) return;

    const notifications = targetUsers.map(user => ({
      userId: user._id,
      title: notificationPayload.title,
      message: notificationPayload.message,
      type: notificationPayload.type || "SYSTEM",
      link: notificationPayload.link || null,
      metadata: notificationPayload.metadata || {},
    }));

    await Notification.insertMany(notifications, { ordered: false });
  } catch (error) {
    console.error("Failed to dispatch notifications to admins/orgs:", error);
  }
};