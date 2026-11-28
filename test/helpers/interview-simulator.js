/**
 * In-memory interview simulator for planner/engine tests. Mirrors the
 * bookkeeping interview-session.service.js does around the adaptive engine
 * (topic switch, phase entry, counters, coverage) without a database or AI.
 */
import { adaptiveEngineService } from "../../src/modules/ai-interview/services/adaptive-engine.service.js";
import { phaseService } from "../../src/modules/ai-interview/services/phase.service.js";
import { interviewStrategyService } from "../../src/modules/ai-interview/services/interview-strategy.service.js";
import { experienceLevelResolverService } from "../../src/modules/ai-interview/services/experience-level-resolver.service.js";
import { interviewPlanService } from "../../src/modules/ai-interview/services/interview-plan.service.js";
import { InterviewAction } from "../../src/modules/ai-interview/enums/interview-action.enum.js";

export const FULLSTACK_RESUME = {
  skills: ["React", "JavaScript", "Node.js", "Express", "MongoDB", "Docker", "Figma"],
  primarySkills: ["React", "JavaScript", "Node.js", "Express", "MongoDB"],
  secondarySkills: ["Docker", "Figma"],
  detectedExperienceYears: 0,
  experience: [
    {
      role: "Software Engineer",
      company: "Acme",
      duration: "Jan 2023 - Present",
      responsibilities: ["Built REST APIs in Node.js", "Owned the React checkout flow"],
      technologies: ["React", "Node.js", "MongoDB"],
    },
  ],
  projects: [
    { title: "ShopFast E-commerce", description: "Online store", technologies: ["React", "Node.js", "MongoDB"], architecture: "REST API + SPA", contributions: ["Built cart", "Payment flow"], evidenceSnippet: "Built ShopFast" },
    { title: "ChatHub", description: "Realtime chat", technologies: ["Node.js", "Socket.io"], architecture: "", contributions: ["WebSocket server"], evidenceSnippet: "ChatHub" },
    { title: "Portfolio Site", description: "Personal site", technologies: ["HTML", "CSS"], architecture: "", contributions: [], evidenceSnippet: "Portfolio" },
  ],
};

/** Builds a session + plan exactly as createResumeInterview would (minus DB). */
export function buildPlannedSession({
  experienceLevel = "2-3 Years",
  duration = 30,
  role = "Full Stack Developer",
  interviewTypes = ["technical"],
  extracted = FULLSTACK_RESUME,
  difficulty = "ADAPTIVE",
  focusTopics = [],
} = {}) {
  const profile = experienceLevelResolverService.resolve({ selectedLevel: experienceLevel, extracted });
  const globalQuestionLimit = interviewPlanService.computeGlobalQuestionLimit(duration);
  const strategy = interviewStrategyService.buildStrategy({
    role,
    interviewTypes,
    profile,
    candidateSkills: extracted?.skills || [],
    primarySkills: extracted?.primarySkills || null,
    secondarySkills: extracted?.secondarySkills || null,
    extracted,
    focusTopics,
    duration,
    globalQuestionLimit,
  });
  const plan = {
    difficulty,
    globalQuestionLimit,
    maxQuestionsPerTopic: 4,
    maxFollowUpsPerQuestion: 2,
    maxFollowUpsPerTopic: 3,
    maxGlobalFollowUps: 3,
    topics: strategy.orderedTopics,
    topicBudgets: strategy.topicBudgets,
  };
  const session = {
    interviewId: "sim",
    role,
    experienceLevel,
    interviewTypes,
    difficulty,
    resumeData: { extracted },
    experienceProfile: profile,
    phasePlan: strategy.phasePlan.map((p) => ({ ...p })),
    currentPhase: strategy.phasePlan[0].phase,
    topicOrder: strategy.orderedTopics,
    allowedTopics: strategy.orderedTopics,
    coverageState: strategy.orderedTopics.map((topic) => ({ topic, questionsAsked: 0, status: "PENDING", averageScore: 0, bestScore: 0, knowledgeGaps: 0 })),
    currentTopic: "INTRODUCTION",
    questionCount: 0,
    topicQuestionCount: 0,
    followUpCount: 0,
    topicFollowUpCount: 0,
    globalFollowUpCount: 0,
    candidatePerformance: { streakCorrect: 0, consecutiveKnowledgeGapsInTopic: 0 },
    interviewState: "IN_PROGRESS",
    endTime: new Date(Date.now() + duration * 60 * 1000),
    timeRemaining: duration * 60,
    preparedQuestions: [],
  };
  return { session, plan, profile, strategy };
}

