import TestSeries from "../../models/testSeries.model.js";
import crypto from "crypto";


export const createSeries = async (data, user) => {
  console.log(user);
  const seriesCode =
    data.visibility === "LINK_ONLY"
      ? crypto.randomBytes(4).toString("hex")
      : undefined;

  return TestSeries.create({
    ...data,
    seriesCode,
    createdBy: {
      userId: new mongoose.Types.ObjectId(req.user._id),   // ✅ FIXED
      role: user.role,
    },
  });
};

export const updateSeries = (id, data) =>
  TestSeries.findByIdAndUpdate(id, data, { new: true });

export const deleteSeries = (id) =>
  TestSeries.findByIdAndDelete(id);

export const getSeriesById = (id) =>
  TestSeries.findById(id).populate("tests");
