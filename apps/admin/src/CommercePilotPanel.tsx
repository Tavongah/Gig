import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { MerchantLocationPicker } from "./MerchantLocationPicker";
import { hasValidCoordinates, presentationLocationLabel } from "./merchantLocation";
import { displayCategory, friendlyApiError, uploadCatalogImage } from "./commerceAdminUi";
import { CategorySelect, PhotoHero, ProductThumb } from "./ProductThumb";

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
  catalogProductId?: string | null;
  imageUrl?: string | null;
};

type CatalogHit = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  sizeLabel: string | null;
  primaryImageUrl: string | null;
  status: string;
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
  const [catalogSearch, setCatalogSearch] = useState("");
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogHit | null>(null);
  const [offerPrice, setOfferPrice] = useState("");
  const [offerAvailable, setOfferAvailable] = useState(true);
  const [showNewCatalog, setShowNewCatalog] = useState(false);
  const [newCatalogForm, setNewCatalogForm] = useState({
    name: "",
    brand: "",
    category: "Drinks",
    sizeLabel: "",
    description: "",
    barcode: "",
    primaryImageUrl: "",
    price: "",
    forceCreate: false
  });
  const [similarMatches, setSimilarMatches] = useState<CatalogHit[]>([]);
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
  const [shopView, setShopView] = useState<"products" | "add" | "success" | "edit-offer">("products");
  const [productFilter, setProductFilter] = useState("");
  const [editingOffer, setEditingOffer] = useState<ProductRow | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editAvailable, setEditAvailable] = useState(true);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [localPhotoPreview, setLocalPhotoPreview] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const pendingPhotoRef = useRef<File | null>(null);

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

  const catalogSearchQuery = useQuery({
    queryKey: ["merchant-catalog-search", selectedId, catalogSearch],
    queryFn: () =>
      apiRequest<{ products: CatalogHit[] }>(
        `/admin/commerce/merchants/${selectedId}/catalog/search?q=${encodeURIComponent(catalogSearch.trim())}&limit=20`
      ),
    enabled: Boolean(selectedId) && catalogSearch.trim().length >= 1
  });

  const linkCatalogMut = useMutation({
    mutationFn: () => {
      if (!selectedId || !selectedCatalog) throw new Error("Select a catalog product");
      const priceCents = Math.round(Number(offerPrice) * 100);
      if (!Number.isFinite(priceCents) || priceCents < 1) throw new Error("Enter a valid selling price");
      return apiRequest(`/admin/commerce/merchants/${selectedId}/catalog/link`, {
        method: "POST",
        body: JSON.stringify({
          catalogProductId: selectedCatalog.id,
          priceCents,
          currency: "usd",
          available: offerAvailable
        })
      });
    },
    onSuccess: () => {
      setNotice(`✓ Added to shop`);
      setSelectedCatalog(null);
      setOfferPrice("");
      setShopView("success");
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-products", selectedId] });
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-merchant", selectedId] });
    },
    onError: (e: unknown) =>
      setNotice(friendlyApiError(e, "Product wasn't saved. Please try again."))
  });

  const submitNewCatalogMut = useMutation({
    mutationFn: (opts?: { forceCreate?: boolean }) => {
      if (!selectedId) throw new Error("Select a merchant first");
      const priceCents = Math.round(Number(newCatalogForm.price) * 100);
      return apiRequest<{
        requiresConfirmation: boolean;
        matches?: CatalogHit[];
        catalogProduct?: CatalogHit;
        product?: ProductRow;
      }>(`/admin/commerce/merchants/${selectedId}/catalog/submit`, {
        method: "POST",
        body: JSON.stringify({
          name: newCatalogForm.name.trim(),
          brand: newCatalogForm.brand.trim() || null,
          category: newCatalogForm.category.trim(),
          sizeLabel: newCatalogForm.sizeLabel.trim() || null,
          description: newCatalogForm.description.trim() || null,
          barcode: newCatalogForm.barcode.trim() || null,
          primaryImageUrl: newCatalogForm.primaryImageUrl.trim(),
          priceCents,
          currency: "usd",
          available: true,
          forceCreate: Boolean(opts?.forceCreate || newCatalogForm.forceCreate)
        })
      });
    },
    onSuccess: (res) => {
      if (res.requiresConfirmation && res.matches?.length) {
        setSimilarMatches(res.matches);
        setNotice("Possible match — is this the product?");
        return;
      }
      setNotice("✓ Added to shop");
      setShowNewCatalog(false);
      setSimilarMatches([]);
      setLocalPhotoPreview(null);
      setNewCatalogForm({
        name: "",
        brand: "",
        category: "Drinks",
        sizeLabel: "",
        description: "",
        barcode: "",
        primaryImageUrl: "",
        price: "",
        forceCreate: false
      });
      setShopView("success");
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-products", selectedId] });
    },
    onError: (e: unknown) =>
      setNotice(friendlyApiError(e, "Product wasn't saved. Please try again."))
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

  const archiveProductMut = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/admin/commerce/merchants/${selectedId}/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: true })
      }),
    onSuccess: () => {
      setNotice("Product removed from shop.");
      setShopView("products");
      setEditingOffer(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-products", selectedId] });
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-merchants"] });
    }
  });

  const saveOfferMut = useMutation({
    mutationFn: () => {
      if (!editingOffer) throw new Error("No product selected");
      const priceCents = Math.round(Number(editPrice) * 100);
      if (!Number.isFinite(priceCents) || priceCents < 1) throw new Error("Enter a valid selling price");
      return apiRequest(`/admin/commerce/merchants/${selectedId}/products/${editingOffer.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editingOffer.name,
          priceCents,
          available: editAvailable,
          currency: "usd",
          searchAliases: editingOffer.searchAliases ?? []
        })
      });
    },
    onSuccess: () => {
      setNotice("Product saved.");
      setShopView("products");
      setEditingOffer(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-commerce-products", selectedId] });
    },
    onError: (e: unknown) =>
      setNotice(friendlyApiError(e, "Product wasn't saved. Please try again."))
  });

  async function onPickMerchantPhoto(file: File | null) {
    if (!file) return;
    pendingPhotoRef.current = file;
    if (localPhotoPreview) URL.revokeObjectURL(localPhotoPreview);
    setLocalPhotoPreview(URL.createObjectURL(file));
    setPhotoUploading(true);
    setNotice("");
    try {
      const url = await uploadCatalogImage(apiRequest, file);
      setNewCatalogForm((prev) => ({ ...prev, primaryImageUrl: url }));
      setNotice("Photo updated.");
    } catch (e) {
      setNotice(friendlyApiError(e, "Photo couldn't be uploaded. Please try again."));
    } finally {
      setPhotoUploading(false);
    }
  }

  function openAddFlow() {
    setShopView("add");
    setCatalogSearch("");
    setSelectedCatalog(null);
    setShowNewCatalog(false);
    setOfferPrice("");
    setSimilarMatches([]);
    setNotice("");
  }

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
        <table className="data-table merchant-table-desktop">
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
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="merchant-card-list">
          {(merchantsQuery.data?.merchants ?? []).map((m) => (
            <button key={m.id} type="button" className="product-card" onClick={() => loadMerchant(m)}>
              <div className="product-card-body">
                <strong>{m.name}</strong>
                <span className="muted">{m.pilotArea || m.locationLabel}</span>
                <span className="muted">
                  {m.availableProductCount ?? m._count.products} products
                  {m.acceptsOrders && m.isActive ? " · Open" : " · Closed"}
                </span>
              </div>
              <span className="chevron" aria-hidden>
                ›
              </span>
            </button>
          ))}
        </div>
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
        <button
          type="button"
          className="btn-primary"
          onClick={() => saveMerchant.mutate()}
          disabled={saveMerchant.isPending}
        >
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
          <section className="panel commerce-panel">
            {shopView === "success" ? (
              <div className="success-panel">
                <h2>✓ Added to shop</h2>
                <p className="muted">Ready for the next product.</p>
                <button
                  type="button"
                  className="btn-primary btn-block"
                  onClick={() => {
                    setNotice("");
                    openAddFlow();
                  }}
                >
                  Add another product
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-block"
                  onClick={() => {
                    setShopView("products");
                    setNotice("");
                  }}
                >
                  Done
                </button>
              </div>
            ) : null}

            {shopView === "edit-offer" && editingOffer ? (
              <>
                <button type="button" className="text-back" onClick={() => setShopView("products")}>
                  ← Products
                </button>
                <h2>{editingOffer.name}</h2>
                {editingOffer.unit ? <p className="muted">{editingOffer.unit}</p> : null}
                {notice ? <p className="notice">{notice}</p> : null}
                <div className="commerce-form">
                  <label>
                    Selling price
                    <input
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      inputMode="decimal"
                      placeholder="2.50"
                    />
                  </label>
                  <label className="toggle-row">
                    <span>In stock</span>
                    <input
                      type="checkbox"
                      checked={editAvailable}
                      onChange={(e) => setEditAvailable(e.target.checked)}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn-primary btn-block"
                  onClick={() => saveOfferMut.mutate()}
                  disabled={saveOfferMut.isPending}
                >
                  {saveOfferMut.isPending ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-block"
                  onClick={() => archiveProductMut.mutate(editingOffer.id)}
                >
                  Remove from shop
                </button>
              </>
            ) : null}

            {shopView === "add" ? (
              <>
                <button type="button" className="text-back" onClick={() => setShopView("products")}>
                  ← Products
                </button>
                <h2>Add product to {selectedLabel}</h2>
                {notice ? <p className="notice">{notice}</p> : null}

                {!showNewCatalog && !selectedCatalog ? (
                  <>
                    <label className="search-field">
                      <span className="sr-only">Search DUTS Catalog</span>
                      <input
                        value={catalogSearch}
                        onChange={(e) => setCatalogSearch(e.target.value)}
                        placeholder="Search DUTS Catalog…"
                        enterKeyHint="search"
                      />
                    </label>

                    <div className="product-card-list">
                      {(catalogSearchQuery.data?.products ?? []).map((hit) => (
                        <div key={hit.id} className="product-card static">
                          <ProductThumb src={hit.primaryImageUrl} alt={hit.name} size="md" />
                          <div className="product-card-body">
                            <strong>{hit.name}</strong>
                            <span className="muted">
                              {[hit.brand, hit.sizeLabel].filter(Boolean).join(" · ") ||
                                displayCategory(hit.category)}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => {
                              setSelectedCatalog(hit);
                              setShowNewCatalog(false);
                            }}
                          >
                            Select
                          </button>
                        </div>
                      ))}
                    </div>
                    {catalogSearch.trim() && !catalogSearchQuery.isFetching && (catalogSearchQuery.data?.products ?? []).length === 0 ? (
                      <p className="muted">No matching products.</p>
                    ) : null}

                    <div className="cant-find">
                      <p className="muted">Can&apos;t find it?</p>
                      <button
                        type="button"
                        className="btn-primary btn-block"
                        onClick={() => {
                          setShowNewCatalog(true);
                          setSelectedCatalog(null);
                          setNewCatalogForm((prev) => ({ ...prev, name: catalogSearch.trim() }));
                        }}
                      >
                        + Add new product
                      </button>
                    </div>
                  </>
                ) : null}

                {selectedCatalog ? (
                  <div className="offer-panel">
                    <ProductThumb src={selectedCatalog.primaryImageUrl} alt={selectedCatalog.name} size="lg" />
                    <h3>{selectedCatalog.name}</h3>
                    <p className="muted">
                      {[selectedCatalog.brand, selectedCatalog.sizeLabel].filter(Boolean).join(" · ")}
                    </p>
                    <div className="commerce-form">
                      <label>
                        Selling price *
                        <input
                          value={offerPrice}
                          onChange={(e) => setOfferPrice(e.target.value)}
                          placeholder="2.00"
                          inputMode="decimal"
                        />
                      </label>
                      <label className="toggle-row">
                        <span>In stock</span>
                        <input
                          type="checkbox"
                          checked={offerAvailable}
                          onChange={(e) => setOfferAvailable(e.target.checked)}
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      className="btn-primary btn-block"
                      onClick={() => linkCatalogMut.mutate()}
                      disabled={linkCatalogMut.isPending}
                    >
                      {linkCatalogMut.isPending ? "Saving…" : "Add to shop"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-block"
                      onClick={() => setSelectedCatalog(null)}
                    >
                      Back to search
                    </button>
                  </div>
                ) : null}

                {showNewCatalog ? (
                  <div className="offer-panel">
                    <h3>Add new product</h3>
                    {similarMatches.length > 0 ? (
                      <div className="similar-box">
                        <p>
                          <strong>Possible match</strong>
                        </p>
                        {similarMatches.map((m) => (
                          <div key={m.id} className="product-card static">
                            <ProductThumb src={m.primaryImageUrl} alt={m.name} size="sm" />
                            <div className="product-card-body">
                              <strong>{m.name}</strong>
                              <span className="muted">{m.sizeLabel ?? displayCategory(m.category)}</span>
                            </div>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => {
                                setSelectedCatalog(m);
                                setShowNewCatalog(false);
                                setSimilarMatches([]);
                              }}
                            >
                              Use this product
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="btn-primary btn-block"
                          onClick={() => submitNewCatalogMut.mutate({ forceCreate: true })}
                        >
                          Create new product
                        </button>
                      </div>
                    ) : (
                      <>
                        <PhotoHero
                          src={localPhotoPreview || newCatalogForm.primaryImageUrl}
                          alt={newCatalogForm.name || "Product photo"}
                          emptyLabel={localPhotoPreview ? "Photo selected ✓" : "Product photo *"}
                        />
                        <div className="photo-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => cameraRef.current?.click()}
                            disabled={photoUploading}
                          >
                            Take photo
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => galleryRef.current?.click()}
                            disabled={photoUploading}
                          >
                            Choose photo
                          </button>
                        </div>
                        {photoUploading ? <p className="muted">Uploading photo…</p> : null}
                        {!photoUploading && localPhotoPreview && !newCatalogForm.primaryImageUrl.trim() ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => void onPickMerchantPhoto(pendingPhotoRef.current)}
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
                            void onPickMerchantPhoto(e.target.files?.[0] ?? null);
                            e.target.value = "";
                          }}
                        />
                        <input
                          ref={galleryRef}
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => {
                            void onPickMerchantPhoto(e.target.files?.[0] ?? null);
                            e.target.value = "";
                          }}
                        />

                        <div className="commerce-form">
                          <label>
                            Product name *
                            <input
                              value={newCatalogForm.name}
                              onChange={(e) => setNewCatalogForm({ ...newCatalogForm, name: e.target.value })}
                            />
                          </label>
                          <label>
                            Brand
                            <input
                              value={newCatalogForm.brand}
                              onChange={(e) => setNewCatalogForm({ ...newCatalogForm, brand: e.target.value })}
                            />
                          </label>
                          <label>
                            Category *
                            <CategorySelect
                              value={newCatalogForm.category}
                              onChange={(category) => setNewCatalogForm({ ...newCatalogForm, category })}
                            />
                          </label>
                          <label>
                            Size / quantity
                            <input
                              value={newCatalogForm.sizeLabel}
                              onChange={(e) =>
                                setNewCatalogForm({ ...newCatalogForm, sizeLabel: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            Short product description
                            <textarea
                              rows={3}
                              value={newCatalogForm.description}
                              onChange={(e) =>
                                setNewCatalogForm({ ...newCatalogForm, description: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            Barcode / GTIN
                            <input
                              value={newCatalogForm.barcode}
                              onChange={(e) => setNewCatalogForm({ ...newCatalogForm, barcode: e.target.value })}
                              inputMode="numeric"
                            />
                          </label>
                          <label>
                            Selling price *
                            <input
                              value={newCatalogForm.price}
                              onChange={(e) => setNewCatalogForm({ ...newCatalogForm, price: e.target.value })}
                              inputMode="decimal"
                            />
                          </label>
                        </div>
                        <button
                          type="button"
                          className="btn-primary btn-block"
                          onClick={() => submitNewCatalogMut.mutate({})}
                          disabled={
                            submitNewCatalogMut.isPending ||
                            photoUploading ||
                            !newCatalogForm.name.trim() ||
                            !newCatalogForm.category.trim() ||
                            !newCatalogForm.primaryImageUrl.trim() ||
                            !newCatalogForm.price.trim()
                          }
                        >
                          {submitNewCatalogMut.isPending ? "Saving…" : "Add product"}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-block"
                          onClick={() => setShowNewCatalog(false)}
                        >
                          Back to search
                        </button>
                      </>
                    )}
                  </div>
                ) : null}
              </>
            ) : null}

            {shopView === "products" ? (
              <>
                <div className="panel-header-row">
                  <h2>Products ({productsQuery.data?.products?.length ?? 0})</h2>
                </div>
                {notice ? <p className="notice">{notice}</p> : null}
                <label className="search-field">
                  <span className="sr-only">Search products</span>
                  <input
                    value={productFilter}
                    onChange={(e) => setProductFilter(e.target.value)}
                    placeholder="Search products"
                  />
                </label>
                <button type="button" className="btn-primary btn-block" onClick={openAddFlow}>
                  + Add product
                </button>
                <div className="product-card-list">
                  {(productsQuery.data?.products ?? [])
                    .filter((p) =>
                      !productFilter.trim()
                        ? true
                        : p.name.toLowerCase().includes(productFilter.trim().toLowerCase())
                    )
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="product-card"
                        onClick={() => {
                          setEditingOffer(p);
                          setEditPrice((p.priceCents / 100).toFixed(2));
                          setEditAvailable(p.available);
                          setShopView("edit-offer");
                          setNotice("");
                        }}
                      >
                        <ProductThumb src={p.imageUrl} alt={p.name} size="md" />
                        <div className="product-card-body">
                          <strong>{p.name}</strong>
                          {p.unit ? <span className="muted">{p.unit}</span> : null}
                          <span className="price-line">${(p.priceCents / 100).toFixed(2)}</span>
                          <span className={p.available ? "stock-ok" : "stock-out"}>
                            {p.available ? "In stock" : "Out of stock"}
                          </span>
                        </div>
                        <span className="chevron" aria-hidden>
                          ›
                        </span>
                      </button>
                    ))}
                </div>
              </>
            ) : null}
          </section>

          <details className="panel advanced-box">
            <summary>Advanced — bulk import &amp; test tools</summary>
            <div className="commerce-form" style={{ marginTop: 12 }}>
              <label>
                Bulk catalog import
                <textarea rows={6} value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
              </label>
            </div>
            <div className="row-actions">
              <button type="button" className="btn-secondary" onClick={() => previewBulk.mutate()}>
                Preview
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => importBulk.mutate()}
                disabled={!bulkPreview || bulkPreview.valid.length === 0}
              >
                Confirm import ({bulkPreview?.valid.length ?? 0})
              </button>
            </div>
            {bulkPreview ? (
              <ul className="muted">
                {bulkPreview.lines.slice(0, 12).map((l, i) => (
                  <li key={`${l.line}-${i}`}>
                    {l.name
                      ? `${l.name} · $${((l.priceCents ?? 0) / 100).toFixed(2)} · ${l.status}`
                      : `${l.line} · ${l.status}`}
                  </li>
                ))}
              </ul>
            ) : null}

            <h3 style={{ marginTop: 20 }}>Test basket</h3>
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
            <button type="button" className="btn-secondary" onClick={() => runTestBasket.mutate()}>
              Run test basket
            </button>
            {testResult ? <pre className="readiness-box">{testResult}</pre> : null}

            <details style={{ marginTop: 16 }}>
              <summary>Legacy quick add</summary>
              <div className="form-grid" style={{ marginTop: 12 }}>
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
              <button type="button" className="btn-secondary" onClick={() => addProduct.mutate()} disabled={addProduct.isPending}>
                Add product (legacy)
              </button>
            </details>
          </details>
        </>
      ) : null}
    </>
  );
}
