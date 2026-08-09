import Organization from "../../../models/organization.model.js";
import xlsx from "xlsx";
import {
  getOrganizationAnalyticsService,
  createOrganizationService,
} from "./organization.service.js";
import {
  createStudent,
  createUsersFromArray,
  getOrganizationById,
  getUserById,
} from "../../../modules/user/user.service.js";
import { generateUserTemplate } from "../../../modules/user/template/generate-userTemplate.js";

export const getOrganizationAnalytics = async (req, res, next) => {
  try {
    // Extract organization ID from route parameters
    const { orgId } = req.params;

    // An ORGANIZATION-role caller may only ever view their own org's
    // analytics — without this check, any org account could read any other
    // org's analytics just by changing the orgId in the URL.
    if (req.user?.role === "ORGANIZATION") {
      let requesterOrgId = req.user.organizationId ? String(req.user.organizationId) : null;
      if (!requesterOrgId) {
        const dbUser = await getUserById(req.user._id);
        requesterOrgId = dbUser?.organizationId ? String(dbUser.organizationId._id || dbUser.organizationId) : null;
      }
      if (!requesterOrgId || requesterOrgId !== String(orgId)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
    }

    // Extract optional date range filters from query parameters
    const { startDate, endDate } = req.query;

    const data = await getOrganizationAnalyticsService({
      orgId,
      startDate,
      endDate,
    });

    
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getOrganizations = async (req, res, next) => {
  try {
    // This list is reachable by any ORGANIZATION-role account (used to
    // populate "restrict visibility to these organizations" pickers when
    // creating a test/series), so it must not leak other orgs' contact
    // details — only the name/code needed to identify an org in a picker.
    const organizations = await Organization.find({})
      .select("name code createdAt")
      .sort({ name: 1 })
      .lean();

    res.status(200).json({
      success: true,
      data: organizations,
    });
  } catch (error) {
    next(error);
  }
};

export const createOrganizationStudent = async (req, res, next) => {
  try {
    const organizationId = req.body.organizationId || req.body.orgId || null;
    const organizationCode = req.body.organizationCode || req.body.orgCode || null;

    const studentEmail = req.body.studentEmail || req.body.email;
    const studentName = req.body.studentName || req.body.name || `${req.body.firstName || ""} ${req.body.lastName || ""}`.trim();
    const course = req.body.course || req.body.plan || req.body.educationStream || null;

    if (!studentEmail) {
      return res.status(400).json({ success: false, message: "Student email is required" });
    }

    let organization = null;
    if (organizationId) {
      organization = await getOrganizationById(organizationId);
    }
    if (!organization && organizationCode) {
      organization = await Organization.findOne({ code: organizationCode }).lean();
    }
    if (!organization) {
      return res.status(400).json({ success: false, message: "Organization not found. Create the organization first." });
    }

    const [firstName, ...rest] = (studentName || studentEmail).trim().split(" ");
    const lastName = rest.join(" ");

    const payload = {
      firstName: firstName || studentEmail,
      lastName,
      email: studentEmail,
      password: req.body.password || "change_me",
      organizationId: organization._id,
      status: req.body.status || "ACTIVE",
    };

    if (course) {
      payload.education = { stream: course };
    }

    const user = await createStudent(payload);
    res.status(201).json({ success: true, user });
  } catch (error) {
    next(error);
  }
};

export const bulkImportOrganizationStudents = async (req, res, next) => {
  try {
    const file = req.file || (req.files && req.files.file && req.files.file[0]);
    if (!file || !file.buffer) {
      return res.status(400).json({ success: false, message: "Excel file is required" });
    }

    const organizationId = req.body.organizationId || req.body.orgId || null;
    const organizationCode = req.body.organizationCode || req.body.orgCode || null;

    let rows = [];
    try {
      if (
        file.mimetype === "text/csv" ||
        file.mimetype === "application/csv" ||
        file.originalname.endsWith(".csv")
      ) {
        const csvText = file.buffer.toString("utf-8");
        const workbook = xlsx.read(csvText, { type: "string" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
      } else {
        const workbook = xlsx.read(file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
      }
    } catch (error) {
      return res.status(400).json({ success: false, message: "Invalid file format" });
    }

    const results = await createUsersFromArray(rows, { organizationId, organizationCode });
    res.status(200).json({ success: true, results });
  } catch (error) {
    next(error);
  }
};

export const downloadStudentTemplate = async (req, res, next) => {
  try {
    const buffer = generateUserTemplate();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=students_template.xlsx");
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

export const createOrganization = async (req, res, next) => {
  try {
    const {
      organizationName,
      contactPerson,
      contactEmail,
      businessPhone,
      plan,
      password,
      studentLimit,
    } = req.body;

    if (!organizationName || !contactPerson || !contactEmail || !password) {
      return res.status(400).json({
        success: false,
        message: "Organization name, contact person, contact email, and password are required",
      });
    }

    const organization = await createOrganizationService({
      organizationName,
      contactPerson,
      contactEmail,
      businessPhone,
      plan,
      password,
      studentLimit,
      createdBy: req.user ?._id || req.user ?.id,
    });

    return res.status(201).json({
      success: true,
      message: "Organization created successfully",
      data: organization,
    });
  } catch (error) {
    next(error);
  }
};