# Premium Entitlement Reconciler

A backend service that reconciles a user's premium subscription across three independent sales channels — an in-app **store**, a **mobile carrier**, and a third-party **marketplace** — and maintains a single canonical answer to:

> Is this user premium right now, and why?

It ingests store webhooks, polls the carrier on a schedule, accepts marketplace bulk revokes, exposes a read API, and schedules an at-most-once "your premium expires soon" notification.

## Stack

- **TypeScript / Node** (Express, raw `pg`, `zod` for validation)
- **Postgres** for storage and for the concurrency primitives (advisory locks, `FOR UPDATE SKIP LOCKED`)
- **Vitest** for tests, run against a real Postgres
- **Docker Compose** to boot the service, the database, the mock carrier, and two workers with one command

## Running it

### One command (Docker)

```bash
docker compose up --build
```

This boots:

- `db` — Postgres 16 (host port **5433** to avoid clashing with a local Postgres on 5432)
- `mock-carrier` — the stubbed carrier API on port **4000**
- `api` — the HTTP service on port **3000** (runs migrations on boot)
- `worker` — the carrier poller + notification worker, **2 replicas**, to demonstrate safe concurrent processing

The API and workers share one image; the API container owns the build.

### Local development

```bash
npm install
createdb reconciler                 # or point DATABASE_URL at any Postgres
export DATABASE_URL=postgres://localhost:5432/reconciler
npm run migrate                     # apply migrations
npm run mock-carrier &              # stub carrier on :4000
npm run dev                         # api + workers with reload
```

### Tests

```bash
npm test
```

Tests spin up against a real Postgres. By default they use `postgres://<you>@localhost:5432/reconciler_test` and create that database automatically; override with `DATABASE_URL`.

## API

### `POST /webhooks/store`

Ingests a store event. Idempotent on `eventId`; order-independent; safe for late delivery.

```bash
curl -X POST localhost:3000/webhooks/store -H 'content-type: application/json' -d '{
  "eventId":"evt_abc123","userId":"u_42","type":"INITIAL_PURCHASE",
  "eventTimeMs":1716700000000,"productId":"premium_monthly"
}'
```

`type` is one of `INITIAL_PURCHASE | RENEWAL | CANCELLATION | BILLING_ISSUE | EXPIRATION | UN_CANCELLATION`. Returns `202` for a newly applied event, `200` for a duplicate.

### `POST /webhooks/marketplace/revoke`

Revokes **only** marketplace-granted access for the listed users; store and carrier grants are untouched.

```bash
curl -X POST localhost:3000/webhooks/marketplace/revoke -H 'content-type: application/json' \
  -d '{"userIds":["u_42","u_91","u_133"]}'
```

### `POST /webhooks/marketplace/grant`

Grants marketplace access for the listed users. (Not in the original spec — the spec only describes the monthly bulk *revoke* — but a grant signal is required for a revoke to mean anything; see Design decisions.)

### `GET /users/:id/entitlement`

Returns the canonical entitlement.

```bash
curl localhost:3000/users/u_42/entitlement
```

```json
{
  "active": true,
  "source": "STORE",
  "expiresAt": "2026-06-10T00:00:00.000Z",
  "lastChangedAt": "2026-05-20T11:23:00.000Z",
  "reason": "RENEWAL"
}
```

`source` is `STORE | CARRIER | MARKETPLACE | NONE`.

### `POST /users/:id/carrier/enroll`

Registers a user as carrier-billed so the poller will include them. (Not in the original spec; see Design decisions.)

### `GET /users/:id/timeline` _(stretch)_

Returns the reconstructed history of the user's entitlement changes from the audit log.

```bash
curl localhost:3000/users/u_42/timeline
```

```json
{
  "userId": "u_42",
  "entries": [
    {
      "at": "2026-05-20T11:23:00.000Z",
      "eventId": "evt_abc123",
      "source": "STORE",
      "previous": null,
      "next": { "active": true, "source": "STORE", "expiresAt": "2026-06-19T11:23:00.000Z", "reason": "INITIAL_PURCHASE" }
    }
  ]
}
```

### Mock carrier — `GET /mock/carrier/plan?userId=...`

Served by the `mock-carrier` service. Randomised **85% active / 10% inactive / 5% api_error**. Accepts `?force=active|inactive|api_error` for deterministic local testing.

## How reconciliation works

