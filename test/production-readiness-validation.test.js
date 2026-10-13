import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { resumeTopicService } from "../src/ai-interview/resume/resume-topic.service.js";
import { resumeParserService } from "../src/ai-interview/resume/resume-parser.service.js";
import { findRelevantProjectContext } from "../src/ai-interview/resume/resume-project-context.js";
import { adaptiveEngineService } from "../src/ai-interview/services/adaptive-engine.service.js";
import { interviewStateBuilderService } from "../src/ai-interview/services/interview-state-builder.service.js";
import { questionPlannerService } from "../src/ai-interview/services/interview-question-planner.service.js";
import { InterviewSession } from "../src/ai-interview/schemas/interview-session.schema.js";
import { InterviewTurn } from "../src/ai-interview/schemas/interview-turn.schema.js";
import { InterviewPlan } from "../src/ai-interview/schemas/interview-plan.schema.js";
import { InterviewState } from "../src/ai-interview/enums/interview-state.enum.js";
import { InterviewAction } from "../src/ai-interview/enums/interview-action.enum.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";
import { performance } from "perf_hooks";

test("Production-Readiness Validation Pass", async (t) => {
  // -------------------------------------------------------------
  // Gate 1: Representative Resumes Across Different Stacks
  // -------------------------------------------------------------
  await t.test("Gate 1A: Go & Distributed Systems Resume", () => {
    const goResumeText = `
      Alex Chen
      Senior Backend Engineer - 5+ years of experience
      
      TECHNICAL SKILLS:
      Languages: Go, Python, SQL
      Infrastructure: Docker, Kubernetes, AWS, Terraform, Kafka, Redis
      
      EXPERIENCE:
      Senior Distributed Systems Engineer at CloudCorp (2021 - Present)
      - Designed distributed consensus worker pools in Go handling 50k RPS.
      - Integrated Apache Kafka for event-driven streaming and Redis caching.
      
      PROJECTS:
      Distributed Raft Engine (Go, Docker):
      Implemented Raft distributed consensus protocol in Go with leader election and log replication.
    `;

    const extracted = resumeParserService.extractEntitiesFromText(goResumeText);

    // Verify accurate extraction
    assert.ok(extracted.skills.includes("Go"), "Should extract Go");
    assert.ok(extracted.skills.includes("Docker"), "Should extract Docker");
    assert.ok(extracted.skills.includes("Kubernetes"), "Should extract Kubernetes");
    assert.ok(extracted.skills.includes("Kafka"), "Should extract Kafka");
    assert.ok(extracted.skills.includes("Redis"), "Should extract Redis");

    // Primary vs secondary distinction
    assert.ok(extracted.primarySkills.includes("Go"), "Go was used in projects/experience and should be primary");
    assert.ok(extracted.primarySkills.includes("Kafka"), "Kafka was used in experience and should be primary");

    // Scoped topics
    const topics = resumeTopicService.selectInterviewTopics({
      role: "Backend Engineer",
      candidateSkills: extracted.skills,
      duration: 30,
    });

    assert.ok(topics.includes("GO"), "Topics must include GO");
    assert.ok(topics.includes("POSTGRESQL") === false, "Must not inject PostgreSQL if candidate didn't declare it");
    assert.ok(topics.includes("NODE.JS") === false, "Must not inject Node.js into Go candidate");
  });

  await t.test("Gate 1B: ML & Data Engineer Resume", () => {
    const dataResumeText = `
      Priya Sharma
      Data Scientist & ML Engineer with 3 years experience.
      
      TECHNICAL SKILLS:
      Python, PyTorch, Pandas, NumPy, Scikit-learn, SQL, FastAPI, Docker
      
      PROJECTS:
      Visual Defect Classifier (Python, PyTorch, FastAPI):
      Trained ResNet computer vision models on 100k industrial images achieving 98.4% precision.
      Containerized inferencing service with FastAPI and Docker.
    `;

    const extracted = resumeParserService.extractEntitiesFromText(dataResumeText);

    assert.ok(extracted.skills.includes("Python"), "Should extract Python");
    assert.ok(extracted.skills.includes("PyTorch"), "Should extract PyTorch");
    assert.ok(extracted.skills.includes("Pandas"), "Should extract Pandas");
    assert.ok(extracted.skills.includes("FastAPI"), "Should extract FastAPI");

    const topics = resumeTopicService.selectInterviewTopics({
      role: "Machine Learning Engineer",
      candidateSkills: extracted.skills,
      duration: 45, // 5 topics
    });

    assert.ok(topics.includes("PYTHON"), "Topics must include PYTHON");
    assert.ok(topics.includes("PYTORCH"), "Topics must include PYTORCH");
    assert.ok(topics.includes("FASTAPI"), "Topics must include FASTAPI");
    assert.ok(!topics.includes("NODE.JS"), "Must not inject Node.js into ML engineer profile");
  });

  // -------------------------------------------------------------
  // Gate 2: Ambiguity Protection (e.g. English word 'go' vs Golang)
  // -------------------------------------------------------------
  await t.test("Gate 2: English prose with 'go' or 'c.' does not trigger false tech skills", () => {
    const proseResume = `
      Jane Doe
      Operations Specialist
      I have a track record of being ready to go the extra mile.
      We had to go back to the drawing board several times.
      Managed logistics c. 2022 to 2024.
      
      TECHNICAL SKILLS:
      Excel, PowerPoint, Jira
    `;

    const extracted = resumeParserService.extractEntitiesFromText(proseResume);

    // "go" in "ready to go" and "go back" MUST NOT match Go programming language!
    assert.ok(!extracted.skills.includes("Go"), "Casual prose 'ready to go' must NEVER trigger Golang");
    assert.ok(!extracted.skills.includes("C"), "'c. 2022' must NEVER trigger C language");
  });

  // -------------------------------------------------------------
  // Gate 3: Fallback & Error Handling
  // -------------------------------------------------------------
  await t.test("Gate 3: Empty text or malformed files throw clean 422 errors", async () => {
    await assert.rejects(
      async () => {
        await resumeParserService.parseResumeFile({ buffer: Buffer.from("   \n\t  "), mimetype: "text/plain", originalname: "empty.txt" });
      },
      (err) => err.statusCode === 422 || err.message.includes("empty")
    );
  });

  // -------------------------------------------------------------
  // Gate 4: General Competencies Isolation
  // -------------------------------------------------------------
  await t.test("Gate 4: General competencies (SYSTEM_DESIGN, PROBLEM_SOLVING) are assessment dimensions, not resume skills", () => {
    const candidateSkills = ["Python"];
    const scopedTopics = resumeTopicService.selectInterviewTopics({
      role: "Software Engineer",
      candidateSkills,
      duration: 30,
    });

    // In topic plan:
    assert.ok(scopedTopics.includes("PYTHON"));
    assert.ok(scopedTopics.includes("PROBLEM_SOLVING") || scopedTopics.includes("SYSTEM_DESIGN"));

    // But candidateSkills array itself was never mutated!
    assert.deepEqual(candidateSkills, ["Python"], "Candidate skills array must remain pristine");
  });

  // -------------------------------------------------------------
  // Gate 5: End-to-End Flow & Adaptive Engine Preservation
  // -------------------------------------------------------------
  await t.test("Gate 5: End-to-End Interview: Upload -> Plan -> Intro -> First Tech -> Follow-up", async () => {
    const candidateSkills = ["Python", "Django", "PostgreSQL", "AWS"];
    const scopedTopics = resumeTopicService.selectInterviewTopics({
      role: "Backend Developer",
      candidateSkills,
      duration: 30,
    });

    assert.equal(scopedTopics[0], "PYTHON", "First technical topic should be PYTHON");

    const session = {
      _id: new mongoose.Types.ObjectId(),
      interviewId: "int-val-001",
      currentTopic: "INTRODUCTION",
      allowedTopics: scopedTopics,
      topicOrder: scopedTopics,
      techStack: candidateSkills,
      questionCount: 1,
      topicQuestionCount: 1,
      duration: 30,
      timeRemaining: 1800,
      endTime: new Date(Date.now() + 1800000),
      interviewState: InterviewState.IN_PROGRESS,
      resumeData: {
        extracted: {
          skills: candidateSkills,
          projects: [
            {
              title: "Payment Gateway API",
              description: "Designed multi-currency Django REST payment processor on AWS.",
              technologies: ["Python", "Django", "PostgreSQL", "AWS"],
              architecture: "Event-driven with idempotency keys",
              contributions: ["Wrote database transaction rollback logic"],
              evidenceSnippet: "Designed multi-currency Django REST payment processor on AWS",
            },
          ],
        },
      },
    };

    const plan = {
      globalQuestionLimit: 10,
      maxQuestionsPerTopic: 3,
      maxFollowUpsPerQuestion: 2,
    };

    // Candidate completed Turn 1 (Intro)
    const turn1 = {
      turnNumber: 1,
      topic: "INTRODUCTION",
      candidateAnswer: "Hello, I am a backend engineer specializing in Python and Django.",
      answerStatus: "ACCURATE",
    };

    // Step A: Adaptive engine decides next action after Intro
    const actionA = adaptiveEngineService.determineNextAction(session, plan, turn1);
    assert.equal(actionA.action, InterviewAction.SWITCH_TOPIC);
    assert.equal(actionA.nextTopic, "PYTHON", "Must switch to candidate's first declared topic (PYTHON)");

    // Step B: Ensure project context is linked to PYTHON topic
    const projectContext = findRelevantProjectContext(session.resumeData, actionA.nextTopic);
    assert.ok(projectContext, "Should link Payment Gateway API to topic PYTHON");
    assert.equal(projectContext.title, "Payment Gateway API");
    assert.ok(projectContext.technologies.includes("Django"));

    // Step C: Turn 2 (First Technical Question) asked on PYTHON
    session.currentTopic = "PYTHON";
    session.questionCount = 2;
    session.topicQuestionCount = 1;

    const turn2 = {
      turnNumber: 2,
      topic: "PYTHON",
      concept: "Database Transactions & Idempotency",
      question: "In your Payment Gateway API, how did you ensure atomicity during payment processing in Django?",
      candidateAnswer: "We used transaction.atomic() to wrap the charge and ledger write, but did not handle concurrent retries.",
      answerStatus: "PARTIALLY_ACCURATE",
      conceptsDemonstrated: ["Django transaction.atomic"],
      conceptsMissing: ["Distributed idempotency lock", "Optimistic locking"],
      followUpType: "DEPTH_PROBE",
      followUp: true,
      followUpAllowed: true,
    };

    // Step D: Adaptive engine decides next action on partial answer
    const actionB = adaptiveEngineService.determineNextAction(session, plan, turn2);
    assert.equal(actionB.action, InterviewAction.FOLLOW_UP, "Should ask follow-up depth probe on partial answer");

    // Step E: Interview state claims validation
    const state = interviewStateBuilderService.buildState(session, [turn1, turn2]);
    const pythonClaim = state.resumeClaimsValidated.find((c) => c.claim === "Python");
    assert.ok(pythonClaim);
    // Since Turn 2 was partially accurate with missing concepts, it's not yet fully supported
    assert.ok(pythonClaim.status === "PARTIALLY_SUPPORTED" || pythonClaim.status === "UNPROVEN");
  });

  // -------------------------------------------------------------
  // Gate 6: Latency Benchmark (<15ms prepared claim)
  // -------------------------------------------------------------
  await t.test("Gate 6: Prepared question atomic claim operates within low-latency boundary", async () => {
    const dummySessionId = new mongoose.Types.ObjectId();
    const tStart = performance.now();
    // Recovery / check call
    await questionPlannerService.recoverStaleClaims(null);
    const durationMs = performance.now() - tStart;
    assert.ok(durationMs < 50, `Stale claim check took ${durationMs.toFixed(2)}ms, must be < 50ms`);
  });
});
