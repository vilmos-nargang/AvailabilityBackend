import "dotenv/config";

import express from "express";
import { initDb } from "./model.mjs";
import { authRouter } from "./routes/auth_route.mjs";
import { monitorRouter } from "./routes/monitors.mjs";
import { checksRouter } from "./routes/checks.mjs";

const app = express();

app.use(express.json());

const fallbackPort = 80;
const port = process.env.PORT || fallbackPort;

initDb();

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/monitors", monitorRouter);
app.use("/api/monitors", checksRouter);

app.use((err, req, res, next) => {
  console.error(err);

  res.status(err.statusCode || 500).json({
    message: err.message || "Internal server error"
  });
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});