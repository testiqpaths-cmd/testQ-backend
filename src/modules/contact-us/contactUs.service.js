import ContactUs from "./contactUs.model.js";

export const createContactUs = async (data) => {
  return await ContactUs.create(data);
};

export const getContactUs = async (filters = {}) => {
  return await ContactUs.find(filters)
    .populate("organizationId", "name")
    .sort({ createdAt: -1 })
    .lean();
};

export const getContactUsById = async (id) => {
  return await ContactUs.findById(id).lean();
};

export const deleteContactUsById = async (id) => {
  return await ContactUs.findByIdAndDelete(id);
};
