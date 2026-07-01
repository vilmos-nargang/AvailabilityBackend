import express from "express";
import { MonitorModel } from "../model.mjs";
import { authMiddleware } from "../middleware/auth.mjs";

export const monitorRouter = express.Router();
monitorRouter.use(authMiddleware);

const ALLOWED_METHODS = new Set(["HEAD", "GET"]);

function parseMonitorId(req, res, next) {
  const id = Number(req.params.monitorId);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      message: "Invalid monitor id"
    });
  }

  req.monitorId = id;
  next();
}

function isValidHttpUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}


/**
 * GET /api/monitors
 * List user's monitors.
 */
monitorRouter.get("/", (req, res, next) => {
  try {
    const monitors = MonitorModel.listForUser(req.user.id);
    res.json(monitors);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/monitors
 * Create monitor.
 */
monitorRouter.post("/", (req, res, next) => {
  try {
    const { name, method = "HEAD" } = req.body;
    const rawUrl = req.body.rawUrl ?? req.body.url;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        message: "Name is required"
      });
    }

    if (!rawUrl || typeof rawUrl !== "string" || !isValidHttpUrl(rawUrl)) {
      return res.status(400).json({
        message: "A valid HTTP or HTTPS URL is required"
      });
    }

    const normalizedMethod = String(method).toUpperCase();

    if (!ALLOWED_METHODS.has(normalizedMethod)) {
      return res.status(400).json({
        message: "Method must be HEAD or GET"
      });
    }

    const monitor = MonitorModel.create({
      userId: req.user.id,
      name: name.trim(),
      rawUrl: rawUrl.trim(),
      method: normalizedMethod
    });

    res.status(201).json(monitor);
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({
        message: "You already have a monitor for this URL and method"
      });
    }

    next(err);
  }
});

/**
 * GET /api/monitors/:monitorId
 * Get one monitor.
 */
monitorRouter.get("/:monitorId", parseMonitorId, (req, res, next) => {
  try {
    const monitor = MonitorModel.findByIdForUser(req.monitorId, req.user.id);

    if (!monitor) {
      return res.status(404).json({
        message: "Monitor not found"
      });
    }

    res.json(monitor);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/monitors/:monitorId
 * Delete monitor.
 */
monitorRouter.delete("/:monitorId", parseMonitorId, (req, res, next) => {
  try {
    const deleted = MonitorModel.deleteForUser(req.monitorId, req.user.id);

    if (!deleted) {
      return res.status(404).json({
        message: "Monitor not found"
      });
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});