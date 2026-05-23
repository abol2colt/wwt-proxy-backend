const express = require("express");
const cors = require("cors");

function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:4200" }));
  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, service: "wtt-proxy" });
  });

  return app;
}

module.exports = { createApp };
