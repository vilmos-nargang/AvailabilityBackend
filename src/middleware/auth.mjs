// auth.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { UserModel } from "../model.mjs";

const JWT_SECRET = process.env.JWT_SECRET 
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN 

const SALT_ROUNDS = 10;

function createToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email
    },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN
    }
  );
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt
  };
}



export async function registerUser({ email, password }) {
  if (!email || !password) {
    const err = new Error("Email and password are required");
    err.statusCode = 400;
    throw err;
  }

  if (password.length < 8) {
    const err = new Error("Password must be at least 8 characters long");
    err.statusCode = 400;
    throw err;
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = UserModel.findByEmail(normalizedEmail);

  if (existingUser) {
    const err = new Error("Email is already registered");
    err.statusCode = 409;
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = UserModel.create(normalizedEmail, passwordHash);

  return {
    user: toPublicUser(user)
  };
}



export async function loginUser({ email, password }) {
  if (!email || !password) {
    const err = new Error("Email and password are required");
    err.statusCode = 400;
    throw err;
  }

  const normalizedEmail = email.trim().toLowerCase();

  const user = UserModel.findByEmail(normalizedEmail);

  if (!user) {
    const err = new Error("Invalid email or password");
    err.statusCode = 401;
    throw err;
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);

  if (!passwordMatches) {
    const err = new Error("Invalid email or password");
    err.statusCode = 401;
    throw err;
  }

  const token = createToken(user);

  return {
    token,
    user: toPublicUser(user)
  };
}



export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Missing or invalid Authorization header"
    });
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    const user = UserModel.findById(payload.sub);

    if (!user) {
      return res.status(401).json({
        message: "Invalid token user"
      });
    }

    req.user = user;

    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token"
    });
  }
}