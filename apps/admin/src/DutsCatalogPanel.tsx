import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

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
  status: "PENDING" | "APPROVED" | "REJECTED" | "ARCHIVED";
  source: string;
};

const emptyForm = {
  name: "",
  brand: "",
  category: "Drinks",
  sizeLabel: "",
  description: "",
  barcode: "",
  primaryImageUrl: "",
  status: "APPROVED" as CatalogProduct["status"]
};

export function DutsCatalogPanel({ apiRequest }: { apiRequest: ApiRequest }) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);

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
    enabled: Boolean(selectedId)
  });

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
        status: form.status
      };
      if (selectedId) {
        return apiRequest<{ product: CatalogProduct }>(
          `/admin/commerce/catalog/products/${selectedId}`,
          { method: "PATCH", body: JSON.stringify(body) }
        );
      }
      return apiRequest<{ product: CatalogProduct }>("/admin/commerce/catalog/products", {
        method: "POST",
        body: JSON.stringify(body)
      });
    },
    onSuccess: (res) => {
      setNotice("Catalog product saved.");
      setSelectedId(res.product.id);
      void queryClient.invalidateQueries({ queryKey: ["duts-catalog"] });
      void queryClient.invalidateQueries({ queryKey: ["duts-catalog-detail"] });
    },
    onError: (e: Error) => setNotice(e.message)
  });

  const statusMut = useMutation({
    mutationFn: (action: "approve" | "reject" | "archive") =>
      apiRequest<{ product: CatalogProduct }>(
        `/admin/commerce/catalog/products/${selectedId}/${action}`,
        { method: "POST", body: "{}" }
      ),
    onSuccess: () => {
      setNotice("Status updated.");
      void queryClient.invalidateQueries({ queryKey: ["duts-catalog"] });
      void queryClient.invalidateQueries({ queryKey: ["duts-catalog-detail"] });
    },
    onError: (e: Error) => setNotice(e.message)
  });

  const migrateMut = useMutation({
    mutationFn: () =>
      apiRequest<{ report: Record<string, unknown> }>("/admin/commerce/catalog/migrate-existing", {
        method: "POST",
        body: "{}"
      }),
    onSuccess: (res) => {
      setNotice(`Migration: ${JSON.stringify(res.report)}`);
      void queryClient.invalidateQueries({ queryKey: ["duts-catalog"] });
    },
    onError: (e: Error) => setNotice(e.message)
  });

  async function onPickImage(file: File | null) {
    if (!file) return;
    setUploading(true);
    setNotice("");
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
      const dataBase64 = btoa(binary);
      const uploaded = await apiRequest<{ url: string }>("/admin/commerce/catalog/upload-image", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "image/jpeg",
          dataBase64
        })
      });
      setForm((prev) => ({ ...prev, primaryImageUrl: uploaded.url }));
      setNotice("Image uploaded.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function loadProduct(p: CatalogProduct) {
    setSelectedId(p.id);
    setForm({
      name: p.name,
      brand: p.brand ?? "",
      category: p.category,
      sizeLabel: p.sizeLabel ?? "",
      description: p.description ?? "",
      barcode: p.barcode ?? "",
      primaryImageUrl: p.primaryImageUrl ?? "",
      status: p.status
    });
  }

  const detail = detailQuery.data?.product;

  return (
    <div className="commerce-stack">
      <section className="panel">
        <h2>DUTS Catalog</h2>
        <p className="muted">
          Canonical product information. Merchants attach offers (price / stock) without rewriting shared details.
        </p>
        {notice ? <p className="notice">{notice}</p> : null}
        <div className="form-grid">
          <label>
            Search
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, brand, barcode…" />
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Approved (default search)</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </label>
        </div>
        <div className="row-actions">
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              setForm(emptyForm);
            }}
          >
            Add product
          </button>
          <button type="button" className="secondary" onClick={() => migrateMut.mutate()} disabled={migrateMut.isPending}>
            Migrate existing merchant products
          </button>
        </div>
        <table className="data-table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th></th>
              <th>Name</th>
              <th>Brand</th>
              <th>Category</th>
              <th>Size</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(listQuery.data?.products ?? []).map((p) => (
              <tr key={p.id} className={selectedId === p.id ? "selected-row" : undefined}>
                <td>
                  {p.primaryImageUrl ? (
                    <img src={p.primaryImageUrl} alt="" width={36} height={36} style={{ objectFit: "cover" }} />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <button type="button" className="ghost-btn" onClick={() => loadProduct(p)}>
                    {p.name}
                  </button>
                </td>
                <td>{p.brand ?? "—"}</td>
                <td>{p.category}</td>
                <td>{p.sizeLabel ?? "—"}</td>
                <td>{p.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>{selectedId ? "Edit catalog product" : "New catalog product"}</h2>
        <div className="form-grid">
          <label>
            Product photo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => void onPickImage(e.target.files?.[0] ?? null)}
              disabled={uploading}
            />
          </label>
          {form.primaryImageUrl ? (
            <img src={form.primaryImageUrl} alt="" width={96} height={96} style={{ objectFit: "cover" }} />
          ) : null}
          <label>
            Product name *
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Brand
            <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
          </label>
          <label>
            Category *
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </label>
          <label>
            Size / quantity
            <input value={form.sizeLabel} onChange={(e) => setForm({ ...form, sizeLabel: e.target.value })} />
          </label>
          <label>
            Description
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <label>
            Barcode / GTIN
            <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status })}
            >
              <option value="APPROVED">APPROVED</option>
              <option value="PENDING">PENDING</option>
              <option value="REJECTED">REJECTED</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
          </label>
        </div>
        <div className="row-actions">
          <button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.name.trim() || !form.category.trim()}>
            Save
          </button>
          {selectedId ? (
            <>
              <button type="button" className="secondary" onClick={() => statusMut.mutate("approve")}>
                Approve
              </button>
              <button type="button" className="secondary" onClick={() => statusMut.mutate("reject")}>
                Reject
              </button>
              <button type="button" className="secondary" onClick={() => statusMut.mutate("archive")}>
                Archive
              </button>
            </>
          ) : null}
        </div>
        {detail ? <p className="muted">Source: {detail.source}</p> : null}
      </section>
    </div>
  );
}
