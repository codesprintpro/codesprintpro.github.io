---
title: "System Design: Building an Inventory Reservation System"
description: "Design a production inventory reservation system that prevents oversells across carts, checkout, payments, cancellations, and expirations with idempotency, hold timeouts, and operational recovery."
date: "2026-04-10"
category: "System Design"
tags: ["system design", "inventory", "ecommerce", "distributed systems", "idempotency", "databases", "payments"]
featured: false
affiliateSection: "system-design-courses"
---

Inventory looks easy until traffic spikes.

A product has 10 units. Ten customers should be able to buy it. The eleventh should not.

In practice, that clean rule gets blurred by carts, payment retries, partial failures, slow checkouts, reservation expiries, warehouse adjustments, split shipments, cancellations, and distributed services that do not commit together.

That is how teams end up with three bad outcomes:

- **oversell**: you sold inventory you do not actually have
- **undersell**: inventory is available but stuck in ghost reservations
- **inconsistent truth**: product page, checkout, warehouse, and finance all disagree

This guide designs a production inventory reservation system.

## Problem Statement

Build a platform that lets ecommerce and order systems reserve stock safely during checkout.

The system must support:

- showing sellable inventory
- creating temporary holds during cart / checkout
- confirming reservations after successful payment
- releasing reservations after timeout or cancellation
- handling concurrent purchases for the same SKU
- preventing duplicate holds on retries
- surviving service failures and delayed events

Examples:

- one user adds the last laptop to cart while another user starts checkout
- payment succeeds but order service times out before acknowledging
- warehouse adjusts stock after damage or manual count correction
- a flash sale creates massive contention on a few hot SKUs

This is not just a stock-counting problem. It is a **distributed consistency** problem with money and customer trust attached.

## Requirements

Functional requirements:

- track on-hand inventory per SKU and location
- compute sellable inventory
- create reservation holds with expiry
- confirm reservations into committed allocations
- release expired or cancelled reservations
- support idempotent retries
- support quantity updates
- expose inventory availability APIs
- publish inventory change events
- support warehouse adjustments and restocks

Non-functional requirements:

- prevent oversell
- low latency for reserve operation
- predictable behavior under high contention
- survive duplicate requests and at-least-once event delivery
- support auditability and replay
- isolate inventory by merchant / tenant / warehouse
- handle partial failures across payment and order flows

The most important invariant:

```text
sellable = on_hand - committed - active_reservations
sellable must never go below zero
```

If your design does not defend that invariant under retries, timeouts, and concurrent updates, it is not production-safe.

## Real-World Flow

A realistic purchase path looks like this:

1. product page asks for current availability
2. customer adds item to cart
3. checkout service requests reservation
4. reservation is held for 10 minutes
5. payment succeeds
6. reservation is confirmed into committed allocation
7. order service finalizes order
8. warehouse later fulfills shipment

Alternative paths:

- payment fails -> release reservation
- customer abandons checkout -> reservation expires
- order is cancelled after confirmation -> committed stock returns to available
- warehouse damage adjustment reduces on-hand -> active sellable count drops

This means inventory state cannot be represented by just one number.

## Inventory State Model

At minimum, each SKU needs these buckets:

- `on_hand`: physical units known to exist
- `reserved`: temporary holds not yet sold
- `committed`: sold / allocated to confirmed orders
- `available`: derived sellable units

Formula:

```text
available = on_hand - reserved - committed
```

Example:

```text
SKU: laptop-16gb
on_hand:     100
reserved:      8
committed:    74
available:    18
```

Do not store `available` as the only truth. It can be materialized or cached, but the real system needs the underlying buckets.

## Why Naive Designs Fail

### Naive design 1: decrement stock only after payment success

Problem:

- multiple users can start checkout for the same few units
- payment may succeed for more users than available stock

Result:

- oversell

### Naive design 2: decrement stock when item enters cart

Problem:

- carts are abandoned constantly
- stock gets stuck

Result:

- undersell

### Naive design 3: rely on cache counters alone

Problem:

- cache loss or stale invalidation corrupts truth
- race conditions under concurrent updates

Result:

