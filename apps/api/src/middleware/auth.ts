import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { AccountStatus, UserRole } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";

interface JwtPayload {
  sub: string;
  roles: UserRole[];
  accountStatus: AccountStatus;
  defaultRole: UserRole;
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
      roles: payload.roles ?? [],
      accountStatus: payload.accountStatus ?? AccountStatus.ACTIVE,
      defaultRole: payload.defaultRole ?? UserRole.CLIENT
    };
    next();
  } catch {
    res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

export function requireRole(...roles: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: { roles: true, accountStatus: true }
    });

    if (!user) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }

    req.auth.roles = user.roles;
    req.auth.accountStatus = user.accountStatus;

    const isAllowed = user.roles.some((role) => roles.includes(role));
    if (!isAllowed) {
      res.status(403).json({ error: "FORBIDDEN" });
      return;
    }

    next();
  };
}

export function requireApprovedWorker(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: "AUTH_REQUIRED" });
    return;
  }

  if (!req.auth.roles.includes(UserRole.WORKER)) {
    res.status(403).json({ error: "FORBIDDEN" });
    return;
  }

  if (req.auth.accountStatus === AccountStatus.PENDING_APPROVAL) {
    res.status(403).json({ error: "WORKER_PENDING_APPROVAL", message: "Your account is still under review." });
    return;
  }

  if (req.auth.accountStatus === AccountStatus.REJECTED) {
    res.status(403).json({ error: "WORKER_REJECTED", message: "Your worker application was not approved." });
    return;
  }

  if (req.auth.accountStatus === AccountStatus.SUSPENDED) {
    res.status(403).json({ error: "ACCOUNT_SUSPENDED", message: "Your account has been suspended." });
    return;
  }

  if (req.auth.accountStatus !== AccountStatus.APPROVED) {
    res.status(403).json({ error: "WORKER_NOT_APPROVED" });
    return;
  }

  next();
}

export async function getCurrentUser(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { workerProfile: { include: { serviceCategories: true } } }
  });
}
