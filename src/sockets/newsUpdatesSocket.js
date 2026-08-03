import logger from "../config/logger.js";

export const setupNewsUpdatesSocket = (io) => {
  const nsp = io.of("/news-updates");

  nsp.on("connection", (socket) => {
    logger.info("Socket connected to news-updates namespace");

    socket.on("disconnect", () => {
      logger.info("Socket disconnected from news-updates namespace");
    });
  });
};
