import axios from "axios";
import FormData from "form-data";

/**
 * Send an image to the Python YOLO phone detection service.
 *
 * @param {Buffer} imageBuffer - Image data
 * @param {string} filename - Original filename
 * @param {string} mimetype - Image MIME type
 */
export const detectPhone = async (
  imageBuffer,
  filename = "frame.jpg",
  mimetype = "image/jpeg"
) => {
  try {
    const formData = new FormData();

    formData.append("file", imageBuffer, {
      filename,
      contentType: mimetype,
    });

    const response = await axios.post(
      "http://localhost:8000/detect-phone",
      formData,
      {
        headers: {
          ...formData.getHeaders(),
        },

        // Prevent large webcam frames from timing out
        timeout: 10000,
      }
    );

    return response.data;
  } catch (error) {
    console.error(
      "Phone detection service error:",
      error.response?.data || error.message
    );

    throw new Error("Phone detection service unavailable");
  }
};