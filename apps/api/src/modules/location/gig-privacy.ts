import { GIG_SEARCHING_STATUSES } from "@gigflow/shared";
import type { GeocodedAddress } from "@gigflow/shared";
import type { Gig, GigAssignment, GigStatus, ServiceCategory, User } from "@prisma/client";

type GigWithRelations = Gig & {
  serviceCategory?: ServiceCategory | null;
  client?: Pick<User, "id" | "fullName" | "email" | "phoneNumber"> | null;
  assignments?: Array<GigAssignment & { worker?: Pick<User, "id" | "fullName" | "email" | "phoneNumber"> | null }>;
};

export function toGeoPointInput(address: GeocodedAddress) {
  return {
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
    country: address.country,
    formattedAddress: address.formattedAddress,
    latitude: address.latitude,
    longitude: address.longitude
  };
}

export function canWorkerViewFullGigAddress(gig: Pick<Gig, "status" | "clientId">, viewerId: string, assignments: GigAssignment[] = []): boolean {
  if (gig.clientId === viewerId) {
    return true;
  }

  return assignments.some((assignment) => assignment.workerId === viewerId);
}

export function sanitizeGigForViewer<T extends GigWithRelations>(
  gig: T,
  viewerId: string,
  options?: { distanceMiles?: number }
): T & { locationSummary?: string; distanceLabel?: string; addressHidden?: boolean } {
  const assigned = canWorkerViewFullGigAddress(gig, viewerId, gig.assignments ?? []);
  if (assigned || !GIG_SEARCHING_STATUSES.includes(gig.status as (typeof GIG_SEARCHING_STATUSES)[number])) {
    return {
      ...gig,
      distanceLabel: options?.distanceMiles !== undefined ? `${options.distanceMiles} mi away` : undefined
    };
  }

  const { addressLine1: _line1, addressLine2: _line2, postalCode: _postal, formattedAddress: _formatted, latitude: _lat, longitude: _lng, ...rest } = gig;

  return {
    ...rest,
    addressLine1: "",
    addressLine2: null,
    postalCode: "",
    formattedAddress: null,
    latitude: "0",
    longitude: "0",
    locationSummary: `${gig.city}, ${gig.region}`,
    distanceLabel: options?.distanceMiles !== undefined ? `${options.distanceMiles} mi away` : undefined,
    addressHidden: true
  } as unknown as T & { locationSummary?: string; distanceLabel?: string; addressHidden?: boolean };
}
