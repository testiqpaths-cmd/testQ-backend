import { z } from "zod";

export const TestedConceptSchema = z.object({
  concept: z.string(),
  evidence: z.string().optional().default(""),
  confidence: z.number().min(0).max(1).default(0.8),
  turn: z.number(),
});

export const MisconceptionSchema = z.object({
  concept: z.string(),
  claim: z.string(),
  turn: z.number(),
});

export const MissingConceptSchema = z.object({
  concept: z.string(),
  turn: z.number(),
});

export const TopicMasteryItemSchema = z.object({
  level: z.enum(["BASIC", "INTERMEDIATE", "STRONG", "EXCELLENT"]),
  avgScore: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  evidenceTurns: z.array(z.number()),
});

export const ResumeClaimValidatedSchema = z.object({
  claim: z.string(),
  status: z.enum(["SUPPORTED", "PARTIALLY_SUPPORTED", "UNPROVEN"]),
  evidenceTurn: z.number().nullable().default(null),
});

export const RecentTurnContextSchema = z.object({
  turnNumber: z.number(),
  topic: z.string().optional().default("GENERAL"),
  question: z.string(),
  candidateAnswer: z.string(),
  depthLevel: z.string().optional().default("ADEQUATE"),
});

export const CurrentQuestionContextSchema = z.object({
  question: z.string(),
  topic: z.string().optional().default("GENERAL"),
  difficulty: z.string().optional().default("MEDIUM"),
});

export const InterviewStateSchema = z.object({
  testedConcepts: z.array(TestedConceptSchema).default([]),
  misconceptions: z.array(MisconceptionSchema).default([]),
  missingConcepts: z.array(MissingConceptSchema).default([]),
  topicMastery: z.record(z.string(), TopicMasteryItemSchema).default({}),
  resumeClaimsValidated: z.array(ResumeClaimValidatedSchema).default([]),
  recentTurns: z.array(RecentTurnContextSchema).default([]),
  currentQuestion: CurrentQuestionContextSchema.optional().nullable(),
  totalTurnsCompleted: z.number().default(0),
  currentTopic: z.string().default("GENERAL"),
  currentDifficulty: z.string().default("MEDIUM"),
});

export default InterviewStateSchema;
