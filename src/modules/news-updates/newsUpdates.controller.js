import { createNews, deleteNews, getAllNews, getStudentNews } from "./newsUpdates.service.js";
import { getIO } from "../../sockets/index.js";

const isAdminRole = (role) => role === "IQPATH_ADMIN" || role === "admin";
const isOrganizationRole = (role) => role === "ORGANIZATION" || role === "organization";

export const createNewsController = async (req, res, next) => {
  try {
    if (!isAdminRole(req.user?.role) && !isOrganizationRole(req.user?.role)) {
      return res.status(403).json({
        success: false,
        message: "Only admins and organizations can publish updates",
      });
    }

    const { title, description, color, priority, visibleFrom, visibleTill, lifelineDays } = req.body || {};

    if (!title?.trim() || !description?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Title and description are required",
      });
    }

    const now = new Date();
    const startTime = visibleFrom ? new Date(visibleFrom) : now;
    const days = Number(lifelineDays || 1);
    const endTime = visibleTill ? new Date(visibleTill) : new Date(startTime.getTime() + days * 24 * 60 * 60 * 1000);

    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid visibility window",
      });
    }

    if (startTime < now) {
      return res.status(400).json({
        success: false,
        message: "Visible from date cannot be in the past",
      });
    }

    if (endTime < now) {
      return res.status(400).json({
        success: false,
        message: "Visible till date cannot be in the past",
      });
    }

    const payload = {
      title: title.trim(),
      description: description.trim(),
      priority: priority || "MEDIUM",
      color: color || "blue",
      visibleFrom: startTime,
      visibleTill: endTime,
      audience: "ALL",
      pinned: false,
      isActive: true,
    };

    const news = await createNews(payload, req.user);

    try {
      const io = getIO();
      io.of("/news-updates").emit("news-updates:changed", {
        newsId: news._id?.toString(),
        createdAt: news.createdAt,
      });
    } catch {
      // Ignore socket broadcast errors; request should still succeed.
    }

    return res.status(201).json({
      success: true,
      message: "News update published successfully",
      data: news,
    });
  } catch (error) {
    next(error);
  }
};

export const getNewsUpdatesController = async (req, res, next) => {
  try {
    const role = req.user?.role;

    if (isAdminRole(role) || isOrganizationRole(role)) {
      const items = await getAllNews();
      return res.json({ success: true, data: items });
    }

    const items = await getStudentNews({
      organizationId: req.user?.organizationId || null,
      assignedTestIds: [],
    });

    return res.json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
};

export const deleteNewsController = async (req, res, next) => {
  try {
    if (!isAdminRole(req.user?.role) && !isOrganizationRole(req.user?.role)) {
      return res.status(403).json({
        success: false,
        message: "Only admins and organizations can delete updates",
      });
    }

    const deleted = await deleteNews(req.params.id);

    try {
      const io = getIO();
      io.of("/news-updates").emit("news-updates:changed", {
        newsId: req.params.id,
        deletedAt: new Date(),
      });
    } catch {
      // Ignore socket broadcast errors; request should still succeed.
    }

    return res.json({
      success: true,
      message: "News update deleted successfully",
      data: deleted,
    });
  } catch (error) {
    if (error?.message === "News update not found") {
      return res.status(404).json({
        success: false,
        message: "News update not found",
      });
    }

    next(error);
  }
};
