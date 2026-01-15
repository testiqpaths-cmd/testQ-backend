import express from "express";
import { errorMiddleware } from "./common/middlewares/error.middleware.js";
import cookieParser from "cookie-parser";
const app = express();

app.use(express.json());
app.use(errorMiddleware);
app.use(cookieParser());

app.get("/", (req, res) => {
  res.send("API is running...");
});

export default app;

