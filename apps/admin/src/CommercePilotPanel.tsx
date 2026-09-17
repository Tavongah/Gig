import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { MerchantLocationPicker } from "./MerchantLocationPicker";
import { hasValidCoordinates, presentationLocationLabel } from "./merchantLocation";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

type MerchantRow = {
  id: string;
  name: string;
  contactName: string;
  whatsappPhone: string;
  phone: string;
  locationLabel: string;
  latitude: string | number;
  longitude: string | number;
  openingHours: string | null;
  pilotArea: string | null;
  notes: string | null;
  isActive: boolean;
  acceptsOrders: boolean;
  availableProductCount?: number;
  _count: { products: number; orders: number };
};

type Readiness = {
  status: "READY" | "NOT_READY";
  availableProductCount: number;
  missing: string[];
  summary: string;
  checks: Record<string, string>;
};

type ProductRow = {
  id: string;
  name: string;
  priceCents: number;
  available: boolean;
  unit: string | null;
  searchAliases: string[];
};

type BulkPreview = {
  lines: Array<{
    line: string;
    name?: string;
    priceCents?: number;
    status: string;
    warning?: string;
  }>;
  valid: Array<{ name: string; priceCents: number }>;
  invalid: string[];
  duplicates: string[];
};

const emptyForm = {
  name: "",
  contactName: "",
  whatsappPhone: "",
  phone: "",
  locationLabel: "",
  latitude: "",
  longitude: "",
  openingHours: "Mon–Sat 07:00–19:00",
  pilotArea: "",
  notes: "",
  isActive: true,
  acceptsOrders: true
};

