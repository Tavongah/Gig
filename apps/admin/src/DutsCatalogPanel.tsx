import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  displayCategory,
  friendlyApiError,
  uploadCatalogImage,
  type CatalogStatus
} from "./commerceAdminUi";
import { CategorySelect, PhotoHero, ProductThumb, StatusBadge } from "./ProductThumb";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

type CatalogProduct = {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  category: string;
  sizeLabel: string | null;
  barcode: string | null;
  primaryImageUrl: string | null;
  status: CatalogStatus;
  source: string;
};

type Mode = "list" | "detail" | "edit" | "create";

const emptyForm = {
  name: "",
  brand: "",
  category: "Drinks",
  sizeLabel: "",
  description: "",
  barcode: "",
  primaryImageUrl: ""
};

export function DutsCatalogPanel({ apiRequest }: { apiRequest: ApiRequest }) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [mode, setMode] = useState<Mode>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pendingPhotoRef = useRef<File | null>(null);

  const listQuery = useQuery({
    queryKey: ["duts-catalog", q, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (statusFilter) params.set("status", statusFilter);
      params.set("limit", "50");
      return apiRequest<{ products: CatalogProduct[] }>(
        `/admin/commerce/catalog/products?${params.toString()}`
      );
    }
  });

  const detailQuery = useQuery({
    queryKey: ["duts-catalog-detail", selectedId],
    queryFn: () =>
      apiRequest<{ product: CatalogProduct }>(`/admin/commerce/catalog/products/${selectedId}`),
    enabled: Boolean(selectedId) && (mode === "detail" || mode === "edit")
  });

  useEffect(() => {
    const p = detailQuery.data?.product;
    if (!p || mode !== "edit") return;
    setForm({
      name: p.name,
      brand: p.brand ?? "",
      category: p.category,
      sizeLabel: p.sizeLabel ?? "",
      description: p.description ?? "",
      barcode: p.barcode ?? "",
      primaryImageUrl: p.primaryImageUrl ?? ""
    });
    setLocalPreview(null);
  }, [detailQuery.data?.product, mode]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        brand: form.brand.trim() || null,
        category: form.category.trim(),
        sizeLabel: form.sizeLabel.trim() || null,
        description: form.description.trim() || null,
        barcode: form.barcode.trim() || null,
        primaryImageUrl: form.primaryImageUrl.trim() || null,
        status: mode === "create" ? ("APPROVED" as const) : undefined
      };
      if (mode === "edit" && selectedId) {
        return apiRequest<{ product: CatalogProduct }>(
          `/admin/commerce/catalog/products/${selectedId}`,
          { method: "PATCH", body: JSON.stringify(body) }
        );
      }
      return apiRequest<{ product: CatalogProduct }>("/admin/commerce/catalog/products", {
        method: "POST",
        body: JSON.stringify({ ...body, status: "APPROVED" })
      });
    },
    onSuccess: (res) => {
      setNotice("Product saved.");
      setSelectedId(res.product.id);
      setMode("detail");
      setLocalPreview(null);
      void queryClient.invalidateQueries({ queryKey: ["duts-catalog"] });
      void queryClient.invalidateQueries({ queryKey: ["duts-catalog-detail"] });
    },
    onError: (e: unknown) =>
      setNotice(friendlyApiError(e, "Product wasn't saved. Please try again."))
  });

  const statusMut = useMutation({
    mutationFn: (action: "approve" | "reject" | "archive") =>
      apiRequest<{ product: CatalogProduct }>(
        `/admin/commerce/catalog/products/${selectedId}/${action}`,
        { method: "POST", body: "{}" }
      ),
    onSuccess: (_res, action) => {
      setNotice(
        action === "approve"
          ? "Product approved."
          : action === "reject"
            ? "Product rejected."
            : "Product archived."
      );
      void queryClient.invalidateQueries({ queryKey: ["duts-catalog"] });
      void queryClient.invalidateQueries({ queryKey: ["duts-catalog-detail"] });
    },
    onError: (e: unknown) =>
      setNotice(friendlyApiError(e, "Couldn't update product status. Try again."))
  });

  const migrateMut = useMutation({
    mutationFn: () =>
      apiRequest<{ report: Record<string, unknown> }>("/admin/commerce/catalog/migrate-existing", {
        method: "POST",
        body: "{}"
      }),
    onSuccess: (res) => {
      setNotice(`Migration finished. Linked: ${String((res.report as { linked?: number }).linked ?? "ok")}`);
      void queryClient.invalidateQueries({ queryKey: ["duts-catalog"] });
    },
    onError: (e: unknown) => setNotice(friendlyApiError(e, "Migration failed. Try again later."))
  });

  async function onPickImage(file: File | null) {
    if (!file) return;
    pendingPhotoRef.current = file;
    if (localPreview) URL.revokeObjectURL(localPreview);
    const previewUrl = URL.createObjectURL(file);
    setLocalPreview(previewUrl);
    setUploading(true);
    setNotice("");
    try {
      const url = await uploadCatalogImage(apiRequest, file);
      setForm((prev) => ({ ...prev, primaryImageUrl: url }));
      setNotice("Photo updated.");
    } catch (e) {
      setNotice(friendlyApiError(e, "Photo couldn't be uploaded. Please try again."));
    } finally {
      setUploading(false);
    }
  }

  function openCreate() {
    setSelectedId(null);
    setForm(emptyForm);
    setLocalPreview(null);
    pendingPhotoRef.current = null;
    setNotice("");
    setMode("create");
  }

  function openDetail(p: CatalogProduct) {
    setSelectedId(p.id);
    setMode("detail");
    setNotice("");
    setLocalPreview(null);
  }

  const detail = detailQuery.data?.product;
  const previewSrc = localPreview || form.primaryImageUrl || null;
  const photoBlocked = uploading || (Boolean(localPreview) && !form.primaryImageUrl.trim());
  const filters: Array<{ id: string; label: string }> = [
    { id: "", label: "All" },
    { id: "APPROVED", label: "Approved" },
    { id: "PENDING", label: "Pending" }
  ];

  if (mode === "create" || mode === "edit") {
    return (
      <div className="commerce-stack">
        <section className="panel commerce-panel">
          <button type="button" className="text-back" onClick={() => setMode(selectedId ? "detail" : "list")}>
            ← Back
          </button>
          <h2>{mode === "create" ? "Add product" : "Edit product"}</h2>
          {notice ? <p className="notice">{notice}</p> : null}

          <PhotoHero src={previewSrc} alt={form.name || "Product photo"} emptyLabel="Product photo" />
          <div className="photo-actions">
            <button type="button" className="btn-secondary" onClick={() => cameraRef.current?.click()} disabled={uploading}>
              Take photo
            </button>
            <button type="button" className="btn-secondary" onClick={() => galleryRef.current?.click()} disabled={uploading}>
              {previewSrc ? "Change photo" : "Choose photo"}
            </button>
          </div>
          {uploading ? <p className="muted">Uploading photo…</p> : null}
          {!uploading && localPreview && !form.primaryImageUrl.trim() ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void onPickImage(pendingPhotoRef.current)}
            >
              Try again
            </button>
          ) : null}
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
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            onChange={(e) => {
              void onPickImage(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />

          <div className="commerce-form">
            <label>
              Product name *
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoComplete="off"
              />
            </label>
            <label>
              Brand
              <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
            </label>
            <label>
              Category *
              <CategorySelect value={form.category} onChange={(category) => setForm({ ...form, category })} />
            </label>
            <label>
              Size / quantity
              <input
                value={form.sizeLabel}
                onChange={(e) => setForm({ ...form, sizeLabel: e.target.value })}
                placeholder="2kg, 2L…"
              />
            </label>
            <label>
              Short product description
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
            <label>
              Barcode / GTIN
              <input
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                inputMode="numeric"
              />
            </label>
          </div>

          <button
            type="button"
            className="btn-primary btn-block"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || photoBlocked || !form.name.trim() || !form.category.trim()}
          >
            {saveMut.isPending ? "Saving…" : "Save product"}
          </button>
        </section>
      </div>
    );
  }

  if (mode === "detail" && selectedId) {
    const p = detail;
    return (
      <div className="commerce-stack">
        <section className="panel commerce-panel">
          <button type="button" className="text-back" onClick={() => setMode("list")}>
            ← Catalog
          </button>
          {notice ? <p className="notice">{notice}</p> : null}
          {detailQuery.isLoading || !p ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <PhotoHero src={p.primaryImageUrl} alt={p.name} emptyLabel={p.name} />
              <h2 className="product-title">{p.name}</h2>
              <p className="muted">
                {[p.brand, p.sizeLabel, displayCategory(p.category)].filter(Boolean).join(" · ")}
              </p>
              <div style={{ margin: "12px 0" }}>
                <StatusBadge status={p.status} />
              </div>
              {p.description ? <p className="product-desc">{p.description}</p> : null}

              <button type="button" className="btn-primary btn-block" onClick={() => setMode("edit")}>
                Edit product
              </button>

              <div className="admin-actions">
                <p className="muted tiny">Admin actions</p>
                <div className="row-actions">
                  <button type="button" className="btn-secondary" onClick={() => statusMut.mutate("approve")}>
                    Approve
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => statusMut.mutate("reject")}>
                    Reject
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => statusMut.mutate("archive")}>
                    Archive
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="commerce-stack">
      <section className="panel commerce-panel">
        <h2>DUTS Catalog</h2>
        <p className="muted">Manage products available across DUTS.</p>
        {notice ? <p className="notice">{notice}</p> : null}

        <label className="search-field">
          <span className="sr-only">Search products</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products…"
            enterKeyHint="search"
          />
        </label>

        <div className="chip-row" role="tablist" aria-label="Status filter">
          {filters.map((f) => (
            <button
              key={f.id || "all"}
              type="button"
              role="tab"
              aria-selected={statusFilter === f.id}
              className={statusFilter === f.id ? "chip chip-active" : "chip"}
              onClick={() => setStatusFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button type="button" className="btn-primary btn-block" onClick={openCreate}>
          + Add product
        </button>

        {listQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {listQuery.error ? (
          <p className="notice">{friendlyApiError(listQuery.error, "Couldn't load products. Try again.")}</p>
        ) : null}

        <div className="product-card-list">
          {(listQuery.data?.products ?? []).map((p) => (
            <button key={p.id} type="button" className="product-card" onClick={() => openDetail(p)}>
              <ProductThumb src={p.primaryImageUrl} alt={p.name} size="md" />
              <div className="product-card-body">
                <strong>{p.name}</strong>
                <span className="muted">
                  {[p.brand, p.sizeLabel].filter(Boolean).join(" · ") || displayCategory(p.category)}
                </span>
                <span className="muted">{displayCategory(p.category)}</span>
                <StatusBadge status={p.status} />
              </div>
              <span className="chevron" aria-hidden>
                ›
              </span>
            </button>
          ))}
        </div>

        {!listQuery.isLoading && (listQuery.data?.products ?? []).length === 0 ? (
          <p className="muted">No products match this search.</p>
        ) : null}

        <details className="advanced-box" open={showAdvanced} onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}>
          <summary>Advanced</summary>
          <p className="muted">Internal tooling — not needed for shop visits.</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => migrateMut.mutate()}
            disabled={migrateMut.isPending}
          >
            {migrateMut.isPending ? "Migrating…" : "Migrate existing merchant products"}
          </button>
        </details>
      </section>
    </div>
  );
}
