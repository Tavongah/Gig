import Constants from "expo-constants";
import { Alert, Linking, Platform } from "react-native";
import { APP_NAME } from "./brand";

type SupportExtra = {
  supportEmail?: string;
  supportPhone?: string;
  supportHours?: string;
};

const extra = Constants.expoConfig?.extra as SupportExtra | undefined;

/** Prefer env/config; never hardcode call/SMS targets in screens. */
export const SUPPORT_EMAIL =
  process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() ||
  extra?.supportEmail?.trim() ||
  "info@duts.tech";

export const SUPPORT_PHONE =
  process.env.EXPO_PUBLIC_SUPPORT_PHONE?.trim() ||
  extra?.supportPhone?.trim() ||
  "+12036769717";

export const SUPPORT_HOURS_LABEL =
  process.env.EXPO_PUBLIC_SUPPORT_HOURS?.trim() ||
  extra?.supportHours?.trim() ||
  "Monday – Saturday · 8:00 AM – 8:00 PM (Eastern Time)";

export const SUPPORT_HOURS_NOTE =
  "Messages received outside support hours will be answered as soon as possible.";

export function formatSupportPhoneDisplay(phone: string = SUPPORT_PHONE): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

function dialNumber(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

export async function openSupportCall(phone: string = SUPPORT_PHONE): Promise<void> {
  const url = `tel:${dialNumber(phone)}`;
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert(
        "Unable to call",
        `This device cannot place calls. Call ${APP_NAME} Support at ${formatSupportPhoneDisplay(phone)}.`
      );
      return;
    }
    await Linking.openURL(url);
  } catch {
    Alert.alert(
      "Unable to call",
      `Please dial ${formatSupportPhoneDisplay(phone)} to reach ${APP_NAME} Support.`
    );
  }
}

export async function openSupportSms(phone: string = SUPPORT_PHONE): Promise<void> {
  const body = encodeURIComponent(`Hello ${APP_NAME} Support,\n\nI need help with:\n`);
  const number = dialNumber(phone);
  const url =
    Platform.OS === "ios" ? `sms:${number}&body=${body}` : `sms:${number}?body=${body}`;

  try {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert(
        "Unable to text",
        `This device cannot send texts. Message ${APP_NAME} Support at ${formatSupportPhoneDisplay(phone)}.`
      );
      return;
    }
    await Linking.openURL(url);
  } catch {
    Alert.alert(
      "Unable to text",
      `Please text ${formatSupportPhoneDisplay(phone)} to reach ${APP_NAME} Support.`
    );
  }
}

export async function openSupportEmail(options?: {
  name?: string;
  accountEmail?: string;
  phoneNumber?: string | null;
  subject?: string;
  issueLabel?: string;
}): Promise<void> {
  const subject = encodeURIComponent(options?.subject ?? `${APP_NAME} Support Request`);
  const issueHeader = options?.issueLabel ?? "Issue:";
  const body = encodeURIComponent(
    [
      "Name:",
      options?.name ?? "",
      "",
      "Account Email:",
      options?.accountEmail ?? "",
      "",
      "Phone Number:",
      options?.phoneNumber ?? "",
      "",
      issueHeader,
      ""
    ].join("\n")
  );
  const url = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;

  try {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert(
        "Unable to email",
        `This device cannot open email. Contact ${APP_NAME} Support at ${SUPPORT_EMAIL}.`
      );
      return;
    }
    await Linking.openURL(url);
  } catch {
    Alert.alert("Unable to email", `Please email ${SUPPORT_EMAIL} to reach ${APP_NAME} Support.`);
  }
}

export async function openEmergencyCall(): Promise<void> {
  const url = "tel:911";
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert("Unable to call", "Please dial 911 on your phone if this is an emergency.");
  }
}
