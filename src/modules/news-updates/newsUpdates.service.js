import NewsUpdate from "./newsUpdates.model.js";

/**
 * Create News
 */
export const createNews = async (payload, user) => {
  const news = await NewsUpdate.create({
    ...payload,
    createdBy: {
      userId: user._id,
      role: user.role,
    },
  });

  return news;
};

/**
 * Update News
 */
export const updateNews = async (id, payload) => {
  const news = await NewsUpdate.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  });

  if (!news) {
    throw new Error("News update not found");
  }

  return news;
};

/**
 * Delete News
 */
export const deleteNews = async (id) => {
  const news = await NewsUpdate.findByIdAndDelete(id);

  if (!news) {
    throw new Error("News update not found");
  }

  return news;
};

/**
 * Admin / management List. An IQPATH_ADMIN sees everything; an
 * ORGANIZATION only sees news it created itself — otherwise every org's
 * management console would leak every other org's (and admin's) internal
 * announcements, defeating the point of scoping visibility by org at all.
 */
export const getAllNews = async ({ createdByUserId } = {}) => {
  const filter = createdByUserId ? { "createdBy.userId": createdByUserId } : {};

  return await NewsUpdate.find(filter)
    .sort({
      pinned: -1,
      priority: 1,
      createdAt: -1,
    })
    .populate("createdBy.userId", "firstName lastName email");
};

/**
 * Get News By Id
 */
export const getNewsById = async (id) => {
  return await NewsUpdate.findById(id);
};

/**
 * Student News
 */
export const getStudentNews = async ({
  organizationId,
  assignedTestIds = [],
}) => {
  const now = new Date();

  const news = await NewsUpdate.find({
    isActive: true,
    visibleFrom: { $lte: now },
    visibleTill: { $gte: now },
  }).sort({
    pinned: -1,
    priority: 1,
    createdAt: -1,
  });

  return news.filter((item) => {
    // Visible to everyone
    if (item.audience === "ALL") return true;

    // Organization-specific
    if (item.audience === "ORGANIZATION") {
      return item.organizations.some(
        (id) => id.toString() === organizationId
      );
    }

    // Assigned test-specific
    if (item.audience === "ASSIGNED_TEST") {
      return item.assignedTests.some((id) =>
        assignedTestIds.includes(id.toString())
      );
    }

    return false;
  });
};