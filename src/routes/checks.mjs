import express from "express";
import { CheckModel, MonitorModel } from "../model.mjs";
import { authMiddleware } from "../middleware/auth.mjs";

export const checksRouter = express.Router();
checksRouter.use(authMiddleware);

const REQUEST_TIMEOUT_MS = 10_000;

function parseMonitorId(req, res, next) {
  const monitorId = Number(req.params.monitorId);

  if (!Number.isInteger(monitorId) || monitorId <= 0) {
    return res.status(400).json({
      message: "Invalid monitor id"
    });
  }

  req.monitorId = monitorId;
  next();
}

function parseLimit(req) {
  const limit = Number(req.query.limit ?? 20);

  if (!Number.isInteger(limit) || limit <= 0) {
    return 20;
  }

  return Math.min(limit, 100);
}

async function runMonitorCheck(monitor) {
  const startedAt = Date.now();
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(monitor.normalizedUrl, {
      method: monitor.method,
      redirect: "manual",
      signal: controller.signal
    });

    return {
      monitorId: monitor.monitorId,
      status: response.status < 400 ? "up" : "down",
      httpStatusCode: response.status,
      responseTimeMs: Date.now() - startedAt,
      error: null
    };
  } catch (err) {
    return {
      monitorId: monitor.monitorId,
      status: "down",
      httpStatusCode: null,
      responseTimeMs: Date.now() - startedAt,
      error: err.name === "AbortError" ? "Request timed out" : err.message
    };
  } finally {
    clearTimeout(timeout);
  }
}


/**
 * POST /api/monitors/:monitorId/check-now
 * Manually check one enabled monitor and save the result.
 */
checksRouter.post("/:monitorId/check-now", parseMonitorId, async (req, res, next) => {
  try {
    const monitor = MonitorModel.findForCheckByIdForUser(
      req.monitorId,
      req.user.id
    );

    if (!monitor) {
      return res.status(404).json({
        message: "Monitor not found or disabled"
      });
    }

    const checkResult = await runMonitorCheck(monitor);
    const check = CheckModel.createAndUpdateMonitor(checkResult);

    res.status(201).json(check);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/monitors/:monitorId/checks
 * List recent checks for one monitor owned by the authenticated user.
 */
checksRouter.get("/:monitorId/checks", parseMonitorId, (req, res, next) => {
  try {
    const monitor = MonitorModel.findByIdForUser(req.monitorId, req.user.id);

    if (!monitor) {
      return res.status(404).json({
        message: "Monitor not found"
      });
    }

    const checks = CheckModel.listForMonitor({
      monitorId: req.monitorId,
      limit: parseLimit(req)
    });

    res.json(checks);
  } catch (err) {
    next(err);
  }
});