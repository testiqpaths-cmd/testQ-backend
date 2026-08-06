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

// Shared by dispatchNotificationToStudents and broadcastAssignedTestsChanged.
// TODO: a PUBLIC test published by an ORGANIZATION creator is visible to
// every org's students on /test/assigned (per the frontend's session
// bucketing), but this only resolves the publishing org's own students —
// other orgs' students won't get the notification/live push for it, only
// the periodic poll. Pre-existing gap, not introduced here; fixing it means
// teaching this function about the test's visibility/allowedOrganizations.
const resolveStudentAudience = async (creator) => {
  if (!creator || !creator.role) return [];

  // If the creator is an organization, notify their students
  if (creator.role === "ORGANIZATION") {
    // If organizationId is missing, fallback to the creator's ID (assuming creator is the organization)
    const orgId = creator.organizationId || creator._id;
    return listStudents({ organizationId: orgId });
  }
  // If the creator is an Admin, notify all students
  if (creator.role === "IQPATH_ADMIN") {
    return listStudents({});
  }

  return [];
};

// Pushes a live "your assigned tests changed" signal to each affected
// student's socket room (see sockets/assignedTestsSocket.js), without
// writing a Notification doc — used for edits (reschedule, series changes)
// where a full "New Test Assigned" notification would be spam.
export const broadcastAssignedTestsChanged = async (creator) => {
  try {
    const students = await resolveStudentAudience(creator);
    if (!students.length) return;

    const { getIO } = await import("../../sockets/index.js");
    const io = getIO();
    students.forEach((student) => {
      io.of("/assigned-tests").to(String(student._id)).emit("assigned-tests:changed");
    });
  } catch (error) {
    console.error("Failed to broadcast assigned-tests:changed:", error);
  }
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
    const students = await resolveStudentAudience(creator);

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

    // Live push alongside the persisted notification (same audience).
    await broadcastAssignedTestsChanged(creator);
  } catch (error) {
    console.error("Failed to dispatch bulk notifications:", error);
  }
};

/**
 * Notifies every student on the platform, regardless of who posted — used
 * for news updates, which are currently always visible to ALL students
 * (see newsUpdates.controller.js: audience is hardcoded to "ALL") whether
 * posted by an admin or an organization. Unlike dispatchNotificationToStudents,
 * this does NOT scope to the creator's own org, since that would leave
 * other orgs' students able to see the news item but never notified of it.
 *
 * @param {Object} notificationPayload - { title, message, type, link, metadata }
 */
export const dispatchNotificationToAllStudents = async (notificationPayload) => {
  try {
    const students = await listStudents({});
    if (students.length === 0) return;

    const notifications = students.map(student => ({
      userId: student._id,
      title: notificationPayload.title,
      message: notificationPayload.message,
      type: notificationPayload.type || "SYSTEM",
      link: notificationPayload.link || null,
      metadata: notificationPayload.metadata || {},
    }));

    await Notification.insertMany(notifications, { ordered: false });
  } catch (error) {
    console.error("Failed to dispatch news notification:", error);
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