import test from "node:test";
import assert from "node:assert/strict";
import { resumeTopicService } from "../src/ai-interview/resume/resume-topic.service.js";
import { resolveInterviewTypeForTopic, getTypePersonaAndConfig, INTERVIEW_TYPES, TYPE_TOPICS } from "../src/ai-interview/constants/interview-types.js";
import { getFallbackQuestion } from "../src/ai-interview/ai/fallback-questions.js";
import { AiQuestionService } from "../src/ai-interview/ai/ai-question.service.js";

test("Interview Types: Topic Selection by Interview Type", async (t) => {
  await t.test("Selects HR topics for pure HR interview", () => {
    const topics = resumeTopicService.selectInterviewTopics({
      role: "Frontend Developer",
      candidateSkills: ["React", "JavaScript", "HTML"],
      duration: 30,
      experienceLevel: "1-3 Years",
      interviewTypes: ["hr"],
    });

    assert.ok(topics.length >= 2, "Should return at least 2 topics");
    // All topics should be HR topics, none should be React/JavaScript
    for (const topic of topics) {
      assert.ok(TYPE_TOPICS.hr.includes(topic), `Expected ${topic} to be an HR topic`);
      assert.notEqual(topic, "REACT");
      assert.notEqual(topic, "JAVASCRIPT");
    }
  });

  await t.test("Selects Behavioral topics for pure Behavioral interview", () => {
    const topics = resumeTopicService.selectInterviewTopics({
      role: "Backend Developer",
      candidateSkills: ["Node.js", "Express", "SQL"],
      duration: 30,
      experienceLevel: "2-3 Years",
      interviewTypes: ["behavioral"],
    });

    assert.ok(topics.length >= 2, "Should return at least 2 topics");
    for (const topic of topics) {
      assert.ok(TYPE_TOPICS.behavioral.includes(topic), `Expected ${topic} to be a Behavioral topic`);
      assert.notEqual(topic, "NODE.JS");
      assert.notEqual(topic, "SQL");
    }
  });

  await t.test("Selects System Design topics for pure System Design interview", () => {
    const topics = resumeTopicService.selectInterviewTopics({
      role: "Full Stack Developer",
      duration: 30,
      interviewTypes: ["system_design"],
    });

    assert.ok(topics.length >= 2, "Should return at least 2 topics");
    for (const topic of topics) {
      assert.ok(TYPE_TOPICS.system_design.includes(topic), `Expected ${topic} to be a System Design topic`);
    }
  });

  await t.test("Balances topics across types for multi-format interview (technical + hr)", () => {
    const topics = resumeTopicService.selectInterviewTopics({
      role: "Frontend Developer",
      candidateSkills: ["React", "JavaScript"],
      duration: 30,
      interviewTypes: ["technical", "hr"],
    });

    assert.ok(topics.length >= 2, "Should return at least 2 topics");
    const hasTech = topics.some((t) => t === "REACT" || t === "JAVASCRIPT" || t === "HTML" || t === "CSS");
    const hasHr = topics.some((t) => TYPE_TOPICS.hr.includes(t));
    assert.ok(hasTech, "Expected at least one technical topic");
    assert.ok(hasHr, "Expected at least one HR topic");
  });

  await t.test("Selects technical topics for pure technical interview with candidate skills", () => {
    const topics = resumeTopicService.selectInterviewTopics({
      role: "Frontend Developer",
      candidateSkills: ["React", "JavaScript", "TypeScript"],
      duration: 30,
      interviewTypes: ["technical"],
    });

    assert.ok(topics.includes("REACT") || topics.includes("JAVASCRIPT"));
  });
});

