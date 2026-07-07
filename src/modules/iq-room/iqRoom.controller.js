import {
  createIQRoomService,
  joinIQRoomService,
  getIQRoomService,
  startIQRoomService,
  getIQRoomLeaderboardService,
  getUserIQRoomHistoryService,
} from "./iqRoom.service.js";
import { getIO } from "../../sockets/index.js";

export const createIQRoomController = async (req, res, next) => {
  try {
    const {
      name,
      description,
      testId,
      maxParticipants,
      durationMinutes,
      autoStart,
      autoEnd,
    } = req.body;

    const creatorId = req.user.id;

    const room = await createIQRoomService({
      name,
      description,
      creatorId,
      testId,
      maxParticipants,
      durationMinutes,
      autoStart,
      autoEnd,
    });

    res.status(201).json({
      success: true,
      message: "IQ Room created successfully",
      data: room,
    });
  } catch (error) {
    next(error);
  }
};

export const joinIQRoomController = async (req, res, next) => {
  try {
    const { roomCode } = req.body;
    const userId = req.user.id;

    const room = await joinIQRoomService({ roomCode, userId });

    res.status(200).json({
      success: true,
      message: "Joined IQ Room successfully",
      data: room,
    });
  } catch (error) {
    next(error);
  }
};

export const getIQRoomController = async (req, res, next) => {
  try {
    const { roomCode } = req.params;

    const room = await getIQRoomService({ roomCode });

    res.status(200).json({
      success: true,
      data: room,
    });
  } catch (error) {
    next(error);
  }
};

export const startIQRoomController = async (req, res, next) => {
  try {
    const { roomCode } = req.params;
    const userId = req.user.id;

    const room = await startIQRoomService({ roomCode, userId });

    // Emit event to room
    const io = getIO();
    io.of("/iq-room").to(roomCode).emit("room-started", { roomCode, testId: room.testId });

    res.status(200).json({
      success: true,
      message: "Room started successfully",
      data: room,
    });
  } catch (error) {
    next(error);
  }
};

export const getIQRoomLeaderboardController = async (req, res, next) => {
  try {
    const { roomCode } = req.params;
    const leaderboard = await getIQRoomLeaderboardService({ roomCode });

    res.status(200).json({
      success: true,
      data: leaderboard,
    });
  } catch (error) {
    next(error);
  }
};

export const getUserIQRoomHistoryController = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const history = await getUserIQRoomHistoryService(userId);

    res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    next(error);
  }
};
