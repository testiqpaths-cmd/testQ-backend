import { InterviewTurn } from "../schemas/interview-turn.schema.js";
import { InterviewSession } from "../schemas/interview-session.schema.js";
import { InterviewPlan } from "../schemas/interview-plan.schema.js";
import { InterviewState } from "../enums/interview-state.enum.js";
import { AnswerStatus } from "../enums/answer-status.enum.js";
import { Difficulty } from "../enums/difficulty.enum.js";
import { aiAnswerAnalysisService } from "../ai/ai-answer-analysis.service.js";
import { interviewStateBuilderService } from "./interview-state-builder.service.js";
import { conceptHistoryService } from "./concept-history.service.js";
import { ApiError } from "../../common/exceptions/ApiError.js";
import logger from "../../config/logger.js";

export class AnswerAnalysisService {
  constructor(ai = aiAnswerAnalysisService) {
    this.ai = ai;
  }

  /**
   * Deterministic check for explicit knowledge gap language in candidate transcript.
   * STRICT MANDATE: Explicit knowledge gaps MUST NOT trigger follow-ups or defense demands.
   *
   * @param {string} rawAnswer - Candidate answer transcript
   * @returns {boolean} True if the answer is an explicit knowledge gap
   */
  isExplicitKnowledgeGap(rawAnswer) {
    if (!rawAnswer || typeof rawAnswer !== "string") return false;
    const clean = rawAnswer.trim().toLowerCase().replace(/[.!?,…]+$/g, "").trim();

    // Direct hard admissions of not knowing or wishing to skip
    const HARD_GAP_PATTERNS = [
      /^\(?skipped\)?$/i,
      /^(?:sorry,?\s*)?(?:i\s+)?(?:don'?t|do\s+not)\s+know$/i,
      /^(?:sorry,?\s*)?(?:i'?m|i\s+am)\s+not\s+(?:really\s+)?sure$/i,
      /^(?:sorry,?\s*)?not\s+really\s+sure(?:\s+about\s+this)?$/i,
      /^(?:have\s+)?no\s+idea$/i,
      /^(?:pass|skip)(?:\s+(?:this\s+question|on\s+this))?$/i,
      /^(?:can'?t|cannot)\s+(?:recall|remember|answer)$/i,
      /^(?:i\s+)?(?:don'?t|do\s+not)\s+remember$/i,
      /^(?:never\s+used\s+it(?:\s+before)?)$/i,
    ];

    if (HARD_GAP_PATTERNS.some((p) => p.test(clean))) return true;

    // Check if phrase contains explicit gap language
    const EXPLICIT_GAP_PATTERNS = [
      /\b(?:i\s+)?(?:don'?t|do\s+not)\s+know\b/i,
      /\b(?:i'?m|i\s+am)\s+not\s+(?:really\s+)?sure\b/i,
      /\bnot\s+really\s+sure\b/i,
      /\b(?:haven'?t|have\s+never|never)\s+(?:worked|dealt)\s+with\b/i,
      /\b(?:haven'?t|have\s+never|never)\s+used\b/i,
      /\b(?:have\s+)?no\s+idea\b/i,
      /\bpass\s+(?:this\s+question|on\s+this)?\b/i,
      /\bskip\s+(?:this\s+question)?\b/i,
      /\b(?:can'?t|cannot)\s+answer\b/i,
      /\b(?:don'?t|can'?t|cannot)\s+remember\b/i,
    ];

    const matchesPattern = EXPLICIT_GAP_PATTERNS.some((pattern) => pattern.test(clean));
    if (!matchesPattern) return false;

    const words = clean.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    // If answer is short (< 8 words) and contains gap language, it's a knowledge gap.
    if (wordCount < 8) return true;

    // Distinguish explicit gap from hedging with substantive technical explanation:
    // e.g. "I'm not completely sure, but I think Django middleware intercepts the request..."
    const hasHedgingExplanation = /\b(?:but|however|i\s+think|i\s+believe|perhaps|might\s+be|could\s+be)\b/i.test(clean);
    if (hasHedgingExplanation && wordCount >= 8) {
      return false; // Let the AI evaluate the technical accuracy!
    }

    // Dominant gap phrases (e.g. "Sorry, I don't know anything about this topic at all")
    const gapDominantPatterns = [
      /^(?:sorry,?\s*)?(?:i\s+)?(?:don'?t|do\s+not)\s+know(?:\s+anything|\s+much)?\s*(?:about)?/i,
      /^(?:sorry,?\s*)?(?:i\s+)?(?:haven'?t|have\s+never)\s+(?:worked|used)/i,
    ];
    return gapDominantPatterns.some((p) => p.test(clean)) && wordCount < 20;
  }

  /**
   * Analyzes an existing question turn's candidate answer.
   * Enforces backend authority: deterministic "I don't know" rules, follow-up authorization,
   * coverage state updates, and candidate performance tracking.
   *
   * @param {Object} params
   * @param {string} params.sessionId - Interview session ID
   * @param {Object} params.user - Authenticated user ({ _id, role })
   * @param {string} [params.turnId] - Specific turn ID to analyze (defaults to current turn)
   * @returns {Promise<Object>} Persisted analysis result with authorized next action recommendations
   */
  async analyzeTurnAnswer({ sessionId, user, turnId = null }) {
    const tAnalysisStart = performance.now();
    if (!sessionId) {
      throw new ApiError(400, "Session ID is required for answer analysis.");
    }
    if (!user || !user._id) {
      throw new ApiError(401, "Unauthorized");
    }

    // 1. Fetch session with strict ownership check
    const query = sessionId.toString().startsWith("int-")
      ? { interviewId: sessionId }
      : { _id: sessionId };

    const session = await InterviewSession.findOne(query);
    if (!session) {
      throw new ApiError(404, `Interview session not found: ${sessionId}`);
    }

    const isOwner = session.userId.toString() === user._id.toString();
    const isAdmin = user.role === "IQPATH_ADMIN";
    if (!isOwner && !isAdmin) {
      throw new ApiError(403, "You are not authorized to analyze this interview session.");
    }

    // 2. Locate the existing InterviewTurn
    let turn = null;
    if (turnId) {
      turn = await InterviewTurn.findById(turnId);
    } else if (session.currentQuestion?.id || session.currentQuestion?.questionId) {
      const qId = session.currentQuestion.id || session.currentQuestion.questionId;
      turn = await InterviewTurn.findById(qId);
    }

    if (!turn) {
      turn = await InterviewTurn.findOne({
        sessionId: session._id,
        turnNumber: session.questionCount,
      });
    }

    if (!turn) {
      throw new ApiError(404, "No active interview turn found to analyze.");
    }

    // A "no response" turn (the response timer expired with nothing said)
    // legitimately has an empty answer — it's judged as SKIPPED below.
    const isNoResponse = turn.endedReason === "timeout_no_response";
    if ((!turn.candidateAnswer || !turn.candidateAnswer.trim()) && !isNoResponse) {
      throw new ApiError(400, "No candidate answer recorded for this turn yet.");
    }

    // 3. Duplicate Analysis Protection
    if (turn.processingState === "ANALYZED" && turn.answerStatus) {
      logger.info(`Turn ${turn.turnNumber} already analyzed; returning cached analysis.`);
      return {
        sessionId: session.interviewId,
        turnId: turn._id.toString(),
        turnNumber: turn.turnNumber,
        topic: turn.topic,
        answerStatus: turn.answerStatus,
        correctnessScore: turn.correctnessScore,
        relevanceScore: turn.relevanceScore,
        completenessScore: turn.completenessScore,
        conceptsDemonstrated: turn.conceptsDemonstrated || [],
        conceptsMissing: turn.conceptsMissing || [],
        depthLevel: turn.depthLevel || "ADEQUATE",
        followUpAllowed: Boolean(turn.followUpAllowed),
        feedbackSummary: turn.feedbackSummary,
        interviewState: session.interviewState,
      };
    }

    // Fetch internal plan for backend constraints
    const plan = await InterviewPlan.findById(session.planId);

    // 4. STRICT DETERMINISTIC "I DON'T KNOW" CHECK
    const isExplicitGap = !isNoResponse && this.isExplicitKnowledgeGap(turn.candidateAnswer);

    let finalStatus = AnswerStatus.PARTIAL;
    let relevance = 50;
    let correctness = 50;
    let completeness = 50;
    let confidence = 60;
    let conceptsDemonstrated = [];
    let conceptsMissing = [];
    let feedbackSummary = "";
    let aiFollowUpRecommended = false;
    let difficultyRec = turn.difficulty;
    let topicContinuation = true;

    let depthLevel = "ADEQUATE";
    let knowledgeLevel = "INTERMEDIATE";
    let knowledgeConfidence = 60;
    let depthEstablished = false;
    let practicalUnderstanding = "ADEQUATE";
    let followUpType = "NONE";
    let aiResult = null;

    if (isNoResponse) {
      logger.info(
        `No response recorded for session ${session.interviewId} (turn ${turn.turnNumber}). Scoring as SKIPPED.`
      );
      finalStatus = AnswerStatus.SKIPPED;
      relevance = 0;
      correctness = 0;
      completeness = 0;
      confidence = 0;
      depthLevel = "SHALLOW";
      knowledgeLevel = "NONE";
      knowledgeConfidence = 100;
      depthEstablished = false;
      practicalUnderstanding = "NONE";
      followUpType = "NONE";
      conceptsDemonstrated = [];
      conceptsMissing = [turn.topic];
      feedbackSummary = "No answer was given before the response time limit.";
      aiFollowUpRecommended = false;
      difficultyRec = Difficulty.EASY;
      topicContinuation = true;
    } else if (isExplicitGap) {
      logger.info(
        `Explicit knowledge gap detected for session ${session.interviewId} (turn ${turn.turnNumber}). Strict no-followup enforced.`
      );
      finalStatus = AnswerStatus.KNOWLEDGE_GAP;
      relevance = 0;
      correctness = 0;
      completeness = 0;
      confidence = 0;
      depthLevel = "SHALLOW";
      knowledgeLevel = "NONE";
      knowledgeConfidence = 100;
      depthEstablished = true;
      practicalUnderstanding = "NONE";
      followUpType = "NONE";
      conceptsDemonstrated = [];
      conceptsMissing = [turn.topic];
      feedbackSummary = "Explicit knowledge gap expressed. Moving to next concept.";
      aiFollowUpRecommended = false;
      difficultyRec = Difficulty.EASY;
      topicContinuation = false;
    } else {
      let previousSessionTurns = [];
      let interviewState = null;
      try {
        previousSessionTurns = await InterviewTurn.find({
          sessionId: session._id,
          _id: { $ne: turn._id },
          candidateAnswer: { $exists: true, $ne: null },
        })
          .sort({ turnNumber: 1 })
          .select(
            "turnNumber topic concept question candidateAnswer correctnessScore completenessScore depthLevel conceptsDemonstrated conceptsMissing misconceptions contradictionDetected contradictionDetails processingState"
          )
          .lean();

        interviewState = interviewStateBuilderService.buildState(
          session,
          previousSessionTurns,
          { question: turn.question, topic: turn.topic, difficulty: turn.difficulty }
        );
      } catch (err) {
        logger.warn(`Failed to build compact interview state (non-fatal): ${err.message}`);
      }

      // Delegate to AI Analysis Layer
      aiResult = await this.ai.analyzeCandidateAnswer({
        question: turn.question,
        candidateAnswer: turn.candidateAnswer,
        topic: turn.topic,
        difficulty: turn.difficulty,
        role: session.role,
        experienceLevel: session.experienceLevel,
        interviewState,
        previousTurns: previousSessionTurns,
        interviewId: session.interviewId,
      });

      finalStatus = aiResult.answerStatus || AnswerStatus.PARTIAL;
      relevance = aiResult.relevanceScore ?? 70;
      correctness = aiResult.correctnessScore ?? 60;
      completeness = aiResult.completenessScore ?? 50;
      confidence = aiResult.confidence ?? 70;
      depthLevel = aiResult.depthLevel || (completeness < 70 ? "SHALLOW" : "ADEQUATE");
      knowledgeLevel =
        aiResult.knowledgeLevel ||
        (correctness >= 90
          ? "EXCELLENT"
          : correctness >= 75
          ? "STRONG"
          : correctness >= 50
          ? "INTERMEDIATE"
          : correctness >= 25
          ? "BASIC"
          : "NONE");
      knowledgeConfidence = aiResult.knowledgeConfidence ?? 70;
      depthEstablished = Boolean(aiResult.depthEstablished);
      practicalUnderstanding = aiResult.practicalUnderstanding || "ADEQUATE";
      followUpType = aiResult.followUpType || "NONE";
      conceptsDemonstrated = aiResult.conceptsDemonstrated || [];
      conceptsMissing = aiResult.conceptsMissing || [];
      feedbackSummary = aiResult.feedbackSummary || "Candidate answer evaluated.";
      aiFollowUpRecommended = Boolean(aiResult.followUpRecommended);
      difficultyRec = aiResult.difficultyRecommendation || turn.difficulty;
      topicContinuation = aiResult.topicContinuationRecommended ?? true;
    }

    const evidenceLevel = isNoResponse
      ? "LOW"
      : isExplicitGap
      ? "HIGH" // Certain evidence of gap
      : aiResult?.evidenceLevel || (depthLevel === "DEEP" ? "MEDIUM" : "LOW");

    const contradictionDetected = Boolean(aiResult?.contradictionDetected);
    const contradictionDetails = aiResult?.contradictionDetails || null;
    const misconceptions = Array.isArray(aiResult?.misconceptions) ? aiResult.misconceptions : [];
    const experienceAuthenticity = aiResult?.experienceAuthenticity || "UNPROVEN";

    // 5. BACKEND AUTHORITY: Authorize or reject follow-up based on Knowledge Depth & Recommended Logic
    // Rules:
    // - Explicit gap / skipped -> never follow up
    // - Correct AND complete AND sufficiently detailed (90-100% + complete) -> NEVER follow up (Accept answer)
    // - Depth already established -> never follow up (move forward)
    // - Respect topic follow-up ceiling (max 3 per topic)
    // - Respect global follow-up ceiling
    // - Time remaining > 120s
    // - Introduction turn -> never follow up
    // - <40%: Don't waste multiple cross-questions; move to another question
    // - 80-90%: Ask 1 meaningful cross-question to validate depth
    let followUpAllowed = false;
    const maxFollowUpsPerQ = plan?.maxFollowUpsPerQuestion ?? 3;
    const maxFollowUpsPerTopic = plan?.maxFollowUpsPerTopic ?? 3;
    const maxGlobalFollowUps = plan?.maxGlobalFollowUps ?? 3;
    const isAlreadyFollowUp = Boolean(turn.parentTurnId || (turn.followUp && maxFollowUpsPerQ <= 1));
    const topicFollowUps = session.topicFollowUpCount || 0;

    const isIntro =
      turn.turnNumber === 1 ||
      (turn.topic && turn.topic.toUpperCase() === "INTRODUCTION") ||
      turn.concept === "Introduction";

    const isShallow = depthLevel === "SHALLOW";
    const hasMisconception = contradictionDetected || (misconceptions && misconceptions.length > 0);
    const hasMissingDetails = Array.isArray(conceptsMissing) && conceptsMissing.length > 0;
    const isAccurate = finalStatus === AnswerStatus.ACCURATE || correctness >= 90;

    // Distinction: 100% accurate != automatically complete.
    // IF answer is correct AND complete AND sufficiently detailed:
    // DO NOT cross-question! Accept answer and advance.
    const isCorrectAndComplete =
      isAccurate &&
      !isShallow &&
      completeness >= 80 &&
      !hasMisconception &&
      !hasMissingDetails &&
      !aiFollowUpRecommended;

    if (isCorrectAndComplete) {
      depthEstablished = true;
    }

    let isQualityCandidateForFollowUp = false;
    if (hasMisconception) {
      isQualityCandidateForFollowUp = true;
    } else if (isCorrectAndComplete) {
      // Rule: IF answer is correct AND complete AND sufficiently detailed -> Do NOT cross-question!
      isQualityCandidateForFollowUp = false;
    } else if (isAccurate && (isShallow || completeness < 75 || hasMissingDetails || aiFollowUpRecommended)) {
      // Correct but shallow, missing important detail, or 80-90% validating depth
      isQualityCandidateForFollowUp = true;
    } else if (finalStatus === AnswerStatus.PARTIAL || (correctness >= 40 && correctness < 90)) {
      // 40-60% clarify fundamentals, 60-80% depth probe
      isQualityCandidateForFollowUp = true;
    } else if (finalStatus === AnswerStatus.INCORRECT || correctness < 40) {
      // <40%: Don't waste multiple cross-questions; move to another question.
      // Only permit 1 single clarification if first attempt on question and specifically recommended.
      const alreadyProbed = (session.followUpCount || 0) >= 1 || Boolean(turn.isFollowUp || turn.parentTurnId);
      isQualityCandidateForFollowUp = !alreadyProbed && aiFollowUpRecommended;
    }

    // 80-90% rule: Ask 1 meaningful cross-question to validate depth
    const isEightyToNinety = correctness >= 80 && correctness < 90 && !isShallow;
    if (isEightyToNinety && (session.followUpCount || 0) >= 1) {
      isQualityCandidateForFollowUp = false;
    }

    const evaluationSource = isNoResponse || isExplicitGap
      ? "PREDEFINED"
      : (aiResult?.evaluationSource || "AI");

    // Explicit categorized follow-up reason
    let followUpReason = "NONE";
    const missingConcept = (Array.isArray(conceptsMissing) && conceptsMissing[0]) || null;
    if (contradictionDetected) {
      followUpReason = "CONTRADICTION";
    } else if (hasMisconception) {
      followUpReason = "MISCONCEPTION";
    } else if (correctness < 60 || knowledgeLevel === "BASIC") {
      followUpReason = "CLARIFICATION";
    } else if (hasMissingDetails) {
      followUpReason = "MISSING_CONCEPT";
    } else if (isShallow) {
      followUpReason = "SHALLOW_ANSWER";
    } else if (correctness >= 80 && correctness <= 90) {
      followUpReason = "PRACTICAL_DEPTH";
    } else if (followUpAllowed) {
      followUpReason = "PRACTICAL_DEPTH";
    }

    // TERMINAL ANSWER HARD GATE:
    // If correctness >= 90, completeness >= 90, relevance >= 90, depth = DEEP,
    // and no misconceptions, contradictions, or missing concepts:
    // HARD STOP -> ACCEPT -> NEVER FOLLOW UP!
    const isTerminalAnswer =
      correctness >= 90 &&
      completeness >= 90 &&
      relevance >= 90 &&
      depthLevel === "DEEP" &&
      (!misconceptions || misconceptions.length === 0) &&
      !contradictionDetected &&
      (!conceptsMissing || conceptsMissing.length === 0);

    if (isTerminalAnswer) {
      depthEstablished = true;
      followUpAllowed = false;
      aiFollowUpRecommended = false;
      followUpReason = "NONE";
    }

    if (evaluationSource === "FALLBACK") {
      // Conservative handling: never make aggressive follow-up decisions on uncertain fallback
      followUpAllowed = false;
      followUpReason = "NONE";
    }

    if (
      !isIntro &&
      !isAlreadyFollowUp &&
      !isExplicitGap &&
      !isNoResponse &&
      !depthEstablished &&
      !isTerminalAnswer &&
      evaluationSource !== "FALLBACK" &&
      isQualityCandidateForFollowUp &&
      (session.followUpCount || 0) < maxFollowUpsPerQ &&
      topicFollowUps < maxFollowUpsPerTopic &&
      (session.globalFollowUpCount || 0) < maxGlobalFollowUps &&
      session.timeRemaining > 120 &&
      (session.candidatePerformance?.consecutiveKnowledgeGapsInTopic || 0) < 2
    ) {
      followUpAllowed = true;
    } else {
      followUpAllowed = false;
      if (!isQualityCandidateForFollowUp || isTerminalAnswer || depthEstablished) {
        followUpReason = "NONE";
      }
    }

    // 6. Update the existing InterviewTurn with full Knowledge State
    turn.answerStatus = finalStatus;
    turn.relevanceScore = relevance;
    turn.correctnessScore = correctness;
    turn.completenessScore = completeness;
    turn.confidence = confidence;
    turn.depthLevel = depthLevel;
    turn.knowledgeLevel = knowledgeLevel;
    turn.knowledgeConfidence = knowledgeConfidence;
    turn.depthEstablished = depthEstablished;
    turn.evidenceLevel = evidenceLevel;
    turn.contradictionDetected = contradictionDetected;
    turn.contradictionDetails = contradictionDetails;
    turn.misconceptions = misconceptions;
    turn.experienceAuthenticity = experienceAuthenticity;
    turn.practicalUnderstanding = practicalUnderstanding;
    turn.followUpType = followUpType;
    turn.followUpReason = followUpReason;
    turn.missingConcept = missingConcept;
    turn.evaluationSource = evaluationSource;
    turn.conceptsDemonstrated = conceptsDemonstrated;
    turn.conceptsMissing = conceptsMissing;
    turn.feedbackSummary = feedbackSummary;
    turn.followUpRecommended = aiFollowUpRecommended;
    turn.followUpAllowed = followUpAllowed;
    if (turn.parentTurnId) {
      turn.followUp = true; // Preserve follow-up marker
    }
    turn.difficultyRecommendation = difficultyRec;
    turn.topicContinuationRecommended = topicContinuation;
    turn.processingState = "ANALYZED";
    turn.analysisTimestamp = new Date();
    const answerAnalysisMs = Math.round(performance.now() - tAnalysisStart);
    turn.latencyMetrics = {
      ...(turn.latencyMetrics || {}),
      answerAnalysisMs,
    };

    await turn.save();

    // 7. Update Session Topic State (Coverage & Knowledge State)
    if (Array.isArray(session.coverageState)) {
      const topicIndex = session.coverageState.findIndex(
        (c) => c.topic.toUpperCase() === turn.topic.toUpperCase()
      );

      if (topicIndex >= 0) {
        const item = session.coverageState[topicIndex];
        if (
          finalStatus === AnswerStatus.KNOWLEDGE_GAP ||
          finalStatus === AnswerStatus.SKIPPED
        ) {
          item.knowledgeGaps = (item.knowledgeGaps || 0) + 1;
        }

        if (turn.parentTurnId || turn.followUp) {
          item.followupsAsked = (item.followupsAsked || 0) + 1;
        }

        item.bestScore = Math.max(item.bestScore || 0, correctness);

        // Aggregate concepts
        const currentTested = new Set(item.conceptsTested || []);
        if (turn.concept) currentTested.add(turn.concept);
        conceptsDemonstrated.forEach((c) => currentTested.add(c));
        conceptsMissing.forEach((c) => currentTested.add(c));
        item.conceptsTested = Array.from(currentTested);

        const currentKnown = new Set(item.conceptsKnown || []);
        conceptsDemonstrated.forEach((c) => currentKnown.add(c));
        item.conceptsKnown = Array.from(currentKnown);

        const currentMissing = new Set(item.conceptsMissing || []);
        conceptsMissing.forEach((c) => currentMissing.add(c));
        item.conceptsMissing = Array.from(currentMissing);

        // Calculate average score across turns for this topic
        const pastTopicTurns = await InterviewTurn.find({
          sessionId: session._id,
          topic: turn.topic,
          correctnessScore: { $ne: null },
        }).select("correctnessScore difficulty followUpType parentTurnId depthLevel").lean();

        if (pastTopicTurns.length > 0) {
          const sum = pastTopicTurns.reduce((acc, t) => acc + (t.correctnessScore || 0), 0);
          item.averageScore = Math.round(sum / pastTopicTurns.length);
        } else {
          item.averageScore = correctness;
        }

        // Establish topic knowledge level (NONE | BASIC | INTERMEDIATE | STRONG | STRONG_FOUNDATION | EXCELLENT)
        // and distinguish fundamental mastery vs advanced depth
        let fundamentalKnowledge = null;
        let advancedDepth = null;
        let knowledgeSummary = null;

        if (pastTopicTurns.length > 1) {
          const hardTurns = pastTopicTurns.filter(
            (t) => t.difficulty === "HARD" || t.followUpType === "PRACTICAL" || t.followUpType === "VALIDATION"
          );
          const basicTurns = pastTopicTurns.filter(
            (t) => t.difficulty !== "HARD" && t.followUpType !== "PRACTICAL" && t.followUpType !== "VALIDATION"
          );

          const basicScore = basicTurns.length > 0
            ? Math.round(basicTurns.reduce((s, t) => s + (t.correctnessScore || 0), 0) / basicTurns.length)
            : item.bestScore;

          const advScore = hardTurns.length > 0
            ? Math.round(hardTurns.reduce((s, t) => s + (t.correctnessScore || 0), 0) / hardTurns.length)
            : null;

          if (basicScore >= 90) fundamentalKnowledge = "EXCELLENT";
          else if (basicScore >= 75) fundamentalKnowledge = "STRONG";
          else if (basicScore >= 50) fundamentalKnowledge = "INTERMEDIATE";
          else fundamentalKnowledge = "WEAK";

          if (advScore != null) {
            if (advScore >= 80) advancedDepth = "EXCELLENT";
            else if (advScore >= 65) advancedDepth = "STRONG";
            else if (advScore >= 50) advancedDepth = "INTERMEDIATE";
            else advancedDepth = "WEAK";
          } else {
            advancedDepth = item.depthLevel === "DEEP" ? "STRONG" : "UNPROVEN";
          }

          if ((fundamentalKnowledge === "EXCELLENT" || fundamentalKnowledge === "STRONG") && advancedDepth === "WEAK") {
            item.knowledgeLevel = "STRONG_FOUNDATION";
            knowledgeSummary = "Strong foundation / incomplete depth";
          } else if (item.bestScore >= 90 && advancedDepth !== "WEAK") {
            item.knowledgeLevel = "EXCELLENT";
            knowledgeSummary = "Comprehensive mastery across fundamentals and advanced topics";
          } else if (item.bestScore >= 75 && advancedDepth !== "WEAK") {
            item.knowledgeLevel = "STRONG";
            knowledgeSummary = "Solid understanding with adequate depth";
          } else if (item.bestScore >= 55) {
            item.knowledgeLevel = "INTERMEDIATE";
            knowledgeSummary = "Moderate working knowledge";
          } else if (item.bestScore >= 30) {
            item.knowledgeLevel = "BASIC";
            knowledgeSummary = "Foundational surface knowledge";
          } else {
            item.knowledgeLevel = "NONE";
            knowledgeSummary = "Foundational knowledge gap identified";
          }
        } else {
          // Single turn
          if (item.bestScore >= 90) {
            item.knowledgeLevel = "EXCELLENT";
            fundamentalKnowledge = "EXCELLENT";
            advancedDepth = item.depthLevel === "DEEP" ? "EXCELLENT" : "UNPROVEN";
          } else if (item.bestScore >= 75) {
            item.knowledgeLevel = "STRONG";
            fundamentalKnowledge = "STRONG";
            advancedDepth = item.depthLevel === "DEEP" ? "STRONG" : "UNPROVEN";
          } else if (item.bestScore >= 55) {
            item.knowledgeLevel = "INTERMEDIATE";
            fundamentalKnowledge = "INTERMEDIATE";
            advancedDepth = "WEAK";
          } else if (item.bestScore >= 30) {
            item.knowledgeLevel = "BASIC";
            fundamentalKnowledge = "BASIC";
            advancedDepth = "WEAK";
          } else {
            item.knowledgeLevel = "NONE";
            fundamentalKnowledge = "WEAK";
            advancedDepth = "WEAK";
          }
        }

        item.fundamentalKnowledge = fundamentalKnowledge;
        item.advancedDepth = advancedDepth;
        item.knowledgeSummary = knowledgeSummary;

        // Breadth Level (based on distinct verified concepts)
        const knownCount = item.conceptsKnown?.length || 0;
        if (knownCount >= 4) {
          item.breadthLevel = "HIGH";
        } else if (knownCount >= 2) {
          item.breadthLevel = "MEDIUM";
        } else {
          item.breadthLevel = "LOW";
        }

        // Depth Level (highest demonstrated depth)
        if (depthLevel === "DEEP" || item.depthLevel === "DEEP") {
          item.depthLevel = "DEEP";
        } else if (depthLevel === "ADEQUATE" || item.depthLevel === "ADEQUATE") {
          item.depthLevel = "ADEQUATE";
        } else {
          item.depthLevel = "SHALLOW";
        }

        // Evidence Level
        const totalTurnsOnTopic = (item.questionsAsked || 1) + (item.followupsAsked || 0);
        if (totalTurnsOnTopic >= 3 && item.bestScore >= 75 && item.depthLevel !== "SHALLOW") {
          item.evidenceLevel = "HIGH";
        } else if (totalTurnsOnTopic >= 2 || item.depthLevel === "DEEP") {
          item.evidenceLevel = "MEDIUM";
        } else {
          item.evidenceLevel = "LOW";
        }

        // Misconceptions & Contradictions
        const allMisconceptions = new Set(item.misconceptions || []);
        misconceptions.forEach((m) => allMisconceptions.add(m));
        item.misconceptions = Array.from(allMisconceptions);

        const allContradictions = new Set(item.contradictions || []);
        if (contradictionDetected && contradictionDetails) {
          allContradictions.add(contradictionDetails);
        }
        item.contradictions = Array.from(allContradictions);

        // Experience Authenticity
        if (experienceAuthenticity === "PRODUCTION_VERIFIED" || item.experienceAuthenticity === "PRODUCTION_VERIFIED") {
          item.experienceAuthenticity = "PRODUCTION_VERIFIED";
        } else if (experienceAuthenticity === "THEORETICAL_TEXTBOOK" || item.experienceAuthenticity === "THEORETICAL_TEXTBOOK") {
          item.experienceAuthenticity = "THEORETICAL_TEXTBOOK";
        } else if (experienceAuthenticity === "SURFACE_FAMILIARITY") {
          item.experienceAuthenticity = "SURFACE_FAMILIARITY";
        }

        // Depth Established (Evidence-based: requires deep understanding, complete accurate answer, or successful follow-up probe)
        const isTurnDepthProven =
          (depthEstablished === true && depthLevel !== "SHALLOW") ||
          (depthLevel === "DEEP" && practicalUnderstanding === "DEEP") ||
          (correctness >= 90 && completeness >= 85 && depthLevel !== "SHALLOW") ||
          (Boolean(turn.parentTurnId || turn.isFollowUp) && correctness >= 75 && depthLevel !== "SHALLOW");

        item.depthEstablished = Boolean(item.depthEstablished || isTurnDepthProven);
        item.topicState = item.depthEstablished ? "ESTABLISHED" : "EXPLORING";

        // Coverage formula: proportion of target questions asked
        const targetQ = plan?.maxQuestionsPerTopic || 4;
        item.coveragePercentage = Math.min(
          100,
          Math.round(((item.questionsAsked || 1) / targetQ) * 100)
        );

        item.shouldContinue =
          !item.depthEstablished &&
          (item.questionsAsked || 0) < targetQ &&
          (item.followupsAsked || 0) < maxFollowUpsPerTopic;

        session.coverageState[topicIndex] = item;
      }
    }

    // 8. Update Session Candidate Performance Tracking
    if (!session.candidatePerformance) {
      session.candidatePerformance = {
        baselineEstablished: false,
        baselineScore: 0,
        streakCorrect: 0,
        streakGaps: 0,
        consecutiveKnowledgeGapsInTopic: 0,
        runningAccuracy: 0,
      };
    }

    const perf = session.candidatePerformance;
    if (finalStatus === AnswerStatus.ACCURATE) {
      perf.streakCorrect = (perf.streakCorrect || 0) + 1;
      perf.streakGaps = 0;
      perf.consecutiveKnowledgeGapsInTopic = 0;
    } else if (
      finalStatus === AnswerStatus.KNOWLEDGE_GAP ||
      finalStatus === AnswerStatus.SKIPPED
    ) {
      // A no-response counts toward the topic's gap streak so repeated
      // silence eventually moves the interview on to another topic.
      perf.streakGaps = (perf.streakGaps || 0) + 1;
      perf.consecutiveKnowledgeGapsInTopic =
        (perf.consecutiveKnowledgeGapsInTopic || 0) + 1;
      perf.streakCorrect = 0;
    } else {
      perf.streakCorrect = 0;
      perf.consecutiveKnowledgeGapsInTopic = 0;
    }

    // Update running accuracy (rolling average)
    const prevAccuracy = perf.runningAccuracy || 0;
    const turnCount = session.questionCount || 1;
    perf.runningAccuracy = Math.round(
      (prevAccuracy * (turnCount - 1) + correctness) / turnCount
    );

    // Establish candidate baseline after initial turns
    if (turnCount >= 3 && !perf.baselineEstablished) {
      perf.baselineEstablished = true;
      perf.baselineScore = perf.runningAccuracy;
      logger.info(`Baseline established for candidate in session ${session.interviewId}: ${perf.baselineScore}%`);
    }

    session.candidatePerformance = perf;

    // 9. Advance Interview State to WAITING_FOR_NEXT_QUESTION
    session.interviewState = InterviewState.WAITING_FOR_NEXT_QUESTION;

    await session.save();

    // Fold this turn into the candidate's cross-interview concept history
    // (non-fatal — used only to inform future difficulty choices).
    await conceptHistoryService.recordTurn(session.userId, turn);

    logger.info(
      `Turn ${turn.turnNumber} analyzed for session ${session.interviewId}: status=${finalStatus}, score=${correctness}, followUpAllowed=${followUpAllowed}`
    );

    return {
      sessionId: session.interviewId,
      turnId: turn._id.toString(),
      turnNumber: turn.turnNumber,
      topic: turn.topic,
      answerStatus: turn.answerStatus,
      correctnessScore: turn.correctnessScore,
      relevanceScore: turn.relevanceScore,
      completenessScore: turn.completenessScore,
      conceptsDemonstrated: turn.conceptsDemonstrated,
      conceptsMissing: turn.conceptsMissing,
      followUpAllowed,
      feedbackSummary: turn.feedbackSummary,
      interviewState: session.interviewState,
      latencyMetrics: turn.latencyMetrics,
    };
  }
}

export const answerAnalysisService = new AnswerAnalysisService();
export default answerAnalysisService;
