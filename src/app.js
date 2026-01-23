import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import env from "./config/env.js";
import routes from "./routes/index.js";
import { errorMiddleware } from "./common/middlewares/error.middleware.js";

const app = express();

const corsOptions = {
  origin: "http://localhost:5173",
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));


// Middleware
app.use(express.json());
app.use(cookieParser());



// Routes
app.use("/api", routes);

// Default route
app.get("/", (req, res) => {
  res.send("API is running...");
});

// Error middleware (after routes)
app.use(errorMiddleware);

export default app;
