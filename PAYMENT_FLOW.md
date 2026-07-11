# GIGFLOW Payment Flow v2

## Principle

**Posting a gig is free.** Payment happens only after the customer selects a worker.

## Status flow

```
POSTED
  → workers express interest
  → WORKER_SELECTED (customer picks worker)
  → PAYMENT_AUTHORIZED (Stripe hold — gig status becomes WORKER_ASSIGNED)
  → WORKER_EN_ROUTE → WORKER_ARRIVED → IN_PROGRESS
  → WAITING_EXTRA_TIME_APPROVAL (estimate + timer only, optional)
  → WAITING_CUSTOMER_CONFIRMATION (worker ended job)
  → COMPLETED (customer approves → Stripe capture → worker earnings)
```

## API endpoints

| Endpoint | Role | Purpose |
|----------|------|---------|
| `POST /v1/gigs` | Client | Post gig (free, status `POSTED`) |
| `POST /v1/gigs/:id/accept` | Worker | Express interest |
| `GET /v1/gigs/:id/interests` | Client | List interested workers |
| `POST /v1/gigs/:id/select-worker` | Client | Select worker → `WORKER_SELECTED` |
| `POST /v1/payments/payment-intent` | Client | Authorize card after worker selection |
| `PATCH /v1/gigs/:id/status` | Worker | Lifecycle + GPS (`latitude`, `longitude`) |
| `POST /v1/gigs/:id/approve-extra-time` | Client | Approve 15–480 extra minutes |
| `POST /v1/gigs/:id/approve-completion` | Client | Capture payment + complete gig |

## Mobile screens

- **Post gig** → `GigSelectWorkers`
- **Select worker** → `GigPayment` (Confirm & pay)
- **After worker ends** → `GigCompletionReview`

## Auto-completion

Gigs in `WAITING_CUSTOMER_CONFIRMATION` for 24+ hours auto-approve hourly (API background job).

## Pricing types

- `FIXED` — no timer
- `HOURLY` — timer, 15-min rounding, 1-hour minimum
- `ESTIMATE_TIMER` — pauses at booked hours, requires customer approval to continue
