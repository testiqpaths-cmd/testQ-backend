import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  hasUnassessedCoreCompetencies,
  PROVISIONAL_ASSESSMENT_NOTICE_MESSAGE,
} from "../../../testQ-frontend/testQ-frontend/src/features/ai-interview/utils/interview.utils.js";
import { interviewResultsService } from "../src/ai-interview/services/interview-results.service.js";
import { integrityService } from "../src/ai-interview/services/integrity.service.js";

test("TC-224: Display Provisional Assessment Notice in Interview Report Suite", async (t) => {
  await t.test("Message content matches the exact requirement", () => {
    const expectedMessage =
      "Certain core competency areas were not assessed in this interview. The performance score reflects only demonstrated skills.";
    assert.equal(
      PROVISIONAL_ASSESSMENT_NOTICE_MESSAGE,
      expectedMessage,
      "Notice banner message must match the exact specification"
    );
  });

  await t.test(
    "Scenario 1: System Design is null, Behavioral has a score -> banner is displayed",
    () => {
      const details = {
        scores: {
          technicalSkills: 85,
          systemDesign: null,
          behavioral: 80,
          communication: 75,
        },
      };

      const shouldShow = hasUnassessedCoreCompetencies(details);
      assert.equal(
        shouldShow,
        true,
        "Banner must be displayed when systemDesign is null"
      );
    }
  );

  await t.test(
    "Scenario 2: Behavioral is null, System Design has a score -> banner is displayed",
    () => {
      const details = {
        scores: {
          technicalSkills: 90,
          systemDesign: 85,
          behavioral: null,
          communication: 80,
        },
      };

      const shouldShow = hasUnassessedCoreCompetencies(details);
      assert.equal(
        shouldShow,
        true,
        "Banner must be displayed when behavioral is null"
      );
    }
  );

  await t.test(
    "Scenario 3: Both competencies are null -> banner condition is true (displayed once)",
    () => {
      const details = {
        scores: {
          technicalSkills: 88,
          systemDesign: null,
          behavioral: null,
          communication: 70,
        },
      };

      const shouldShow = hasUnassessedCoreCompetencies(details);
      assert.equal(
        shouldShow,
        true,
        "Banner must be displayed when both competencies are null"
      );
    }
  );

  await t.test(
    "Scenario 4: All core competencies have valid scores, including genuine score of 0 -> banner is hidden",
    () => {
      // Case A: systemDesign scored 0 (assessed but poor)
      const detailsA = {
        scores: {
          technicalSkills: 80,
          problemSolving: 75,
          systemDesign: 0,
          behavioral: 70,
          communication: 85,
        },
      };
      assert.equal(
        hasUnassessedCoreCompetencies(detailsA),
        false,
        "Banner must be hidden when systemDesign scored 0 (genuine assessed score)"
      );

      // Case B: behavioral scored 0
      const detailsB = {
        scores: {
          technicalSkills: 80,
          problemSolving: 75,
          systemDesign: 65,
          behavioral: 0,
          communication: 85,
        },
      };
      assert.equal(
        hasUnassessedCoreCompetencies(detailsB),
        false,
        "Banner must be hidden when behavioral scored 0 (genuine assessed score)"
      );

      // Case C: all positive scores
      const detailsC = {
        scores: {
          technicalSkills: 90,
          problemSolving: 85,
          systemDesign: 80,
          behavioral: 75,
          communication: 85,
        },
      };
      assert.equal(
        hasUnassessedCoreCompetencies(detailsC),
        false,
        "Banner must be hidden when all core competencies have valid positive scores"
      );
    }
  );

  await t.test(
    "Scenario 5: Report data is loading, null, or unavailable -> no incorrect banner state or runtime error",
    () => {
      assert.equal(hasUnassessedCoreCompetencies(null), false);
      assert.equal(hasUnassessedCoreCompetencies(undefined), false);
      assert.equal(hasUnassessedCoreCompetencies({}), false);
      assert.equal(hasUnassessedCoreCompetencies({ scores: {} }), false);
      assert.equal(hasUnassessedCoreCompetencies({ competencyScores: {} }), false);
    }
  );

  await t.test(
    "AssessmentProfile compatibility: detects null or INSUFFICIENT_EVIDENCE in profile competencies",
    () => {
      const detailsWithUnassessedProfile = {
        assessmentProfile: {
          competencies: [
            { key: "technicalKnowledge", score: 80, status: "EVALUATED" },
            { key: "systemDesign", score: null, status: "INSUFFICIENT_EVIDENCE" },
          ],
        },
      };
      assert.equal(
        hasUnassessedCoreCompetencies(detailsWithUnassessedProfile),
        true,
        "Should show notice when competency in assessmentProfile has score null"
      );

      const detailsWithEvaluatedProfile = {
        assessmentProfile: {
          competencies: [
            { key: "technicalKnowledge", score: 80, status: "EVALUATED" },
            { key: "systemDesign", score: 0, status: "EVALUATED" },
            { key: "behavioral", score: 70, status: "EVALUATED" },
          ],
        },
      };
      assert.equal(
        hasUnassessedCoreCompetencies(detailsWithEvaluatedProfile),
        false,
        "Should not show notice when all profile competencies are evaluated (including 0)"
      );
    }
  );

  await t.test(
    "End-to-end integration: technical-only interview session triggers TC-224 notice",
    async () => {
      const origTurnFind = mongoose.model("InterviewTurn").find;
      const origPlanFindById = mongoose.model("InterviewPlan").findById;
      const origSummaryForSession = integrityService.summaryForSession;
      const origAiFeedback = interviewResultsService.ai.generateInterviewFeedback;

      try {
        const sessionId = new mongoose.Types.ObjectId();
        const planId = new mongoose.Types.ObjectId();

        const technicalTurns = [
          {
            _id: new mongoose.Types.ObjectId(),
            sessionId,
            turnNumber: 1,
            topic: "REACT",
            questionType: "TECHNICAL",
            question: "Explain the Virtual DOM in React.",
            candidateAnswer: "Virtual DOM diffs and batches updates.",
            answerStatus: "ACCURATE",
            correctnessScore: 85,
            relevanceScore: 90,
            completenessScore: 85,
            confidence: 85,
          },
          {
            _id: new mongoose.Types.ObjectId(),
            sessionId,
            turnNumber: 2,
            topic: "REACT",
            questionType: "TECHNICAL",
            question: "What are hooks in React?",
            candidateAnswer: "Hooks provide state and lifecycle to functional components.",
            answerStatus: "ACCURATE",
            correctnessScore: 80,
            relevanceScore: 85,
            completenessScore: 80,
            confidence: 80,
          },
        ];

        mongoose.model("InterviewTurn").find = () => ({
          sort: () => ({
            lean: async () => technicalTurns,
          }),
        });

        mongoose.model("InterviewPlan").findById = () => ({
          lean: async () => ({
            _id: planId,
            globalQuestionLimit: 2,
          }),
        });

        integrityService.summaryForSession = async () => ({ copyPasteCount: 0 });
        interviewResultsService.ai.generateInterviewFeedback = async () => ({
          overallFeedback: "Solid React knowledge.",
          perQuestion: [],
        });

        const session = {
          _id: sessionId,
          interviewId: "int-tc-224-technical-only",
          planId,
          role: "Frontend Developer",
          experienceLevel: "MID",
          interviewTypes: ["TECHNICAL"],
          techStack: ["React"],
          difficulty: "MEDIUM",
          duration: 15,
          questionCount: 2,
          coverageState: [
            {
              topic: "REACT",
              status: "EVALUATED",
              averageScore: 82,
              questionsAsked: 2,
            },
          ],
        };

        const results = await interviewResultsService.computeResultsForSession(session);

        // Verify TC-223 established values: systemDesign and behavioral are null
        assert.equal(results.scores.systemDesign, null);
        assert.equal(results.scores.behavioral, null);

        // Verify TC-224 notice is triggered
        const noticeTriggered = hasUnassessedCoreCompetencies(results);
        assert.equal(
          noticeTriggered,
          true,
          "Notice must trigger on technical-only session with unassessed competencies"
        );
      } finally {
        mongoose.model("InterviewTurn").find = origTurnFind;
        mongoose.model("InterviewPlan").findById = origPlanFindById;
        integrityService.summaryForSession = origSummaryForSession;
        interviewResultsService.ai.generateInterviewFeedback = origAiFeedback;
      }
    }
  );
});
