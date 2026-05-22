import { Router } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

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
