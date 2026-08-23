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
// `verify` stashes the exact raw request bytes on req.rawBody alongside the
// normal parsed req.body — every existing route is unaffected, but the
// Razorpay webhook route needs the raw bytes (not the re-serialized JSON
// object) to verify Razorpay's HMAC signature correctly.
app.use(express.json({ limit: "10mb", verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  })
);
app.use(cookieParser());

// Request logger middleware (logs body, headers, params, query)
app.use(requestLogger);

// Routes
app.use("/api", routes);


// Default route
app.get("/", (req, res) => {
  res.send("API is running...");
});

// Error middleware (after routes)
app.use(errorMiddleware);





export default app;
