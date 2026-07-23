const NewsUpdate = require("./newsUpdates.model");

const getActiveNewsUpdates = async ({ activeOnly = true } = {}) => {
  const query = activeOnly ? { isActive: true } : {};
  return NewsUpdate.find(query).sort({ createdAt: -1 }).lean();
};

const createNewsUpdate = async (payload) => NewsUpdate.create(payload);

const updateNewsUpdate = async (id, payload) =>
  NewsUpdate.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  }).lean();

const deleteNewsUpdate = async (id) => NewsUpdate.findByIdAndDelete(id);

module.exports = {
  getActiveNewsUpdates,
  createNewsUpdate,
  updateNewsUpdate,
  deleteNewsUpdate,
};