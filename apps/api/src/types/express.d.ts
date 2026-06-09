import type { AccountStatus, UserRole } from "@prisma/client";

declare global {
  namespace Express {
    interface AuthContext {
      userId: string;
      roles: UserRole[];
      accountStatus: AccountStatus;
      defaultRole: UserRole;
    }

    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
