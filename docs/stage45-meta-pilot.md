# Stage 4.5 — Real Meta WhatsApp + Harare pilot safety

Feature freeze on Stage 4 marketplace. This stage proves the mocked flow on the **official WhatsApp Business Platform (Cloud API)** and hardens payment / idempotency for a tiny cash pilot.

## Environment (do not commit secrets)

| Variable | Purpose |
|----------|---------|
| `WHATSAPP_PROVIDER` | `mock` (tests/dev) or `meta` (pilot) |
| `WHATSAPP_TOKEN` | Cloud API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Business phone number ID |
| `WHATSAPP_APP_SECRET` | App secret for `X-Hub-Signature-256` |
| `WHATSAPP_VERIFY_TOKEN` | Webhook subscribe verify token (default `duts-whatsapp-verify`) |
| `COMMERCE_PAYMENT_METHOD` | Pilot: `CASH` (default). Never `TEST_BYPASS` in pilot/production |
| `COMMERCE_MERCHANT_TIMEOUT_SECONDS` | Merchant accept window (default `900`) |
| `ALLOW_WHATSAPP_MOCK` | Must be unset/`false` in pilot — mock inbound fail-closed |
| `WHATSAPP_TEMPLATE_*` | Optional approved template names (see below) |

Webhook callback (public HTTPS):

- Verify: `GET {API_PUBLIC_URL}/v1/whatsapp/webhook`
- Events: `POST {API_PUBLIC_URL}/v1/whatsapp/webhook`

Meta App → WhatsApp → Configuration: set Callback URL to that path, verify token matching `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages`.

Mock inbound (`POST /v1/whatsapp/mock/inbound`) is **blocked** when `APP_ENV` is pilot/staging/production.

## Payment mode (critical)

WhatsApp marketplace orders record:

- `paymentMethod = CASH` (pilot default)
- `paymentStatus = DUE_ON_DELIVERY`

Do **not** mark cash orders PAID until money is collected. `TEST_BYPASS` throws `TEST_BYPASS_FORBIDDEN` outside development/test.

EcoCash / OneMoney / Stripe commerce rails are enum-ready only — not implemented for WhatsApp checkout in this stage.

## Session vs templates

Within the 24h customer-care window, session text/buttons are used.

Configure template names for out-of-window notifications (approve in Meta Business Manager):

- `WHATSAPP_TEMPLATE_MERCHANT_NEW_ORDER`
- `WHATSAPP_TEMPLATE_ORDER_ACCEPTED`
- `WHATSAPP_TEMPLATE_COURIER_ASSIGNED`
- `WHATSAPP_TEMPLATE_ON_THE_WAY`
- `WHATSAPP_TEMPLATE_DELIVERED`
- `WHATSAPP_TEMPLATE_CANCELLED`

Until templates are approved, session text is sent. Interactive buttons always have plain-text reply fallbacks.

## Interactive messages

Meta supports reply buttons (max 3, title ≤20 chars). List replies are parsed if present. Every button flow also documents text commands (`CONFIRM`, `Accept 123`, etc.).

## Pilot merchant onboarding (one shop)

1. Admin creates merchant via admin Commerce UI or `POST /v1/admin/commerce/merchants` (name, contact, WhatsApp number E.164 `+263…`, location lat/lng, category).
2. Confirm `isActive=true`, `acceptsOrders=true`.
3. Merchant WhatsApps the DUTS business number from the **authorized** phone.
4. Merchant: `Products` → `Add … for $X.XX` for ~15–30 real SKUs (merchant sets prices).
5. Spot-check admin product list; customer location near shop can find items.
6. Set `COMMERCE_PAYMENT_METHOD=CASH`, `WHATSAPP_PROVIDER=meta`, public HTTPS webhook verified.
7. Run one full E2E: customer WA → merchant accept → ready → courier app → PIN → delivered.

## Metrics (structured logs)

Flow events (JSON console / log drain): `WHATSAPP_INBOUND`, `COMMERCE_BASKET_CREATED`, `COMMERCE_QUOTE_GENERATED`, `COMMERCE_ORDER_CONFIRMED`, `COMMERCE_MERCHANT_ACCEPTED`, `COMMERCE_MERCHANT_REJECTED`, `COMMERCE_MERCHANT_TIMEOUT`, `COMMERCE_PRICE_CHANGED`, `COMMERCE_PRODUCT_UNAVAILABLE`, `COMMERCE_READY_FOR_PICKUP`, `COMMERCE_READY_IDEMPOTENT`, `COURIER_ASSIGNED`, `COMMERCE_DELIVERED`, etc.

Derive averages (merchant response, delivery time) from timestamps on `CommerceOrder` (`confirmedAt`, `merchantAcceptedAt`, `readyAt`, `deliveredAt`).

## Tests

```bash
npm run test:commerce-whatsapp --workspace=@gigflow/api
npm run test:commerce-pilot-safety --workspace=@gigflow/api
npm run test:delivery --workspace=@gigflow/api
npm run test:delivery-e2e --workspace=@gigflow/api
```

## GO / NO-GO checklist

See Stage 4.5 completion report. Real Meta customer/merchant phones + public HTTPS are required for GO; automated suite alone is not sufficient.
