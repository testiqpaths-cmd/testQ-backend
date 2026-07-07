import logger from "../config/logger.js";

export const setupIQRoomSocket = (io) => {
  const iqRoomNamespace = io.of("/iq-room");

  iqRoomNamespace.on("connection", (socket) => {
    logger.info(`Socket connected to IQ Room: ${socket.id}`);

    // Join a specific room waiting area
    socket.on("join-room", ({ roomCode, user }) => {
      socket.join(roomCode);
      socket.userId = user?.id || user?._id;
      logger.info(`User ${socket.userId} joined IQ Room ${roomCode}`);
      
      // Notify others in the room
      socket.to(roomCode).emit("participant-joined", user);
    });

    // When the creator starts the test
    socket.on("start-room", ({ roomCode }) => {
      logger.info(`IQ Room ${roomCode} started by creator`);
      iqRoomNamespace.to(roomCode).emit("room-started", { roomCode });
    });

    // When a user submits or auto-submits their test attempt
    socket.on("submit-test", ({ roomCode, result }) => {
      logger.info(`User submitted test in IQ Room ${roomCode}`);
      // Notify everyone in the room about the updated leaderboard
      // The frontend will usually just fetch the leaderboard API, 
      // but we emit a trigger here so clients know to re-fetch or we send the raw result.
      iqRoomNamespace.to(roomCode).emit("leaderboard-update", result);
    });

    socket.on("disconnect", () => {
      logger.info(`Socket disconnected from IQ Room: ${socket.id}`);
      // Ideally, broadcast participant-left if we tracked rooms in socket memory
    });
  });
};
