import HelpSupport from "./helpSupport.model.js";

export const createHelpSupport = async (data) => {
  return await HelpSupport.create(data);
};

export const getHelpSupports = async (filters) => {
  return await HelpSupport.find(filters)
    .populate("studentId", "firstName lastName email")
    .populate("organizationId", "name")
    .sort({ createdAt: -1 });
};

export const getHelpSupportById = async (id) => {
  return await HelpSupport.findById(id);
};

export const resolveHelpSupport = async (id) => {
  return await HelpSupport.findByIdAndUpdate(
    id,
    { status: "resolved" },
    { new: true }
  );
};
