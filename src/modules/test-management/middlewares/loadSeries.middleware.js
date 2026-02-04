// import TestSeries from "../../../models/testSeries.model.js";
// import mongoose from "mongoose";

// const loadSeries = async (req, res, next) => {
//   const series = await TestSeries.findById(req.params.id);
//   if (!series) {
//     return res.status(404).json({ message: "Test Series not found" });
//   }
//   req.series = series;
//   next();
// };

// export default loadSeries;
import mongoose from "mongoose";
import TestSeries from "../../../models/testSeries.model.js";

const loadSeries = async (req, res, next) => {
  try {
    const { id } = req.params;

    // ✅ Validate ObjectId first
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Test Series ID",
      });
    }

    const series = await TestSeries.findById(id);

    if (!series) {
      return res.status(404).json({
        success: false,
        message: "Test Series not found",
      });
    }

    req.series = series;
    next();
  } catch (error) {
    next(error); // ✅ forward to error middleware
  }
};

export default loadSeries;
