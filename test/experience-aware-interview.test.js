import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import {
  buildPlannedSession,
  simulateInterview,
  phaseSequence,
  ANSWERS,
  FULLSTACK_RESUME,
} from "./helpers/interview-simulator.js";
import { interviewStrategyService, diversifyTopics } from "../src/modules/ai-interview/services/interview-strategy.service.js";
import { experienceLevelResolverService, parseDurationYears } from "../src/modules/ai-interview/services/experience-level-resolver.service.js";
import { parseExperienceLevel, bandForYears } from "../src/modules/ai-interview/constants/experience-bands.js";
import { ResumeTopicService, resumeTopicService } from "../src/modules/ai-interview/resume/resume-topic.service.js";
import { phaseService } from "../src/modules/ai-interview/services/phase.service.js";
import { adaptiveEngineService } from "../src/modules/ai-interview/services/adaptive-engine.service.js";
import { buildQuestionContext } from "../src/modules/ai-interview/services/question-context.service.js";
import { AiQuestionService } from "../src/modules/ai-interview/ai/ai-question.service.js";
import { buildExperienceCalibration } from "../src/modules/ai-interview/ai/ai-answer-analysis.service.js";
import { AiFeedbackService } from "../src/modules/ai-interview/ai/ai-feedback.service.js";
import { InterviewQuestionPlannerService } from "../src/modules/ai-interview/services/interview-question-planner.service.js";
import { FollowUpProbePlannerService } from "../src/modules/ai-interview/services/follow-up-probe-planner.service.js";
import { questionBankService } from "../src/modules/ai-interview/services/question-bank.service.js";
import { questionAudioService } from "../src/modules/ai-interview/tts/question-audio.service.js";
import { InterviewSession } from "../src/modules/ai-interview/schemas/interview-session.schema.js";
import { InterviewTurn } from "../src/modules/ai-interview/schemas/interview-turn.schema.js";
import { InterviewPlan } from "../src/modules/ai-interview/schemas/interview-plan.schema.js";
import { getFallbackQuestion } from "../src/modules/ai-interview/ai/fallback-questions.js";
import { resumeUpload } from "../src/modules/ai-interview/middlewares/resume-upload.middleware.js";
import { QUESTION_CATEGORIES, phaseIndex } from "../src/modules/ai-interview/constants/interview-phases.js";

const P = {
  INTRO: "INTRODUCTION",
  EXP: "PROFESSIONAL_EXPERIENCE",
  CORE: "CORE_TECHNICAL",
  ADV: "ADVANCED_TECHNICAL",
  PROJ: "PROJECT_DEEP_DIVE",
  SCEN: "SCENARIO_BASED",
  EVAL: "EXPERIENCE_EVALUATION",
  CLOSE: "CLOSING",
};

const FRESHER_RESUME = {
  skills: ["JavaScript", "React", "HTML", "CSS", "Node.js"],
  primarySkills: ["JavaScript", "React"],
  secondarySkills: ["HTML", "CSS", "Node.js"],
  detectedExperienceYears: 0,
  experience: [],
  projects: [
    { title: "Todo App", description: "College project", technologies: ["React", "JavaScript"], architecture: "", contributions: ["Built UI"], evidenceSnippet: "Todo App" },
  ],
};

const phasesOf = (session) => session.phasePlan.map((p) => p.phase);
const budgetOf = (session, phase) => session.phasePlan.find((p) => p.phase === phase)?.questionBudget || 0;
const silence = () => {};

/** Captures the prompts the question generator sends, returns a fixed question. */
function capturingLlm(reply = {}) {
  const calls = [];
  return {
    calls,
    generateStructuredJson: async ({ systemPrompt, userPrompt }) => {
      calls.push({ systemPrompt, userPrompt });
      return {
        question: "Explain how React reconciliation decides which DOM nodes to update.",
        concept: "reconciliation",
        topic: "REACT",
        difficulty: "MEDIUM",
        questionType: "CONCEPTUAL",
        competency: "Technical Knowledge",
        ...reply,
      };
    },
  };
}

