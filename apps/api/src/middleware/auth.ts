import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { UserRole } from "@prisma/client";
import { env } from "../config/env.js";

interface JwtPayload {
  sub: string;
  roles: UserRole[];
}

function parseBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = parseBearerToken(req.header("authorization"));

  if (!token) {
    res.status(401).json({ error: "AUTH_REQUIRED" });
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.auth = {
      userId: payload.sub,
      roles: payload.roles
    };
    next();
  } catch {
    res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }

    const isAllowed = req.auth.roles.some((role) => roles.includes(role));

    if (!isAllowed) {
      res.status(403).json({ error: "FORBIDDEN" });
      return;
    }

    next();
  };
}