- impossible-to-debug drift

The right model is:

- **temporary reservation during checkout**
- **confirmation after payment**
- **automatic release on timeout**

## Reservation Lifecycle

Think of a reservation like a hotel room hold.

The room is not sold yet, but it is temporarily unavailable to others.

State machine:

```text
REQUESTED
  -> RESERVED
  -> CONFIRMED
  -> RELEASED
  -> EXPIRED
  -> CANCELLED
```

Rules:

- only `RESERVED` stock counts against availability
- `CONFIRMED` stock moves into committed allocation
- `RELEASED`, `EXPIRED`, and `CANCELLED` free the stock

## Core API Design

```http
POST /v1/reservations
Idempotency-Key: checkout-cart-981-item-laptop-1
```

```json
{
  "tenantId": "merchant_42",
  "sku": "laptop-16gb",
  "warehouseId": "blr-1",
  "quantity": 1,
  "cartId": "cart_981",
  "customerId": "cust_77",
  "expiresInSeconds": 600
}
```

Response:

```json
{
  "reservationId": "res_123",
  "status": "RESERVED",
  "expiresAt": "2026-04-10T12:35:00Z"
}
```

Confirm reservation:

```http
POST /v1/reservations/res_123/confirm
```

Release reservation:

```http
POST /v1/reservations/res_123/release
```

Availability:

```http
GET /v1/inventory/laptop-16gb/availability?warehouseId=blr-1
```

## Data Model

### Inventory balance table

```sql
CREATE TABLE inventory_balances (
  tenant_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  on_hand INT NOT NULL,
  reserved INT NOT NULL DEFAULT 0,
  committed INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, sku, warehouse_id),
  CHECK (on_hand >= 0),
  CHECK (reserved >= 0),
  CHECK (committed >= 0),
  CHECK (on_hand - reserved - committed >= 0)
);
```

The `CHECK` constraints are not your only guardrail, but they are good last-line protection.

### Reservation table

```sql
CREATE TABLE inventory_reservations (
  reservation_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  cart_id TEXT,
  customer_id TEXT,
  quantity INT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payment_id TEXT,
  order_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX idx_inventory_reservations_active
  ON inventory_reservations (tenant_id, sku, warehouse_id, expires_at)
  WHERE status = 'RESERVED';
```

### Inventory event log

```sql
CREATE TABLE inventory_events (
  event_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  event_type TEXT NOT NULL,      -- restock, reserve, confirm, release, expire, adjust
  quantity INT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

This event log is crucial for audit, replay, debugging, and reconciliation.

## Reserve Operation

The hardest API is `reserve`, because many clients may try to reserve the same SKU concurrently.

The reserve transaction must:

1. verify enough sellable stock exists
2. increment `reserved`
3. create reservation row
4. write inventory event

All atomically.

### Transactional SQL example

```sql
BEGIN;

UPDATE inventory_balances
SET reserved = reserved + :quantity,
    version = version + 1,
    updated_at = now()
WHERE tenant_id = :tenant_id
  AND sku = :sku
  AND warehouse_id = :warehouse_id
  AND (on_hand - reserved - committed) >= :quantity;

-- Expect exactly one row updated. If 0, insufficient stock.

INSERT INTO inventory_reservations (
  reservation_id,
  tenant_id,
  sku,
  warehouse_id,
  cart_id,
  customer_id,
  quantity,
  status,
  idempotency_key,
  expires_at
) VALUES (
  :reservation_id,
  :tenant_id,
  :sku,
  :warehouse_id,
  :cart_id,
  :customer_id,
  :quantity,
  'RESERVED',
  :idempotency_key,
  :expires_at
);

INSERT INTO inventory_events (
  event_id,
  tenant_id,
  sku,
  warehouse_id,
  event_type,
  quantity,
  reference_type,
  reference_id
) VALUES (
  :event_id,
  :tenant_id,
  :sku,
  :warehouse_id,
  'reserve',
  :quantity,
  'reservation',
  :reservation_id
);

COMMIT;
```

The key trick is doing the stock check inside the `UPDATE` condition, not in a separate `SELECT`.

Bad:

```text
SELECT available
if available >= quantity:
  UPDATE ...
