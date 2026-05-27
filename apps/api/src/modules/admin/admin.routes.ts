import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole(UserRole.ADMIN));

adminRouter.get("/overview", async (_req, res, next) => {
  try {
    const [users, workers, openGigs, completedGigs, revenue, commissionSetting] = await Promise.all([
      prisma.user.count(),
      prisma.workerProfile.count(),
      prisma.gig.count({ where: { status: "OPEN" } }),
      prisma.gig.count({ where: { status: "COMPLETED" } }),
      prisma.payment.aggregate({ _sum: { platformFeeCents: true, amountCents: true } }),
      prisma.commissionSetting.findFirst({ orderBy: { effectiveFrom: "desc" } })
    ]);

    res.json({
      users,
      workers,
      openGigs,
      completedGigs,
      grossVolumeCents: revenue._sum.amountCents ?? 0,
      platformRevenueCents: revenue._sum.platformFeeCents ?? 0,
      commissionRate: commissionSetting ? Number(commissionSetting.rate) : 0.2
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/users", async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        roles: true,
        defaultRole: true,
        isVerified: true,
        createdAt: true,
        workerProfile: { select: { completedGigCount: true, availabilityStatus: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    res.json({ users });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/categories", async (_req, res, next) => {
  try {
    const categories = await prisma.serviceCategory.findMany({ orderBy: { name: "asc" } });
    res.json({ categories });
  } catch (error) {
    next(error);
  }
});

const commissionSchema = z.object({
  rate: z.number().min(0.05).max(0.35)
});

adminRouter.post("/commission", validateBody(commissionSchema), async (req, res, next) => {
  try {
    const setting = await prisma.commissionSetting.create({
      data: {
        rate: req.body.rate,
        createdById: req.auth!.userId
      }
    });
    res.status(201).json({ commission: { rate: Number(setting.rate), effectiveFrom: setting.effectiveFrom } });
  } catch (error) {
    next(error);
  }
});
