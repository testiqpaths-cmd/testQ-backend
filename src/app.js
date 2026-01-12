const express = require("express");
const { errorMiddleware } = require('./common/middlewares/error.middleware');
const app = express();

app.use(express.json());
// app.use(errorMiddleware);

app.get("/", (req, res) => {
  res.send("API is running...");
});

module.exports = app;
