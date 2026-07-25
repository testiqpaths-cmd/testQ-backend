import cloudinary from '../../config/cloudinary.js';

export const uploadToCloudinary = async (filePath, folder) => {
  return await cloudinary.uploader.upload(filePath, {
    folder,
  });
};

// Multer's memoryStorage gives us a Buffer, not a file path — the SDK's
// upload() only accepts a path/remote URL/base64 data URI, so we encode the
// buffer as a data URI rather than writing a temp file to disk.
export const uploadBufferToCloudinary = async (buffer, mimetype, folder) => {
  const dataUri = `data:${mimetype};base64,${buffer.toString('base64')}`;
  return await cloudinary.uploader.upload(dataUri, { folder });
};
