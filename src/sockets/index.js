import { Server } from "socket.io";
import { setupIQRoomSocket } from "./iqRoomSocket.js";
import { corsOptions } from "../config/cors.js";

let io;

export const setupSockets = (server) => {
  io = new Server(server, {
    cors: corsOptions,
  });

  setupIQRoomSocket(io);

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
};
