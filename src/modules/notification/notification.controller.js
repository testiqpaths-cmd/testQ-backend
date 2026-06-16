import Notification from "./notification.model.js";

/**
 * CREATE NOTIFICATION
 */
export const createNotificationController = async (req, res) => {
  try {
    const { title, message } = req.body;

    const userId = req.user._id;

    const notification = await Notification.create({
      userId,
      title,
      message,
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

    const notifications = await Notification.find({ userId }).sort({
      createdAt: -1,
    });

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

    const notification = await Notification.findByIdAndUpdate(
      id,
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
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