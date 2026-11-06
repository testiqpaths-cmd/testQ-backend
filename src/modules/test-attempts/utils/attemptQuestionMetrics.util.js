export const DIFFICULTY_LABELS = ["Easy", "Medium", "Hard"];

export const hasAnswerValue = (answer) => {
  const hasSelectedOption =
    answer?.selectedOption !== undefined &&
    answer?.selectedOption !== null &&
    String(answer.selectedOption).trim() !== "";

  const hasTextAnswer =
    answer?.textAnswer !== undefined &&
    answer?.textAnswer !== null &&
    String(answer.textAnswer).trim() !== "";

  return hasSelectedOption || hasTextAnswer;
};

export const normalizeDifficulty = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (normalized === "easy") return "Easy";
  if (normalized === "hard") return "Hard";

  // Missing, invalid, or unknown difficulty defaults to Medium.
  return "Medium";
};

export const createEmptyDifficultyBreakdown = () => ({
  Easy: { correct: 0, wrong: 0, skipped: 0 },
  Medium: { correct: 0, wrong: 0, skipped: 0 },
  Hard: { correct: 0, wrong: 0, skipped: 0 },
});

const createEmptyCounts = () => ({
  correct: 0,
  wrong: 0,
  skipped: 0,
  pending: 0,
});

const resolveDifficulty = (
  questionId,
  question,
  questionDifficultyMap
) => {
  const mappedDifficulty =
    questionId && questionDifficultyMap instanceof Map
      ? questionDifficultyMap.get(questionId)
      : undefined;

  return normalizeDifficulty(
    mappedDifficulty ?? question?.difficulty
  );
};

export const calculateAttemptQuestionMetrics = ({
  answers = [],
  questionSnapshots = [],
  questionDifficultyMap = new Map(),
} = {}) => {
  const normalizedAnswers = Array.isArray(answers) ? answers : [];
  const normalizedSnapshots = Array.isArray(questionSnapshots)
    ? questionSnapshots
    : [];

  const answerByQuestionId = new Map();

  for (const answer of normalizedAnswers) {
    if (answer?.questionId == null) continue;

    const questionId = String(answer.questionId);

    // Preserve the first answer if duplicate records exist.
    if (!answerByQuestionId.has(questionId)) {
      answerByQuestionId.set(questionId, answer);
    }
  }

  const counts = createEmptyCounts();
  const difficultyBreakdown = createEmptyDifficultyBreakdown();
  const processedQuestionIds = new Set();

  const recordQuestion = (answer, questionId, question) => {
    const hasValue = hasAnswerValue(answer);
    const difficulty = resolveDifficulty(
      questionId,
      question,
      questionDifficultyMap
    );

    if (hasValue) {
      // Pending answers count as answered, but not as correct or wrong.
      if (answer.isCorrect === true) {
        counts.correct += 1;
        difficultyBreakdown[difficulty].correct += 1;
      } else if (answer.isCorrect === false) {
        counts.wrong += 1;
        difficultyBreakdown[difficulty].wrong += 1;
      } else {
        counts.pending += 1;
      }

      return;
    }

    counts.skipped += 1;
    difficultyBreakdown[difficulty].skipped += 1;
  };

  // Snapshots define the question set when available, including unanswered
  // questions that have no corresponding answer record.
  for (const question of normalizedSnapshots) {
    const questionId =
      question?.questionId == null
        ? null
        : String(question.questionId);

    const answer = questionId
      ? answerByQuestionId.get(questionId)
      : undefined;

    recordQuestion(answer, questionId, question);

    if (questionId) {
      processedQuestionIds.add(questionId);
    }
  }

  // Also include answers that are not represented in questionSnapshots.
  for (const answer of normalizedAnswers) {
    const questionId =
      answer?.questionId == null
        ? null
        : String(answer.questionId);

    if (questionId && processedQuestionIds.has(questionId)) {
      continue;
    }

    recordQuestion(answer, questionId, null);

    if (questionId) {
      processedQuestionIds.add(questionId);
    }
  }

  const evaluatedCount = counts.correct + counts.wrong;
  const answeredCount = evaluatedCount + counts.pending;
  const totalQuestions =
    counts.correct + counts.wrong + counts.skipped + counts.pending;

  return {
    ...counts,
    answeredCount,
    evaluatedCount,
    totalQuestions,
    accuracy:
      evaluatedCount > 0
        ? (counts.correct / evaluatedCount) * 100
        : 0,
    difficultyBreakdown,
  };
};
