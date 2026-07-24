import { Router } from "express";
import { z } from "zod";
import { GigStatus, UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import {
  approveWorker,
  getWorkerApplication,
  listAllGigs,
  listPendingWorkers,
  reactivateWorker,
  rejectWorker,
  setIdentityVerificationStatus,
  suspendWorker
} from "./worker-approval.service.js";
import { getCancellationPolicy } from "../gigs/cancellation-policy.service.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole(UserRole.ADMIN));

adminRouter.get("/overview", async (_req, res, next) => {
  try {
    const [users, workers, pendingWorkers, openGigs, completedGigs, revenue, commissionSetting, cancelPolicy] =
      await Promise.all([
        prisma.user.count(),
        prisma.workerProfile.count(),
        prisma.user.count({ where: { accountStatus: "PENDING_APPROVAL", roles: { has: UserRole.WORKER } } }),
        prisma.gig.count({
          where: {
            status: {
              in: [
                GigStatus.POSTED,
                GigStatus.SEARCHING_FOR_WORKER,
                GigStatus.WORKER_SELECTED,
                GigStatus.WORKER_ASSIGNED,
                GigStatus.WORKER_EN_ROUTE,
                GigStatus.WORKER_ARRIVED,
                GigStatus.IN_PROGRESS,
                GigStatus.WAITING_EXTRA_TIME_APPROVAL,
                GigStatus.WAITING_CUSTOMER_CONFIRMATION
              ]
            }
          }
        }),
        prisma.gig.count({ where: { status: "COMPLETED" } }),
        prisma.payment.aggregate({ _sum: { platformFeeCents: true, amountCents: true } }),
        prisma.commissionSetting.findFirst({ orderBy: { effectiveFrom: "desc" } }),
        getCancellationPolicy()
      ]);

    res.json({
      users,
      workers,
      pendingWorkers,
      openGigs,
      completedGigs,
      grossVolumeCents: revenue._sum.amountCents ?? 0,
      platformRevenueCents: revenue._sum.platformFeeCents ?? 0,
      commissionRate: commissionSetting ? Number(commissionSetting.rate) : 0.2,
      cancellationFeePercent: cancelPolicy.cancellationFeePercent,
      cancellationGraceMinutes: cancelPolicy.cancellationGraceMinutes
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
        accountStatus: true,
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

const platformSettingsSchema = z.object({
  cancellationFeePercent: z.number().min(0).max(1).optional(),
  cancellationGraceMinutes: z.number().int().min(1).max(60).optional()
});

adminRouter.get("/settings/cancellation", async (_req, res, next) => {
  try {
    const policy = await getCancellationPolicy();
    res.json({ policy });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/settings/cancellation", validateBody(platformSettingsSchema), async (req, res, next) => {
  try {
    const current = await getCancellationPolicy();
    const updated = await prisma.platformSetting.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        cancellationFeePercent: req.body.cancellationFeePercent ?? current.cancellationFeePercent,
        cancellationGraceMinutes: req.body.cancellationGraceMinutes ?? current.cancellationGraceMinutes
      },
      update: {
        ...(req.body.cancellationFeePercent !== undefined
          ? { cancellationFeePercent: req.body.cancellationFeePercent }
          : {}),
        ...(req.body.cancellationGraceMinutes !== undefined
          ? { cancellationGraceMinutes: req.body.cancellationGraceMinutes }
          : {})
      }
    });
    res.json({
      policy: {
        cancellationFeePercent: Number(updated.cancellationFeePercent),
        cancellationGraceMinutes: updated.cancellationGraceMinutes
      }
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/workers/pending", async (_req, res, next) => {
  try {
    const workers = await listPendingWorkers();
    res.json({ workers });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/workers/:workerId", async (req, res, next) => {
  try {
    const workerId = String(req.params.workerId);
    const worker = await getWorkerApplication(workerId);
    res.json({ worker });
  } catch (error) {
    next(error);
  }
});

const identityStatusSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"])
});

adminRouter.post(
  "/workers/:workerId/identity-status",
  validateBody(identityStatusSchema),
  async (req, res, next) => {
    try {
      const workerId = String(req.params.workerId);
      const worker = await setIdentityVerificationStatus(workerId, req.body.status);
      res.json({ worker });
    } catch (error) {
      next(error);
    }
  }
);

const rejectSchema = z.object({ reason: z.string().max(500).optional() });

adminRouter.post("/workers/:workerId/approve", async (req, res, next) => {
  try {
    const workerId = String(req.params.workerId);
    const worker = await approveWorker(workerId, req.auth!.userId);
    res.json({ worker });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/workers/:workerId/reject", validateBody(rejectSchema), async (req, res, next) => {
  try {
    const workerId = String(req.params.workerId);
    const worker = await rejectWorker(workerId, req.auth!.userId, req.body.reason);
    res.json({ worker });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/workers/:workerId/suspend", validateBody(rejectSchema), async (req, res, next) => {
  try {
    const workerId = String(req.params.workerId);
    const worker = await suspendWorker(workerId, req.auth!.userId, req.body.reason);
    res.json({ worker });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/workers/:workerId/reactivate", async (req, res, next) => {
  try {
    const workerId = String(req.params.workerId);
    const worker = await reactivateWorker(workerId, req.auth!.userId);
    res.json({ worker });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/gigs", async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const gigs = await listAllGigs(status);
    res.json({ gigs });
  } catch (error) {
    next(error);
  }
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

const refundSchema = z.object({
  amountCents: z.number().int().positive().optional(),
  reason: z.string().max(200).optional(),
  notes: z.string().max(1000).optional()
});

adminRouter.post("/payments/:paymentId/refund", validateBody(refundSchema), async (req, res, next) => {
  try {
    const { createAdminRefund } = await import("../payments/payment.service.js");
    const payment = await prisma.payment.findUnique({ where: { id: String(req.params.paymentId) } });
    if (!payment) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    const amountCents = req.body.amountCents ?? Math.max(0, payment.amountCents - payment.refundAmountCents);
    const result = await createAdminRefund(payment.id, {
      amountCents,
      reason: req.body.reason,
      notes: req.body.notes,
      adminId: req.auth!.userId
    });
    res.json({ refund: result });
  } catch (error) {
    next(error);
  }
});
