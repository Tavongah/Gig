import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

type Line = {
  id: string;
  retailer: string;
  productName: string;
  productUrl: string;
  quantity: number;
  size: string | null;
  color: string | null;
  variantDetails: string | null;
};

type RequestRow = {
  id: string;
  reference: string;
  status: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  preferredContactChannel: string;
  destinationCity: string;
  deliveryAddress: string;
  localDeliveryCoverage?: string;
  lines: Line[];
  quotes?: Array<{ id: string; version: number; status: string; totalCents: number; currency: string; expiresAt?: string }>;
  payments?: Array<{
    id: string;
    status: string;
    amountCents: number;
    currency: string;
    paymentMethod: string;
    provider?: string;
    providerReference?: string | null;
    confirmationMethod?: string | null;
    merchantReference?: string;
  }>;
};

function cents(raw: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(raw.trim())) throw new Error("Enter amounts like 12.50");
  const [dollars, fraction = ""] = raw.trim().split(".");
  return Number(dollars) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

export function CrossBorderPanel({ apiRequest }: { apiRequest: ApiRequest }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staffLink, setStaffLink] = useState<string | null>(null);
  const [merchandise, setMerchandise] = useState("0.00");
  const [saShip, setSaShip] = useState("0.00");
  const [freight, setFreight] = useState("0.00");
  const [customs, setCustoms] = useState("0.00");
  const [customsEstimate, setCustomsEstimate] = useState(true);
  const [fee, setFee] = useState("0.00");
  const [zw, setZw] = useState("0.00");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [rate, setRate] = useState("");
  const [rateSource, setRateSource] = useState("");
  const [zar, setZar] = useState("");
  const list = useQuery({
    queryKey: ["cross-border-requests"],
    queryFn: () => apiRequest<{ requests: RequestRow[] }>("/admin/cross-border/requests")
  });
  const detail = useQuery({
    queryKey: ["cross-border-request", selected],
    queryFn: () => apiRequest<{ request: RequestRow }>(`/admin/cross-border/requests/${selected}`),
    enabled: Boolean(selected)
  });
  const request = detail.data?.request;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["cross-border-requests"] });
    void queryClient.invalidateQueries({ queryKey: ["cross-border-request", selected] });
  };

  const quote = useMutation({
    mutationFn: async () => {
      if (!request) throw new Error("Open a request first.");
      const body = {
        merchandiseSubtotalCents: cents(merchandise),
        saShippingCents: cents(saShip),
        crossBorderFreightCents: cents(freight),
        customsCents: cents(customs),
        customsIsEstimate: customsEstimate,
        serviceFeeCents: cents(fee),
        zimbabweDeliveryCents: cents(zw),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        zarMerchandiseCents: zar ? cents(zar) : null,
        exchangeRate: rate || null,
        exchangeRateSource: rateSource || null,
        exchangeRateAt: rate ? new Date().toISOString() : null,
        lines: request.lines.map((line) => ({
          requestLineId: line.id,
          unitPriceCents: cents(prices[line.id] || "0")
        }))
      };
      return apiRequest(`/admin/cross-border/requests/${request.id}/quotes`, {
        method: "POST",
        body: JSON.stringify(body)
      });
    },
    onSuccess: refresh,
    onError: (err: Error) => setError(err.message)
  });

  async function generateLink(quoteId: string) {
    setError(null);
    try {
      const result = await apiRequest<{ paymentLink: string }>(`/admin/cross-border/quotes/${quoteId}/payment-link`, {
        method: "POST",
        body: "{}"
      });
      setStaffLink(result.paymentLink);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment link was not created.");
    }
  }

  async function post(path: string, body?: unknown) {
    setError(null);
    try {
      const result = await apiRequest<{ paymentLink?: string | null; reason?: string; sent?: boolean }>(path, { method: "POST", body: body ? JSON.stringify(body) : "{}" });
      if (result?.paymentLink) setStaffLink(result.paymentLink);
      if (result?.sent === false) setError(result.reason ?? "The quotation was not delivered.");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  return (
    <section className="panel">
      <h2>Cross-Border Orders</h2>
      <p className="muted">South African shopping is separate from local shop orders. Card payments are not enabled.</p>
      {list.error ? <p className="notice">{list.error.message}</p> : null}
      {error ? <p className="notice">{error}</p> : null}
      {staffLink ? <p className="notice">Payment link for staff handoff: {staffLink}</p> : null}
      <table>
        <tbody>
          {(list.data?.requests ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.reference}</td>
              <td>{row.status}</td>
              <td>{row.destinationCity}</td>
              <td><button type="button" onClick={() => setSelected(row.id)}>Open</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {request ? (
        <div>
          <h3>{request.reference} · {request.status}</h3>
          <p>{request.customerName} · {request.preferredContactChannel}</p>
          <p>{request.phone ?? "No phone"} · {request.email ?? "No email"}</p>
          <p>{request.destinationCity} · {request.deliveryAddress}</p>
          {request.localDeliveryCoverage === "STAFF_CONFIRM" ? (
            <p className="notice">This city is outside Harare and Gweru. Confirm the final delivery before sending a quotation. Do not create a local delivery job.</p>
          ) : null}
          {request.lines.map((line) => (
            <p key={line.id}>
              {line.quantity} x {line.productName} · {line.retailer}
              {line.size ? ` · size ${line.size}` : ""}{line.color ? ` · colour ${line.color}` : ""}
              {line.variantDetails ? ` · ${line.variantDetails}` : ""}
              <br />
              <a href={line.productUrl}>{line.productUrl}</a>
              <input value={prices[line.id] ?? ""} placeholder="Unit price USD" onChange={(event) => setPrices({ ...prices, [line.id]: event.target.value })} />
            </p>
          ))}
          <label>Merchandise USD <input value={merchandise} onChange={(event) => setMerchandise(event.target.value)} /></label>
          <label>SA shipping <input value={saShip} onChange={(event) => setSaShip(event.target.value)} /></label>
          <label>Cross-border freight <input value={freight} onChange={(event) => setFreight(event.target.value)} /></label>
          <label>Customs <input value={customs} onChange={(event) => setCustoms(event.target.value)} /></label>
          <label><input type="checkbox" checked={customsEstimate} onChange={(event) => setCustomsEstimate(event.target.checked)} /> Customs is an estimate</label>
          <label>DUTS fee <input value={fee} onChange={(event) => setFee(event.target.value)} /></label>
          <label>Zimbabwe delivery <input value={zw} onChange={(event) => setZw(event.target.value)} /></label>
          <label>ZAR merchandise snapshot <input value={zar} onChange={(event) => setZar(event.target.value)} /></label>
          <label>Exchange rate <input value={rate} onChange={(event) => setRate(event.target.value)} /></label>
          <label>Rate source <input value={rateSource} onChange={(event) => setRateSource(event.target.value)} /></label>
          <button type="button" onClick={() => { setError(null); quote.mutate(); }}>Save draft quotation</button>
          {(request.quotes ?? []).map((item) => (
            <p key={item.id}>
              Version {item.version} · {item.status} · {(item.totalCents / 100).toFixed(2)} {item.currency}
              {item.status === "DRAFT" ? <button type="button" onClick={() => void post(`/admin/cross-border/quotes/${item.id}/approve`)}>Approve</button> : null}
              {item.status === "APPROVED" || item.status === "SENT" ? <button type="button" onClick={() => void post(`/admin/cross-border/quotes/${item.id}/send`)}>Send quotation</button> : null}
              {item.status === "APPROVED" || item.status === "SENT" || item.status === "ACCEPTED" ? (
                <button type="button" onClick={() => void generateLink(item.id)}>Generate Payment Link</button>
              ) : null}
            </p>
          ))}
          {staffLink ? (
            <p>
              <input readOnly value={staffLink} />
              <button type="button" onClick={() => void navigator.clipboard.writeText(staffLink)}>Copy Payment Link</button>
            </p>
          ) : null}
          <p className="muted">Send the payment link yourself. Quotation messages do not include it. Card checkout stays off.</p>
          <ConfirmExternalPayment
            request={request}
            onSubmit={(body) => post(`/admin/cross-border/requests/${request.id}/confirm-external-payment`, body)}
          />
          {(request.payments ?? []).map((payment) => {
            const manual = payment.confirmationMethod === "MANUAL_ZB_PORTAL" || payment.provider === "MANUAL_ZB_PORTAL";
            return (
              <p key={payment.id}>
                Payment {payment.status} · {(payment.amountCents / 100).toFixed(2)} {payment.currency} · {manual ? "Staff-attested ZB portal check" : payment.paymentMethod}
                {payment.providerReference ? ` · ZB ${payment.providerReference}` : ""}
                {manual ? null : <button type="button" onClick={() => void post(`/admin/cross-border/payments/${payment.id}/reconcile`)}>Check payment status</button>}
                {manual && payment.status === "PAID" ? (
                  <DisputeButton onSubmit={(reason) => post(`/admin/cross-border/payments/${payment.id}/dispute`, { reason })} />
                ) : null}
              </p>
            );
          })}
          <h3>Procurement</h3>
          <button type="button" onClick={() => void post(`/admin/cross-border/requests/${request.id}/status`, { status: "UNDER_REVIEW" })}>Mark under review</button>
          <PurchaseForm requestId={request.id} onSubmit={(body) => post(`/admin/cross-border/requests/${request.id}/purchase`, body)} />
          <button type="button" onClick={() => void post(`/admin/cross-border/requests/${request.id}/shipment`, { to: "RECEIVED_IN_SOUTH_AFRICA" })}>Received in South Africa</button>
          <button type="button" onClick={() => void post(`/admin/cross-border/requests/${request.id}/shipment`, { to: "IN_TRANSIT_TO_ZIMBABWE" })}>In transit</button>
          <button type="button" onClick={() => void post(`/admin/cross-border/requests/${request.id}/shipment`, { to: "READY_FOR_LOCAL_DELIVERY" })}>Ready for local delivery</button>
          <button type="button" onClick={() => void post(`/admin/cross-border/requests/${request.id}/shipment`, { to: "OUT_FOR_DELIVERY" })}>Out for delivery</button>
          <button type="button" onClick={() => void post(`/admin/cross-border/requests/${request.id}/shipment`, { to: "DELIVERED" })}>Delivered</button>
          <button type="button" onClick={() => void post(`/admin/cross-border/requests/${request.id}/status`, { status: "REFUND_PENDING" })}>Hold for refund review</button>
        </div>
      ) : null}
    </section>
  );
}

function DisputeButton({ onSubmit }: { onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("WRONG_REFERENCE");
  return (
    <span>
      <select value={reason} onChange={(event) => setReason(event.target.value)}>
        <option value="WRONG_REFERENCE">Wrong reference</option>
        <option value="INCORRECT_CONFIRMATION">Incorrect confirmation</option>
        <option value="DUPLICATE_RECEIPT">Duplicate receipt</option>
        <option value="REFUND_REQUIRED">Refund required</option>
        <option value="REVERSAL_OR_DISPUTE">Reversal or dispute</option>
      </select>
      <button type="button" onClick={() => void onSubmit(reason)}>Open payment dispute</button>
    </span>
  );
}

function ConfirmExternalPayment({
  request,
  onSubmit
}: {
  request: RequestRow;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const quote = [...(request.quotes ?? [])].sort((a, b) => b.version - a.version)[0];
  const payable = quote && (quote.status === "APPROVED" || quote.status === "SENT" || quote.status === "ACCEPTED");
  const [transactionReference, setTransactionReference] = useState("");
  const [orderReference, setOrderReference] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(quote?.currency ?? "USD");
  const [confirmedAt, setConfirmedAt] = useState("");
  const [attested, setAttested] = useState(false);
  const [review, setReview] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  if (!payable || !quote) return null;
  const shown = `${(quote.totalCents / 100).toFixed(2)} ${quote.currency}`;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setFormError(null);
        if (!review) {
          if (!attested) {
            setFormError("Confirm that you verified this payment in the ZB portal.");
            return;
          }
          setReview(true);
          return;
        }
        const when = new Date(confirmedAt);
        if (Number.isNaN(when.getTime())) {
          setFormError("Enter the payment confirmation time.");
          return;
        }
        let amountCents = 0;
        try {
          amountCents = cents(amount);
        } catch (error) {
          setFormError(error instanceof Error ? error.message : "Enter the confirmed amount.");
          return;
        }
        void onSubmit({
          quoteId: quote.id,
          transactionReference,
          orderReference: orderReference || null,
          amountCents,
          currency,
          confirmedAt: when.toISOString(),
          attested: true
        }).finally(() => setReview(false));
      }}
    >
      <h3>Confirm External Payment</h3>
      <p className="muted">Approved quotation version {quote.version}: {shown}. DUTS does not create or send the ZB link. This records a staff check in the ZB merchant portal, not an automatic ZB status check.</p>
      <label>ZB transaction reference <input value={transactionReference} onChange={(event) => { setTransactionReference(event.target.value); setReview(false); }} /></label>
      <label>ZB order reference, if different <input value={orderReference} onChange={(event) => { setOrderReference(event.target.value); setReview(false); }} /></label>
      <label>Confirmed amount USD <input value={amount} onChange={(event) => { setAmount(event.target.value); setReview(false); }} /></label>
      <label>Currency <input value={currency} onChange={(event) => { setCurrency(event.target.value); setReview(false); }} /></label>
      <label>Payment confirmation time <input type="datetime-local" value={confirmedAt} onChange={(event) => { setConfirmedAt(event.target.value); setReview(false); }} /></label>
      <label>
        <input type="checkbox" checked={attested} onChange={(event) => { setAttested(event.target.checked); setReview(false); }} />
        I verified this successful payment in the ZB Smile&Pay merchant portal.
      </label>
      {review ? <p className="notice">Confirm {shown} for {request.reference}. ZB reference {transactionReference.trim()}.</p> : null}
      {formError ? <p className="notice">{formError}</p> : null}
      <button type="submit">{review ? "Confirm External Payment" : "Review confirmation"}</button>
    </form>
  );
}

function PurchaseForm({ requestId, onSubmit }: { requestId: string; onSubmit: (body: Record<string, unknown>) => Promise<void> }) {
  const [orderRef, setOrderRef] = useState("");
  const [amount, setAmount] = useState("");
  const [receipt, setReceipt] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        try {
          void onSubmit({
            requestId,
            retailerOrderReference: orderRef,
            purchaseAmountCents: cents(amount),
            purchaseCurrency: "ZAR",
            purchaseDate: new Date().toISOString(),
            receiptReference: receipt
          });
        } catch (err) {
          window.alert(err instanceof Error ? err.message : "Enter the purchase amount like 12.50");
        }
      }}
    >
      <input value={orderRef} placeholder="Retailer order number" onChange={(event) => setOrderRef(event.target.value)} />
      <input value={amount} placeholder="Actual purchase amount" onChange={(event) => setAmount(event.target.value)} />
      <input value={receipt} placeholder="Receipt reference" onChange={(event) => setReceipt(event.target.value)} />
      <button type="submit">Record purchase</button>
    </form>
  );
}