```

Two concurrent requests can both pass the read and both update.

Good:

```text
UPDATE ... WHERE available >= quantity
```

That makes the availability test part of the write.

## Application Service Example

```java
@Service
public class InventoryReservationService {

    @Transactional
    public ReservationResponse reserve(ReserveInventoryRequest request) {
        Optional<InventoryReservation> existing =
            reservationRepository.findByTenantIdAndIdempotencyKey(
                request.tenantId(),
                request.idempotencyKey()
            );

        if (existing.isPresent()) {
            return ReservationResponse.from(existing.get());
        }

        int updated = inventoryBalanceRepository.reserveIfAvailable(
            request.tenantId(),
            request.sku(),
            request.warehouseId(),
            request.quantity()
        );

        if (updated == 0) {
            throw new InsufficientInventoryException(request.sku());
        }

        InventoryReservation reservation = InventoryReservation.create(
            request.tenantId(),
            request.sku(),
            request.warehouseId(),
            request.cartId(),
            request.customerId(),
            request.quantity(),
            request.idempotencyKey(),
            Instant.now().plusSeconds(request.expiresInSeconds())
        );

        reservationRepository.save(reservation);
        inventoryEventRepository.save(InventoryEvent.reserve(reservation));

        return ReservationResponse.from(reservation);
    }
}
```

Idempotency is not optional here. Checkout retries happen all the time.

## Confirm Operation

Confirmation happens after payment success.

The confirm transaction should:

1. verify reservation is still `RESERVED`
2. decrement `reserved`
3. increment `committed`
4. mark reservation `CONFIRMED`
5. write event

```sql
BEGIN;

SELECT status, quantity
FROM inventory_reservations
WHERE reservation_id = :reservation_id
FOR UPDATE;

-- Must be RESERVED and not expired.

UPDATE inventory_balances
SET reserved = reserved - :quantity,
    committed = committed + :quantity,
    version = version + 1,
    updated_at = now()
WHERE tenant_id = :tenant_id
  AND sku = :sku
  AND warehouse_id = :warehouse_id;

UPDATE inventory_reservations
SET status = 'CONFIRMED',
    payment_id = :payment_id,
    order_id = :order_id,
    updated_at = now()
WHERE reservation_id = :reservation_id
  AND status = 'RESERVED';

INSERT INTO inventory_events (... event_type = 'confirm' ...);

