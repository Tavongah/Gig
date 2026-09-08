# Stage 4 — WhatsApp shopping marketplace (customer + merchant)

Primary MVP: **Shop through WhatsApp. DUTS gets it delivered.**

Channels:

| Actor | Interface |
|-------|-----------|
| Customer | WhatsApp |
| Merchant | WhatsApp |
| Courier | Existing DUTS mobile app |
| Admin | Existing DUTS admin (`/v1/admin/commerce/*`) |

Parcel-by-WhatsApp, multi-store baskets, POS, and EcoCash are **out of scope**.

## Architecture

```
Customer WA ─┐
             ├─► WhatsApp gateway (mock | Meta Cloud API)
Merchant WA ─┘         │
                       ▼
              Conversation + intent (deterministic + optional OpenAI)
                       ▼
              Commerce (Merchant, Product, CommerceOrder)
                       ▼
              READY_FOR_PICKUP → createDelivery(orderSource=WHATSAPP)
                       ▼
              Existing courier matching / PIN / completion
                       ▼
              CommerceOrder status sync + customer WA updates
```

## Key modules

- `apps/api/src/modules/commerce/` — merchants, catalog, orders, delivery link
- `apps/api/src/modules/whatsapp/` — provider, conversation idempotency, customer + merchant handlers, routes
- `packages/shared/src/commerce.ts` — shared types / schemas
- Migration `20260906020000_stage4_whatsapp_marketplace`

## Local / mock test

```bash
npm run prisma:seed --workspace=@gigflow/api
npm run test:commerce-whatsapp --workspace=@gigflow/api
```

Mock inbound (dev):

`POST /v1/whatsapp/mock/inbound` with `{ providerMessageId, from, text?, location?, buttonId? }`

Demo merchant (seed): `ABC Tuck Shop` WhatsApp `+263771000001`

## Meta Cloud API (real WA)

Set:

- `WHATSAPP_PROVIDER=meta`
- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_VERIFY_TOKEN`

Webhook: `GET/POST /v1/whatsapp/webhook`

## Merchant WhatsApp (authorized number only)

Mutations require `Merchant.whatsappPhone` match + `isActive`.

Examples: `Add Mazoe Orange 2L for $2.50`, `Bread is now $1.20`, `Coke is out of stock`, `Show my orders`, `Accept 1042`, `Order 1042 is ready`, `Open` / `Close`.

## Config knobs (`PlatformSetting`)

- `marketplaceMerchantRadiusKm`
- `marketplaceServiceFeeCents`
- `marketplaceMerchantCommissionRate`

Plus existing delivery fee fields for last-mile pricing.

## Stage 4.5 (Meta + pilot safety)

See [`stage45-meta-pilot.md`](./stage45-meta-pilot.md) for Cloud API webhook setup, cash payment mode, templates, and merchant onboarding.

Migration: `20260906030000_stage45_pilot_safety` — `CommercePaymentMethod`, `DUE_ON_DELIVERY`, `merchantRespondBy`.

## Stage 4.6 (conversation hardening)

See [`stage46-conversation-hardening.md`](./stage46-conversation-hardening.md). Multi-turn carts, intents, budget, merchant bulk/ambiguity, simulation suite (`npm run test:commerce-conversation`).

