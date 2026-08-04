import { createNews, getAllNews, getStudentNews } from "./newsUpdates.service.js";
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

    const startTime = visibleFrom ? new Date(visibleFrom) : new Date();
    const days = Number(lifelineDays || 1);
    const endTime = visibleTill ? new Date(visibleTill) : new Date(startTime.getTime() + days * 24 * 60 * 60 * 1000);

    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid visibility window",
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
