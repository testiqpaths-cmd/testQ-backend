import { Server } from "socket.io";
import { setupIQRoomSocket } from "./iqRoomSocket.js";
import { setupAssignedTestsSocket } from "./assignedTestsSocket.js";
import { setupNewsUpdatesSocket } from "./newsUpdatesSocket.js";
import { corsOptions } from "../config/cors.js";

let io;

export const setupSockets = (server) => {
  io = new Server(server, {
    cors: corsOptions,
  });

  setupIQRoomSocket(io);
  setupAssignedTestsSocket(io);
  setupNewsUpdatesSocket(io);

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
};
