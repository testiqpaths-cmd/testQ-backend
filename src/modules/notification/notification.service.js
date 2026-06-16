import Notification from "./notification.model.js";

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