COMMIT;
```

This must also be idempotent.

If the payment service retries the confirm call after a timeout, you should return the already confirmed state, not fail or double-commit.

## Release and Expiry

Reservations should not live forever.

Common TTLs:

- flash sale checkout: 2-5 minutes
- standard checkout: 10-15 minutes
- B2B quote or approval flows: longer, but usually with explicit workflow

Expiry handling pattern:

1. reservation row has `expires_at`
2. background worker scans expired `RESERVED` rows
3. worker releases stock transactionally
4. status becomes `EXPIRED`

```java
@Scheduled(fixedDelay = 5000)
public void expireReservations() {
    List<UUID> expiredIds = reservationRepository.findExpiredReservationIds(
        Instant.now(),
        1000
    );

    for (UUID reservationId : expiredIds) {
        try {
            expirationService.expireReservation(reservationId);
        } catch (Exception ex) {
            log.warn("Failed to expire reservation {}", reservationId, ex);
        }
    }
}
```

The expiration path should be safe to rerun repeatedly.

## Why Background Expiry Can Still Be Correct

A background job every few seconds means an expired reservation may still exist briefly.

That is okay if your read path computes active reservations using:

```text
status = RESERVED AND expires_at > now()
```

In other words:

- operational cleanup can lag slightly
- correctness should not depend only on cleanup speed

This distinction matters under outages.

## Availability Read Path

The read path is often far hotter than writes.

Options:

### Option 1: read directly from primary table

Simple and correct. Good starting point.

### Option 2: cached availability

Useful for product pages with huge read traffic.

But never make cache the only truth. Cache should be refreshed from transactional state or invalidated on changes.

Example response:

```json
{
  "sku": "laptop-16gb",
  "warehouseId": "blr-1",
  "onHand": 100,
  "reserved": 8,
  "committed": 74,
  "available": 18
}
```

For high-scale storefront reads, it is common to keep a Redis projection:

```text
inventory:merchant_42:laptop-16gb:blr-1 -> 18
```

But reserve/confirm/release must still happen against the database or another transactional source of truth.

## High Contention and Hot SKUs

Flash sales are where inventory systems go from "working" to "interesting."

Example:

- 500 units available
- 100,000 users try to buy within seconds

Failure modes:

- database row lock contention
- request timeouts
- retries amplifying the load
- ghost reservations if request handling is sloppy

Mitigations:

### 1. Queue reserve attempts for hot SKUs

Instead of every request hitting the same row at once:

```text
Checkout -> hot-SKU queue -> serialized reservation worker
```

Pros:

- smoother write path
- less lock thrashing

Cons:

- added queue latency
- more operational complexity

### 2. Partition by warehouse or stock pool

If one SKU is spread across warehouses, concurrent writes may hit different rows.

### 3. Fast fail once remaining stock is near zero

Expose "sold out" quickly rather than letting thousands of requests burn database resources for the same impossible outcome.

### 4. Rate limit retry storms

Checkout clients love retrying. Your inventory API should love them less.

## Payment and Order Integration

Inventory, payment, and order do not commit in one database transaction.

That means the workflow must be designed for partial failure.

### Recommended flow

1. reserve inventory
2. initiate payment
3. payment succeeds
4. confirm reservation
5. create order

This still leaves failure gaps:

- payment succeeded but confirm timed out
- reservation confirmed but order creation failed

You need recovery mechanisms.

## Saga-Style Recovery

Treat checkout as a saga.

```text
Reserve inventory
  -> Charge payment
      -> Confirm reservation
          -> Create order
```

Compensations:

- reservation failed -> stop checkout
- payment failed -> release reservation
- order creation failed after confirmation -> create recovery task, maybe refund or retry order creation

Do not depend on synchronous success of every downstream call.

## Outbox Pattern for Inventory Events

If you update inventory and publish an event in separate steps, you create dual-write risk.

Bad:

```java
inventoryRepository.confirm(...);
kafkaTemplate.send("inventory-events", event); // process may crash here
```

Good:

- transaction updates DB
- transaction writes outbox row
- separate relay publishes to Kafka

```sql
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
```

This lets search indexing, storefront projections, and analytics stay in sync without losing inventory events.

## Warehouse Adjustments

Real stock changes for many reasons outside checkout:

- restock
- damage
- cycle count correction
- shrinkage / theft
- inbound transfer
- outbound transfer

Treat these as explicit inventory events.

Example adjustment API:

```http
POST /v1/inventory/adjustments
```

```json
{
  "tenantId": "merchant_42",
  "sku": "laptop-16gb",
  "warehouseId": "blr-1",
  "delta": -2,
  "reason": "damaged_in_warehouse",
  "referenceId": "qc_report_991"
}
```

Rules:

- do not let adjustments silently violate invariants
- if reducing on-hand below `reserved + committed`, escalate operationally

Example:

```text
on_hand = 10
reserved = 3
committed = 7

