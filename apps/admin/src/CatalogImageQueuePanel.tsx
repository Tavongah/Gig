import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { friendlyApiError, uploadImageQueueCandidate } from "./commerceAdminUi";
import { PhotoHero } from "./ProductThumb";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

type QueueTab = "all-missing" | "branded" | "exceptions" | "human-review" | "completed" | "legacy";
type PackId =
  | "PACK_A_BEVERAGES"
  | "PACK_B_HOUSEHOLD"
  | "PACK_C_SNACKS"
  | "PACK_D_BREAKFAST"
  | "PACK_E_PERSONAL_CARE";
type PriorityId = "BRANDED_PRIORITY_A" | "BRANDED_PRIORITY_B" | "BRANDED_PRIORITY_C";

type QueueItem = {
  id: string;
  catalogProductId: string;
  queueKind: string;
  exceptionQueue: string | null;
  status: string;
  acquisitionStatus: string;
  name: string;
  brand: string | null;
  sizeLabel: string | null;
  category: string;
  brandFamily: string | null;
  acquisitionPack: string | null;
  packLabel: string | null;
  priority: string | null;
  regionalPackageRisk: string | null;
  brandMetadataReview: boolean;
  likelyBrand: string | null;
  referenceImageUrl: string | null;
  candidateImageUrl: string | null;
  livePrimaryImageUrl: string | null;
  imageState: string;
  alreadyExists: boolean;
  rejectionReason: string | null;
  notes: string | null;
  readOnly: boolean;
};

type QueueResponse = {
  items: QueueItem[];
  instructions: string[];
  summary: {
    branded: number;
    brandedMissing: number;
    brandedComplete: number;
    priorityA: number;
    priorityB: number;
    priorityC: number;
    exceptions: number;
    humanReview: number;
    legacyReview: number;
    packs: Array<{ pack: string; label: string; total: number; complete: number }>;
  };
};

type Checks = {
  brandMatches: boolean;
  productMatches: boolean;
  sizeMatches: boolean;
  flavorMatches: boolean;
  packageTypeMatches: boolean;
  imageClear: boolean;
  noWatermark: boolean;
  noPriceOverlay: boolean;
  regionalPackageConfirmed: boolean;
};

const FALLBACK_INSTRUCTIONS = [
  "Photograph one product only.",
  "Show the front of the package.",
  "Make brand, product and size visible.",
  "Keep the whole package in frame.",
  "Avoid glare and blur.",
  "Do not cover the product with your hand.",
  "Do not use screenshots or downloaded internet images.",
  "Use the real product sold locally."
];

const emptyChecks = (): Checks => ({
  brandMatches: false,
  productMatches: false,
  sizeMatches: false,
  flavorMatches: false,
  packageTypeMatches: false,
  imageClear: false,
  noWatermark: false,
  noPriceOverlay: false,
  regionalPackageConfirmed: false
});

const REJECTION_REASONS = [
  "WRONG_BRAND",
  "WRONG_PRODUCT",
  "WRONG_SIZE",
  "WRONG_VARIANT",
  "BLURRY",
  "GLARE",
  "PACKAGE_OBSTRUCTED",
  "WATERMARK",
  "REGIONAL_PACKAGE_MISMATCH",
  "OTHER"
] as const;

function statusLabel(status: string): string {
  switch (status) {
    case "NEEDS_IMAGE_ACQUISITION":
      return "Needs Photo";
    case "PHOTO_RECEIVED":
    case "VALIDATION_REQUIRED":
      return "Needs Validation";
    case "VALIDATED":
      return "Validated";
    case "REJECTED":
      return "Rejected";
    case "UPLOADED":
      return "Uploaded";
    case "IMAGE_ALREADY_EXISTS":
      return "Image already exists";
    default:
      return status.replace(/_/g, " ");
  }
}

function priorityLetter(priority: string | null): string {
  if (priority === "BRANDED_PRIORITY_A") return "A";
  if (priority === "BRANDED_PRIORITY_B") return "B";
  if (priority === "BRANDED_PRIORITY_C") return "C";
  return "—";
}