export function CommercePilotPanel({ apiRequest }: { apiRequest: ApiRequest }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [productForm, setProductForm] = useState({ name: "", price: "", aliases: "" });
  const [bulkText, setBulkText] = useState(
    "Bread | 1.20\nEggs 6-pack | 2.50\nMazoe Orange 2L | 3.00\nMilk 1L | 1.50"
  );
  const [bulkPreview, setBulkPreview] = useState<BulkPreview | null>(null);
  const [testItems, setTestItems] = useState("bread\neggs\nmazoe");
  const [testLat, setTestLat] = useState("");
  const [testLng, setTestLng] = useState("");
  const [testResult, setTestResult] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [locationConfirmed, setLocationConfirmed] = useState(false);

  const merchantsQuery = useQuery({
    queryKey: ["admin-commerce-merchants"],
    queryFn: () => apiRequest<{ merchants: MerchantRow[] }>("/admin/commerce/merchants")
  });

  const detailQuery = useQuery({
    queryKey: ["admin-commerce-merchant", selectedId],
    queryFn: () =>
      apiRequest<{ merchant: MerchantRow; readiness: Readiness }>(
        `/admin/commerce/merchants/${selectedId}`
      ),
    enabled: Boolean(selectedId)
  });

  const productsQuery = useQuery({
    queryKey: ["admin-commerce-products", selectedId],
    queryFn: () =>
      apiRequest<{ products: ProductRow[] }>(`/admin/commerce/merchants/${selectedId}/products`),
    enabled: Boolean(selectedId)
  });

  const saveMerchant = useMutation({
    mutationFn: async () => {
      if (!hasValidCoordinates(form)) {
        throw new Error("Set a valid shop location on the map before saving.");
      }
      if (!locationConfirmed) {
        throw new Error("Confirm the shop location pin before saving.");
      }
      const body = {
        name: form.name.trim(),
        contactName: form.contactName.trim() || undefined,
        whatsappPhone: form.whatsappPhone.trim(),
        phone: form.phone.trim() || undefined,
        locationLabel: presentationLocationLabel(form.locationLabel),
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        openingHours: form.openingHours.trim() || undefined,
        pilotArea: form.pilotArea.trim() || undefined,
        notes: form.notes.trim() || undefined,
        isActive: form.isActive,
        acceptsOrders: form.acceptsOrders
      };
      if (selectedId) {
        return apiRequest<{ merchant: MerchantRow; readiness: Readiness }>(
          `/admin/commerce/merchants/${selectedId}`,
          { method: "PATCH", body: JSON.stringify(body) }
        );
      }
      return apiRequest<{ merchant: MerchantRow; readiness: Readiness }>(
        "/admin/commerce/merchants",
        { method: "POST", body: JSON.stringify(body) }
      );
    },
    onSuccess: (data) => {
      setSelectedId(data.merchant.id);
      setLocationConfirmed(true);
      setNotice(`Saved ${data.merchant.name}. Readiness: ${data.readiness.status}`);
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-merchants"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-merchant", data.merchant.id] });
    },
    onError: (e: Error) => setNotice(e.message)
  });

  const addProduct = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error("Select a merchant first");
      const priceCents = Math.round(Number(productForm.price) * 100);
      return apiRequest(`/admin/commerce/merchants/${selectedId}/products`, {
        method: "POST",
        body: JSON.stringify({
          name: productForm.name.trim(),
          priceCents,
          currency: "usd",
          available: true,
          searchAliases: productForm.aliases
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean)
        })
      });
    },
    onSuccess: () => {
      setProductForm({ name: "", price: "", aliases: "" });
      setNotice("Product added");
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-products", selectedId] });
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-merchant", selectedId] });
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-merchants"] });
    },
    onError: (e: Error) => setNotice(e.message)
  });

  const toggleProduct = useMutation({
    mutationFn: ({ id, available }: { id: string; available: boolean }) =>
      apiRequest(`/admin/commerce/merchants/${selectedId}/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ available })
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-products", selectedId] });
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-merchant", selectedId] });
    }
  });

  const archiveProductMut = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/admin/commerce/merchants/${selectedId}/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: true })
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-products", selectedId] });
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-merchants"] });
    }
  });

  const previewBulk = useMutation({
    mutationFn: () =>
      apiRequest<{ preview: BulkPreview }>(`/admin/commerce/merchants/${selectedId}/catalog/preview`, {
        method: "POST",
        body: JSON.stringify({ text: bulkText })
      }),
    onSuccess: (data) => setBulkPreview(data.preview),
    onError: (e: Error) => setNotice(e.message)
  });

  const importBulk = useMutation({
    mutationFn: () =>
      apiRequest(`/admin/commerce/merchants/${selectedId}/catalog/import`, {
        method: "POST",
        body: JSON.stringify({ text: bulkText, confirm: true })
      }),
    onSuccess: () => {
      setNotice("Catalog imported");
      setBulkPreview(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-products", selectedId] });
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-merchant", selectedId] });
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-merchants"] });
    },
    onError: (e: Error) => setNotice(e.message)
  });

  const runTestBasket = useMutation({
    mutationFn: () => {
      const items = testItems
        .split(/\r?\n/)
        .map((q) => q.trim())
        .filter(Boolean)
        .map((query) => ({ query, quantity: 1 }));
      return apiRequest<{ result: Record<string, unknown> }>(
        `/admin/commerce/merchants/${selectedId}/test-basket`,
        {
          method: "POST",
          body: JSON.stringify({
            customerLat: Number(testLat),
            customerLng: Number(testLng),
            items
          })
        }
      );
    },
    onSuccess: (data) => setTestResult(JSON.stringify(data.result, null, 2)),
    onError: (e: Error) => setNotice(e.message)
  });

  const readiness = detailQuery.data?.readiness;

  const selectedLabel = useMemo(() => {
    if (!selectedId) return "New merchant";
    return detailQuery.data?.merchant.name ?? "Merchant";
  }, [selectedId, detailQuery.data?.merchant.name]);

  function loadMerchant(m: MerchantRow) {
    setSelectedId(m.id);
    setForm({
      name: m.name,
      contactName: m.contactName ?? "",
      whatsappPhone: m.whatsappPhone,
      phone: m.phone ?? "",
      locationLabel: m.locationLabel,
      latitude: String(m.latitude),
      longitude: String(m.longitude),
      openingHours: m.openingHours ?? "",
      pilotArea: m.pilotArea ?? "",
      notes: m.notes ?? "",
      isActive: m.isActive,
      acceptsOrders: m.acceptsOrders
    });
    setLocationConfirmed(true);
    setTestLat(String(m.latitude));
    setTestLng(String(Number(m.longitude) + 0.002));
    setNotice("");
    setBulkPreview(null);
    setTestResult("");
  }

  function startNew() {
    setSelectedId(null);
    setForm(emptyForm);
    setLocationConfirmed(false);
    setNotice("");
    setBulkPreview(null);
    setTestResult("");
  }

  return (
    <>
      <section className="panel">
        <div className="panel-header-row">
          <h2>Pilot merchants</h2>
          <button type="button" className="ghost-btn" onClick={startNew}>
            New merchant
          </button>
        </div>
        {notice ? <p className="notice">{notice}</p> : null}
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>WhatsApp</th>
              <th>Area</th>
              <th>Open</th>
              <th>Catalog</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(merchantsQuery.data?.merchants ?? []).map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{m.whatsappPhone}</td>
                <td>{m.pilotArea || m.locationLabel}</td>
                <td>{m.acceptsOrders && m.isActive ? "Yes" : "No"}</td>
                <td>{m.availableProductCount ?? m._count.products}</td>
                <td>
                  <button type="button" className="ghost-btn" onClick={() => loadMerchant(m)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>{selectedLabel}</h2>
        <div className="form-grid">
          <label>
            Business name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Owner / manager
            <input
              value={form.contactName}
              onChange={(e) => setForm({ ...form, contactName: e.target.value })}
            />
          </label>
          <label>
            WhatsApp (authorized)
            <input
              value={form.whatsappPhone}
              onChange={(e) => setForm({ ...form, whatsappPhone: e.target.value })}
              placeholder="0772… or +263…"
            />
          </label>
          <label>
            Primary phone
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label>
            Pilot area
            <input
              value={form.pilotArea}
              onChange={(e) => setForm({ ...form, pilotArea: e.target.value })}
              placeholder="Glen Norah / MSU Senga"
            />
          </label>
          <label>
            Opening hours
            <input
              value={form.openingHours}
              onChange={(e) => setForm({ ...form, openingHours: e.target.value })}
            />
          </label>
          <label>
            Notes
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        </div>

        <MerchantLocationPicker
          apiRequest={apiRequest}
          value={{
            latitude: form.latitude,
            longitude: form.longitude,
            locationLabel: form.locationLabel
          }}
          onChange={(next) =>
            setForm((prev) => ({
              ...prev,
              latitude: next.latitude,
              longitude: next.longitude,
              locationLabel: next.locationLabel
            }))
          }
          confirmed={locationConfirmed}
          onConfirmedChange={setLocationConfirmed}
        />

        <div className="inline-checks">
          <label>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />{" "}
            Active
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.acceptsOrders}
              onChange={(e) => setForm({ ...form, acceptsOrders: e.target.checked })}
            />{" "}
            Accepts DUTS orders
          </label>
        </div>
        <button type="button" onClick={() => saveMerchant.mutate()} disabled={saveMerchant.isPending}>
          {selectedId ? "Save merchant" : "Create merchant"}
        </button>
        {readiness ? (
          <pre className="readiness-box">{readiness.summary}</pre>
        ) : selectedId ? (
          <p className="muted">Loading readiness…</p>
        ) : null}
      </section>

      {selectedId ? (
        <>
          <section className="panel">
            <h2>Catalog</h2>
            <div className="form-grid">
              <label>
                Product name
                <input
                  value={productForm.name}
                  onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                />
              </label>
              <label>
                Price (USD)
                <input
                  value={productForm.price}
                  onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                />
              </label>
              <label>
                Aliases (comma)
                <input
                  value={productForm.aliases}
                  onChange={(e) => setProductForm({ ...productForm, aliases: e.target.value })}
                />
              </label>
            </div>
            <button type="button" onClick={() => addProduct.mutate()} disabled={addProduct.isPending}>
              Add product
            </button>
            <table className="data-table" style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Price</th>
                  <th>Available</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(productsQuery.data?.products ?? []).map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>${(p.priceCents / 100).toFixed(2)}</td>
                    <td>{p.available ? "Yes" : "No"}</td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() =>
                          toggleProduct.mutate({ id: p.id, available: !p.available })
                        }
                      >
                        {p.available ? "Mark unavailable" : "Mark available"}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => archiveProductMut.mutate(p.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <h2>Bulk catalog import</h2>
            <p className="muted">One product per line: Name | price — preview before save.</p>
            <textarea
              rows={8}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              style={{ width: "100%" }}
            />
            <div className="row-actions">
              <button type="button" onClick={() => previewBulk.mutate()}>
                Preview
              </button>
              <button
                type="button"
                onClick={() => importBulk.mutate()}
                disabled={!bulkPreview || bulkPreview.valid.length === 0}
              >
                Confirm import ({bulkPreview?.valid.length ?? 0})
              </button>
            </div>
            {bulkPreview ? (
              <table className="data-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Parsed</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkPreview.lines.map((l, i) => (
                    <tr key={`${l.line}-${i}`}>
                      <td>{l.line}</td>
                      <td>
                        {l.name
                          ? `${l.name} · $${((l.priceCents ?? 0) / 100).toFixed(2)}`
                          : "—"}
                      </td>
                      <td>
                        {l.status}
                        {l.warning ? ` — ${l.warning}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>

          <section className="panel">
            <h2>Test basket (live matching)</h2>
            <div className="form-grid">
              <label>
                Customer lat
                <input value={testLat} onChange={(e) => setTestLat(e.target.value)} />
              </label>
              <label>
                Customer lng
                <input value={testLng} onChange={(e) => setTestLng(e.target.value)} />
              </label>
            </div>
            <label>
              Items (one per line)
              <textarea rows={4} value={testItems} onChange={(e) => setTestItems(e.target.value)} />
            </label>
            <button type="button" onClick={() => runTestBasket.mutate()}>
              Run test basket
            </button>
            {testResult ? <pre className="readiness-box">{testResult}</pre> : null}
          </section>
        </>
      ) : null}
    </>
  );
}
