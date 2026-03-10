import express from 'express';
import {authMiddleware} from '../../common/middlewares/auth.middleware.js';
import {startTestAttemptController} from '../test-attempts/testAttempt.controller.js';

const router = express.Router();

router.post('/starttest/:testId', authMiddleware, startTestAttemptController);

export default router;