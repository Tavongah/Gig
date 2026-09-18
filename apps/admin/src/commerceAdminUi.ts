export type CatalogStatus = "PENDING" | "APPROVED" | "REJECTED" | "ARCHIVED";

export const CATALOG_CATEGORIES = [
  "Drinks",
  "Bread & Bakery",
  "Dairy",
  "Snacks",
  "Groceries",
  "Household",
  "Personal Care",
  "Baking",
  "Other"
] as const;

export function friendlyCatalogStatus(status: string): string {
  switch (status) {
    case "APPROVED":
      return "Approved";
    case "PENDING":
      return "Pending review";
    case "REJECTED":
      return "Rejected";
    case "ARCHIVED":
      return "Archived";
    default:
      return status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function statusTone(status: string): "ok" | "warn" | "err" | "muted" {
  switch (status) {
    case "APPROVED":
      return "ok";
    case "PENDING":
      return "warn";
    case "REJECTED":
      return "err";
    default:
      return "muted";
  }
}

/** Display casing only — does not mutate stored values. */
export function displayCategory(category: string | null | undefined): string {
  const raw = (category ?? "").trim();
  if (!raw) return "Other";
  const known = CATALOG_CATEGORIES.find((c) => c.toLowerCase() === raw.toLowerCase());
  if (known) return known;
  return raw
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function friendlyApiError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (!msg.trim()) return fallback;
  if (
    /spaces|s3|storage|bucket|NoSuchBucket|specified bucket|ECONN|network|fetch|timeout|500|502|503|access key/i.test(
      msg
    )
  ) {
    return fallback;
  }
  if (msg.length > 160) return fallback;
  return msg;
}

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

function normalizeClientImageType(raw: string | null | undefined): string {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "image/jpg" || t === "image/pjpeg") return "image/jpeg";
  if (t === "image/x-png") return "image/png";
  return t || "image/jpeg";
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      if (comma < 0) {
        reject(new Error("Couldn't read this photo."));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("Couldn't read this photo."));
    reader.readAsDataURL(file);
  });
}

export async function uploadCatalogImage(
  apiRequest: ApiRequest,
  file: File
): Promise<string> {
  const dataBase64 = await readFileAsBase64(file);
  const uploaded = await apiRequest<{ url: string }>("/admin/commerce/catalog/upload-image", {
    method: "POST",
    body: JSON.stringify({
      fileName: file.name || "product.jpg",
      contentType: normalizeClientImageType(file.type),
      dataBase64
    })
  });
  if (!uploaded?.url) {
    throw new Error("Photo couldn't be uploaded. Please try again.");
  }
  return uploaded.url;
}
