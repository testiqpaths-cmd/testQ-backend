import * as service from "./test.service.js";
import Test from "../../models/test.model.js";

// export async function createTest(req, res, next) {
//   try {
//     const test = await service.createTest(req.body, req.user);
//     res.status(201).json({ success: true, data: test });
//   } catch (e) {
//     next(e);
//   }
// }

export const createTest = async (req, res) => {
  try {
    const data = req.body;

    // 🔴 TEMP FIX: manually inject createdBy
    const createdBy = {
      userId: req.user?._id || req.user?.id,
      role: req.user?.role || "IQPATH_ADMIN" || "ORGANIZATION" ||"STUDENT", // default to a valid role if missing
    };

    if (!createdBy.userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    // 🔴 TEMP FIX: FORCE MANUAL MODE (no randomConfig)
    const testDoc = {
      title: data.title,
      description: data.description,
      visibility: data.visibility,

      questionMode: "MANUAL",
      questions: data.questions || [], // can be empty for now

      duration: data.duration,
      totalMarks: data.totalMarks,

      scheduleType: "FIXED",
      startTime: data.startTime,
      endTime: data.endTime,

      createdBy,
    };

    const created = await Test.create(testDoc);

    return res.status(201).json({
      success: true,
      message: "Test created successfully",
      data: created,
    });
  } catch (err) {
    console.error("❌ createTest error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export async function getTest(req, res) {
  res.json({ success: true, data: req.test });
}

export async function updateTest(req, res, next) {
  try {
    const test = await service.updateTest(req.test, req.body);
    res.json({ success: true, data: test });
  } catch (e) {
    next(e);
  }
}

export async function deleteTest(req, res, next) {
  try {
    await service.deleteTest(req.test);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
}

export const getAllTests = async (req, res) => {
  const tests = await Test.find().sort({ createdAt: -1 }); // adjust model
  return res.json({ success: true, data: tests });
};
