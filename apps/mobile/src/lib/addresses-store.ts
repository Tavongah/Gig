import AsyncStorage from "@react-native-async-storage/async-storage";

export type SavedAddress = {
  id: string;
  label: string;
  formattedAddress: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
  updatedAt: string;
};

const keyForUser = (userId: string) => `duts.addresses.${userId}`;

async function readAll(userId: string): Promise<SavedAddress[]> {
  const raw = await AsyncStorage.getItem(keyForUser(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SavedAddress[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(userId: string, addresses: SavedAddress[]): Promise<void> {
  await AsyncStorage.setItem(keyForUser(userId), JSON.stringify(addresses));
}

export async function listAddresses(userId: string): Promise<SavedAddress[]> {
  const addresses = await readAll(userId);
  return addresses.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.label.localeCompare(b.label));
}

export async function upsertAddress(
  userId: string,
  input: Omit<SavedAddress, "id" | "updatedAt" | "isDefault"> & { id?: string; isDefault?: boolean }
): Promise<SavedAddress[]> {
  const addresses = await readAll(userId);
  const id = input.id ?? `addr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const next: SavedAddress = {
    id,
    label: input.label.trim() || "Address",
    formattedAddress: input.formattedAddress,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    city: input.city,
    region: input.region,
    postalCode: input.postalCode,
    country: input.country || "US",
    latitude: input.latitude,
    longitude: input.longitude,
    isDefault: Boolean(input.isDefault),
    updatedAt: new Date().toISOString()
  };

  let updated = addresses.filter((item) => item.id !== id);
  if (next.isDefault || updated.length === 0) {
    updated = updated.map((item) => ({ ...item, isDefault: false }));
    next.isDefault = true;
  }
  updated.push(next);
  await writeAll(userId, updated);
  return listAddresses(userId);
}

export async function deleteAddress(userId: string, addressId: string): Promise<SavedAddress[]> {
  let updated = (await readAll(userId)).filter((item) => item.id !== addressId);
  if (updated.length > 0 && !updated.some((item) => item.isDefault)) {
    updated = updated.map((item, index) => ({ ...item, isDefault: index === 0 }));
  }
  await writeAll(userId, updated);
  return listAddresses(userId);
}

export async function setDefaultAddress(userId: string, addressId: string): Promise<SavedAddress[]> {
  const updated = (await readAll(userId)).map((item) => ({
    ...item,
    isDefault: item.id === addressId
  }));
  await writeAll(userId, updated);
  return listAddresses(userId);
}
