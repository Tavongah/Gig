import type { UserRole } from "@prisma/client";

declare global {
  namespace Express {
    interface AuthContext {
      userId: string;
      roles: UserRole[];
    }

    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
