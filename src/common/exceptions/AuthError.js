import { ApiError } from './ApiError.js';

export class AuthError extends ApiError {
  constructor(message = 'Unauthorized') {
    super(401, message);
  }
}
