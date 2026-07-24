import { AccountStatus, AuthProvider, UserRole } from "@prisma/client";
import type { CompleteProfileInput, SocialLoginInput } from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { getFirebaseProvider, isFirebaseConfigured, verifyFirebaseIdToken } from "../../lib/firebase-admin.js";
import { mapAuthProvider, normalizePhoneNumber } from "./access.service.js";
import { issueToken, sanitizeUser, userInclude } from "./auth.service.js";
import { sendEmailVerification } from "./verification.service.js";

export async function loginWithSocialProvider(input: SocialLoginInput) {
  if (!isFirebaseConfigured()) {
    throw new AppError("FIREBASE_NOT_CONFIGURED", 503, "FIREBASE_NOT_CONFIGURED", {
      firebase: "Social sign-in is not configured yet."
    });
  }

  const decoded = await verifyFirebaseIdToken(input.idToken);
  const firebaseProvider = getFirebaseProvider(decoded);
  if (firebaseProvider !== input.provider && firebaseProvider !== "unknown") {
    throw new AppError("PROVIDER_MISMATCH", 400, "PROVIDER_MISMATCH", {
      provider: "Sign-in provider does not match the submitted token."
    });
  }

  const hasProviderEmail = Boolean(decoded.email);
  const email = decoded.email?.toLowerCase() ?? `${decoded.uid}@apple.private.gigflow.local`;
  const fullName = decoded.name?.trim() || (hasProviderEmail ? email.split("@")[0] : "DUTS User");
  const emailVerified = hasProviderEmail ? Boolean(decoded.email_verified) : false;
  const authProvider = mapAuthProvider(input.provider);
  const intendedRole = input.intendedRole === "WORKER" ? UserRole.WORKER : UserRole.CLIENT;
  const accountStatus =
    intendedRole === UserRole.WORKER ? AccountStatus.PENDING_APPROVAL : AccountStatus.ACTIVE;

  let user = await prisma.user.findFirst({
    where: {
      OR: [{ firebaseUid: decoded.uid }, { email }]
    },
    include: userInclude
  });

  if (user && user.firebaseUid && user.firebaseUid !== decoded.uid && user.authProvider !== AuthProvider.EMAIL) {
    throw new AppError("ACCOUNT_EXISTS", 409, "ACCOUNT_EXISTS", {
      email: "An account already exists with this email."
    });
  }

  if (user && user.authProvider === AuthProvider.EMAIL && !user.firebaseUid) {
    throw new AppError("EMAIL_IN_USE", 409, "EMAIL_IN_USE", {
      email: "This email is registered with a password. Sign in with email instead."
    });
  }

  if (!user) {
    user = await prisma.user.create({
      data: {
        firebaseUid: decoded.uid,
        authProvider,
        email,
        fullName,
        avatarUrl: decoded.picture ?? null,
        roles: [intendedRole],
        defaultRole: intendedRole,
        accountStatus,
        emailVerified,
        phoneVerified: false,
        profileCompleted: false,
        isVerified: emailVerified,
        ...(intendedRole === UserRole.WORKER
          ? {
              workerProfile: {
                create: {
                  bio: "New worker on DUTS — profile pending completion.",
                  city: "Pending",
                  serviceArea: "Pending",
                  workExperience: "Pending",
                  platformRulesAgreed: true,
                  backgroundCheckConsent: true,
                  governmentIdAcknowledged: true,
                  proofOfAddressAcknowledged: true
                }
              }
            }
          : {})
      },
      include: userInclude
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        firebaseUid: decoded.uid,
        authProvider,
        fullName: user.fullName || fullName,
        avatarUrl: user.avatarUrl ?? decoded.picture ?? null,
        emailVerified: user.emailVerified || emailVerified,
        isVerified: user.phoneVerified || user.emailVerified || emailVerified
      },
      include: userInclude
    });
  }

  if (user.accountStatus === AccountStatus.SUSPENDED) {
    throw new AppError("ACCOUNT_SUSPENDED", 403, "ACCOUNT_SUSPENDED", {
      status: "Your account has been suspended. Contact support."
    });
  }

  const token = issueToken(user);
  return { token, user: sanitizeUser(user), needsProfileCompletion: !user.profileCompleted };
}

function isApplePlaceholderEmail(email: string): boolean {
  return email.endsWith("@apple.private.gigflow.local");
}

export async function completeUserProfile(userId: string, input: CompleteProfileInput) {
  const current = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  let normalizedPhone: string | null = null;
  if (input.phoneNumber) {
    normalizedPhone = normalizePhoneNumber(input.phoneNumber);
    const existingPhone = await prisma.user.findFirst({
      where: { phoneNumber: normalizedPhone, NOT: { id: userId } }
    });
    if (existingPhone) {
      throw new AppError("PHONE_IN_USE", 409, "PHONE_IN_USE", {
        phoneNumber: "That phone number is already linked to another account."
      });
    }
  }

  let nextEmail = current.email;
  let nextEmailVerified = current.emailVerified;
  if (input.email) {
    const normalizedEmail = input.email.toLowerCase();
    if (normalizedEmail !== current.email) {
      const existingEmail = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existingEmail && existingEmail.id !== userId) {
        throw new AppError("EMAIL_IN_USE", 409, "EMAIL_IN_USE", {
          email: "Email is already registered"
        });
      }
      nextEmail = normalizedEmail;
      nextEmailVerified = false;
    }
  } else if (isApplePlaceholderEmail(current.email)) {
    throw new AppError("EMAIL_REQUIRED", 400, "EMAIL_REQUIRED", {
      email: "Add an email address to finish your profile."
    });
  }

  const role = input.defaultRole === "WORKER" ? UserRole.WORKER : UserRole.CLIENT;
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      fullName: input.fullName.trim(),
      email: nextEmail,
      emailVerified: nextEmailVerified,
      phoneNumber: normalizedPhone,
      defaultRole: role,
      roles: { set: [role] },
      avatarUrl: input.avatarUrl ?? undefined,
      profileCompleted: true,
      accountStatus: role === UserRole.WORKER ? AccountStatus.PENDING_APPROVAL : AccountStatus.ACTIVE,
      ...(input.location
        ? {
            formattedAddress: input.location.formattedAddress,
            addressLine1: input.location.addressLine1,
            city: input.location.city,
            region: input.location.region,
            postalCode: input.location.postalCode,
            country: input.location.country,
            latitude: input.location.latitude,
            longitude: input.location.longitude
          }
        : {})
    },
    include: userInclude
  });

  if (!user.emailVerified) {
    await sendEmailVerification(user.id, user.email);
  }

  return sanitizeUser(user);
}