damage adjustment = -2
new on_hand = 8
reserved + committed = 10
```

Now you have a stock deficit problem. The system should not quietly pretend everything is fine.

## Multi-Warehouse and Location Routing

Many systems do not reserve against one global stock bucket.

They reserve against:

- a specific warehouse
- a regional pool
- a fulfillment policy result

Example strategy:

1. find preferred warehouse by region and SLA
2. attempt reservation
3. fall back to alternate warehouse if policy allows

This means availability is not always one number. It can be:

- per warehouse
- per region
- per fulfillment method

## Soft Reservations vs Hard Reservations

Not every product needs the same strictness.

### Hard reservation

- stock is removed from sellable count immediately
- best for scarce items, limited drops, ticketing

### Soft reservation

- cart addition may not reserve immediately
- reservation happens only at checkout or payment initiation
- best for common catalog items

This is a product and business decision, not only a technical one.

## Oversell Prevention Strategies

There are several common patterns:

### 1. Strong transactional reservation

Best correctness, higher contention.

### 2. Deliberate oversell buffer

Some businesses accept small oversell risk because cancellations or failed payments offset it.

Example:

```text
physical stock = 100
sellable stock exposed = 102
```

This is common in travel, fashion, or imperfect warehouse environments.

Use it only intentionally, with business approval.

### 3. Segmented stock pools

Keep a protected allocation for specific sales channels.

Example:

- website: 70 units
- marketplace: 20 units
- store pickup: 10 units

This reduces cross-channel oversell.

## Audit and Reconciliation

Inventory disputes are normal:

- customer says item was in stock
- warehouse says there was none
- finance sees order refunded
- support sees confirmed order

You need to answer:

- who reserved the stock?
- when did it expire or confirm?
- which payment/order references were attached?
- what adjustments happened afterward?

That is why event history matters.

Useful reconciliation query:

```sql
SELECT event_type, quantity, reference_type, reference_id, created_at
FROM inventory_events
WHERE tenant_id = 'merchant_42'
  AND sku = 'laptop-16gb'
  AND warehouse_id = 'blr-1'
ORDER BY created_at ASC;
```

This is also where inventory ties into payment/order reconciliation.

## Failure Modes

### 1. Payment succeeds after reservation expiry

Fix:

- confirm endpoint checks reservation status and expiry
- recovery workflow decides whether to re-reserve, backorder, or refund

### 2. Duplicate reserve request on client retry

Fix:

- idempotency key unique constraint

### 3. Expiry worker down for 30 minutes

Fix:

- availability logic should respect `expires_at`
- worker recovery should be replay-safe

### 4. Cache says available, DB says sold out

Fix:

- reserve path trusts DB, not cache
- cache is advisory only

### 5. Manual stock adjustment creates negative sellable state

Fix:

- adjustment validation
- operational deficit case creation

### 6. Confirm succeeds, order service fails

Fix:

- saga recovery task
- retry order creation
- manual operations queue if needed

## Observability

Track more than just available stock.

Metrics:

- reservation success rate
- insufficient inventory rate
- reservation latency p95 / p99
- active reservations count
- expired reservations per minute
- ghost reservation cleanup count
- confirmation failure rate
- inventory drift incidents
- hot SKU contention metrics

Dashboards should answer:

- which SKUs are hottest
- which warehouses are drifting
- whether expiry cleanup is delayed
- how much stock is currently reserved vs committed

## What I Would Build First

Phase 1:

- single-warehouse inventory balance table
- reserve / confirm / release APIs
- reservation expiry worker
- event log
- idempotency

Phase 2:

- outbox event publishing
- cached availability projection
- recovery workflows for payment/order gaps
- operations dashboard

Phase 3:

- multi-warehouse routing
- hot-SKU queueing
- channel stock pools
- advanced reconciliation and anomaly detection

This order matters. Teams often jump into distributed cache and event fanout before they have correct transactional reservation semantics.

## Production Checklist

- invariant enforced: `on_hand - reserved - committed >= 0`
- reserve path atomic
- confirm/release idempotent
- reservation expiry automated
- availability cache not treated as source of truth
- event log retained
- outbox used for publishing inventory changes
- stock adjustments audited
- recovery flow exists for payment/order mismatch
- hot-SKU contention tested before major sale

## Final Takeaway

An inventory reservation system is not just stock accounting.

It is the guardrail between customer intent and physical reality.

If you design it well, customers see honest availability, checkout stays trustworthy, and operations can explain every unit.

If you design it poorly, you sell what you do not have, or worse, hide what you do.

## Read Next

- [Idempotency Keys in APIs: Retries, Duplicate Requests, and Exactly-Once Illusions](/blog/api-idempotency-keys/)
- [System Design: Building a Payment Reconciliation Engine](/blog/system-design-payment-reconciliation-engine/)
- [Transactional Outbox Pattern: Reliable Event Publishing Without Dual Writes](/blog/transactional-outbox-pattern/)