Each channel writes only its own slice of state; the canonical entitlement is **derived**, never written directly by a channel:

| Source | Stored as | Expiry | Becomes active when |
| --- | --- | --- | --- |
| Store | the raw event log (`store_events`) | derived from the latest period | folded state is ACTIVE/CANCELED/BILLING_ISSUE and not past expiry |
| Carrier | `carrier_state.status` | none (indefinite) | last poll returned `active` |
| Marketplace | `marketplace_state.status` | none (indefinite) | granted and not revoked |

**Store state** is computed by folding all of a user's events in `(eventTimeMs, eventId)` order. Because the fold always runs over the full sorted log, the result is identical no matter what order events arrive in — duplicates are dropped at insert (`eventId` is the primary key), and a late event simply slots into its correct position on the next fold. The subscription period is inferred from `productId` (`*monthly*`→30d, `*year*`/`*annual*`→365d, `*week*`→7d, else 30d).

**Canonical selection** (`pickCanonical`): a user is premium if **any** source is active. Among active sources the winner is the one that keeps the user premium the longest — a `null` (indefinite) expiry beats any finite date, and finite dates compare by latest. Ties break by a fixed priority `STORE > MARKETPLACE > CARRIER`. If nothing is active the source is `NONE`.

Every reconcile runs inside a transaction guarded by `pg_advisory_xact_lock(hashtext(userId))`, so all changes for a given user serialize and the last writer always recomputes from committed source state.

## Concurrency

- **Carrier polling** runs on every worker. Users are claimed atomically with `UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED LIMIT n)`, which both selects and stamps `last_polled_at`, so two workers never poll the same user in the same cycle. An `api_error` leaves the stored status unchanged and is retried next cycle.
- **Notifications** are claimed the same way (`FOR UPDATE SKIP LOCKED`) before `sent_at` is set, so a notification is sent at most once even with many workers.
- **At-most-once scheduling** is enforced by a unique constraint on `(user_id, type, target_expires_at)`: re-running the scheduler or the periodic scan is a no-op, while a genuine renewal to a later expiry is a new episode and is allowed.

## Design decisions and tradeoffs

- **Event log as source of truth for the store.** Folding from the full log makes duplicate/out-of-order/late handling fall out for free and keeps the ingestion endpoint trivially idempotent, at the cost of recomputing on each event. For the volumes implied here that is fine; at scale you would snapshot folded state and fold only newer events.
- **Period inferred from `productId`.** The webhook carries no expiry, so the period is derived from the product. A real integration would carry the period/expiry on the event.
- **Longest-lived grant wins.** This makes `active` and `expiresAt` internally consistent ("premium until your last grant lapses"). The alternative — a fixed channel priority — would let a still-active carrier plan be hidden behind an expired store grant, which is wrong for the headline question. The tradeoff is that an active indefinite grant (carrier/marketplace) hides a finite store expiry, which also correctly suppresses a premature "expires soon" notification.
- **Marketplace grant + carrier enroll endpoints.** The spec only describes a marketplace *revoke* and carrier *polling*, but both imply a prior grant/enrolment that has to originate somewhere. Rather than seed rows by hand, those two endpoints make the system self-contained and testable.
- **Per-user advisory lock** instead of table locks keeps unrelated users fully parallel while still serializing each user's reconciliation.

## Stretch: audit log and timeline

Every time a user's canonical entitlement actually changes, the reconciler writes an `entitlement_audit` row inside the same transaction: the triggering store `event_id` (null for carrier/marketplace-driven changes), the new `source`, and the full previous and next state snapshots. `GET /users/:id/timeline` replays those rows in order. No-op reconciles (duplicates, idempotent re-grants) write nothing, so the timeline only contains real transitions.

## What I'd change with another week

- Snapshot folded store state instead of re-folding the whole log per event.
- Make carrier polling lease-based with a visibility timeout and a dead-letter for repeated `api_error`s, plus jittered scheduling across workers.
- Replace the in-process `setInterval` workers with a real queue (or `pg_cron` / a leader-elected scheduler) so cadence is independent of process count.
- Add structured logging, request tracing, and metrics (poll latency, reconcile counts, notification lag).
- Push notification idempotency further: an outbox row per delivery attempt with a provider message id.
- Contract tests for the carrier client and a fault-injecting mock (timeouts, malformed bodies).
