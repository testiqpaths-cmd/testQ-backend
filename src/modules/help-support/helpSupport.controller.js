import * as service from "./helpSupport.service.js";

export const createHelpSupportController = async (req, res) => {
  try {
    const { fullName, email, subject, message } = req.body;
    const studentId = req.user._id;
    // Assuming organizationId is available on req.user for students belonging to an org
    const organizationId = req.user.organizationId || null;

    const query = await service.createHelpSupport({
      studentId,
      organizationId,
      fullName,
      email,
      subject,
      message,
    });

    return res.status(201).json({ success: true, data: query });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getHelpSupportsController = async (req, res) => {
  try {
    const { role, _id, organizationId } = req.user;
    let filters = {};

    if (role === "STUDENT") {
      filters.studentId = _id;
    } else if (role === "ORGANIZATION") {
      filters.organizationId = organizationId || _id;
    } else if (role === "IQPATH_ADMIN") {
      // IQPATH_ADMIN sees everything
      filters = {};
    }

    const queries = await service.getHelpSupports(filters);
    return res.json({ success: true, data: queries });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const resolveHelpSupportController = async (req, res) => {
  try {
    const { id } = req.params;
    const { role, organizationId, _id } = req.user;

    if (role === "STUDENT") {
      return res.status(403).json({ success: false, message: "Forbidden: Students cannot resolve queries" });
    }

    const query = await service.getHelpSupportById(id);
    if (!query) {
      return res.status(404).json({ success: false, message: "Query not found" });
    }

    if (role === "ORGANIZATION") {
      const userOrgId = organizationId || _id;
      if (String(query.organizationId) !== String(userOrgId)) {
        return res.status(403).json({ success: false, message: "Forbidden: Not your organization's query" });
      }
    }

    const resolvedQuery = await service.resolveHelpSupport(id);
    return res.json({ success: true, data: resolvedQuery });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
