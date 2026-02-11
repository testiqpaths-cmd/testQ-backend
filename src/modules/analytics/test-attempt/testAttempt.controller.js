import { getStudentResults } from "./testAttempt.service.js"; 
// ⚠️ Adjust path if needed (see below)

export const getMyResultsController = async (req, res, next) => {
  try {
    const studentId = req.user._id;
      //console.log("student from request",studentId)
    if (!studentId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const results = await getStudentResults(studentId);

    res.status(200).json({
      success: true,
      data: results || [],
    });
  } catch (err) {
    next(err);
  }
};

