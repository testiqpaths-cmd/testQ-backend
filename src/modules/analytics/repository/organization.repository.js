import mongoose from "mongoose";
import TestAttempt from "../../../models/testAttempt.model.js";

export const getOrganizationAnalyticsRepo = async ({ orgId, startDate, endDate }) => {
  
  const orgObjectId = new mongoose.Types.ObjectId(orgId);

  // Match stage: filter attempts by organizationId and optional date range
  const matchStage = { "student.organizationId": orgObjectId };

  if (startDate || endDate) {
    matchStage.submittedAt = {};
    if (startDate) matchStage.submittedAt.$gte = new Date(startDate);
    if (endDate) matchStage.submittedAt.$lte = new Date(endDate);
  }

  // Pipeline for test-wise analytics
  const pipeline = [
   
    {
      $lookup: {
        from: "users",
        localField: "studentId",
        foreignField: "_id",
        as: "student",
      },
    },
    { $unwind: "$student" }, // Flatten student array
    { $match: matchStage },  // Apply filters
    {
      $group: {
        _id: "$testId",                        
        uniqueStudents: { $addToSet: "$studentId" }, 
        averageScore: { $avg: "$percentage" }, 
        passCount: {                           
          $sum: { $cond: [{ $eq: ["$resultStatus", "PASS"] }, 1, 0] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        testId: "$_id",
        totalAttempts: 1,
        totalStudentsAttempted: { $size: "$uniqueStudents" },
        averageScore: { $round: ["$averageScore", 2] },
        passPercentage: {
          $round: [
            { $multiply: [{ $divide: ["$passCount", "$totalAttempts"] }, 100] },
            2,
          ],
        },
      },
    },
    { $sort: { totalAttempts: -1 } }, 
  ];

  // Execute test-wise analytics pipeline
  const testWiseAnalytics = await TestAttempt.aggregate(pipeline);

  // Pipeline for overall analytics (unique students across org)
  const overall = await TestAttempt.aggregate([
    {
      $lookup: {
        from: "users",
        localField: "studentId",
        foreignField: "_id",
        as: "student",
      },
    },
    { $unwind: "$student" },
    { $match: matchStage },
    {
      $group: {
        _id: null,
        students: { $addToSet: "$studentId" }, // Unique student IDs
      },
    },
    {
      $project: {
        _id: 0,
        totalStudentsAttempted: { $size: "$students" },
      },
    },
  ]);

  // Return combined analytics
  return {
    overall: overall[0] || { totalStudentsAttempted: 0 },
    testWiseAnalytics,
  };
};