test("Interview Types: Topic Type Resolution", async (t) => {
  await t.test("Resolves HR topics correctly", () => {
    assert.equal(resolveInterviewTypeForTopic("CULTURE_FIT"), INTERVIEW_TYPES.HR);
    assert.equal(resolveInterviewTypeForTopic("CAREER_GOALS"), INTERVIEW_TYPES.HR);
    assert.equal(resolveInterviewTypeForTopic("WORK_ETHIC"), INTERVIEW_TYPES.HR);
    assert.equal(resolveInterviewTypeForTopic("TEAMWORK"), INTERVIEW_TYPES.HR);
    assert.equal(resolveInterviewTypeForTopic("CONFLICT_RESOLUTION"), INTERVIEW_TYPES.HR);
  });

  await t.test("Resolves Behavioral topics correctly", () => {
    assert.equal(resolveInterviewTypeForTopic("LEADERSHIP"), INTERVIEW_TYPES.BEHAVIORAL);
    assert.equal(resolveInterviewTypeForTopic("COLLABORATION"), INTERVIEW_TYPES.BEHAVIORAL);
    assert.equal(resolveInterviewTypeForTopic("ADAPTABILITY"), INTERVIEW_TYPES.BEHAVIORAL);
    assert.equal(resolveInterviewTypeForTopic("OVERCOMING_CHALLENGES"), INTERVIEW_TYPES.BEHAVIORAL);
    assert.equal(resolveInterviewTypeForTopic("DECISION_MAKING"), INTERVIEW_TYPES.BEHAVIORAL);
  });

  await t.test("Resolves System Design topics correctly", () => {
    assert.equal(resolveInterviewTypeForTopic("HIGH_LEVEL_ARCHITECTURE"), INTERVIEW_TYPES.SYSTEM_DESIGN);
    assert.equal(resolveInterviewTypeForTopic("SCALABILITY"), INTERVIEW_TYPES.SYSTEM_DESIGN);
    assert.equal(resolveInterviewTypeForTopic("DATABASE_DESIGN"), INTERVIEW_TYPES.SYSTEM_DESIGN);
    assert.equal(resolveInterviewTypeForTopic("MICROSERVICES"), INTERVIEW_TYPES.SYSTEM_DESIGN);
  });

  await t.test("Resolves Coding topics correctly", () => {
    assert.equal(resolveInterviewTypeForTopic("DATA_STRUCTURES"), INTERVIEW_TYPES.CODING);
    assert.equal(resolveInterviewTypeForTopic("ALGORITHMS"), INTERVIEW_TYPES.CODING);
    assert.equal(resolveInterviewTypeForTopic("TIME_COMPLEXITY"), INTERVIEW_TYPES.CODING);
  });

  await t.test("Falls back to session interviewType for general topics", () => {
    assert.equal(resolveInterviewTypeForTopic("GENERAL_DISCUSSION", ["hr"]), INTERVIEW_TYPES.HR);
    assert.equal(resolveInterviewTypeForTopic("GENERAL_DISCUSSION", ["behavioral"]), INTERVIEW_TYPES.BEHAVIORAL);
    assert.equal(resolveInterviewTypeForTopic("GENERAL_DISCUSSION", ["technical"]), INTERVIEW_TYPES.TECHNICAL);
  });
});

test("Interview Types: Fallback Questions Respect Interview Type", async (t) => {
  await t.test("Returns HR questionType and competency for HR topic", () => {
    const q = getFallbackQuestion("CULTURE_FIT", "EASY", [], "hr");
    assert.equal(q.questionType, "HR");
    assert.equal(q.competency, "Culture & Professionalism");
    assert.ok(q.question.length > 10);
  });

  await t.test("Returns BEHAVIORAL questionType and competency for Behavioral topic", () => {
    const q = getFallbackQuestion("LEADERSHIP", "MEDIUM", [], "behavioral");
    assert.equal(q.questionType, "BEHAVIORAL");
    assert.equal(q.competency, "Behavioral & Leadership");
    assert.ok(q.question.length > 10);
  });

  await t.test("Returns SCENARIO questionType for System Design topic", () => {
    const q = getFallbackQuestion("HIGH_LEVEL_ARCHITECTURE", "MEDIUM", [], "system_design");
    assert.equal(q.questionType, "SCENARIO");
    assert.equal(q.competency, "System Architecture & Scalability");
    assert.ok(q.question.length > 10);
  });

  await t.test("Falls back to type-appropriate question when topic is unknown", () => {
    const qHr = getFallbackQuestion("UNKNOWN_TOPIC", "EASY", [], "hr");
    assert.equal(qHr.questionType, "HR");
    assert.equal(qHr.competency, "Culture & Professionalism");

    const qBeh = getFallbackQuestion("UNKNOWN_TOPIC", "EASY", [], "behavioral");
    assert.equal(qBeh.questionType, "BEHAVIORAL");
    assert.equal(qBeh.competency, "Behavioral & Leadership");
  });
});

test("Interview Types: AI Question Prompt Persona Tailoring", async (t) => {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";

  const mockLlm = {
    generateStructuredJson: async ({ systemPrompt, userPrompt }) => {
      capturedSystemPrompt = systemPrompt;
      capturedUserPrompt = userPrompt;
      return {
        question: "Tell me about a time you resolved a conflict with a team member.",
        concept: "Conflict Resolution",
        topic: "CONFLICT_RESOLUTION",
        difficulty: "MEDIUM",
        questionType: "HR",
        competency: "Culture & Professionalism",
      };
    },
  };

  const service = new AiQuestionService(mockLlm);
  const result = await service.generateQuestion({
    role: "Frontend Developer",
    experienceLevel: "2-3 Years",
    topic: "CONFLICT_RESOLUTION",
    difficulty: "MEDIUM",
    interviewType: "hr",
  });

  assert.ok(capturedSystemPrompt.includes("HR and Talent Acquisition"), "Persona should be HR partner");
  assert.ok(capturedSystemPrompt.includes("Culture & Professionalism"), "Should target HR competency");
  assert.equal(result.questionType, "HR");
  assert.equal(result.competency, "Culture & Professionalism");
});
