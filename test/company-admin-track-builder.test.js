import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Company, { generateSlug } from "../src/models/company.model.js";
import TestSeries from "../src/models/testSeries.model.js";
import Test from "../src/models/test.model.js";
import Question from "../src/models/question.model.js";
import { createCompanySchema, updateCompanySchema } from "../src/modules/company/company.schema.js";
import {
  createTestSeriesSchema,
  updateTestSeriesSchema,
  hiringRoundSchema,
} from "../src/modules/test-management/schemas/testSeries.schema.js";
import { validateHiringRoundsAndReferences } from "../src/modules/test-management/testSeries.controller.js";
import { imageUpload } from "../src/common/middlewares/imageUpload.middleware.js";

const { Types } = mongoose;

describe("Step 3: Admin Company Management and Hiring-Track Builder Tests", () => {
  const dummyUserId = new Types.ObjectId();
  const dummyCompanyId = new Types.ObjectId();
  const dummyTestId1 = new Types.ObjectId();
  const dummyTestId2 = new Types.ObjectId();
  const dummyTestId3 = new Types.ObjectId();

  /* ── 1. COMPANY MODEL & SCHEMA VALIDATION ── */
  describe("Company Management & Branding Schema", () => {
    test("1.1 createCompanySchema accepts valid company with colors, logo, and description", () => {
      const validData = {
        name: "Google Inc",
        description: "Multinational technology company",
        logo: "https://example.com/google.png",
        primaryColor: "#4285F4",
        secondaryColor: "#34A853",
        isActive: true,
      };

      const result = createCompanySchema.safeParse(validData);
      assert.equal(result.success, true);
      assert.equal(result.data.name, "Google Inc");
      assert.equal(result.data.primaryColor, "#4285F4");
    });

    test("1.2 createCompanySchema rejects missing name or invalid hex color format", () => {
      const invalidName = createCompanySchema.safeParse({ name: "" });
      assert.equal(invalidName.success, false);

      const invalidColor = createCompanySchema.safeParse({
        name: "Acme Corp",
        primaryColor: "not-a-hex-color",
      });
      assert.equal(invalidColor.success, false);
    });

    test("1.3 updateCompanySchema permits partial updates and rejects empty objects", () => {
      const partialUpdate = updateCompanySchema.safeParse({
        primaryColor: "#1e40af",
        isActive: false,
      });
      assert.equal(partialUpdate.success, true);
      assert.equal(partialUpdate.data.isActive, false);

      const emptyUpdate = updateCompanySchema.safeParse({});
      assert.equal(emptyUpdate.success, false);
    });

    test("1.4 Company model auto-generates slug and supports logoUrl virtual getter/setter", async () => {
      const company = new Company({
        name: "Amazon Web Services",
        logoUrl: "https://example.com/aws.png",
        primaryColor: "#FF9900",
      });

      await company.validate();
      assert.equal(company.slug, "amazon-web-services");
      assert.equal(company.logo, "https://example.com/aws.png");
      assert.equal(company.logoUrl, "https://example.com/aws.png");
      assert.equal(company.isActive, true);
    });
  });

  /* ── 2. HIRING TRACK BUILDER SCHEMA & ROUNDS VALIDATION ── */
  describe("Hiring Track Builder Schema & Mixed Rounds", () => {
    test("2.1 createTestSeriesSchema validates experienceLevel and targetRole", () => {
      const validPayload = {
        title: "TCS Ninja 2026 Drive",
        visibility: "PUBLIC",
        category: "COMPANY",
        companyId: dummyCompanyId.toString(),
        experienceLevel: "FRESHER",
        targetRole: "Assistant System Engineer",
        patternVersion: "2026",
      };

      const result = createTestSeriesSchema.safeParse(validPayload);
      assert.equal(result.success, true);
      assert.equal(result.data.experienceLevel, "FRESHER");
      assert.equal(result.data.targetRole, "Assistant System Engineer");
    });

    test("2.2 Rejects invalid experience levels", () => {
      const invalidLevel = createTestSeriesSchema.safeParse({
        title: "Invalid Track",
        visibility: "PUBLIC",
        category: "COMPANY",
        companyId: dummyCompanyId.toString(),
        experienceLevel: "INTERN_LEVEL", // Not in enum
      });
      assert.equal(invalidLevel.success, false);
    });

    test("2.3 hiringRoundSchema accepts TESTS round with multiple tests", () => {
      const testRound = {
        roundOrder: 1,
        roundKey: "ROUND_1_ASSESSMENT",
        roundName: "Cognitive & Technical Assessment",
        roundType: "TESTS",
        cutoffPercentage: 60,
        weight: 100,
        retakePolicy: "ALL_TESTS",
        tests: [dummyTestId1.toString(), dummyTestId2.toString()],
      };

      const parsed = hiringRoundSchema.safeParse(testRound);
      assert.equal(parsed.success, true);
      assert.equal(parsed.data.tests.length, 2);
      assert.equal(parsed.data.cutoffPercentage, 60);
    });

    test("2.4 hiringRoundSchema accepts AI_INTERVIEW round with full configuration", () => {
      const interviewRound = {
        roundOrder: 2,
        roundKey: "ROUND_2_TECH_INTERVIEW",
        roundName: "AI Technical Interview",
        roundType: "AI_INTERVIEW",
        cutoffPercentage: 70,
        weight: 150,
        retakePolicy: "ALL_TESTS",
        aiInterviewConfig: {
          role: "Full Stack Engineer",
          experienceLevel: "MID",
          interviewTypes: ["TECHNICAL", "SYSTEM_DESIGN"],
          topics: ["Node.js", "MongoDB", "Distributed Systems"],
          durationMinutes: 45,
          difficulty: "HARD",
          customRubric: { focus: "Architecture tradeoffs and latency optimization" },
        },
      };

      const parsed = hiringRoundSchema.safeParse(interviewRound);
      assert.equal(parsed.success, true);
      assert.equal(parsed.data.aiInterviewConfig.durationMinutes, 45);
      assert.equal(parsed.data.aiInterviewConfig.topics.length, 3);
      assert.equal(parsed.data.aiInterviewConfig.difficulty, "HARD");
    });

    test("2.5 Rejects duplicate roundOrder and duplicate roundKey in createTestSeriesSchema", () => {
      const duplicateOrders = {
        title: "Duplicate Order Track",
        visibility: "PUBLIC",
        category: "COMPANY",
        companyId: dummyCompanyId.toString(),
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "ROUND_1",
            roundName: "Round 1",
            roundType: "TESTS",
            tests: [dummyTestId1.toString()],
          },
          {
            roundOrder: 1, // Duplicate order
            roundKey: "ROUND_2",
            roundName: "Round 2",
            roundType: "AI_INTERVIEW",
            aiInterviewConfig: { durationMinutes: 30 },
          },
        ],
      };

      const resultOrder = createTestSeriesSchema.safeParse(duplicateOrders);
      assert.equal(resultOrder.success, false);

      const duplicateKeys = {
        title: "Duplicate Key Track",
        visibility: "PUBLIC",
        category: "COMPANY",
        companyId: dummyCompanyId.toString(),
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "ROUND_DUPLICATE",
            roundName: "Round 1",
            roundType: "TESTS",
            tests: [dummyTestId1.toString()],
          },
          {
            roundOrder: 2,
            roundKey: "ROUND_DUPLICATE", // Duplicate key
            roundName: "Round 2",
            roundType: "AI_INTERVIEW",
            aiInterviewConfig: { durationMinutes: 30 },
          },
        ],
      };

      const resultKey = createTestSeriesSchema.safeParse(duplicateKeys);
      assert.equal(resultKey.success, false);
    });

    test("2.6 Rejects TESTS round without any test references", () => {
      const emptyTestsRound = {
        title: "Empty Tests Track",
        visibility: "PUBLIC",
        category: "COMPANY",
        companyId: dummyCompanyId.toString(),
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "ROUND_1",
            roundName: "Round 1",
            roundType: "TESTS",
            tests: [], // Empty tests array for a TESTS round
          },
        ],
      };

      const result = createTestSeriesSchema.safeParse(emptyTestsRound);
      assert.equal(result.success, false);
    });
  });

  /* ── 3. CONTROLLER VALIDATION LOGIC ── */
  describe("Controller Validation & References", () => {
    test("3.1 validateHiringRoundsAndReferences checks company requirement for COMPANY category", async () => {
      await assert.rejects(
        async () => {
          await validateHiringRoundsAndReferences({
            companyId: null,
            category: "COMPANY",
          });
        },
        /Company ID is required/
      );
    });

    test("3.2 validateHiringRoundsAndReferences rejects non-existent company", async () => {
      const origCompanyFindById = Company.findById;
      Company.findById = () => ({
        select: () => ({
          lean: async () => null,
        }),
        lean: async () => null,
      });

      try {
        const nonExistentCompanyId = new Types.ObjectId();
        await assert.rejects(
          async () => {
            await validateHiringRoundsAndReferences({
              companyId: nonExistentCompanyId.toString(),
              category: "COMPANY",
            });
          },
          /Referenced company does not exist/
        );
      } finally {
        Company.findById = origCompanyFindById;
      }
    });

    test("3.3 validateHiringRoundsAndReferences detects non-existent referenced tests", async () => {
      const origCompanyFindById = Company.findById;
      const origTestFind = Test.find;

      Company.findById = () => ({
        select: () => ({
          lean: async () => ({ _id: dummyCompanyId, name: "Google" }),
        }),
        lean: async () => ({ _id: dummyCompanyId, name: "Google" }),
      });

      Test.find = () => ({
        select: () => ({
          lean: async () => [], // Empty array simulates missing tests
        }),
        lean: async () => [],
      });

      try {
        const fakeTestId = new Types.ObjectId();
        await assert.rejects(
          async () => {
            await validateHiringRoundsAndReferences({
              companyId: dummyCompanyId.toString(),
              category: "COMPANY",
              hiringRounds: [
                {
                  roundOrder: 1,
                  roundKey: "ROUND_1",
                  roundName: "Assessment",
                  roundType: "TESTS",
                  cutoffPercentage: 50,
                  weight: 100,
                  retakePolicy: "ALL_TESTS",
                  tests: [fakeTestId.toString()],
                },
              ],
            });
          },
          /Referenced test\(s\) do not exist/
        );
      } finally {
        Company.findById = origCompanyFindById;
        Test.find = origTestFind;
      }
    });

    test("3.4 validateHiringRoundsAndReferences resolves multiple valid tests and rounds", async () => {
      const origCompanyFindById = Company.findById;
      const origTestFind = Test.find;

      Company.findById = () => ({
        select: () => ({
          lean: async () => ({ _id: dummyCompanyId, name: "Google" }),
        }),
        lean: async () => ({ _id: dummyCompanyId, name: "Google" }),
      });

      Test.find = () => ({
        select: () => ({
          lean: async () => [
            { _id: dummyTestId1 },
            { _id: dummyTestId2 },
          ],
        }),
        lean: async () => [
          { _id: dummyTestId1 },
          { _id: dummyTestId2 },
        ],
      });

      try {
        const validated = await validateHiringRoundsAndReferences({
          companyId: dummyCompanyId.toString(),
          category: "COMPANY",
          experienceLevel: "EXPERIENCED_1_3",
          hiringRounds: [
            {
              roundOrder: 1,
              roundKey: "ROUND_1_CODING",
              roundName: "Technical Coding Challenge",
              roundType: "TESTS",
              cutoffPercentage: 65,
              weight: 100,
              retakePolicy: "ALL_TESTS",
              tests: [dummyTestId1.toString(), dummyTestId2.toString()],
            },
            {
              roundOrder: 2,
              roundKey: "ROUND_2_AI_INTERVIEW",
              roundName: "System Design Discussion",
              roundType: "AI_INTERVIEW",
              cutoffPercentage: 70,
              weight: 120,
              retakePolicy: "ALL_TESTS",
              aiInterviewConfig: {
                role: "Backend Architect",
                durationMinutes: 45,
                difficulty: "HARD",
              },
            },
          ],
        });

        assert.equal(validated.length, 2);
        assert.equal(validated[0].roundType, "TESTS");
        assert.equal(validated[0].tests.length, 2);
        assert.equal(validated[1].roundType, "AI_INTERVIEW");
        assert.equal(validated[1].aiInterviewConfig.durationMinutes, 45);
      } finally {
        Company.findById = origCompanyFindById;
        Test.find = origTestFind;
      }
    });
  });

  /* ── 4. LEGACY COMPATIBILITY ── */
  describe("Legacy TestSeries & Question Tagging Compatibility", () => {
    test("4.1 Legacy GENERAL test series creates and validates with no hiring rounds", async () => {
      const series = new TestSeries({
        title: "Standard Aptitude Series",
        visibility: "PUBLIC",
        category: "GENERAL",
        createdBy: {
          userId: dummyUserId,
          role: "ORGANIZATION",
        },
        tests: [dummyTestId1],
      });

      await series.validate();
      assert.equal(series.category, "GENERAL");
      assert.equal(series.hiringRounds.length, 0);
      assert.equal(series.experienceLevel, "FRESHER");
    });

    test("4.2 Legacy COMPANY test series with roundsConfig persists properly", async () => {
      const legacyCompanySeries = new TestSeries({
        title: "Infosys Campus Hiring 2025",
        visibility: "PUBLIC",
        category: "COMPANY",
        companyId: dummyCompanyId,
        createdBy: {
          userId: dummyUserId,
          role: "IQPATH_ADMIN",
        },
        roundsConfig: [
          {
            stageOrder: 1,
            stageKey: "ROUND_1",
            stageName: "Online Test",
            cutoffPercentage: 65,
            retakePolicy: "FAILED_ONLY",
          },
        ],
      });

      await legacyCompanySeries.validate();
      assert.equal(legacyCompanySeries.roundsConfig.length, 1);
      assert.equal(legacyCompanySeries.roundsConfig[0].cutoffPercentage, 65);
      assert.equal(legacyCompanySeries.hiringRounds.length, 0);
    });

    test("4.3 Question model accepts company tagging without affecting company branding", async () => {
      const question = new Question({
        questionText: "What is the time complexity of binary search?",
        type: "MCQ",
        options: ["O(log n)", "O(n)", "O(n^2)", "O(1)"],
        correctAnswer: "O(log n)",
        companyIds: [dummyCompanyId],
        createdBy: dummyUserId,
      });

      await question.validate();
      assert.equal(question.companyIds.length, 1);
      assert.equal(question.companyIds[0].toString(), dummyCompanyId.toString());
    });
  });

  /* ── 5. LOGO UPLOAD & STORAGE ERROR HANDLING ── */
  describe("Logo Upload Middleware Validation", () => {
    test("5.1 imageUpload rejects non-image mimetypes like pdf or text", (t, done) => {
      const fakeReq = {};
      const fakeFile = { mimetype: "application/pdf", originalname: "resume.pdf" };

      // Call fileFilter of imageUpload
      imageUpload.fileFilter(fakeReq, fakeFile, (err, acceptFile) => {
        assert.ok(err instanceof Error, "Should produce an error for disallowed mimetype");
        assert.match(err.message, /Only JPEG, PNG, WEBP or GIF/);
        assert.equal(acceptFile, false);
        done();
      });
    });

    test("5.2 imageUpload accepts valid image mimetypes like image/png and image/jpeg", (t, done) => {
      const fakeReq = {};
      const fakeFile = { mimetype: "image/png", originalname: "logo.png" };

      imageUpload.fileFilter(fakeReq, fakeFile, (err, acceptFile) => {
        assert.equal(err, null);
        assert.equal(acceptFile, true);
        done();
      });
    });
  });
});
