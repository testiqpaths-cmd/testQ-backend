import * as orgService from "../services/organization.service.js";
 import { validationResult } from "express-validator";
import { parseExcelFile } from "../utils/excel.js";
 import fs from "fs";
// List students
// ===============================
export const listOrgStudents = async (req, res, next) => {
  try {
    if (req.user.role !== "ORGANIZATION") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const students = await orgService.getStudents(req.user._id);

    res.status(200).json({
      success: true,
      students,
    });
  } catch (err) {
    next(err);
  }
};

// ===============================
// Create student
// ===============================
export const createOrgStudent = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "ORGANIZATION") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // 👇 Use _id directly as organizationId
    const organizationId = req.user._id;

    const { user, plainPassword } =
      await orgService.createStudent(req.body, organizationId);

    res.status(201).json({
      success: true,
      user,
      password: plainPassword,
    });

  } catch (err) {
    next(err);
  }
};

// ===============================
// Bulk Upload Students

export const bulkUploadStudents = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Excel file is required",
      });
    }

    // Your logic here

    res.status(200).json({
      success: true,
      message: "Students uploaded successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


// ===============================
// Update student
// ===============================
export const updateOrgStudent = async (req, res, next) => {
  try {
    if (req.user.role !== "ORGANIZATION") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const student = await orgService.updateStudent(
      req.params.id,
      req.body,
      req.user._id
    );

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Student updated successfully",
      student,
    });
  } catch (err) {
    next(err);
  }
};

// ===============================
// Delete student
// ===============================
export const deleteOrgStudent = async (req, res, next) => {
  try {
    if (req.user.role !== "ORGANIZATION") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const deleted = await orgService.deleteStudent(
      req.params.id,
      req.user._id
    );

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Student not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Student deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};