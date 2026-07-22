import IQRoom from "../../../models/iqRoom.model.js";

export const getIQRoomByIdLeanRepo = (id) => IQRoom.findById(id).lean();

export const getIQRoomByIdRepo = (id) => IQRoom.findById(id);