export const ANSWERS = {
  average: () => ({ answerStatus: "PARTIAL", correctnessScore: 70, completenessScore: 80, relevanceScore: 85, depthLevel: "ADEQUATE", knowledgeLevel: "INTERMEDIATE", followUpAllowed: false, followUpRecommended: false }),
  strong: () => ({ answerStatus: "ACCURATE", correctnessScore: 88, completenessScore: 85, relevanceScore: 92, depthLevel: "ADEQUATE", knowledgeLevel: "STRONG", followUpAllowed: false, followUpRecommended: false }),
  weak: () => ({ answerStatus: "INCORRECT", correctnessScore: 20, completenessScore: 30, relevanceScore: 60, depthLevel: "SHALLOW", knowledgeLevel: "BASIC", followUpAllowed: false, followUpRecommended: false }),
};

/**
 * Runs the interview to completion. Returns every turn with its topic,
 * phase, difficulty and whether it was a follow-up.
 */
export function simulateInterview(session, plan, answerFor = ANSWERS.average, { maxTurns = 60 } = {}) {
  const turns = [];
  session.currentTopic = "INTRODUCTION";
  session.questionCount = 1;
  session.topicQuestionCount = 1;
  phaseService.recordQuestion(session, "INTRODUCTION");
  turns.push({ turnNumber: 1, topic: "INTRODUCTION", phase: session.currentPhase, difficulty: "EASY", isFollowUp: false });
  let lastTurn = { turnNumber: 1, topic: "INTRODUCTION", difficulty: "EASY", ...answerFor("INTRODUCTION", session) };

  for (let n = 2; n <= maxTurns; n++) {
    const d = adaptiveEngineService.determineNextAction(session, plan, lastTurn);
    if (d.action === InterviewAction.COMPLETE_INTERVIEW) {
      phaseService.closePlan(session);
      break;
    }

    if (d.action === InterviewAction.FOLLOW_UP) {
      const phaseBefore = session.currentPhase;
      session.followUpCount++;
      session.topicFollowUpCount++;
      session.globalFollowUpCount++;
      turns.push({ turnNumber: n, topic: session.currentTopic, phase: session.currentPhase, phaseBefore, difficulty: d.difficulty || lastTurn.difficulty, isFollowUp: true });
      lastTurn = { turnNumber: n, topic: session.currentTopic, difficulty: d.difficulty || lastTurn.difficulty, isFollowUp: true, ...answerFor(session.currentTopic, session) };
      continue;
    }

    if (d.action === InterviewAction.SWITCH_TOPIC) {
      const prev = session.coverageState.find((c) => c.topic === session.currentTopic);
      if (prev) prev.status = "EVALUATED";
      session.currentTopic = d.nextTopic;
      session.topicQuestionCount = 1;
      session.followUpCount = 0;
      session.topicFollowUpCount = 0;
      phaseService.enterPhaseForTopic(session, d.nextTopic);
      session.candidatePerformance.consecutiveKnowledgeGapsInTopic = 0;
    } else {
      session.topicQuestionCount++;
      session.followUpCount = 0;
    }

    session.questionCount++;
    const answer = answerFor(session.currentTopic, session);
    const cov = session.coverageState.find((c) => c.topic === session.currentTopic);
    if (cov) {
      cov.questionsAsked++;
      cov.status = "IN_PROGRESS";
      cov.averageScore = Math.round(((cov.averageScore || 0) * (cov.questionsAsked - 1) + answer.correctnessScore) / cov.questionsAsked);
      cov.bestScore = Math.max(cov.bestScore || 0, answer.correctnessScore);
    }
    phaseService.recordQuestion(session, session.currentTopic);
    const difficulty = d.difficulty || lastTurn.difficulty;
    turns.push({ turnNumber: n, topic: session.currentTopic, phase: session.currentPhase, difficulty, isFollowUp: false });
    if (answer.answerStatus === "ACCURATE") session.candidatePerformance.streakCorrect++;
    else session.candidatePerformance.streakCorrect = 0;
    lastTurn = { turnNumber: n, topic: session.currentTopic, difficulty, ...answer };
  }
  return turns;
}

/** Collapses consecutive turns into the ordered list of phases visited. */
export function phaseSequence(turns) {
  const seq = [];
  for (const t of turns) if (seq[seq.length - 1] !== t.phase) seq.push(t.phase);
  return seq;
}
