import User from "../../../database/models/user.model.js"; // assume a mongoose model

export const authRepository = {
  create: (data) => User.create(data),
  findByEmail: (email) => User.findOne({ email }),
  findById: (id) => User.findById(id),
};
