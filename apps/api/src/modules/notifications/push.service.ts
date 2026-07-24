import { NotificationChannel, NotificationStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import type { NotificationPayload } from "../realtime/realtime.service.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_TOKEN_PREFIX = "ExponentPushToken[";

type RegisterPushTokenInput = {
  token: string;
  platform: "ios" | "android" | "web";
};

function isExpoPushToken(token: string): boolean {
  return token.startsWith(EXPO_TOKEN_PREFIX) && token.endsWith("]");
}

export async function registerDevicePushToken(userId: string, input: RegisterPushTokenInput) {
  const token = input.token.trim();
  if (!isExpoPushToken(token)) {
    throw new Error("INVALID_PUSH_TOKEN");
  }

  return prisma.devicePushToken.upsert({
    where: { token },
    create: {
      userId,
      token,
      platform: input.platform,
      enabled: true
    },
    update: {
      userId,
      platform: input.platform,
      enabled: true,
      updatedAt: new Date()
    }
  });
}

export async function unregisterDevicePushToken(userId: string, token: string) {
  const existing = await prisma.devicePushToken.findUnique({ where: { token: token.trim() } });
  if (!existing || existing.userId !== userId) {
    return { ok: true as const };
  }
  await prisma.devicePushToken.update({
    where: { token: token.trim() },
    data: { enabled: false }
  });
  return { ok: true as const };
}

export async function disableAllPushTokensForUser(userId: string): Promise<void> {
  await prisma.devicePushToken.updateMany({
    where: { userId, enabled: true },
    data: { enabled: false }
  });
}

async function markInvalidTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await prisma.devicePushToken.updateMany({
    where: { token: { in: tokens } },
    data: { enabled: false }
  });
}

/**
 * Send Expo push notifications to all enabled devices for a user.
 * Never throws — push failures must not break socket delivery.
 */
export async function sendPushToUser(userId: string, payload: NotificationPayload): Promise<void> {
  try {
    const devices = await prisma.devicePushToken.findMany({
      where: { userId, enabled: true },
      select: { token: true }
    });
    if (devices.length === 0) return;

    const messages = devices.map((device) => ({
      to: device.token,
      sound: "default" as const,
      title: payload.title,
      body: payload.body,
      data: {
        type: payload.type,
        gigId: payload.gigId ?? null
      },
      channelId: "duts-default"
    }));

    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(messages)
    });

    const result = (await response.json().catch(() => null)) as
      | { data?: Array<{ status?: string; details?: { error?: string }; message?: string }> }
      | null;

    const invalid: string[] = [];
    for (let i = 0; i < (result?.data?.length ?? 0); i += 1) {
      const ticket = result!.data![i];
      if (ticket?.status === "error") {
        const err = ticket.details?.error ?? ticket.message ?? "";
        if (err === "DeviceNotRegistered" || err.includes("not a registered")) {
          invalid.push(devices[i]!.token);
        }
      }
    }
    await markInvalidTokens(invalid);

    await prisma.notification.create({
      data: {
        userId,
        gigId: payload.gigId,
        channel: NotificationChannel.PUSH,
        status: response.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
        title: payload.title,
        body: payload.body,
        payload: {
          type: payload.type,
          gigId: payload.gigId ?? null
        } as Prisma.InputJsonValue
      }
    });
  } catch (error) {
    console.warn("[push] sendPushToUser failed", userId, error);
  }
}
