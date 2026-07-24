import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, isSpacesConfigured } from "../config/env.js";
import { AppError } from "./errors.js";

export type UploadPurpose =
  | "worker-profile"
  | "customer-photo"
  | "gig-image"
  | "verification-document";

const PURPOSE_PREFIX: Record<UploadPurpose, string> = {
  "worker-profile": "profiles/workers",
  "customer-photo": "profiles/customers",
  "gig-image": "gigs",
  "verification-document": "verification"
};

let client: S3Client | null = null;

function getSpacesClient(): S3Client {
  if (!isSpacesConfigured()) {
    throw new AppError("STORAGE_NOT_CONFIGURED", 503, "STORAGE_NOT_CONFIGURED", {
      storage: "DigitalOcean Spaces is not configured."
    });
  }

  if (!client) {
    const config: S3ClientConfig = {
      region: env.SPACES_REGION ?? env.AWS_REGION ?? "us-east-1",
      endpoint: env.SPACES_ENDPOINT ?? env.S3_ENDPOINT,
      credentials: {
        accessKeyId: env.SPACES_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID ?? "",
        secretAccessKey: env.SPACES_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY ?? ""
      },
      forcePathStyle: false
    };
    client = new S3Client(config);
  }

  return client;
}

function getBucket(): string {
  return env.SPACES_BUCKET ?? env.S3_BUCKET ?? "";
}

export function buildObjectKey(purpose: UploadPurpose, userId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return `${PURPOSE_PREFIX[purpose]}/${userId}/${Date.now()}-${safeName}`;
}

export async function createUploadSignedUrl(input: {
  purpose: UploadPurpose;
  userId: string;
  fileName: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<{ uploadUrl: string; objectKey: string; publicUrl: string }> {
  const objectKey = buildObjectKey(input.purpose, input.userId, input.fileName);
  // Do not sign with ACL — DigitalOcean Spaces frequently rejects ACL on presigned PUTs.
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: objectKey,
    ContentType: input.contentType
  });

  const uploadUrl = await getSignedUrl(getSpacesClient(), command, {
    expiresIn: input.expiresInSeconds ?? 900
  });

  return {
    uploadUrl,
    objectKey,
    publicUrl: publicUrlForObjectKey(objectKey)
  };
}

export function publicUrlForObjectKey(objectKey: string): string {
  if (env.SPACES_CDN_URL) {
    return `${env.SPACES_CDN_URL.replace(/\/$/, "")}/${objectKey}`;
  }

  const bucket = getBucket();
  const endpoint = (env.SPACES_ENDPOINT ?? env.S3_ENDPOINT ?? "").replace(/\/$/, "");
  if (endpoint.includes("digitaloceanspaces.com")) {
    const host = endpoint.replace(/^https?:\/\//, "");
    return `https://${bucket}.${host}/${objectKey}`;
  }
  return `${endpoint}/${bucket}/${objectKey}`;
}

export function assertObjectKeyOwnedByUser(objectKey: string, userId: string): void {
  const allowed = Object.values(PURPOSE_PREFIX).some((prefix) =>
    objectKey.startsWith(`${prefix}/${userId}/`)
  );
  if (!allowed) {
    throw new AppError("FORBIDDEN", 403, "FORBIDDEN", {
      storage: "Invalid upload target."
    });
  }
}

export async function createDownloadSignedUrl(objectKey: string, expiresInSeconds = 900): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: objectKey
  });

  return getSignedUrl(getSpacesClient(), command, { expiresIn: expiresInSeconds });
}

/** Upload a public avatar/object and return a stable HTTPS URL. */
export async function uploadPublicObject(input: {
  purpose: UploadPurpose;
  userId: string;
  fileName: string;
  contentType: string;
  body: Buffer;
}): Promise<{ objectKey: string; publicUrl: string }> {
  const objectKey = buildObjectKey(input.purpose, input.userId, input.fileName);
  const bucket = getBucket();
  const client = getSpacesClient();

  // Avoid ACL headers — DigitalOcean Spaces commonly rejects them.
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: "public, max-age=31536000, immutable"
    })
  );

  return {
    objectKey,
    publicUrl: publicUrlForObjectKey(objectKey)
  };
}

/** Private object upload for identity documents — never public-read. */
export async function uploadPrivateObject(input: {
  purpose: UploadPurpose;
  userId: string;
  fileName: string;
  contentType: string;
  body: Buffer;
}): Promise<{ objectKey: string }> {
  const objectKey = buildObjectKey(input.purpose, input.userId, input.fileName);
  const bucket = getBucket();

  await getSpacesClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: "private, max-age=0, no-store"
    })
  );

  return { objectKey };
}

export { isSpacesConfigured } from "../config/env.js";
