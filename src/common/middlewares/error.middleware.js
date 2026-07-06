import { ApiError } from '../exceptions/ApiError.js';

export const errorMiddleware = (err, req, res, next) => {
  let statusCode = err instanceof ApiError ? err.statusCode : 500;
  let message = err.message || 'Internal Server Error';

  // Handle Mongoose / MongoDB Duplicate Key Error
  if (err.code === 11000) {
    statusCode = 400;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    const value = err.keyValue ? err.keyValue[field] : '';
    
    if (value === "") {
      message = `This ${field} cannot be left empty as it is already taken.`;
    } else {
      // Clean up field name for display (e.g., "phone_1" -> "phone")
      const displayField = field.replace(/_[0-9]+$/, '');
      message = `An account with this ${displayField} (${value}) already exists.`;
    }
  }

  res.status(statusCode).json({
    success: false,
    message,
    errors: err.errors || null,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};

