import IQRoom from "../../models/iqRoom.model.js";
import Test from "../../models/test.model.js";
import TestAttempt from "../../models/testAttempt.model.js";
import { AppError } from "../../common/utils/error.js";

// Generate a random 6-character alphanumeric code
const generateRoomCode = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export const createIQRoomService = async ({
  name,
  description,
  creatorId,
  testId,
  maxParticipants,
  durationMinutes,
  autoStart,
  autoEnd,
}) => {
  const test = await Test.findById(testId);
  if (!test) {
    throw new AppError("Test not found", 404);
  }

  let roomCode;
  let isUnique = false;
  // Ensure uniqueness of room code
  while (!isUnique) {
    roomCode = generateRoomCode();
    const existing = await IQRoom.findOne({ roomCode });
    if (!existing) {
      isUnique = true;
    }
  }

  const room = await IQRoom.create({
    roomCode,
    name,
    description,
    creatorId,
    testId,
    maxParticipants,
    durationMinutes: durationMinutes || test.duration,
    autoStart,
    autoEnd,
    status: "WAITING",
  });

  return room;
};

export const joinIQRoomService = async ({ roomCode, userId }) => {
  const room = await IQRoom.findOne({ roomCode: roomCode.toUpperCase() });

  if (!room) {
    throw new AppError("Invalid Room Code", 404);
  }

  if (room.status !== "WAITING") {
    throw new AppError("Room is no longer accepting participants", 400);
  }

  if (room.participants.length >= room.maxParticipants) {
    throw new AppError("Room is full", 400);
  }

  const alreadyJoined = room.participants.some(
    (p) => p.userId.toString() === userId.toString()
  );

  if (!alreadyJoined) {
    room.participants.push({ userId });
    await room.save();
  }

  return room;
};

export const getIQRoomService = async ({ roomCode }) => {
  const room = await IQRoom.findOne({ roomCode: roomCode.toUpperCase() })
    .populate("creatorId", "name email")
    .populate("testId", "title duration marksPerQuestion negativeMarkingPercentage maxAttempts")
    .populate("participants.userId", "name email");

  if (!room) {
    throw new AppError("Room not found", 404);
  }

  return room;
};

export const startIQRoomService = async ({ roomCode, userId }) => {
  const room = await IQRoom.findOne({ roomCode: roomCode.toUpperCase() });

  if (!room) {
    throw new AppError("Room not found", 404);
  }

  if (room.creatorId.toString() !== userId.toString()) {
    throw new AppError("Only the creator can start the room", 403);
  }

  if (room.status !== "WAITING") {
    throw new AppError(`Cannot start room in ${room.status} state`, 400);
  }

  room.status = "RUNNING";
  room.startedAt = new Date();
  await room.save();

  return room;
};

export const getIQRoomLeaderboardService = async ({ roomCode }) => {
  const room = await IQRoom.findOne({ roomCode: roomCode.toUpperCase() }).lean();
  if (!room) {
    throw new AppError("Room not found", 404);
  }

  // Fetch all attempts tied to this room
  const attempts = await TestAttempt.find({ iqRoomId: room._id })
    .populate("studentId", "name email")
    .lean();

  // Map to leaderboard entries
  const leaderboard = attempts.map(attempt => {
    return {
      userId: attempt.studentId?._id,
      name: attempt.studentId?.name || "Unknown",
      score: attempt.totalScore,
      timeTaken: attempt.timeTakenSeconds,
      correct: attempt.correctAnswersCount,
      wrong: attempt.incorrectAnswersCount,
      skipped: attempt.unattemptedCount,
      submittedAt: attempt.submittedAt,
      status: attempt.status
    };
  });

  // Sort: Highest Score -> Lowest Time -> Earliest Submit
  leaderboard.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.timeTaken !== b.timeTaken) return a.timeTaken - b.timeTaken;
    return new Date(a.submittedAt) - new Date(b.submittedAt);
  });

  // Assign Ranks
  leaderboard.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  return { room, leaderboard };
};

export const getUserIQRoomHistoryService = async (userId) => {
  // Rooms where user is either creator or participant
  const rooms = await IQRoom.find({
    $or: [
      { creatorId: userId },
      { "participants.userId": userId }
    ]
  })
    .sort({ createdAt: -1 })
    .populate("testId", "title")
    .lean();

  return rooms;
};
