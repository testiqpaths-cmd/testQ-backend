export const DIFFICULTY_LABELS = ["Easy", "Medium", "Hard"];

export const toDifficultyLabel = (value) => {
  const normalized = String(value || "MEDIUM").toLowerCase();
  const label = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return DIFFICULTY_LABELS.includes(label) ? label : "Medium";
};

export const emptyDifficultyBreakdown = () => ({
  Easy: { correct: 0, wrong: 0, skipped: 0 },
  Medium: { correct: 0, wrong: 0, skipped: 0 },
  Hard: { correct: 0, wrong: 0, skipped: 0 },
});

export const resolveSubjectName = (test) => {
  if (!test) return "General";

  // 1. Valid populated subjectIds subject name
  if (Array.isArray(test.subjectIds) && test.subjectIds.length > 0) {
    for (const sub of test.subjectIds) {
      if (sub && typeof sub.name === "string" && sub.name.trim()) {
        return sub.name.trim();
      }
    }
  }

  // 2. Valid populated subjectId name, only if supported by the actual schema
  if (test.subjectId && typeof test.subjectId.name === "string" && test.subjectId.name.trim()) {
    return test.subjectId.name.trim();
  }

  // 3. Valid nonempty test type, using the appropriate string value
  if (Array.isArray(test.type) && test.type.length > 0) {
    for (const t of test.type) {
      if (typeof t === "string" && t.trim()) {
        return t.trim();
      }
    }
  } else if (typeof test.type === "string" && test.type.trim()) {
    return test.type.trim();
  }

  // 4. Fallback to "General" when no valid subject is available
  return "General";
};

export const resolveTopicNames = (test) => {
  const topics = [];
  if (test && Array.isArray(test.topicIds)) {
    test.topicIds.forEach((topic) => {
      if (
        topic &&
        typeof topic === "object" &&
        topic.name &&
        typeof topic.name === "string" &&
        topic.name.trim()
      ) {
        topics.push(topic.name.trim());
      } else if (typeof topic === "string" && topic.trim()) {
        topics.push(topic.trim());
      }
    });
  }
  if (topics.length === 0) {
    topics.push("General");
  }
  return topics;
};

export const buildAttemptAnalyticsSnapshot = ({
  attempt,
  test,
  questionDifficultyMap = new Map(),
}) => {
  const testName = test?.title || "Untitled Test";
  const subject = resolveSubjectName(test);
  const topics = resolveTopicNames(test);
  const primaryTopic = topics[0] || "General";
  const category = test?.type || "Standard";

  const difficultyBreakdown = emptyDifficultyBreakdown();
  const answers = Array.isArray(attempt?.answers) ? attempt.answers : [];

  answers.forEach((ans) => {
    const qId = ans?.questionId ? String(ans.questionId) : null;
    const rawDiff = qId && questionDifficultyMap ? questionDifficultyMap.get(qId) : null;
    const label = toDifficultyLabel(rawDiff);
    const bucket = difficultyBreakdown[label] || difficultyBreakdown.Medium;

    if (ans.isCorrect === true) {
      bucket.correct += 1;
    } else if (ans.selectedOption) {
      bucket.wrong += 1;
    } else {
      bucket.skipped += 1;
    }
  });

  return {
    testName,
    subject,
    topic: primaryTopic,
    topics,
    category,
    difficultyBreakdown,
    computedAt: new Date(),
  };
};

export const isValidSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") return false;
  if (!snapshot.testName || typeof snapshot.testName !== "string") return false;
  if (!snapshot.subject || typeof snapshot.subject !== "string") return false;
  if (!snapshot.topic || typeof snapshot.topic !== "string") return false;
  const breakdown = snapshot.difficultyBreakdown;
  if (!breakdown || typeof breakdown !== "object") return false;

  for (const label of DIFFICULTY_LABELS) {
    const bucket = breakdown[label];
    if (!bucket || typeof bucket !== "object") return false;
    if (
      typeof bucket.correct !== "number" ||
      typeof bucket.wrong !== "number" ||
      typeof bucket.skipped !== "number"
    ) {
      return false;
    }
  }
  return true;
};
