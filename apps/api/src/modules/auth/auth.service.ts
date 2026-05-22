import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";

export const sessionRequestSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(100),
  role: z.nativeEnum(UserRole).default(UserRole.CLIENT),
  firebaseUid: z.string().optional()
});

export type SessionRequest = z.infer<typeof sessionRequestSchema>;

export async function createSession(input: SessionRequest) {
  const user = await prisma.user.upsert({
    where: { email: input.email.toLowerCase() },
    update: {
      firebaseUid: input.firebaseUid,
      fullName: input.fullName,
      defaultRole: input.role,
      roles: { set: [input.role] }
    },
    create: {
      email: input.email.toLowerCase(),
      firebaseUid: input.firebaseUid,
      fullName: input.fullName,
      defaultRole: input.role,
      roles: [input.role]
    }
  });

  const token = jwt.sign({ roles: user.roles }, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: "7d"
  });

  return { token, user };
}

export async function getAuthenticatedUser(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { workerProfile: { include: { serviceCategories: true } } }
  });
}
