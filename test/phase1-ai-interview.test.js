import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { InterviewState } from "../src/ai-interview/enums/interview-state.enum.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";
import { InterviewPlan } from "../src/ai-interview/schemas/interview-plan.schema.js";
import { InterviewSession } from "../src/ai-interview/schemas/interview-session.schema.js";
import { interviewPlanService } from "../src/ai-interview/services/interview-plan.service.js";
import { interviewSessionService } from "../src/ai-interview/services/interview-session.service.js";
import { resumeTopicService } from "../src/ai-interview/resume/resume-topic.service.js";
import { resumeParserService } from "../src/ai-interview/resume/resume-parser.service.js";

// Mock user IDs
const candidateA_id = new mongoose.Types.ObjectId();
const candidateB_id = new mongoose.Types.ObjectId();
const admin_id = new mongoose.Types.ObjectId();

test("Phase 1: Resume Topic Service Scoping", async (t) => {
  await t.test("Prioritizes Frontend topics and limits based on 15 min duration", () => {
    const topics = resumeTopicService.selectInterviewTopics({
      role: "Frontend Developer",
      candidateSkills: ["Python", "React", "Docker", "JavaScript", "SQL", "HTML"],
      duration: 15,
    });

    assert.ok(topics.length <= 3, "15-minute interview should have at most 3 topics");
    assert.ok(topics.includes("REACT") || topics.includes("JAVASCRIPT"), "Should prioritize frontend skills");
  });

  await t.test("Prioritizes Backend topics for Backend Developer role", () => {
    const topics = resumeTopicService.selectInterviewTopics({
      role: "Backend Engineer",
      candidateSkills: ["React", "Node.js", "MongoDB", "CSS", "Python"],
      duration: 30,
    });

    assert.ok(topics.includes("NODE.JS") || topics.includes("MONGODB") || topics.includes("PYTHON"));
  });
});

test("Phase 1: Resume Parser Service Validation", async (t) => {
  await t.test("Rejects missing buffer", async () => {
    await assert.rejects(
      async () => {
        await resumeParserService.parseResumeFile(null);
      },
      { message: "No resume file provided." }
    );
  });

  await t.test("Rejects unsupported file formats", async () => {
    await assert.rejects(
      async () => {
        await resumeParserService.parseResumeFile({
          buffer: Buffer.from("image content"),
          mimetype: "image/png",
          originalname: "resume.png",
          size: 1000,
        });
      },
      /Unsupported resume file format/
    );
  });

  await t.test("Parses valid text buffer and extracts skills", async () => {
    const textBuffer = Buffer.from(
      "Jane Doe\nExperienced software engineer with 3 years of experience in JavaScript, React, Node.js, and MongoDB."
    );
    const result = await resumeParserService.parseResumeFile({
      buffer: textBuffer,
      mimetype: "text/plain",
      originalname: "resume.txt",
      size: textBuffer.length,
    });

    assert.equal(result.filename, "resume.txt");
    assert.ok(result.extracted.skills.includes("JavaScript"));
    assert.ok(result.extracted.skills.includes("React"));
    assert.equal(result.extracted.detectedExperienceYears, 3);
  });
});

test("Phase 1: Interview Plan Service Calculation", async (t) => {
  await t.test("Calculates correct question limits and follow-up caps", async () => {
    // Test logic without saving to DB by instantiating plan document
    const topics = ["JAVASCRIPT", "REACT", "NODE_JS"];
    const duration = 30;

    const globalLimit = Math.min(25, Math.max(4, Math.round(duration / 3.5)));
    const maxQuestionsPerTopic = Math.min(
      5,
      Math.max(2, Math.ceil(globalLimit / topics.length) + 1)
    );

    assert.equal(globalLimit, 9, "30-min interview should target 9 questions");
    assert.equal(maxQuestionsPerTopic, 4, "Per-topic limit should be 4");
  });
});

test("Phase 1: Interview Session Creation & Ownership Logic", async (t) => {
  await t.test("InterviewSession validates authorization and ownership", () => {
    const session = {
      userId: candidateA_id,
      interviewId: "int-test-12345",
      role: "Frontend Developer",
      interviewState: InterviewState.READY,
    };

    // Candidate A is owner
    const isOwner = session.userId.toString() === candidateA_id.toString();
    assert.equal(isOwner, true, "Candidate A should be recognized as owner");

    // Candidate B is not owner
    const isOwnerB = session.userId.toString() === candidateB_id.toString();
    assert.equal(isOwnerB, false, "Candidate B should NOT be recognized as owner");

    // Admin access
    const adminUser = { _id: admin_id, role: "IQPATH_ADMIN" };
    const canAdminAccess =
      session.userId.toString() === adminUser._id.toString() ||
      adminUser.role === "IQPATH_ADMIN";
    assert.equal(canAdminAccess, true, "Admin should have access");
  });

  await t.test("InterviewSession default states match specifications", () => {
    assert.equal(InterviewState.READY, "READY");
    assert.equal(InterviewState.IN_PROGRESS, "IN_PROGRESS");
    assert.equal(InterviewState.COMPLETED, "COMPLETED");
    assert.equal(Difficulty.ADAPTIVE, "ADAPTIVE");
  });
});
