import * as service from "./notification.service.js";

/**
 * CREATE NOTIFICATION
 */
export const createNotificationController = async (req, res) => {
  try {
    const { title, message, type, link, metadata } = req.body;
    const userId = req.user._id;

    const notification = await service.createNotification({
      userId,
      title,
      message,
      type,
      link,
      metadata,
    });

    return res.status(201).json({
      success: true,
      notification,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * GET NOTIFICATIONS (LOGGED IN USER)
 */
export const getNotificationsController = async (req, res) => {
  try {
    const userId = req.user._id;
    const notifications = await service.getNotifications(userId);

    return res.json({
      success: true,
      notifications,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * MARK AS READ
 */
export const markNotificationReadController = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const notification = await service.markNotificationRead(id, userId);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found or unauthorized",
      });
    }

    return res.json({
      success: true,
      notification,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * MARK ALL AS READ
 */
export const markAllNotificationsReadController = async (req, res) => {
  try {
    const userId = req.user._id;
    await service.markAllNotificationsRead(userId);

    return res.json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * DELETE NOTIFICATION
 */
export const deleteNotificationController = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const notification = await service.deleteNotification(id, userId);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found or unauthorized",
      });
    }

    return res.json({
      success: true,
      message: "Notification deleted",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * DELETE ALL NOTIFICATIONS
 */
export const deleteAllNotificationsController = async (req, res) => {
  try {
    const userId = req.user._id;
    await service.deleteAllNotifications(userId);

    return res.json({
      success: true,
      message: "All notifications deleted",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};