import cloudinary from '../config/cloudinary.js';

export const uploadToCloudinary = async (filePath, folder) => {
  return await cloudinary.uploader.upload(filePath, {
    folder,
  });
};
