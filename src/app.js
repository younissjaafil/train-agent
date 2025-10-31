const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get("/status", (req, res) =>
  res.json({
    service: "Train Agent Microservice",
    status: "Microservice is running successfully",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  })
);

module.exports = app;
