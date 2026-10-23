import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FRONTEND_DIR = path.resolve(__dirname, "../../../testQ-frontend/testQ-frontend");
const AI_INTERVIEW_DIR = path.join(FRONTEND_DIR, "src/features/ai-interview");

const readFrontendFile = (subPath) => {
  const fullPath = path.join(FRONTEND_DIR, subPath);
  assert.ok(fs.existsSync(fullPath), `File must exist: ${fullPath}`);
  return fs.readFileSync(fullPath, "utf8");
};

test("TC-300: Consistent Dark Theme in AI Interview Room Suite", async (t) => {
  const roomCode = readFrontendFile("src/features/ai-interview/pages/AIInterviewRoom.jsx");
  const topBarCode = readFrontendFile("src/features/ai-interview/components/room/InterviewTopBar.jsx");
  const questionCaptionCode = readFrontendFile("src/features/ai-interview/components/room/QuestionCaption.jsx");
  const answerComposerCode = readFrontendFile("src/features/ai-interview/components/room/AnswerComposer.jsx");
  const candidateTileCode = readFrontendFile("src/features/ai-interview/components/room/CandidateVideoTile.jsx");
  const aiTileCode = readFrontendFile("src/features/ai-interview/components/room/AiInterviewerTile.jsx");
  const conversationPanelCode = readFrontendFile("src/features/ai-interview/components/room/ConversationPanel.jsx");
  const errorCode = readFrontendFile("src/features/ai-interview/components/common/InterviewErrorState.jsx");
  const layoutCode = readFrontendFile("src/shared/layouts/DashboardLayout.jsx");

  await t.test("Requirement 1: Main background color is exactly #070D18 throughout the room and layout shell", () => {
    // 1. AIInterviewRoom main container
    assert.match(
      roomCode,
      /bg-\[#070D18\]/,
      "AIInterviewRoom main container must use exact background #070D18"
    );

    // 2. Error state in room
    assert.match(
      roomCode,
      /if\s*\(\s*error\s*\)[\s\S]*?bg-\[#070D18\]/,
      "AIInterviewRoom error screen must use background #070D18"
    );

    // 3. Completed state in room
    assert.match(
      roomCode,
      /if\s*\(\s*isComplete\s*\)[\s\S]*?bg-\[#070D18\]/,
      "AIInterviewRoom completed transition screen must use background #070D18"
    );

    // 4. Preparing / loading state in room
    assert.match(
      roomCode,
      /SESSION_STATUS\.PREPARING[\s\S]*?bg-\[#070D18\]/,
      "AIInterviewRoom preparing state must use background #070D18"
    );

    // 5. DashboardLayout layout shell for AI Interview Session
    assert.match(
      layoutCode,
      /isAiInterviewSession[\s\S]*?bg-\[#070D18\]/,
      "DashboardLayout surrounding container for AI interview session must use exact background #070D18"
    );
  });

  await t.test("Requirement 2: Top bar border is exactly #1E3A6E", () => {
    // 1. InterviewTopBar bottom border
    assert.match(
      topBarCode,
      /border-b\s+border-\[#1E3A6E\]/,
      "InterviewTopBar must apply exact border #1E3A6E to its bottom border"
    );

    // 2. Top bar background
    assert.match(
      topBarCode,
      /bg-\[#070D18\]/,
      "InterviewTopBar must use exact background #070D18"
    );
  });

  await t.test("Requirement 3: Primary text uses Tailwind text-slate-100", () => {
    // 1. Top bar title
    assert.match(
      topBarCode,
      /text-slate-100/,
      "InterviewTopBar must use text-slate-100 for primary text"
    );

    // 2. Question caption question text
    assert.match(
      questionCaptionCode,
      /text-slate-100/,
      "QuestionCaption must use text-slate-100 for question text"
    );

    // 3. Room completion heading
    assert.match(
      roomCode,
      /Interview Completed[\s\S]*?text-slate-100|text-slate-100[\s\S]*?Interview Completed/,
      "AIInterviewRoom completion screen must use text-slate-100"
    );

    // 4. Error state heading
    assert.match(
      errorCode,
      /text-slate-100/,
      "InterviewErrorState must use text-slate-100 for heading"
    );

    // 5. Answer composer textarea text
    assert.match(
      answerComposerCode,
      /text-slate-100/,
      "AnswerComposer textarea must use text-slate-100 for primary text"
    );
  });

  await t.test("Requirement 4: Secondary text uses Tailwind text-slate-300", () => {
    // 1. Top bar secondary metadata (role / company)
    assert.match(
      topBarCode,
      /text-slate-300/,
      "InterviewTopBar must use text-slate-300 for secondary text"
    );

    // 2. Question caption status/helper text
    assert.match(
      questionCaptionCode,
      /text-slate-300/,
      "QuestionCaption must use text-slate-300 for helper/status text"
    );

    // 3. Error state description
    assert.match(
      errorCode,
      /text-slate-300/,
      "InterviewErrorState must use text-slate-300 for message description"
    );

    // 4. Completion screen description
    assert.match(
      roomCode,
      /text-slate-300/,
      "AIInterviewRoom completion screen must use text-slate-300"
    );

    // 5. Answer composer secondary text / buttons
    assert.match(
      answerComposerCode,
      /text-slate-300/,
      "AnswerComposer controls must use text-slate-300 for secondary text"
    );
  });

  await t.test("Requirement 5: Room components use consistent #1E3A6E borders and dark backgrounds without light containers", () => {
    // QuestionCaption
    assert.match(questionCaptionCode, /border-\[#1E3A6E\]/);
    assert.match(questionCaptionCode, /bg-\[#070D18\]/);

    // CandidateVideoTile
    assert.match(candidateTileCode, /border-\[#1E3A6E\]/);
    assert.match(candidateTileCode, /bg-\[#070D18\]/);

    // AiInterviewerTile
    assert.match(aiTileCode, /border-\[#1E3A6E\]/);
    assert.match(aiTileCode, /bg-\[#070D18\]/);

    // AnswerComposer
    assert.match(answerComposerCode, /border-\[#1E3A6E\]/);
    assert.match(answerComposerCode, /bg-\[#070D18\]/);

    // ConversationPanel
    assert.match(conversationPanelCode, /border-\[#1E3A6E\]/);
    assert.match(conversationPanelCode, /bg-\[#070D18\]/);

    // ErrorState
    assert.match(errorCode, /border-\[#1E3A6E\]/);
    assert.match(errorCode, /bg-\[#070D18\]/);

    // Ensure no conflicting light containers in room cards
    assert.doesNotMatch(questionCaptionCode, /bg-white/);
    assert.doesNotMatch(answerComposerCode, /bg-white\b/);
    assert.doesNotMatch(candidateTileCode, /bg-white\b/);
    assert.doesNotMatch(aiTileCode, /bg-white\b/);
    assert.doesNotMatch(errorCode, /bg-rose-50\b/);
    assert.doesNotMatch(errorCode, /text-slate-900/);
  });
});
