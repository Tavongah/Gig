# Stage 4.6 — Marketplace quality & conversation hardening

Extends Stage 4/4.5 without architecture rewrite. Focus: multi-turn carts, intents, merchant NL, AI-safe fallback, simulation suite.

## Cart model

Still stored in `WhatsAppConversation.contextJson`:

- `requestedItems` — conversational shopping list
- `draftLines` — resolved one-store basket (authoritative prices)
- `budgetCents`, `draftQuotedAt` (TTL, default 45m via `COMMERCE_CART_TTL_SECONDS`)
- `previousMerchantId` — detect one-store rematch

Mutations: `apps/api/src/modules/whatsapp/cart-mutations.ts`  
Intents: `classifyShoppingIntent` in `shopping-intent.ts`

## Supported intents

`ADD_ITEM` · `REMOVE_ITEM` · `CHANGE_QUANTITY` · `REPLACE_ITEM` · `SHOW_CART` · `CLEAR_CART` · `CHECK_PRICE` · `CHECK_AVAILABILITY` · `CHECK_TOTAL` · `CHECKOUT` · `CANCEL` · `HELP` · `START_OVER` · `SET_BUDGET` · `NEW_LIST`

## Tests

```bash
npm run test:commerce-conversation --workspace=@gigflow/api
npm run test:commerce-whatsapp --workspace=@gigflow/api
npm run test:commerce-pilot-safety --workspace=@gigflow/api
```

Dev test merchants: `prisma/seed-marketplace-test.ts` (names prefixed `[TEST]`). Seeded when `APP_ENV=development` or `SEED_MARKETPLACE_TEST_DATA=true`.
