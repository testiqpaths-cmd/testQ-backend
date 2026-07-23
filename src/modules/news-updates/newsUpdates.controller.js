const service = require("./newsUpdates.service");

const normalizeRole = (value) => String(value || "").trim().toUpperCase();

const isNewsManager = (user = {}) => {
  const role = normalizeRole(user.role || user.userType || user.type);
  return (
    Boolean(user?.isAdmin || user?.isSuperAdmin) ||
    role === "IQPATH_ADMIN" ||
    role === "ADMIN" ||
    role === "ORGANIZATION" ||
    role === "ORG_ADMIN" ||
    role === "ORGANIZATION_ADMIN"
  );
};

const listNewsUpdates = async (req, res) => {
  try {
    const activeOnly = req.query.active === "true" || req.query.active === true;
    const items = await service.getActiveNewsUpdates({ activeOnly });
    return res.json({ success: true, data: items });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to load news updates.",
    });
  }
};

const createNewsUpdate = async (req, res) => {
  try {
    const user = req.user || {};

    if (!isNewsManager(user)) {
      return res.status(403).json({
        success: false,
        message: "Only organization admins and IQPath admins can manage news updates.",
      });
    }

    const title = String(req.body?.title || "").trim();
    const message = String(req.body?.message || "").trim();
    const tag = String(req.body?.tag || "Update").trim();
    const tagColor = String(req.body?.tagColor || "#1358DA").trim();
    const isActive =
      req.body?.isActive === undefined
        ? true
        : req.body.isActive === true || req.body.isActive === "true";

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: "Title and message are required.",
      });
    }

    const payload = {
      title,
      message,
      tag,
      tagColor,
      isActive,
      createdBy: user._id || user.id || user.email || "unknown",
      createdByRole: normalizeRole(user.role || user.userType || user.type || "ORGANIZATION"),
      organizationId: user.organizationId || req.body?.organizationId || null,
    };

    const item = await service.createNewsUpdate(payload);
    return res.status(201).json({ success: true, data: item });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create news update.",
    });
  }
};

const updateNewsUpdate = async (req, res) => {
  try {
    const user = req.user || {};

    if (!isNewsManager(user)) {
      return res.status(403).json({
        success: false,
        message: "Only organization admins and IQPath admins can manage news updates.",
      });
    }

    const payload = {};

    if (req.body?.title !== undefined) payload.title = String(req.body.title).trim();
    if (req.body?.message !== undefined) payload.message = String(req.body.message).trim();
    if (req.body?.tag !== undefined) payload.tag = String(req.body.tag).trim();
    if (req.body?.tagColor !== undefined) payload.tagColor = String(req.body.tagColor).trim();
    if (req.body?.isActive !== undefined) {
      payload.isActive = req.body.isActive === true || req.body.isActive === "true";
    }

    const item = await service.updateNewsUpdate(req.params.id, payload);
    if (!item) {
      return res.status(404).json({ success: false, message: "News update not found." });
    }

    return res.json({ success: true, data: item });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to update news update.",
    });
  }
};

const deleteNewsUpdate = async (req, res) => {
  try {
    const user = req.user || {};

    if (!isNewsManager(user)) {
      return res.status(403).json({
        success: false,
        message: "Only organization admins and IQPath admins can manage news updates.",
      });
    }

    const removed = await service.deleteNewsUpdate(req.params.id);
    if (!removed) {
      return res.status(404).json({ success: false, message: "News update not found." });
    }

    return res.json({ success: true, message: "News update deleted." });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to delete news update.",
    });
  }
};

module.exports = {
  listNewsUpdates,
  createNewsUpdate,
  updateNewsUpdate,
  deleteNewsUpdate,
};