import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "module";
import mongoose from "mongoose";
import { resumeTopicService } from "../src/ai-interview/resume/resume-topic.service.js";
import {
  resumeParserService,
  UNREADABLE_RESUME_MESSAGE,
  cleanExtractedText,
  hasMeaningfulContent,
} from "../src/ai-interview/resume/resume-parser.service.js";
import { findRelevantProjectContext } from "../src/ai-interview/resume/resume-project-context.js";
import { interviewStateBuilderService } from "../src/ai-interview/services/interview-state-builder.service.js";
import { aiQuestionService } from "../src/ai-interview/ai/ai-question.service.js";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit");
const AdmZip = require("adm-zip");

function createPdfBuffer(configure) {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    if (configure) configure(doc);
    doc.end();
  });
}

function createDocxBuffer(textContent) {
  const zip = new AdmZip();
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${textContent}</w:t></w:r></w:p></w:body>
</w:document>`;
  zip.addFile("word/document.xml", Buffer.from(docXml, "utf8"));
  return zip.toBuffer();
}

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
          UNREADABLE_RESUME_MESSAGE,
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
          UNREADABLE_RESUME_MESSAGE
        );
        return true;
      }
    );
  });

  await t.test("9. TC-027: Scanned single-page image-only PDF rejected with HTTP 422", async () => {
    // Create an image-only / blank PDF containing no text elements
    const scannedPdfBuffer = await createPdfBuffer((doc) => {
      // PDF document with page initialized but no text calls
    });

    const scannedFile = {
      buffer: scannedPdfBuffer,
      originalname: "scanned_image_resume.pdf",
      mimetype: "application/pdf",
      size: scannedPdfBuffer.length,
    };

    await assert.rejects(
      async () => {
        await resumeParserService.parseResumeFile(scannedFile);
      },
      (err) => {
        assert.equal(err.statusCode, 422, "Should reject scanned image-only PDF with HTTP 422");
        assert.equal(
          err.message,
          "Uploaded resume appears to be empty or unreadable text. Please provide a text-searchable PDF.",
          "Must return exact unreadable text error message"
        );
        return true;
      }
    );
  });

  await t.test("10. TC-027: Multi-page scanned image-only PDF rejected with HTTP 422", async () => {
    // Multi-page PDF with pages but no extractable text
    const multiPagePdfBuffer = await createPdfBuffer((doc) => {
      doc.addPage();
      doc.addPage();
    });

    const multiPageScannedFile = {
      buffer: multiPagePdfBuffer,
      originalname: "multipage_scanned.pdf",
      mimetype: "application/pdf",
      size: multiPagePdfBuffer.length,
    };

    await assert.rejects(
      async () => {
        await resumeParserService.parseResumeFile(multiPageScannedFile);
      },
      (err) => {
        assert.equal(err.statusCode, 422, "Should reject multi-page scanned PDF with HTTP 422");
        assert.equal(
          err.message,
          UNREADABLE_RESUME_MESSAGE,
          "Must return exact unreadable text message"
        );
        return true;
      }
    );
  });

  await t.test("11. TC-027: File with only whitespace, page markers, or symbols rejected with HTTP 422", async () => {
    // Plain text / artifact file with only '-- 1 of 1 --'
    const artifactOnlyFile = {
      buffer: Buffer.from("\n\n-- 1 of 1 --\n\n", "utf-8"),
      originalname: "artifacts_only.txt",
      mimetype: "text/plain",
      size: 16,
    };

    await assert.rejects(
      async () => {
        await resumeParserService.parseResumeFile(artifactOnlyFile);
      },
      (err) => {
        assert.equal(err.statusCode, 422, "Should reject file containing only extraction artifacts");
        assert.equal(err.message, UNREADABLE_RESUME_MESSAGE);
        return true;
      }
    );

    // File with only whitespace and dividers
    const symbolsOnlyFile = {
      buffer: Buffer.from("   \n\t  --- === ... --- \n\n", "utf-8"),
      originalname: "symbols_only.txt",
      mimetype: "text/plain",
      size: 25,
    };

    await assert.rejects(
      async () => {
        await resumeParserService.parseResumeFile(symbolsOnlyFile);
      },
      (err) => {
        assert.equal(err.statusCode, 422, "Should reject file containing only symbols and whitespace");
        assert.equal(err.message, UNREADABLE_RESUME_MESSAGE);
        return true;
      }
    );
  });

  await t.test("12. Valid text-based PDF accepted and extracted cleanly", async () => {
    const validPdfBuffer = await createPdfBuffer((doc) => {
      doc.text("Sarah Connor\nPrincipal Cloud Architect\nSkills: AWS, Kubernetes, Terraform, Go, Python\nExperience: 8 years designing cloud systems.");
    });

    const validPdfFile = {
      buffer: validPdfBuffer,
      originalname: "sarah_connor_resume.pdf",
      mimetype: "application/pdf",
      size: validPdfBuffer.length,
    };

    const parsed = await resumeParserService.parseResumeFile(validPdfFile);
    assert.ok(parsed, "Should parse valid PDF");
    assert.ok(parsed.rawText.includes("Sarah Connor"), "Raw text must contain candidate name");
    assert.ok(!parsed.rawText.includes("-- 1 of 1 --"), "Raw text must not contain '-- 1 of 1 --'");
    assert.ok(parsed.extracted.skills.includes("AWS"), "Skills must include AWS");
    assert.ok(parsed.extracted.skills.includes("Kubernetes"), "Skills must include Kubernetes");
    assert.ok(!parsed.extracted.summaryPreview.includes("-- 1 of 1 --"), "summaryPreview must not leak page markers");
  });

  await t.test("13. Valid DOCX resume accepted and extracted cleanly", async () => {
    const docxBuffer = createDocxBuffer(
      "David Miller\nFull Stack Developer\nSkills: React, Node.js, TypeScript, PostgreSQL\nProjects: Cloud Management Console with React and Node.js"
    );

    const docxFile = {
      buffer: docxBuffer,
      originalname: "david_miller_resume.docx",
      mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: docxBuffer.length,
    };

    const parsed = await resumeParserService.parseResumeFile(docxFile);
    assert.ok(parsed, "Should parse valid DOCX resume");
    assert.ok(parsed.rawText.includes("David Miller"), "Raw text must contain candidate name");
    assert.ok(parsed.extracted.skills.includes("React"), "Skills must include React");
    assert.ok(parsed.extracted.skills.includes("Node.js"), "Skills must include Node.js");
  });

  await t.test("14. Legitimate resume with zero recognized technical skills accepted (no false rejection)", async () => {
    const nonTechPdfBuffer = await createPdfBuffer((doc) => {
      doc.text(
        "Marcus Aurelius\nSenior Administrator & Policy Advisor\nCore Competencies: Public Administration, Strategic Logistics, Organizational Governance, Civic Planning\nExperience: Over 15 years leading governance institutions and civil administration."
      );
    });

    const nonTechFile = {
      buffer: nonTechPdfBuffer,
      originalname: "marcus_resume.pdf",
      mimetype: "application/pdf",
      size: nonTechPdfBuffer.length,
    };

    // Must NOT reject simply because tech skills are empty
    const parsed = await resumeParserService.parseResumeFile(nonTechFile);
    assert.ok(parsed, "Should accept valid non-technical resume");
    assert.ok(parsed.rawText.includes("Marcus Aurelius"), "Raw text must contain candidate content");
    assert.equal(parsed.extracted.skills.length, 0, "Skills may be empty without causing rejection");
    assert.ok(parsed.extracted.summaryPreview.includes("Marcus Aurelius"), "Summary preview must contain resume content");
  });

  await t.test("15. Valid PDF with page-number extraction artifacts accepted with cleaned text", async () => {
    const artifactPdfBuffer = await createPdfBuffer((doc) => {
      doc.text(
        "Emily Watson\nLead Backend Engineer\nSkills: Python, Django, Redis\nPage 1 of 2\n\nExperience:\nBuilt payment gateway processing 10k transactions/sec.\nPage 2 of 2"
      );
    });

    const artifactPdfFile = {
      buffer: artifactPdfBuffer,
      originalname: "emily_watson_resume.pdf",
      mimetype: "application/pdf",
      size: artifactPdfBuffer.length,
    };

    const parsed = await resumeParserService.parseResumeFile(artifactPdfFile);
    assert.ok(parsed, "Should parse valid PDF with page numbers");
    assert.ok(parsed.extracted.skills.includes("Python"), "Should extract Python");
    assert.ok(parsed.extracted.skills.includes("Django"), "Should extract Django");
    // Ensure standalone 'Page 1 of 2' line was stripped from rawText
    assert.ok(!parsed.rawText.includes("Page 1 of 2"), "Page 1 of 2 artifact should be stripped");
    assert.ok(!parsed.extracted.summaryPreview.includes("Page 1 of 2"), "summaryPreview should not contain page marker");
  });

  await t.test("16. Unit verification: cleanExtractedText and hasMeaningfulContent", () => {
    assert.equal(cleanExtractedText("-- 1 of 1 --"), "");
    assert.equal(cleanExtractedText("\n\n-- 1 of 3 --\n\n\n\n-- 2 of 3 --\n\n\n\n-- 3 of 3 --\n\n"), "");
    assert.equal(cleanExtractedText("   \t\n  "), "");
    assert.equal(cleanExtractedText("Page 1 of 2\nPage 2 of 2"), "");
    assert.equal(cleanExtractedText("- 1 -"), "");

    assert.equal(hasMeaningfulContent("-- 1 of 1 --"), false);
    assert.equal(hasMeaningfulContent("\n\n-- 1 of 3 --\n\n"), false);
    assert.equal(hasMeaningfulContent("   \n\t  "), false);
    assert.equal(hasMeaningfulContent("--- === ... ---"), false);
    assert.equal(hasMeaningfulContent("\f\u200B\uFEFF"), false);

    assert.equal(hasMeaningfulContent("Jane Doe - Consultant"), true);
    assert.equal(hasMeaningfulContent("Art Historian"), true);
    assert.equal(hasMeaningfulContent("A"), true);
  });
});
