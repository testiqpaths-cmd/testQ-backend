import logger from "../config/logger.js";
import { verifyAccessToken } from "../modules/auth/utils/token.service.js";

// Unlike /iq-room (a shared room-code namespace where client-asserted identity
// is low-stakes), this namespace pushes per-student data — so identity must
// come from a verified JWT during the handshake, not a client-sent payload.
export const setupAssignedTestsSocket = (io) => {
  const nsp = io.of("/assigned-tests");

  nsp.use((socket, next) => {
    try {
      const decoded = verifyAccessToken(socket.handshake.auth?.token);
      socket.userId = decoded.id;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  nsp.on("connection", (socket) => {
    socket.join(String(socket.userId));
    logger.info(`Socket connected to assigned-tests: user ${socket.userId}`);

    socket.on("disconnect", () => {
      logger.info(`Socket disconnected from assigned-tests: user ${socket.userId}`);
    });
  });
};
