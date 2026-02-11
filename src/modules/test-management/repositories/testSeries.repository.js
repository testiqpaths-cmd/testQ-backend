import TestSeries from "../../models/testSeries.model.js";

const create = (data) => {
  return TestSeries.create(data);
};

const updateById = (id, data) => {
  return TestSeries.findByIdAndUpdate(id, data, { new: true });
};

const deleteById = (id) => {
  return TestSeries.findByIdAndDelete(id);
};

const findById = (id) => {
  return TestSeries.findById(id).populate("tests");
};

export default {
  create,
  updateById,
  deleteById,
  findById,
};
