import express from 'express';
import {authMiddleware} from '../../common/middlewares/auth.middleware.js';
import {startTestAttemptController , saveAnswerController, submitAttemptController,
  getAttemptController,} from '../test-attempts/testAttempt.controller.js';
import {loadAttempt  , enforceAttemptTimer} from '../test-attempts/middlewares/enforceAttemptTimer.middleware.js';

const router = express.Router();

// ✅ Start test: creates attempt with backend-enforced timing
router.post('/starttest/:testId', authMiddleware, startTestAttemptController);

// ✅ Save answer: checks expiry before allowing save
router.post('/saveanswer/:attemptId', authMiddleware, loadAttempt, enforceAttemptTimer, saveAnswerController);

// ✅ Submit attempt: checks expiry, prevents submission if expired
router.post('/submitattempt/:attemptId', authMiddleware, loadAttempt, enforceAttemptTimer, submitAttemptController);

// ✅ Get attempt: retrieves current state with backend timing (frontend display-only)
router.get('/getattempt/:attemptId', authMiddleware, loadAttempt, enforceAttemptTimer, getAttemptController);

export default router;