export function CatalogImageQueuePanel({ apiRequest }: { apiRequest: ApiRequest }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<QueueTab>("branded");
  const [pack, setPack] = useState<PackId | "">("");
  const [priority, setPriority] = useState<PriorityId | "">("");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checks, setChecks] = useState<Checks>(emptyChecks);
  const [sourceType, setSourceType] = useState<"MERCHANT_SUPPLIED_PHOTO" | "DUTS_OWN_PHOTO">(
    "MERCHANT_SUPPLIED_PHOTO"
  );
  const [capturedBy, setCapturedBy] = useState("");
  const [rejectReason, setRejectReason] = useState<(typeof REJECTION_REASONS)[number]>("WRONG_PRODUCT");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const params = new URLSearchParams();
  params.set("tab", tab);
  if (pack) params.set("pack", pack);
  if (priority) params.set("priority", priority);
  if (q.trim()) params.set("q", q.trim());

  const queueQuery = useQuery({
    queryKey: ["catalog-image-queue", tab, pack, priority, q],
    queryFn: () =>
      apiRequest<QueueResponse>(`/admin/commerce/catalog/image-queue?${params.toString()}`)
  });

  const selected = useMemo(
    () => queueQuery.data?.items.find((item) => item.id === selectedId) ?? null,
    [queueQuery.data?.items, selectedId]
  );

  const assignMut = useMutation({
    mutationFn: () =>
      apiRequest<{ item: QueueItem }>(`/admin/commerce/catalog/image-queue/${selectedId}/assign`, {
        method: "POST",
        body: JSON.stringify({
          catalogProductId: selected?.catalogProductId,
          sourceType,
          capturedByLabel: capturedBy.trim() || null,
          checks: {
            brandMatches: true,
            productMatches: true,
            sizeMatches: true,
            flavorMatches: true,
            packageTypeMatches: true,
            imageClear: true,
            noWatermark: true,
            noPriceOverlay: true,
            regionalPackageConfirmed: checks.regionalPackageConfirmed
          }
        })
      }),
    onSuccess: () => {
      setNotice("Photo assigned to this product only.");
      setSelectedId(null);
      setChecks(emptyChecks());
      void queryClient.invalidateQueries({ queryKey: ["catalog-image-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["duts-catalog"] });
    },
    onError: (e: unknown) => setNotice(friendlyApiError(e, "Could not assign this photo."))
  });

  const rejectMut = useMutation({
    mutationFn: () =>
      apiRequest<{ item: QueueItem }>(`/admin/commerce/catalog/image-queue/${selectedId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason })
      }),
    onSuccess: () => {
      setNotice("Photo rejected. This product was not updated.");
      setChecks(emptyChecks());
      void queryClient.invalidateQueries({ queryKey: ["catalog-image-queue"] });
    },
    onError: (e: unknown) => setNotice(friendlyApiError(e, "Could not reject this photo."))
  });

  async function onPickImage(file: File | null) {
    if (!file || !selectedId) return;
    setUploading(true);
    setNotice("");
    try {
      await uploadImageQueueCandidate(apiRequest, selectedId, file);
      setChecks(emptyChecks());
      setNotice("Photo ready for validation. It is not assigned yet.");
      void queryClient.invalidateQueries({ queryKey: ["catalog-image-queue"] });
    } catch (e) {
      setNotice(friendlyApiError(e, "Photo couldn't be uploaded. Please try again."));
    } finally {
      setUploading(false);
    }
  }

  const summary = queueQuery.data?.summary;
  const items = queueQuery.data?.items ?? [];
  const instructions = (queueQuery.data?.instructions?.length ? queueQuery.data.instructions : FALLBACK_INSTRUCTIONS);
  const highRisk = selected?.regionalPackageRisk === "HIGH";
  const requiredOk =
    checks.brandMatches &&
    checks.productMatches &&
    checks.sizeMatches &&
    checks.flavorMatches &&
    checks.packageTypeMatches &&
    checks.imageClear &&
    checks.noWatermark &&
    checks.noPriceOverlay &&
    (!highRisk || checks.regionalPackageConfirmed);

  if (selected) {
    const canValidate =
      Boolean(selected.candidateImageUrl) &&
      !selected.readOnly &&
      !selected.alreadyExists &&
      selected.imageState === "MISSING";
    return (
      <div className="commerce-stack">
        <section className="panel commerce-panel">
          <button
            type="button"
            className="text-back"
            onClick={() => {
              setSelectedId(null);
              setChecks(emptyChecks());
            }}
          >
            ← Image Queue
          </button>
          {notice ? <p className="notice">{notice}</p> : null}
          <h2>{selected.name}</h2>
          <p className="muted">
            {[selected.likelyBrand || selected.brand, selected.sizeLabel, selected.category]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="iq-meta">
            <span>Pack: {selected.packLabel ?? "Manual / Exception"}</span>
            <span>Priority: {priorityLetter(selected.priority)}</span>
            <span>Risk: {selected.regionalPackageRisk ?? "—"}</span>
            <span>Status: {statusLabel(selected.status)}</span>
          </div>
          {selected.brandMetadataReview ? (
            <p className="iq-flag">BRAND METADATA REVIEW — catalog brand is empty. Photograph as {selected.likelyBrand}. Do not change catalog brand here.</p>
          ) : null}
          {highRisk ? <p className="iq-flag">Zimbabwe/local package preferred</p> : null}
          {selected.alreadyExists ? (
            <p className="notice">IMAGE_ALREADY_EXISTS — this product was not overwritten.</p>
          ) : null}

          <div className="iq-compare">
            <div>
              <h3>Catalog product</h3>
              <p>
                <strong>{selected.name}</strong>
              </p>
              <p className="muted">Brand: {selected.brand || selected.likelyBrand || "—"}</p>
              <p className="muted">Size: {selected.sizeLabel || "—"}</p>
              <p className="muted">Category: {selected.category}</p>
            </div>
            <div>
              <h3>Photo preview</h3>
              <PhotoHero
                src={selected.candidateImageUrl}
                alt={selected.name}
                emptyLabel="No candidate photo yet"
              />
            </div>
          </div>

          {selected.referenceImageUrl ? (
            <div className="iq-reference">
              <p className="tiny">Existing reference image — comparison only. Not assigned.</p>
              <PhotoHero src={selected.referenceImageUrl} alt="Existing reference" emptyLabel="Reference" />
            </div>
          ) : null}

          {!selected.readOnly && !selected.alreadyExists ? (
            <>
              <div className="iq-instructions">
                {instructions.map((line) => (
                  <p key={line} className="tiny">
                    {line}
                  </p>
                ))}
              </div>
              <div className="photo-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => cameraRef.current?.click()}
                  disabled={uploading}
                >
                  Take photo
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => galleryRef.current?.click()}
                  disabled={uploading}
                >
                  {selected.candidateImageUrl ? "Retake / Upload another photo" : "Choose from library"}
                </button>
              </div>
              {uploading ? <p className="muted">Uploading photo…</p> : null}
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  void onPickImage(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  void onPickImage(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
            </>
          ) : null}

          {canValidate ? (
            <>
              <h3>Validate before assigning</h3>
              <p className="tiny">This photo is not assigned until every check is confirmed.</p>
              {(
                [
                  ["brandMatches", "Brand matches"],
                  ["productMatches", "Product matches"],
                  ["sizeMatches", "Size matches"],
                  ["flavorMatches", "Flavor/variant matches"],
                  ["packageTypeMatches", "Package type matches"],
                  ["imageClear", "Image clear"],
                  ["noWatermark", "No watermark"],
                  ["noPriceOverlay", "No obstructive price overlay"]
                ] as Array<[keyof Checks, string]>
              ).map(([key, label]) => (
                <label key={key} className="iq-check">
                  <input
                    type="checkbox"
                    checked={checks[key]}
                    onChange={(e) => setChecks({ ...checks, [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
              {highRisk ? (
                <label className="iq-check">
                  <input
                    type="checkbox"
                    checked={checks.regionalPackageConfirmed}
                    onChange={(e) =>
                      setChecks({ ...checks, regionalPackageConfirmed: e.target.checked })
                    }
                  />
                  Confirm this packaging is appropriate for the Zimbabwe market.
                </label>
              ) : null}
              <label>
                Who captured this photo
                <select
                  value={sourceType}
                  onChange={(e) =>
                    setSourceType(e.target.value as "MERCHANT_SUPPLIED_PHOTO" | "DUTS_OWN_PHOTO")
                  }
                >
                  <option value="MERCHANT_SUPPLIED_PHOTO">Merchant supplied photo</option>
                  <option value="DUTS_OWN_PHOTO">DUTS own photo</option>
                </select>
              </label>
              <label>
                Captured by (optional)
                <input
                  value={capturedBy}
                  onChange={(e) => setCapturedBy(e.target.value)}
                  maxLength={80}
                  autoComplete="off"
                />
              </label>
              <button
                type="button"
                className="btn-primary btn-block"
                disabled={!requiredOk || assignMut.isPending}
                onClick={() => assignMut.mutate()}
              >
                {assignMut.isPending ? "Assigning…" : "Confirm and assign this product only"}
              </button>
              <label>
                Reject reason
                <select
                  value={rejectReason}
                  onChange={(e) =>
                    setRejectReason(e.target.value as (typeof REJECTION_REASONS)[number])
                  }
                >
                  {REJECTION_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-secondary btn-block"
                disabled={rejectMut.isPending}
                onClick={() => rejectMut.mutate()}
              >
                Reject photo
              </button>
            </>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <div className="commerce-stack">
      <section className="panel commerce-panel">
        <h2>Product Image Queue</h2>
        <p className="muted">Collect real shop photos. Branded images are not auto-populated.</p>
        {notice ? <p className="notice">{notice}</p> : null}
        {summary ? (
          <p className="catalog-stat-row">
            <span>Branded {summary.brandedMissing} / {summary.branded} missing</span>
            <span>Exceptions {summary.exceptions}</span>
            <span>Legacy {summary.legacyReview}</span>
          </p>
        ) : null}
        {summary ? (
          <div className="iq-packs">
            {summary.packs.map((p) => (
              <button
                key={p.pack}
                type="button"
                className={pack === p.pack ? "iq-pack active" : "iq-pack"}
                onClick={() => {
                  setTab("branded");
                  setPack(pack === p.pack ? "" : (p.pack as PackId));
                }}
              >
                <strong>{p.label}</strong>
                <span>
                  {p.complete} / {p.total} complete
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="chip-row" role="tablist" aria-label="Image queue">
          {(
            [
              ["branded", "Branded"],
              ["all-missing", "All Missing"],
              ["exceptions", "Generic Exceptions"],
              ["human-review", "Human Review"],
              ["completed", "Completed"],
              ["legacy", "Legacy Image Review"]
            ] as Array<[QueueTab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={tab === id ? "chip chip-active" : "chip"}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="chip-row" aria-label="Priority">
          {(
            [
              ["", "All priorities"],
              ["BRANDED_PRIORITY_A", "Priority A"],
              ["BRANDED_PRIORITY_B", "Priority B"],
              ["BRANDED_PRIORITY_C", "Priority C"]
            ] as Array<[PriorityId | "", string]>
          ).map(([id, label]) => (
            <button
              key={id || "all"}
              type="button"
              className={priority === id ? "chip chip-active" : "chip"}
              onClick={() => setPriority(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="search-field">
          <span className="sr-only">Search image queue</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search product, brand, size, category…"
            enterKeyHint="search"
          />
        </label>

        {queueQuery.isLoading ? <p className="muted">Loading queue…</p> : null}
        <div className="product-card-list">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="product-card iq-card"
              onClick={() => {
                setSelectedId(item.id);
                setChecks(emptyChecks());
                setNotice("");
              }}
            >
              <div className="product-card-body">
                <strong>{item.name}</strong>
                <span className="muted">
                  {[item.likelyBrand || item.brand, item.sizeLabel, item.category]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="iq-card-meta">
                  Pack: {item.packLabel ?? "Manual / Exception"} · Priority {priorityLetter(item.priority)} ·{" "}
                  {item.regionalPackageRisk ?? "—"} · {statusLabel(item.status)}
                </span>
                {item.brandMetadataReview ? <span className="iq-mini-flag">Brand metadata review</span> : null}
                {item.regionalPackageRisk === "HIGH" ? (
                  <span className="iq-mini-flag">Zimbabwe/local package preferred</span>
                ) : null}
              </div>
            </button>
          ))}
        </div>
        {!queueQuery.isLoading && items.length === 0 ? <p className="muted">No products in this view.</p> : null}
      </section>
    </div>
  );
}
