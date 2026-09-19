import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { CatalogImageQueuePanel } from "./CatalogImageQueuePanel";
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
  unresolved?: boolean;
};

type CatalogView = "canonical" | "archived" | "unresolved" | "all";

type CatalogListResponse = {
  products: CatalogProduct[];
  total?: number;
  approved?: number;
  archived?: number;
  canonical?: number;
  unresolved?: number;
  categories?: string[];
};

type Mode = "list" | "detail" | "edit" | "create";

function catalogRowMatchesQuery(product: CatalogProduct, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  const hay = [product.name, product.brand, product.sizeLabel, product.category]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (hay.includes(q)) return true;
  if (q.includes("matemba") && hay.includes("kapenta")) return true;
  if ((q === "coke" || q.includes("coca-cola") || q.includes("coca cola")) && hay.includes("coca")) {
    return true;
  }
  return false;
}

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
  const [view, setView] = useState<CatalogView>("canonical");
  const [section, setSection] = useState<"products" | "image-queue">("products");
  const [categoryFilter, setCategoryFilter] = useState("");
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
    queryKey: ["duts-catalog", view],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("view", view);
      params.set("limit", "1000");
      return apiRequest<CatalogListResponse>(`/admin/commerce/catalog/products?${params.toString()}`);
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
  const viewFilters: Array<{ id: CatalogView; label: string }> = [
    { id: "canonical", label: "Canonical" },
    { id: "unresolved", label: "Unresolved" },
    { id: "archived", label: "Archived" },
    { id: "all", label: "All" }
  ];
  const canonicalCount = listQuery.data?.canonical ?? 0;
  const archivedCount = listQuery.data?.archived ?? 0;
  const unresolvedCount = listQuery.data?.unresolved ?? 0;
  const categoryOptions = useMemo(() => {
    const fromApi = listQuery.data?.categories ?? [];
    const fromRows = (listQuery.data?.products ?? []).map((p) => p.category);
    return [...new Set([...fromApi, ...fromRows])].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [listQuery.data?.categories, listQuery.data?.products]);
  const visibleProducts = useMemo(() => {
    return (listQuery.data?.products ?? []).filter((p) => {
      if (categoryFilter && p.category !== categoryFilter) return false;
      return catalogRowMatchesQuery(p, q);
    });
  }, [listQuery.data?.products, categoryFilter, q]);

  if (mode === "create" || mode === "edit") {
    return (
      <div className="commerce-stack">
        <section className="panel commerce-panel">
          <button type="button" className="text-back" onClick={() => setMode(selectedId ? "detail" : "list")}>
            ← Back
          </button>
          <h2>{mode === "create" ? "Add product" : "Edit product"}</h2>
          {notice ? <p className="notice">{notice}</p> : null}

          <PhotoHero
            src={previewSrc}
            alt={form.name || "Product photo"}
            emptyLabel={localPreview ? "Photo selected ✓" : "Product photo"}
          />
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
            accept="image/*"
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
                {p.unresolved ? <span className="catalog-unresolved-badge">Unresolved</span> : null}
              </div>
              {!p.primaryImageUrl ? <p className="catalog-missing-image">No image</p> : null}
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
        <div className="chip-row" role="tablist" aria-label="Catalog section">
          <button
            type="button"
            role="tab"
            className={section === "products" ? "chip chip-active" : "chip"}
            onClick={() => setSection("products")}
          >
            Products
          </button>
          <button
            type="button"
            role="tab"
            className={section === "image-queue" ? "chip chip-active" : "chip"}
            onClick={() => setSection("image-queue")}
          >
            Image Queue
          </button>
        </div>
        {section === "image-queue" ? <CatalogImageQueuePanel apiRequest={apiRequest} /> : null}
        {section === "products" ? (
          <>
        <p className="catalog-count-line">
          <strong>{canonicalCount}</strong> canonical products
        </p>
        <p className="catalog-stat-row">
          <span>Canonical {canonicalCount}</span>
          <span>Unresolved {unresolvedCount}</span>
          <span>Archived {archivedCount}</span>
        </p>
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

        <div className="chip-row" role="tablist" aria-label="Catalog view">
          {viewFilters.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={view === f.id}
              className={view === f.id ? "chip chip-active" : "chip"}
              onClick={() => setView(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <label className="catalog-category-filter">
          <span className="sr-only">Category</span>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
          >
            <option value="">All Categories</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {displayCategory(c)}
              </option>
            ))}
          </select>
        </label>

        <p className="muted tiny catalog-showing">
          Showing {visibleProducts.length}
          {listQuery.data?.products ? ` of ${listQuery.data.products.length}` : ""}
        </p>

        <button type="button" className="btn-primary btn-block" onClick={openCreate}>
          + Add product
        </button>

        {listQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {listQuery.error ? (
          <p className="notice">{friendlyApiError(listQuery.error, "Couldn't load products. Try again.")}</p>
        ) : null}

        <div className="product-card-list">
          {visibleProducts.map((p) => (
            <button key={p.id} type="button" className="product-card" onClick={() => openDetail(p)}>
              <ProductThumb src={p.primaryImageUrl} alt={p.name} size="md" />
              <div className="product-card-body">
                <strong>{p.name}</strong>
                <span className="muted">
                  {[p.brand, p.sizeLabel].filter(Boolean).join(" · ") || displayCategory(p.category)}
                </span>
                <span className="muted">{displayCategory(p.category)}</span>
                <span className="catalog-card-flags">
                  <StatusBadge status={p.status} />
                  {p.unresolved ? <span className="catalog-unresolved-badge">Unresolved</span> : null}
                  {!p.primaryImageUrl ? <span className="catalog-missing-image">No image</span> : null}
                </span>
              </div>
              <span className="chevron" aria-hidden>
                ›
              </span>
            </button>
          ))}
        </div>

        {!listQuery.isLoading && visibleProducts.length === 0 ? (
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
          </>
        ) : null}
      </section>
    </div>
  );
}
