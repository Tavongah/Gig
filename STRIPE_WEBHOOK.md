# Stripe webhook (local dev)

Forward Stripe test events to your local API:

```powershell
# Terminal 1 — API
npm run dev:api

# Terminal 2 — Stripe CLI (requires stripe login)
npm run stripe:listen
```

Copy the `whsec_...` signing secret from the Stripe CLI output into `apps/api/.env`:

```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

Restart the API after updating the secret.

## Hosted API (Render)

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**
2. URL: `https://gigflow-api.onrender.com/v1/payments/webhook`
3. Events: `checkout.session.completed`, `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`
4. Copy signing secret → Render `gigflow-api` env `STRIPE_WEBHOOK_SECRET`

Use **test mode** keys (`sk_test_`, `pk_test_`) until you are ready for live payments.
