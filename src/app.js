import express from "express";
import { errorMiddleware } from "./common/middlewares/error.middleware.js";

const app = express();

app.use(express.json());
// app.use(errorMiddleware);

app.get("/", (req, res) => {
  res.send("API is running...");
});

export default app;

