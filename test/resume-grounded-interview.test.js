import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { resumeTopicService } from "../src/ai-interview/resume/resume-topic.service.js";
import { resumeParserService } from "../src/ai-interview/resume/resume-parser.service.js";
import { findRelevantProjectContext } from "../src/ai-interview/resume/resume-project-context.js";
import { interviewStateBuilderService } from "../src/ai-interview/services/interview-state-builder.service.js";
import { aiQuestionService } from "../src/ai-interview/ai/ai-question.service.js";

test("Resume-Grounded Pipeline: Acceptance Criteria Verification", async (t) => {
  await t.test("1. Python/Django resume: No automatic Node.js or Express injection", () => {
    const pythonCandidateSkills = ["Python", "Django", "PostgreSQL", "AWS"];
    const scopedTopics = resumeTopicService.selectInterviewTopics({
      role: "Backend Developer",
      candidateSkills: pythonCandidateSkills,
      duration: 30, // 4 topics
      experienceLevel: "3-5 Years",
      interviewTypes: ["technical"],
    });

    // Must prioritize candidate's actual skills
    assert.ok(scopedTopics.includes("PYTHON"), "Should include PYTHON");
    assert.ok(scopedTopics.includes("DJANGO"), "Should include DJANGO");
    assert.ok(scopedTopics.includes("POSTGRESQL"), "Should include POSTGRESQL");
    assert.ok(scopedTopics.includes("AWS"), "Should include AWS");

    // Must NEVER inject unverified technologies like Node.js or Express
    assert.ok(!scopedTopics.includes("NODE.JS"), "Must NEVER inject NODE.JS into Python resume");
    assert.ok(!scopedTopics.includes("EXPRESS"), "Must NEVER inject EXPRESS into Python resume");
    assert.ok(!scopedTopics.includes("MONGODB"), "Must NEVER inject MONGODB into Python resume");
  });

  await t.test("2. Flutter/Kotlin resume: Skills recognized even if absent from old 44 dictionary", async () => {
    const mobileResumeText = `
      John Mobile
      Senior Mobile Engineer with 4 years of experience.
      
      TECHNICAL SKILLS:
      Mobile: Flutter, Dart, Kotlin, Android, Jetpack Compose, Bloc, Swift
      Tools: Git, CI/CD, Firebase, Fastlane
      
      PROJECTS:
      E-Commerce Mobile App (Flutter, Dart, Firebase):
      Built high-performance cross-platform shopping application serving 50k users.
      Implemented state management with Bloc architecture and offline caching with Hive.
      Integrated payment gateway and push notifications with Firebase.
    `;

    const extracted = resumeParserService.extractEntitiesFromText(mobileResumeText);

    // Verify extraction of modern mobile skills
    assert.ok(extracted.skills.some((s) => s.toLowerCase() === "flutter"), "Should recognize Flutter");
    assert.ok(extracted.skills.some((s) => s.toLowerCase() === "kotlin"), "Should recognize Kotlin");
    assert.ok(extracted.skills.some((s) => s.toLowerCase() === "dart"), "Should recognize Dart");
    assert.ok(extracted.skills.some((s) => s.toLowerCase() === "firebase"), "Should recognize Firebase");

    // Verify projects were extracted
    assert.ok(extracted.projects.length >= 1, "Should extract at least 1 project");
    const proj = extracted.projects[0];
    assert.ok(proj.title.toLowerCase().includes("commerce") || proj.title.toLowerCase().includes("mobile"), "Project title should be captured");
    assert.ok(proj.technologies.some((t) => t.toLowerCase() === "flutter"), "Project should link Flutter");

    // Verify evidence snippet exists for Flutter
    assert.ok(extracted.evidenceSnippets["Flutter"] || extracted.evidenceSnippets["flutter"], "Should capture evidence snippet for Flutter");

    // Verify topic scoping for Mobile Developer role with these skills
    const scopedTopics = resumeTopicService.selectInterviewTopics({
      role: "Mobile Developer",
      candidateSkills: extracted.skills,
      duration: 30,
    });

    assert.ok(scopedTopics.includes("FLUTTER"), "Should scope FLUTTER as topic");
    assert.ok(!scopedTopics.includes("NODE.JS"), "Must not inject Node.js into mobile resume");
  });

  await t.test("3. Resume with several projects: Questions use relevant project context", () => {
    const mockResumeData = {
      extracted: {
        skills: ["Python", "Django", "React", "TypeScript", "PostgreSQL", "AWS"],
        projects: [
          {
            title: "Scalable Analytics API",
            description: "Built high-throughput Django REST API processing 10M daily events on AWS ECS with PostgreSQL database.",
            technologies: ["Python", "Django", "PostgreSQL", "AWS"],
            architecture: "Microservices with Celery async workers and Redis queue",
            contributions: ["Designed database schema", "Optimized complex aggregations"],
            evidenceSnippet: "Built high-throughput Django REST API processing 10M daily events on AWS ECS",
          },
          {
            title: "Executive Metrics Dashboard",
            description: "Developed interactive React and TypeScript monitoring dashboard with Vite and TailwindCSS.",
            technologies: ["React", "TypeScript", "TailwindCSS"],
            architecture: "Single Page Application with Zustand state management",
            contributions: ["Created responsive charts", "Implemented WebSocket live feed"],
            evidenceSnippet: "Developed interactive React and TypeScript monitoring dashboard",
          },
        ],
      },
    };

    // When topic is DJANGO, it should find the Analytics API project
    const djangoContext = findRelevantProjectContext(mockResumeData, "DJANGO");
    assert.ok(djangoContext, "Should find project context for DJANGO");
    assert.equal(djangoContext.title, "Scalable Analytics API");
    assert.ok(djangoContext.technologies.includes("Django"));
    assert.ok(djangoContext.architecture.includes("Microservices"));

    // When topic is REACT, it should find the Executive Metrics Dashboard project
    const reactContext = findRelevantProjectContext(mockResumeData, "REACT");
    assert.ok(reactContext, "Should find project context for REACT");
    assert.equal(reactContext.title, "Executive Metrics Dashboard");
    assert.ok(reactContext.technologies.includes("React"));
  });

  await t.test("4. Resume with few technical skills: No fabricated technical stack", () => {
    const fewSkills = ["Python"];
    const scopedTopics = resumeTopicService.selectInterviewTopics({
      role: "Software Engineer",
      candidateSkills: fewSkills,
      duration: 30, // expects up to 4 topics
      interviewTypes: ["technical"],
    });

    // Should include the single skill
    assert.ok(scopedTopics.includes("PYTHON"), "Must include candidate's single skill PYTHON");

    // Any remaining slots MUST be general engineering competencies, NEVER fabricated stacks
    const generalCompetencies = ["PROBLEM_SOLVING", "SYSTEM_DESIGN", "TECHNICAL_FUNDAMENTALS"];
    for (const topic of scopedTopics) {
      if (topic !== "PYTHON") {
        assert.ok(
          generalCompetencies.includes(topic),
          `Topic '${topic}' must be a general engineering competency, not a fabricated stack`
        );
      }
    }

    assert.ok(!scopedTopics.includes("NODE.JS"), "Must NEVER inject NODE.JS");
    assert.ok(!scopedTopics.includes("EXPRESS"), "Must NEVER inject EXPRESS");
    assert.ok(!scopedTopics.includes("REACT"), "Must NEVER inject REACT");
  });

  await t.test("5. Resume with missing project details: Fallback operates safely", () => {
    const resumeDataWithoutProjects = {
      extracted: {
        skills: ["Go", "Docker", "Kubernetes"],
        projects: [],
      },
    };

    const context = findRelevantProjectContext(resumeDataWithoutProjects, "GO");
    assert.equal(context, null, "Should safely return null when no projects exist without throwing");

    const nullResumeContext = findRelevantProjectContext(null, "GO");
    assert.equal(nullResumeContext, null, "Should safely handle null resumeData");
  });

  await t.test("6. Candidate contradicts resume claims: State builder and validation operate correctly", () => {
    const session = {
      techStack: ["Python", "AWS"],
      resumeData: {
        extracted: {
          skills: ["Python", "AWS"],
        },
      },
      currentTopic: "PYTHON",
      difficulty: "MEDIUM",
    };

    // Candidate answered turn 2 on Python poorly (score: 30, with misconception)
    const turns = [
      {
        turnNumber: 1,
        topic: "INTRODUCTION",
        candidateAnswer: "I am a backend developer with 3 years of experience in Python and AWS.",
        correctnessScore: 80,
      },
      {
        turnNumber: 2,
        topic: "PYTHON",
        concept: "GIL and Multi-threading",
        question: "How does the Python GIL impact CPU-bound multithreaded programs?",
        candidateAnswer: "Python threads run in parallel on multiple cores without any locks.",
        correctnessScore: 25,
        misconceptions: ["Claimed Python threads bypass GIL for CPU-bound tasks"],
        conceptsMissing: ["GIL execution mutex", "Multiprocessing alternative"],
      },
    ];

    const state = interviewStateBuilderService.buildState(session, turns);

    // Verify resume claims validation distinguishes claimed vs proven
    assert.ok(Array.isArray(state.resumeClaimsValidated), "Should have resumeClaimsValidated array");
    const pythonClaim = state.resumeClaimsValidated.find((c) => c.claim.toUpperCase() === "PYTHON");
    assert.ok(pythonClaim, "Should track PYTHON claim");
    // Since score was 25, status should be UNPROVEN (not SUPPORTED)
    assert.equal(pythonClaim.status, "UNPROVEN", "Unproven claim should remain UNPROVEN after poor answer");

    // AWS was not tested, so it remains UNPROVEN
    const awsClaim = state.resumeClaimsValidated.find((c) => c.claim.toUpperCase() === "AWS");
    assert.ok(awsClaim, "Should track AWS claim");
    assert.equal(awsClaim.status, "UNPROVEN", "Untested claim must remain UNPROVEN");
  });

  await t.test("7. Long interview session: Bounded project context prevents prompt explosion", () => {
    const bloatedResumeData = {
      extracted: {
        skills: ["Python"],
        projects: [
          {
            title: "Super Massive Enterprise Distributed High-Availability Multi-Region Platform",
            description: "A".repeat(5000), // 5,000 chars of text
            technologies: ["Python", "Django", "PostgreSQL", "AWS", "Redis", "Kafka", "Docker", "Kubernetes", "Elasticsearch"],
            architecture: "B".repeat(2000),
            contributions: ["C".repeat(1000), "D".repeat(1000), "E".repeat(1000)],
            evidenceSnippet: "F".repeat(1000),
          },
        ],
      },
    };

    const context = findRelevantProjectContext(bloatedResumeData, "PYTHON");
    assert.ok(context, "Context should be extracted");
    assert.ok(context.description.length <= 250, "Description should be bounded <= 250 chars");
    assert.ok(context.architecture.length <= 150, "Architecture should be bounded <= 150 chars");
    assert.ok(context.evidenceSnippet.length <= 150, "Evidence snippet should be bounded <= 150 chars");
    assert.ok(context.technologies.length <= 6, "Technologies list should be bounded <= 6");
    assert.ok(context.contributions.length <= 2, "Contributions should be bounded <= 2");
  });

  await t.test("8. TC-024: Empty 0-byte resume file rejection with HTTP 422", async () => {
    // 0-byte PDF file
    const emptyPdfFile = {
      buffer: Buffer.alloc(0),
      originalname: "empty_resume.pdf",
      mimetype: "application/pdf",
      size: 0,
    };

    await assert.rejects(
      async () => {
        await resumeParserService.parseResumeFile(emptyPdfFile);
      },
      (err) => {
        assert.equal(err.statusCode, 422, "Should return HTTP 422 for empty file");
        assert.equal(
          err.message,
          "Uploaded resume appears to be empty or unreadable text.",
          "Error message must match expected rejection text"
        );
        return true;
      }
    );

    // 0-byte DOCX file
    const emptyDocxFile = {
      buffer: Buffer.alloc(0),
      originalname: "empty_resume.docx",
      mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 0,
    };

    await assert.rejects(
      async () => {
        await resumeParserService.parseResumeFile(emptyDocxFile);
      },
      (err) => {
        assert.equal(err.statusCode, 422, "Should return HTTP 422 for empty docx");
        assert.equal(
          err.message,
          "Uploaded resume appears to be empty or unreadable text."
        );
        return true;
      }
    );
  });
});
