import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import morgan from "morgan";
import env from "./config/env.js";
import routes from "./routes/index.js";
import { errorMiddleware } from "./common/middlewares/error.middleware.js";
import { requestLogger } from "./common/middlewares/logger.middleware.js";
import logger from "./config/logger.js";
import { corsOptions } from "./config/cors.js";
import newsUpdatesRoutes from "./modules/news-updates/newsUpdates.routes";

const app = express();


app.use(cors(corsOptions));

// Morgan HTTP request logger
app.use(morgan(":remote-addr - :remote-user [:date[clf]] \":method :url HTTP/:http-version\" :status :res[content-length] \":referrer\" \":user-agent\" :response-time ms", 
  {
    stream: {
      write: (message) => logger.http(message.trim())
    }
  }
));

// Middleware
app.use(express.json());
app.use(cookieParser());

// Request logger middleware (logs body, headers, params, query)
app.use(requestLogger);

// Routes
app.use("/api", routes);
app.use("/news-updates", newsUpdatesRoutes);

// Default route
app.get("/", (req, res) => {
  res.send("API is running...");
});

// Error middleware (after routes)
app.use(errorMiddleware);


export default app;
