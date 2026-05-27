# GigFlow

GigFlow is a production-minded MVP foundation for a real-time local services marketplace similar to Uber, Lyft, DoorDash, and TaskRabbit. Clients post short-term gigs; nearby workers receive live offers, accept work, complete jobs, and get paid after platform commission.

## System architecture

### Applications

- `apps/mobile` - Expo React Native app for both client and worker modes.
- `apps/api` - Node.js, Express, Prisma, PostgreSQL, Redis, and Socket.IO backend.
- `apps/admin` - React admin dashboard for marketplace operations.
- `packages/shared` - Shared TypeScript domain types, validation schemas, pricing helpers, and constants.

### Backend boundaries

- **Auth module** verifies Firebase ID tokens in production and supports local JWT login during development.
- **Onboarding module** stores role-specific user setup such as client preferences and worker capabilities.
- **Gig module** owns gig creation, dynamic price estimates, state transitions, and worker offer matching.
- **Realtime module** uses Socket.IO rooms to broadcast nearby gigs, worker locations, chat messages, and status updates.
- **Payments module** is prepared for Stripe Connect payment intents, transfers, commissions, and payouts.
- **Admin module** exposes operational reads and configurable marketplace settings such as commission rate.

### Data layer

PostgreSQL is the source of truth. Prisma models cover users, worker profiles, service categories, gigs, assignments, payments, transactions, reviews, notifications, availability windows, chat threads/messages, commission settings, and audit logs.

Redis is used for:

- Socket.IO horizontal scaling through pub/sub.
- Worker presence and availability.
- Nearby matching fan-out cache.
- Rate-limit backing store when deployed.

### Real-time flow

1. Worker app connects to Socket.IO with a JWT/Firebase session.
2. Worker marks availability and joins a location/service-category room.
3. Client posts a gig.
4. API validates the request, calculates an estimate, persists the gig, and broadcasts an offer to eligible workers.
5. Worker accepts the gig.
6. API atomically creates an assignment and changes the gig status.
7. Client receives confirmation; live location and chat rooms are opened.

### Pricing engine

The MVP pricing formula is deterministic and auditable:

```txt
subtotal = base_rate + hourly_rate * estimated_hours + distance_fee
final_price = subtotal * service_multiplier * peak_multiplier * urgency_multiplier * demand_multiplier
platform_fee = final_price * commission_rate
worker_payout = final_price - platform_fee
```

The pricing service is isolated so future AI pricing prediction can replace or augment the deterministic estimate without changing mobile clients.

## Folder structure

```txt
.
├── apps
│   ├── admin          # React + Vite admin dashboard
│   ├── api            # Express, Prisma, Socket.IO backend
│   └── mobile         # Expo React Native client/worker app
├── packages
│   └── shared         # Domain types, zod schemas, shared constants
├── docker-compose.yml # Local PostgreSQL + Redis
├── package.json       # npm workspaces
└── tsconfig.base.json # Shared TypeScript config
```

## MVP roadmap

### Phase 1 - Marketplace foundation

- Authentication and role-based onboarding.
- Client gig posting with deterministic dynamic pricing.
- Worker availability and real-time nearby gig broadcasting.
- Worker accept/reject flow.
- Admin category and commission visibility.

### Phase 2 - Transaction safety

- Stripe Connect onboarding.
- Payment authorization before worker dispatch.
- Completion confirmation and split payouts.
- Refunds, disputes, cancellation policy, and fraud signals.

### Phase 3 - Operational scale

- Push notifications with Firebase Cloud Messaging.
- Production location indexing and smarter matching.
- Live GPS tracking, chat moderation, and support tooling.
- Analytics dashboards for revenue, conversion, cancellations, and marketplace liquidity.

### Phase 4 - AI-ready intelligence

- AI pricing recommendations.
- Smart worker ranking and matching.
- Fraud detection.
- Demand forecasting.
- AI support assistant.

## Key API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/auth/session` | Exchange Firebase token or dev credentials for an API JWT |
| `GET` | `/v1/auth/me` | Return authenticated user |
| `POST` | `/v1/onboarding/complete` | Save role-specific onboarding data |
| `GET` | `/v1/gigs/categories` | List active service categories |
| `POST` | `/v1/gigs/estimate` | Calculate a dynamic price estimate |
| `POST` | `/v1/gigs` | Client creates a gig and broadcasts it |
| `GET` | `/v1/gigs/nearby` | Worker fetches nearby open gigs |
| `POST` | `/v1/gigs/:gigId/accept` | Worker accepts an open gig |
| `PATCH` | `/v1/gigs/:gigId/status` | Advance gig lifecycle (EN_ROUTE → COMPLETED) |
| `GET` | `/v1/gigs/mine` | List gigs for current client or worker |
| `GET` | `/v1/admin/overview` | Admin operational summary |
| `POST` | `/v1/admin/commission` | Update platform commission rate |
| `GET` | `/health` | Liveness + Postgres/Redis checks |

## Local development

```bash
npm install
docker compose up -d postgres redis
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

## Deployment

**See [DEPLOY.md](./DEPLOY.md) for the full hosting guide** (Render, Railway, Docker, Expo EAS, env vars, and launch checklist).

Quick production build:

```bash
npm run build:api
cd apps/api && sh scripts/start.sh
```

- Shared package: unit tests for schemas and pricing helpers.
- API: service-level tests for pricing, gig state transitions, auth, and role authorization.
- Mobile: component tests for onboarding and gig posting forms.
- Admin: smoke tests for dashboard rendering and API integration.
- End-to-end: post gig -> broadcast -> accept -> payment authorization -> completion -> review.

## Testing strategy
