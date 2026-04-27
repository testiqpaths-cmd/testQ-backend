import User from "../../../models/user.model.js";
import { randomPassword } from "../utils/randomPassword.js";
import bcrypt from "bcryptjs";

// ===============================
// Get students
// ===============================
export const getStudents = async (organizationId) => {
  try {
    return await User.find({
      role: "STUDENT",
      organizationId: organizationId,
    }).select("-password");
  } catch (err) {
    throw new Error("Failed to fetch students: " + err.message);
  }
};

// ===============================
// Create student
// ===============================
export const createStudent = async (data, organizationId) => {
  try {
    if (!organizationId) {
      throw new Error("Organization ID is required");
    }

    const plainPassword = randomPassword();
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const newStudent = new User({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      password: hashedPassword,
      role: "STUDENT",
      organizationId: organizationId,
    });

    await newStudent.save();

    return {
      user: newStudent,
      plainPassword,
    };
  } catch (err) {
    throw new Error("Failed to create student: " + err.message);
  }
};

// ===============================
// Bulk Create Students
// ===============================
export const bulkCreateStudents = async (students, organizationId) => {
  const created = [];
  const errors = [];

  for (const student of students) {
    const { firstName, lastName, email, rowNumber } = student;

    // if (!firstName || !lastName || !email) {
    //   errors.push({
    //     row: rowNumber,
    //     email,
    //     error: "Missing required fields",
    //   });
    //   continue;
    // }
    if (!firstName || !lastName || !email) {
  const missing = [];
  if (!firstName) missing.push("firstName");
  if (!lastName) missing.push("lastName");
  if (!email) missing.push("email");

  errors.push({
    row: rowNumber,
    email,
    error: `Missing required fields: ${missing.join(", ")}`
  });
  continue;
}


    const exists = await User.findOne({ email });
    if (exists) {
      errors.push({
        row: rowNumber,
        email,
        error: "Email already exists",
      });
      continue;
    }

    const plainPassword = randomPassword();
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const newStudent = await User.create({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      role: "STUDENT",
      organization: organizationId,
    });

    created.push({
      id: newStudent._id,
      email,
      password: plainPassword,
    });
  }

  return {
    total: students.length,
    createdCount: created.length,
    failedCount: errors.length,
    created,
    errors,
  };
};


// ===============================
// Update student
// ===============================
export const updateStudent = async (id, data, organizationId) => {
  try {
    return await User.findOneAndUpdate(
      {
        _id: id,
        role: "STUDENT",
        organizationId: organizationId,
      },
      data,
      { new: true }
    ).select("-password");
  } catch (err) {
    throw new Error("Failed to update student: " + err.message);
  }
};

// ===============================
// Delete student
// ===============================
export const deleteStudent = async (id, organizationId) => {
  try {
    return await User.findOneAndDelete({
      _id: id,
      role: "STUDENT",
      organizationId: organizationId,
    });
  } catch (err) {
    throw new Error("Failed to delete student: " + err.message);
  }
};