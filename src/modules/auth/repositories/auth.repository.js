import User from "../../../models/user.model.js";

/** Create a new user */
export const createUser = async (data) => {
  return await User.create(data);
};

/** Find a user by email */
export const findUserByEmail = async (email) => {
  return await User.findOne({ email });
};

/** Find a user by Firebase UID */
export const findUserByFirebaseUid = async (firebaseUid) => {
  return await User.findOne({ firebaseUid });
};

/** Find a user by ID */
export const findUserById = async (id) => {
  return await User.findById(id);
};


