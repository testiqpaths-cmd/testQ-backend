import TestSeries from "../../../models/testSeries.model.js";

const loadSeries = async (req, res, next) => {
  const series = await TestSeries.findById(req.params.id);
  if (!series) {
    return res.status(404).json({ message: "Test Series not found" });
  }
  req.series = series;
  next();
};

export default loadSeries;
