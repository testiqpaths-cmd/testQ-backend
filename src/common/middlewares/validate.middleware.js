// src/common/middlewares/validate.middleware.js
import { ZodError } from "zod";

export const validate = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body); // ✅ parse only body
    return next();
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.issues.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        })),
      });
    }
    return next(error);
  }
};
