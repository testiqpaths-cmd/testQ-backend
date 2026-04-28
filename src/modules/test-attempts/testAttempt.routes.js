import express from 'express';
import {authMiddleware} from '../../common/middlewares/auth.middleware.js';
import { roleMiddleware } from "../../common/middlewares/role.middleware.js";
import {startTestAttemptController , saveAnswerController, submitAttemptController,
  getAttemptController,
  evaluateAttemptController,getAttemptResultController,getEvaluationStatusController} from '../test-attempts/testAttempt.controller.js';
import {loadAttempt  , enforceAttemptTimer} from '../test-attempts/middlewares/enforceAttemptTimer.middleware.js';
import { validate } from '../../common/middlewares/validate.middleware.js';
import { evaluateAttemptSchema } from './schemas/evaluateAttempt.schema.js';

const router = express.Router();

// ✅ Start test: creates attempt with backend-enforced timing
router.post('/starttest/:testId', authMiddleware, startTestAttemptController);

// ✅ Save answer: checks expiry before allowing save
router.post('/saveanswer/:attemptId', authMiddleware, loadAttempt, enforceAttemptTimer, saveAnswerController);

// ✅ Submit attempt: checks expiry, prevents submission if expired
router.post('/submitattempt/:attemptId', authMiddleware, loadAttempt, enforceAttemptTimer, submitAttemptController);

// ✅ Get attempt: retrieves current state with backend timing (frontend display-only)
router.get('/getattempt/:attemptId', authMiddleware, loadAttempt, enforceAttemptTimer, getAttemptController);

router.post('/manualevaluate/:attemptId',authMiddleware,roleMiddleware("IQPATH_ADMIN", "ORGANIZATION"),loadAttempt,validate(evaluateAttemptSchema),evaluateAttemptController);

router.get('/getattemptresult/:attemptId', authMiddleware, getAttemptResultController);

// ✅ Get evaluation status by attemptId
router.get('/evaluation-status/:attemptId', authMiddleware, getEvaluationStatusController);

export default router;