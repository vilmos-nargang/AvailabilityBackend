
import express from "express";
import { authMiddleware, loginUser, registerUser } from "../middleware/auth.mjs";
import { tokenBucket, linearRefillFactory } from "../middleware/bucket.mjs";

export const authRouter = express.Router();
//One token every ten minutes.
authRouter.post("/register", async (req, res, next) => { 
  try {
    const result = await registerUser(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const result = await loginUser(req.body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", authMiddleware, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    createdAt: req.user.createdAt
  });
});