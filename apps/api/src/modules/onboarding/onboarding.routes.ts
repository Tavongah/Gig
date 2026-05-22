import { Router } from "express";
import { onboardingSchema } from "@gigflow/shared";
import { UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";

export const onboardingRouter = Router();

onboardingRouter.post("/complete", requireAuth, validateBody(onboardingSchema), async (req, res, next) => {
  try {
    const input = req.body;
    const roles = input.role === UserRole.WORKER ? [UserRole.CLIENT, UserRole.WORKER] : [input.role];

    const user = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: req.auth!.userId },
        data: {
          fullName: input.fullName,
          phoneNumber: input.phoneNumber,
          roles,
          defaultRole: input.role,
          isVerified: true
        }
      });

      if (input.role === UserRole.WORKER && input.workerProfile) {
        await tx.workerProfile.upsert({
          where: { userId: updatedUser.id },
          update: {
            bio: input.workerProfile.bio,
            hasVehicle: input.workerProfile.hasVehicle,
            backgroundCheckConsent: input.workerProfile.backgroundCheckConsent,
            serviceCategories: {
              set: input.workerProfile.serviceCategoryIds.map((id) => ({ id }))
            }
          },
          create: {
            userId: updatedUser.id,
            bio: input.workerProfile.bio,
            hasVehicle: input.workerProfile.hasVehicle,
            backgroundCheckConsent: input.workerProfile.backgroundCheckConsent,
            serviceCategories: {
              connect: input.workerProfile.serviceCategoryIds.map((id) => ({ id }))
            }
          }
        });
      }

      return updatedUser;
    });

    res.json({ user });
  } catch (error) {
    next(error);
  }
});