test("Experience-aware interview planning and generation", async (t) => {
  const origSave = questionBankService.saveGeneratedQuestion;
  const origGetBank = questionBankService.getBankQuestion;
  questionBankService.saveGeneratedQuestion = async () => null;
  questionBankService.getBankQuestion = async () => null;
  t.after(() => {
    questionBankService.saveGeneratedQuestion = origSave;
    questionBankService.getBankQuestion = origGetBank;
  });

  // ---------------------------------------------------------------------
  // Phase flow
  // ---------------------------------------------------------------------
  await t.test("1. Introduction is never followed directly by a project deep dive (all bands, durations)", () => {
    for (const experienceLevel of ["0-1 Years", "1-2 Years", "2-3 Years", "3-5 Years", "5+ Years", "10+ Years"]) {
      for (const duration of [15, 30, 45, 60]) {
        for (const extracted of [FULLSTACK_RESUME, FRESHER_RESUME]) {
          const { session, plan } = buildPlannedSession({ experienceLevel, duration, extracted });
          const seq = phaseSequence(simulateInterview(session, plan));
          assert.equal(seq[0], P.INTRO);
          assert.ok(
            [P.EXP, P.CORE].includes(seq[1]),
            `${experienceLevel}/${duration}m: after intro got ${seq[1]}`
          );
          // Every technical phase that runs comes before any project question.
          const firstProject = seq.indexOf(P.PROJ);
          if (firstProject >= 0) {
            assert.ok(seq.indexOf(P.CORE) >= 0 && seq.indexOf(P.CORE) < firstProject);
            if (seq.includes(P.ADV)) assert.ok(seq.indexOf(P.ADV) < firstProject);
          }
          // Phases only move forward.
          for (let i = 1; i < seq.length; i++) assert.ok(phaseIndex(seq[i]) > phaseIndex(seq[i - 1]), seq.join(" > "));
        }
      }
    }
  });

  await t.test("Acceptance: React/Node/MongoDB resume with three projects follows the natural interview order", () => {
    const { session, plan } = buildPlannedSession({ experienceLevel: "2-3 Years", duration: 30 });
    const turns = simulateInterview(session, plan);
    assert.deepEqual(phaseSequence(turns), [P.INTRO, P.EXP, P.CORE, P.ADV, P.PROJ, P.SCEN, P.EVAL]);
    const coreTopics = turns.filter((x) => x.phase === P.CORE).map((x) => x.topic);
    assert.deepEqual(coreTopics, ["REACT", "NODE.JS"], "frontend then backend fundamentals");
    assert.equal(session.currentPhase, P.CLOSE, "interview ends in CLOSING");
  });

  await t.test("2. A fresher and a 5-year developer get different phase plans", () => {
    const fresher = buildPlannedSession({ experienceLevel: "0-1 Years", extracted: FRESHER_RESUME }).session;
    const senior = buildPlannedSession({ experienceLevel: "5+ Years" }).session;
    assert.equal(fresher.experienceProfile.band, "FRESHER");
    assert.equal(senior.experienceProfile.band, "SENIOR");
    assert.notDeepEqual(phasesOf(fresher), phasesOf(senior));
    assert.ok(!phasesOf(fresher).includes(P.ADV), "freshers get no advanced phase up front");
    assert.ok(!phasesOf(fresher).includes(P.EXP), "no work history -> no professional-experience phase");
    assert.ok(budgetOf(fresher, P.CORE) > budgetOf(senior, P.CORE), "freshers spend more on fundamentals");
    assert.ok(budgetOf(senior, P.ADV) > budgetOf(senior, P.CORE), "seniors spend more on advanced depth");
  });

  await t.test("3. Seniors and leads receive architecture / system design evaluation", () => {
    for (const lvl of ["5+ Years", "Lead Engineer"]) {
      const { session } = buildPlannedSession({ experienceLevel: lvl, extracted: { ...FULLSTACK_RESUME, detectedExperienceYears: lvl === "5+ Years" ? 6 : 9 } });
      const adv = session.phasePlan.find((p) => p.phase === P.ADV);
      assert.ok(adv?.topics.includes("SYSTEM_DESIGN"), `${lvl}: ${adv?.topics}`);
    }
    const lead = buildPlannedSession({ experienceLevel: "8-10 Years", duration: 60, extracted: { ...FULLSTACK_RESUME, detectedExperienceYears: 9 } }).session;
    assert.equal(lead.experienceProfile.band, "LEAD");
    assert.ok(lead.phasePlan.find((p) => p.phase === P.ADV).topics.includes("DISTRIBUTED_SYSTEMS"));
    assert.equal(lead.phasePlan.find((p) => p.phase === P.EVAL).topics[0], "TECHNICAL_LEADERSHIP");
  });

  await t.test("4. Technical fundamentals are never skipped, even for short senior interviews with big projects", () => {
    for (const lvl of ["5+ Years", "10+ Years"]) {
      for (const duration of [5, 10, 15]) {
        const { session, plan } = buildPlannedSession({ experienceLevel: lvl, duration });
        assert.ok(budgetOf(session, P.CORE) >= 1, `${lvl}/${duration}m has no core phase`);
        const seq = phaseSequence(simulateInterview(session, plan));
        assert.ok(seq.includes(P.CORE));
      }
    }
  });

  await t.test("5. Duration is respected: question budgets, time budgets and the simulated run fit the limit", () => {
    for (const duration of [10, 15, 30, 45, 60, 90]) {
      for (const lvl of ["0-1 Years", "2-3 Years", "5+ Years"]) {
        const { session, plan } = buildPlannedSession({ experienceLevel: lvl, duration });
        const total = session.phasePlan.reduce((n, p) => n + p.questionBudget, 0);
        assert.equal(total, plan.globalQuestionLimit, `${lvl}/${duration}m budgets sum`);
        const seconds = session.phasePlan.reduce((n, p) => n + (p.timeBudgetSeconds || 0), 0);
        assert.ok(seconds <= duration * 60 + 5, `${lvl}/${duration}m time budget ${seconds}s`);
        const turns = simulateInterview(session, plan);
        assert.ok(turns.length <= plan.globalQuestionLimit);
        assert.ok(session.phasePlan.at(-1).phase === P.CLOSE, "closing phase kept");
      }
    }
    // Shorter interviews keep fewer phases, by band priority.
    const short = buildPlannedSession({ experienceLevel: "2-3 Years", duration: 15 }).session;
    const long = buildPlannedSession({ experienceLevel: "2-3 Years", duration: 60 }).session;
    assert.ok(phasesOf(short).length < phasesOf(long).length);
  });

  await t.test("5b. A phase that overruns its time budget is treated as finished", () => {
    const { session } = buildPlannedSession({ experienceLevel: "2-3 Years", duration: 30 });
    phaseService.enterPhaseForTopic(session, "REACT");
    const core = session.phasePlan.find((p) => p.phase === P.CORE);
    core.questionsAsked = 1;
    core.startedAt = new Date(Date.now() - core.timeBudgetSeconds * 1000 * 2);
    assert.equal(phaseService.isPhaseExhausted(session), true);
    core.startedAt = new Date();
    assert.equal(phaseService.isPhaseExhausted(session), false);
  });

  await t.test("6. Project phase is planned only with resume evidence and placed after technical phases", () => {
    const noProjects = buildPlannedSession({
      experienceLevel: "0-1 Years",
      extracted: { ...FRESHER_RESUME, projects: [] },
    }).session;
    assert.ok(!phasesOf(noProjects).includes(P.PROJ));

    const withProjects = buildPlannedSession({ experienceLevel: "2-3 Years" }).session;
    const order = phasesOf(withProjects);
    assert.ok(order.indexOf(P.PROJ) > order.indexOf(P.CORE));
    assert.ok(order.indexOf(P.PROJ) > order.indexOf(P.ADV));
  });

  await t.test("12. Interview types keep their behaviour", () => {
    assert.equal(interviewStrategyService.appliesTo(["hr"]), false);
    assert.equal(interviewStrategyService.appliesTo(["behavioral"]), false);
    assert.equal(interviewStrategyService.appliesTo(["coding"]), false);
    assert.equal(interviewStrategyService.appliesTo(["technical"]), true);
    assert.equal(interviewStrategyService.appliesTo(["mixed"]), true);

    // Pure HR keeps HR topics (keyword plan built by the session service).
    const hrTopics = resumeTopicService.selectInterviewTopics({ interviewTypes: ["hr"], duration: 30 });
    assert.ok(hrTopics.includes("CULTURE_FIT"));
    const hrPlan = phaseService.build(hrTopics, { globalQuestionLimit: 9 });
    assert.ok(hrPlan.every((p) => [P.EXP, P.EVAL].includes(p.phase)), JSON.stringify(hrPlan.map((p) => p.phase)));

    // Mixed folds system design into ADVANCED and HR/behavioral into EVALUATION.
    const mixed = buildPlannedSession({ experienceLevel: "2-3 Years", duration: 60, interviewTypes: ["mixed"] }).session;
    const adv = mixed.phasePlan.find((p) => p.phase === P.ADV);
    const evalPhase = mixed.phasePlan.find((p) => p.phase === P.EVAL);
    assert.ok(adv.topics.includes("HIGH_LEVEL_ARCHITECTURE"), adv.topics.join());
    assert.ok(evalPhase.topics.some((x) => ["LEADERSHIP", "CULTURE_FIT"].includes(x)), evalPhase.topics.join());

    // A junior who asks for system design gets it even though the band doesn't plan it.
    const juniorSd = buildPlannedSession({ experienceLevel: "1-2 Years", duration: 45, interviewTypes: ["technical", "system_design"] }).session;
    assert.ok(juniorSd.phasePlan.find((p) => p.phase === P.ADV)?.topics.includes("HIGH_LEVEL_ARCHITECTURE"));
  });

  // ---------------------------------------------------------------------
  // Experience resolution
  // ---------------------------------------------------------------------
  await t.test("Experience levels parse into the documented bands", () => {
    const cases = {
      "0-1 Years": "FRESHER",
      Fresher: "FRESHER",
      FRESHER: "FRESHER",
      "1-2 Years": "JUNIOR",
      "1-3 Years": "JUNIOR",
      "2-3 Years": "MID",
      "3-5 Years": "MID",
      "5+ Years": "SENIOR",
      "7+ Years": "LEAD",
      "Senior Engineer": "SENIOR",
      "Tech Lead": "LEAD",
    };
    for (const [input, band] of Object.entries(cases)) {
      assert.equal(bandForYears(parseExperienceLevel(input)), band, input);
    }
    assert.equal(parseExperienceLevel(""), null);
    assert.equal(parseExperienceLevel(null), null);
  });

  await t.test("Work-history durations are read from resume dates", () => {
    const now = new Date("2026-11-01");
    assert.ok(Math.abs(parseDurationYears("Jan 2023 - Present", now) - 3.8) < 0.1);
    assert.ok(Math.abs(parseDurationYears("2019 – 2022", now) - 3) < 0.01);
    assert.ok(Math.abs(parseDurationYears("2 years 6 months", now) - 2.5) < 0.01);
    assert.equal(parseDurationYears("Remote", now), null);
  });

  await t.test("Conflicting selected and resume experience is reconciled, not silently overridden", () => {
    const resume = { experience: [{ role: "Engineer", company: "X", duration: "2016 - 2025" }] };
    const p = experienceLevelResolverService.resolve({ selectedLevel: "0-1 Years", extracted: resume, now: new Date("2026-01-01") });
    assert.equal(p.conflict, true);
    assert.equal(p.source, "RECONCILED");
    assert.equal(p.selectedBand, "FRESHER");
    assert.equal(p.resumeBand, "LEAD");
    assert.equal(p.band, "MID", "starts between the two");
    assert.equal(p.selectedLevel, "0-1 Years", "original input preserved");
    assert.ok(p.note);

    const agree = experienceLevelResolverService.resolve({ selectedLevel: "2-3 Years", extracted: { detectedExperienceYears: 4 } });
    assert.equal(agree.conflict, false);
    assert.equal(agree.band, "MID", "within one band: trust the selection");

    const resumeOnly = experienceLevelResolverService.resolve({ selectedLevel: null, extracted: { detectedExperienceYears: 6 } });
    assert.equal(resumeOnly.band, "SENIOR");
    assert.equal(resumeOnly.source, "RESUME");
  });

  // ---------------------------------------------------------------------
  // Skill prioritisation
  // ---------------------------------------------------------------------
  await t.test("4. Secondary skills do not outrank equally relevant primary skills", () => {
    const ranked = ResumeTopicService.rankSkills({
      role: "Backend Developer",
      candidateSkills: ["Redis", "Node.js", "PostgreSQL", "Kafka"],
      primarySkills: ["Node.js", "Kafka"],
      secondarySkills: ["Redis", "PostgreSQL"],
    });
    const idx = (t) => ranked.findIndex((r) => r.topic === t);
    assert.ok(idx("NODE.JS") < idx("REDIS"), "primary core before secondary core");
    assert.ok(idx("NODE.JS") < idx("POSTGRESQL"));
    assert.equal(ranked.find((r) => r.topic === "REDIS").evidence, "SECONDARY");

    // selectInterviewTopics honours it too.
    const topics = resumeTopicService.selectInterviewTopics({
      role: "Backend Developer",
      candidateSkills: ["Redis", "Node.js"],
      primarySkills: ["Node.js"],
      secondarySkills: ["Redis"],
      duration: 15,
    });
    assert.equal(topics[0], "NODE.JS");
  });

  await t.test("Advanced questions are only planned on evidence-backed skills", () => {
    const { session } = buildPlannedSession({ experienceLevel: "2-3 Years", duration: 90 });
    const adv = session.phasePlan.find((p) => p.phase === P.ADV).topics;
    assert.ok(!adv.includes("ADVANCED_DOCKER"), "Docker is only listed, not used");
    assert.ok(!adv.includes("ADVANCED_FIGMA"));
  });

  await t.test("Full-stack coverage is spread across frontend, backend and data", () => {
    assert.deepEqual(diversifyTopics(["REACT", "JAVASCRIPT", "NODE.JS", "EXPRESS", "MONGODB"]).slice(0, 3), ["REACT", "NODE.JS", "MONGODB"]);
  });

  await t.test("No technology is invented to fill slots", () => {
    const { session } = buildPlannedSession({
      experienceLevel: "2-3 Years",
      duration: 60,
      extracted: { skills: ["Python"], primarySkills: ["Python"], secondarySkills: [], projects: [], experience: [] },
    });
    const all = session.phasePlan.flatMap((p) => p.topics);
    for (const t of ["REACT", "NODE.JS", "JAVASCRIPT", "MONGODB"]) assert.ok(!all.includes(t), t);
    assert.ok(all.includes("PYTHON"));
  });

  // ---------------------------------------------------------------------
  // Categories and prompts
  // ---------------------------------------------------------------------
  await t.test("2. Technical questions are generated without project context even when the resume has projects", async () => {
    const { session } = buildPlannedSession({ experienceLevel: "2-3 Years" });
    const ctx = buildQuestionContext(session, "REACT");
    assert.equal(ctx.questionCategory, QUESTION_CATEGORIES.TECHNICAL_CONCEPT);
    assert.equal(ctx.projectContext, null);

    const llm = capturingLlm();
    const ai = new AiQuestionService(llm);
    await ai.generateQuestion({ role: "Full Stack Developer", experienceLevel: "2-3 Years", topic: "REACT", difficulty: "MEDIUM", ...ctx });
    const { systemPrompt, userPrompt } = llm.calls[0];
    for (const title of FULLSTACK_RESUME.projects.map((p) => p.title)) {
      assert.ok(!systemPrompt.includes(title) && !userPrompt.includes(title), `prompt mentions ${title}`);
    }
    assert.match(systemPrompt, /Ask a standalone technical question/);
    assert.match(systemPrompt, /Do not mention resume projects/);

    // Second question on the same topic moves to implementation, still no project.
    const ctx2 = buildQuestionContext(session, "REACT", { topicQuestionIndex: 1 });
    assert.equal(ctx2.questionCategory, QUESTION_CATEGORIES.TECHNICAL_IMPLEMENTATION);
    assert.equal(ctx2.projectContext, null);
    assert.equal(buildQuestionContext(session, "ADVANCED_REACT").projectContext, null);
  });

  await t.test("3. Project questions use a matching resume project and rotate between projects", async () => {
    const { session } = buildPlannedSession({ experienceLevel: "2-3 Years" });
    const first = buildQuestionContext(session, "PROJECT_DEEP_DIVE", { projectRotation: 0 });
    const second = buildQuestionContext(session, "PROJECT_DEEP_DIVE", { projectRotation: 1 });
    assert.equal(first.questionCategory, QUESTION_CATEGORIES.PROJECT_DEEP_DIVE);
    assert.equal(first.projectTitle, "ShopFast E-commerce", "best tech overlap first");
    assert.notEqual(second.projectTitle, first.projectTitle);

    const llm = capturingLlm();
    await new AiQuestionService(llm).generateQuestion({ topic: "PROJECT_DEEP_DIVE", difficulty: "MEDIUM", ...first });
    assert.match(llm.calls[0].userPrompt, /ShopFast E-commerce/);
    assert.match(llm.calls[0].systemPrompt, /Use only project information supported by the resume/);
  });

  await t.test("Experience questions use work history, not projects", () => {
    const { session } = buildPlannedSession({ experienceLevel: "2-3 Years" });
    const ctx = buildQuestionContext(session, "WORK_EXPERIENCE");
    assert.equal(ctx.questionCategory, QUESTION_CATEGORIES.EXPERIENCE);
    assert.equal(ctx.projectContext, null);
    assert.equal(ctx.workHistory[0].company, "Acme");
  });

  await t.test("5. The same topic is pitched differently for a fresher and a senior", async () => {
    const prompts = {};
    for (const [lvl, extracted] of [["0-1 Years", FRESHER_RESUME], ["5+ Years", FULLSTACK_RESUME]]) {
      const { session } = buildPlannedSession({ experienceLevel: lvl, extracted });
      const llm = capturingLlm({ topic: "NODE.JS" });
      await new AiQuestionService(llm).generateQuestion({ topic: "NODE.JS", difficulty: "MEDIUM", experienceLevel: lvl, ...buildQuestionContext(session, "NODE.JS") });
      prompts[lvl] = llm.calls[0].systemPrompt;
    }
    assert.match(prompts["0-1 Years"], /Fresher \(0–1 years\)/);
    assert.match(prompts["0-1 Years"], /Do not expect production/);
    assert.match(prompts["5+ Years"], /Senior \(4–7 years\)/);
    assert.match(prompts["5+ Years"], /architecture and trade-off reasoning/);
  });

  await t.test("The planner owns the topic: generator output cannot move it", async () => {
    const llm = capturingLlm({ topic: "PROJECT_DEEP_DIVE" });
    const out = await new AiQuestionService(llm).generateQuestion({ topic: "REACT", difficulty: "EASY", questionCategory: QUESTION_CATEGORIES.TECHNICAL_CONCEPT });
    assert.equal(out.topic, "REACT");
    assert.equal(out.questionType, "CONCEPTUAL");
    assert.equal(out.questionCategory, QUESTION_CATEGORIES.TECHNICAL_CONCEPT);
  });

  await t.test("Offline fallback questions follow the phase topics", () => {
    assert.match(getFallbackQuestion("WORK_EXPERIENCE", "EASY").question, /role|work/i);
    assert.match(getFallbackQuestion("TECHNICAL_SCENARIOS", "MEDIUM").question, /investigate|debug|slow|find/i);
    const adv = getFallbackQuestion("ADVANCED_REACT", "MEDIUM");
    assert.equal(adv.difficulty, "HARD", "advanced uses the skill bank one notch up");
    assert.equal(adv.topic, "ADVANCED_REACT");
  });

  // ---------------------------------------------------------------------
  // Difficulty and adaptation
  // ---------------------------------------------------------------------
  await t.test("6/7. Freshers start easy; mid and senior candidates start deeper and reach HARD in advanced", () => {
    const fresher = buildPlannedSession({ experienceLevel: "0-1 Years", extracted: FRESHER_RESUME });
    const fTurns = simulateInterview(fresher.session, fresher.plan);
    const firstTech = fTurns.find((x) => x.phase === P.CORE);
    assert.equal(firstTech.difficulty, "EASY");
    assert.ok(!fTurns.some((x) => x.difficulty === "HARD"), "average fresher never reaches HARD");

    const senior = buildPlannedSession({ experienceLevel: "5+ Years" });
    const sTurns = simulateInterview(senior.session, senior.plan);
    assert.equal(sTurns.find((x) => x.phase === P.CORE).difficulty, "MEDIUM");
    assert.ok(sTurns.filter((x) => x.phase === P.ADV).every((x) => x.difficulty === "HARD"));
  });

  await t.test("5H. Performance moves difficulty both ways", () => {
    const strongJunior = buildPlannedSession({ experienceLevel: "1-2 Years", duration: 60 });
    const up = simulateInterview(strongJunior.session, strongJunior.plan, ANSWERS.strong);
    assert.ok(up.some((x) => x.difficulty === "HARD"), "strong junior is pushed harder");
    assert.equal(up.find((x) => x.phase === P.CORE).difficulty, "EASY", "but not from the first question");

    const weakMid = buildPlannedSession({ experienceLevel: "2-3 Years", duration: 60 });
    const down = simulateInterview(weakMid.session, weakMid.plan, ANSWERS.weak);
    const core = down.filter((x) => x.phase === P.CORE).map((x) => x.difficulty);
    assert.equal(core[0], "MEDIUM");
    assert.ok(core.includes("EASY"), `weak answers step down: ${core}`);
  });

  await t.test("Weak fundamentals skip the advanced phase instead of stacking harder questions", () => {
    const { session, plan } = buildPlannedSession({ experienceLevel: "2-3 Years", duration: 60 });
    const turns = simulateInterview(session, plan, ANSWERS.weak);
    assert.ok(!turns.some((x) => x.phase === P.ADV));
    assert.equal(session.phasePlan.find((p) => p.phase === P.ADV).status, "SKIPPED");
    assert.ok(turns.some((x) => x.phase === P.PROJ), "interview continues to projects");
  });

  // ---------------------------------------------------------------------
  // Follow-ups
  // ---------------------------------------------------------------------
  await t.test("8. Follow-up prompts respect the current phase", async () => {
    const llm = capturingLlm();
    const ai = new AiQuestionService(llm);
    const base = {
      topic: "REACT",
      difficulty: "MEDIUM",
      previousQuestion: "What is the virtual DOM?",
      candidateAnswer: "It is a copy of the DOM.",
      experienceAuthenticity: "THEORETICAL_TEXTBOOK",
      projectContext: { title: "ShopFast E-commerce", technologies: ["React"] },
    };
    await ai.generateFollowUpQuestion({ ...base, phase: P.CORE, questionCategory: QUESTION_CATEGORIES.TECHNICAL_CONCEPT });
    const core = llm.calls[0].systemPrompt;
    assert.ok(!core.includes("ShopFast"), "technical follow-up must not pivot to a project");
    assert.match(core, /Stay in the current interview phase \(CORE_TECHNICAL\)/);
    assert.match(core, /do not move to a different topic or phase/);

    await ai.generateFollowUpQuestion({ ...base, topic: "PROJECT_DEEP_DIVE", phase: P.PROJ, questionCategory: QUESTION_CATEGORIES.PROJECT_DEEP_DIVE });
    assert.match(llm.calls[1].systemPrompt, /ShopFast E-commerce/);

    const out = await new AiQuestionService(capturingLlm({ topic: "SYSTEM_DESIGN" })).generateFollowUpQuestion({ ...base, questionCategory: QUESTION_CATEGORIES.TECHNICAL_CONCEPT });
    assert.equal(out.topic, "REACT", "follow-up output cannot change topic");
  });

  await t.test("9. Follow-ups never cause phase transitions", () => {
    const { session, plan } = buildPlannedSession({ experienceLevel: "2-3 Years", duration: 45 });
    const probing = () => ({ ...ANSWERS.average(), answerStatus: "PARTIAL", correctnessScore: 65, completenessScore: 60, depthLevel: "SHALLOW", followUpAllowed: true, followUpRecommended: true, conceptsMissing: ["detail"] });
    const turns = simulateInterview(session, plan, probing);
    const followUps = turns.filter((x) => x.isFollowUp);
    assert.ok(followUps.length > 0, "scenario should produce follow-ups");
    for (const f of followUps) assert.equal(f.phase, f.phaseBefore);
    const seq = phaseSequence(turns);
    for (let i = 1; i < seq.length; i++) assert.ok(phaseIndex(seq[i]) > phaseIndex(seq[i - 1]));
  });

  await t.test("Prefetched probes are phase- and experience-aware", () => {
    const probes = new FollowUpProbePlannerService();
    const project = probes.synthesizeProbes({ topic: "PROJECT_DEEP_DIVE", id: "q1" }, "Dev", { category: QUESTION_CATEGORIES.PROJECT_DEEP_DIVE });
    assert.ok(project.every((p) => !/PROJECT_DEEP_DIVE/.test(p.question)));
    assert.ok(project.every((p) => p.topic === "PROJECT_DEEP_DIVE"));

    const fresher = probes.synthesizeProbes({ topic: "VUE", id: "q2", questionText: "x" }, "Dev", { category: QUESTION_CATEGORIES.TECHNICAL_CONCEPT, band: "FRESHER" });
    assert.ok(fresher.every((p) => !/high-throughput production/.test(p.question)));
    const senior = probes.synthesizeProbes({ topic: "VUE", id: "q3", questionText: "x" }, "Dev", { category: QUESTION_CATEGORIES.TECHNICAL_CONCEPT, band: "SENIOR" });
    assert.ok(senior.some((p) => /high-throughput production/.test(p.question)));
  });

  // ---------------------------------------------------------------------
  // Buffering
  // ---------------------------------------------------------------------
  await t.test("10. Buffered questions follow phase order and budgets", () => {
    const planner = new InterviewQuestionPlannerService({});
    const { session, plan } = buildPlannedSession({ experienceLevel: "2-3 Years", duration: 30 });

    // In INTRODUCTION: work experience and core topics, never projects.
    session.currentPhase = P.INTRO;
    let targets = planner.determineTopicsToBuffer(session, plan, []);
    assert.ok(targets.length > 0);
    assert.equal(targets[0].topic, "WORK_EXPERIENCE");
    assert.ok(!targets.some((x) => ["PROJECT_DEEP_DIVE", "TECHNICAL_SCENARIOS"].includes(x.topic)), JSON.stringify(targets));
    assert.equal(targets.filter((x) => x.topic === "WORK_EXPERIENCE").length, 1, "capped at the phase budget");

    // In CORE: core then advanced; still nothing from the project phase.
    phaseService.enterPhaseForTopic(session, "REACT");
    session.currentTopic = "REACT";
    targets = planner.determineTopicsToBuffer(session, plan, [{ topic: "INTRODUCTION" }, { topic: "WORK_EXPERIENCE" }]);
    assert.equal(targets[0].topic, "REACT");
    assert.ok(!targets.some((x) => x.topic === "PROJECT_DEEP_DIVE"), JSON.stringify(targets));
    const advIdx = targets.findIndex((x) => x.topic.startsWith("ADVANCED_"));
    const coreIdx = targets.map((x) => x.topic).lastIndexOf("NODE.JS");
    assert.ok(advIdx === -1 || advIdx > coreIdx, "current phase first");
  });

  await t.test("Fresher pre-buffer never prepares HARD questions", () => {
    const planner = new InterviewQuestionPlannerService({});
    const { session, plan } = buildPlannedSession({ experienceLevel: "0-1 Years", extracted: FRESHER_RESUME, duration: 45 });
    phaseService.enterPhaseForTopic(session, session.topicOrder[0]);
    const targets = planner.determineTopicsToBuffer(session, plan, []);
    assert.ok(targets.length > 0);
    assert.ok(targets.every((x) => x.difficulty !== "HARD"), JSON.stringify(targets));
  });

  await t.test("10/11. replenishPool stores phase-tagged questions, rotates projects and drops duplicates", async () => {
    const { session, plan } = buildPlannedSession({ experienceLevel: "2-3 Years", duration: 60 });
    phaseService.enterPhaseForTopic(session, "PROJECT_DEEP_DIVE");
    session.currentTopic = "PROJECT_DEEP_DIVE";
    session._id = new mongoose.Types.ObjectId();
    session.interviewState = "IN_PROGRESS";

    const pushed = [];
    const contexts = [];
    let call = 0;
    const ai = {
      generateQuestion: async (ctx) => {
        contexts.push(ctx);
        call++;
        // The second generated question duplicates the first -> must be skipped.
        const text = call === 2 ? "Same question?" : call === 1 ? "Same question?" : `Q${call} about ${ctx.topic}`;
        return { question: text, concept: `c${call}`, topic: ctx.topic, difficulty: ctx.difficulty, questionType: "PROJECT", competency: "x" };
      },
    };

    const orig = {
      foau: InterviewSession.findOneAndUpdate,
      uo: InterviewSession.updateOne,
      fbi: InterviewSession.findById,
      tf: InterviewTurn.find,
      pf: InterviewPlan.findById,
      prewarm: questionAudioService.prewarm,
    };
    try {
      InterviewSession.findOneAndUpdate = async () => ({ _id: session._id });
      InterviewSession.updateOne = async (_q, update) => {
        if (update?.$push?.preparedQuestions) pushed.push(update.$push.preparedQuestions);
        return { modifiedCount: 1 };
      };
      InterviewSession.findById = () => {
        const p = Promise.resolve(session);
        p.select = () => ({ lean: async () => ({ interviewState: "IN_PROGRESS" }) });
        return p;
      };
      InterviewTurn.find = () => ({ sort: () => ({ select: () => ({ lean: async () => [] }) }) });
      InterviewPlan.findById = async () => plan;
      questionAudioService.prewarm = silence;

      await new InterviewQuestionPlannerService(ai).replenishPool(session._id);
    } finally {
      InterviewSession.findOneAndUpdate = orig.foau;
      InterviewSession.updateOne = orig.uo;
      InterviewSession.findById = orig.fbi;
      InterviewTurn.find = orig.tf;
      InterviewPlan.findById = orig.pf;
      questionAudioService.prewarm = orig.prewarm;
    }

    const texts = pushed.map((q) => q.question);
    assert.equal(new Set(texts).size, texts.length, "no duplicate stored");
    const projectQs = pushed.filter((q) => q.topic === "PROJECT_DEEP_DIVE");
    assert.ok(projectQs.length >= 1);
    assert.ok(projectQs.every((q) => q.questionCategory === QUESTION_CATEGORIES.PROJECT_DEEP_DIVE && q.projectTitle));
    const projectCtx = contexts.filter((c) => c.topic === "PROJECT_DEEP_DIVE").map((c) => c.projectContext?.title);
    assert.ok(new Set(projectCtx).size > 1, `rotates projects: ${projectCtx}`);
    assert.ok(pushed.every((q) => q.topic !== "INTRODUCTION"));
  });

  await t.test("After a phase transition, leftover buffered questions from earlier phases are discarded", async () => {
    const { session } = buildPlannedSession({ experienceLevel: "2-3 Years" });
    session._id = new mongoose.Types.ObjectId();
    session.preparedQuestions = [
      { topic: "REACT", status: "READY" },
      { topic: "PROJECT_DEEP_DIVE", status: "READY" },
    ];
    phaseService.enterPhaseForTopic(session, "PROJECT_DEEP_DIVE");
    let filter;
    const orig = InterviewSession.updateOne;
    try {
      InterviewSession.updateOne = async (_q, _u, opts) => {
        filter = opts.arrayFilters[0];
        return { modifiedCount: 1 };
      };
      const n = await new InterviewQuestionPlannerService({}).discardOutOfPhaseQuestions(session);
      assert.equal(n, 1);
    } finally {
      InterviewSession.updateOne = orig;
    }
    assert.ok(filter["elem.topic"].$in.includes("REACT"));
    assert.ok(!filter["elem.topic"].$in.includes("PROJECT_DEEP_DIVE"));
  });

  // ---------------------------------------------------------------------
  // Evaluation and reports
  // ---------------------------------------------------------------------
  await t.test("10H. Evaluation and reports use experience-appropriate criteria", async () => {
    const fresher = buildExperienceCalibration({ band: "FRESHER" }, QUESTION_CATEGORIES.TECHNICAL_CONCEPT);
    const senior = buildExperienceCalibration({ band: "SENIOR" });
    assert.match(fresher, /Do not penalise missing production/);
    assert.match(fresher, /fundamentals, logical thinking, learning ability/);
    assert.match(senior, /purely textbook answer .* is SHALLOW/);
    assert.match(senior, /architecture, scalability, decision-making/);
    assert.equal(buildExperienceCalibration(null), "", "older sessions unchanged");

    const llm = capturingLlm({ overallFeedback: "ok", perQuestion: [] });
    await new AiFeedbackService(llm).generateInterviewFeedback({
      role: "Dev", experienceLevel: "5+ Years", score: 70, readinessScore: 70, strengths: [], weaknesses: [], turnsSummary: [],
      experienceProfile: { band: "SENIOR" },
    });
    assert.match(llm.calls[0].systemPrompt, /Judge the candidate as a Senior/);
  });

  // ---------------------------------------------------------------------
  // Compatibility
  // ---------------------------------------------------------------------
  await t.test("Sessions saved with the old phase names keep working", () => {
    const legacy = {
      interviewId: "legacy",
      currentPhase: "TECHNICAL",
      phasePlan: [
        { phase: "INTRO", topics: ["INTRO"], questionBudget: 1, questionsAsked: 1, status: "COMPLETED" },
        { phase: "TECHNICAL", topics: ["REACT"], questionBudget: 1, questionsAsked: 1, status: "IN_PROGRESS" },
        { phase: "PROJECT", topics: ["PROJECT_ARCHITECTURE"], questionBudget: 2, questionsAsked: 0, status: "PENDING" },
      ],
      coverageState: [],
    };
    assert.equal(phaseService.isPhaseExhausted(legacy), true);
    assert.equal(phaseService.nextPhaseFirstTopic(legacy), "PROJECT_ARCHITECTURE");
    phaseService.enterPhaseForTopic(legacy, "PROJECT_ARCHITECTURE");
    assert.equal(legacy.currentPhase, "PROJECT");
    assert.equal(legacy.phasePlan[1].status, "COMPLETED");
    // Without an experience profile the engine keeps its old EASY baseline.
    assert.equal(adaptiveEngineService.determineBaselineDifficulty("ADAPTIVE"), "EASY");
  });

  await t.test(".doc uploads are rejected with an accurate message; PDF and DOCX pass", async () => {
    const filter = resumeUpload.fileFilter || resumeUpload.storage?.fileFilter;
    const check = (originalname, mimetype) =>
      new Promise((resolve) => {
        const run = filter || ((req, file, cb) => resumeUpload._fileFilter?.(req, file, cb));
        run({}, { originalname, mimetype }, (err, ok) => resolve({ err, ok }));
      });
    if (!filter) {
      // multer keeps the filter private; exercise it through a single() handler.
      const handler = resumeUpload.single("resume");
      assert.ok(typeof handler === "function");
    }
    const doc = await check("cv.doc", "application/msword");
    assert.ok(doc.err, "doc must be rejected");
    assert.match(doc.err.message, /\.doc files aren't supported.*PDF or DOCX/);
    assert.equal((await check("cv.pdf", "application/pdf")).ok, true);
    assert.equal((await check("cv.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).ok, true);
  });
});
