import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import env  from "./config/env.js";
import routes from "./routes/index.js";
import { errorMiddleware } from "./common/middlewares/error.middleware.js";

const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());

// CORS with credentials (for JWT cookies)
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  })
);

// Routes
app.use("/api", routes);

// Default route
app.get("/", (req, res) => {
  res.send("API is running...");
});

// Error middleware (after routes)
app.use(errorMiddleware);

export default app;
