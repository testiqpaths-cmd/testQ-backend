import Test from "../../../models/test.model.js";

export default async function loadTest(req, res, next) {
  try {
    const test = await Test.findById(req.params.id);
    if (!test) return res.status(404).json({ message: "Test not found" });
    req.test = test;
    next();
  } catch (err) {
    next(err);
  }
}
