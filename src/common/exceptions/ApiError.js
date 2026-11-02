export class ApiError extends Error {
  constructor(statusCode, message, errors = null, code = null, data = null) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.code = code;
    this.data = data;
    Error.captureStackTrace(this, this.constructor);
  }
}
