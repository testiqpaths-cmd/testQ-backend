import { Router } from 'express';
import { validateMiddleware } from '../../common/middlewares/validate.middleware.js';
import { loginSchema } from './schemas/login.schema.js';
import { registerSchema } from './schemas/register.schema.js';
import { login, register } from './auth.controller.js';

const router = Router();

router.post(
  '/login',
  validateMiddleware(loginSchema),
  login
);

router.post(
  '/register',
  validateMiddleware(registerSchema),
  register
);

export default router;
