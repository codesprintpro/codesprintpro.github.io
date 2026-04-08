---
title: "System Design: Building a Usage Metering and Billing Platform"
description: "Design a production usage metering and billing platform: event ingestion, idempotency, aggregation, pricing, quotas, invoices, reconciliation, audit logs, backfills, and failure recovery for SaaS products."
date: "2026-04-08"
category: "System Design"
tags: ["system design", "billing", "usage metering", "idempotency", "saas", "event driven architecture", "distributed systems"]
featured: false
affiliateSection: "system-design-courses"
---

Usage-based billing looks straightforward: count what the customer used and charge them for it.

In production, it becomes one of the most sensitive systems in the company. If usage is undercounted, you lose revenue. If it is overcounted, customers lose trust. If invoices are wrong, support and finance teams spend days reconciling. If quota enforcement uses stale data, customers either get blocked incorrectly or exceed their contract.

This guide designs a production usage metering and billing platform for SaaS products: event ingestion, idempotency, aggregation, pricing, quotas, invoices, reconciliation, audit logs, backfills, and failure recovery.

## Requirements

Functional requirements:

- ingest usage events from product services
- deduplicate repeated events
- aggregate usage by customer, product, feature, and time window
- support pricing rules
- support quotas and overage alerts
- generate invoices
- support backfills and corrections
- expose usage dashboards to customers
- provide audit trails for finance and support

Non-functional requirements:

- no double charging
- tolerate delayed and duplicate events
- support high write volume
- keep raw events for reconciliation
- make aggregation reproducible
- support customer-specific pricing
- isolate tenants
- preserve auditability
- degrade safely during dependency outages

Billing correctness is not the same as request-path availability. You can often accept usage events asynchronously and reconcile later, but you must never silently drop or double count them.

## High-Level Architecture

```text
Product services
  |
  +-- emit usage events
        |
        v
Usage ingestion API / stream
  |
  +-- validate event
  +-- enforce idempotency
  +-- persist raw event
        |
        v
Aggregation pipeline
  |
  +-- minute/hour/day usage buckets
  +-- quota counters
  +-- customer usage views
        |
        v
Billing engine
  |
  +-- pricing rules
  +-- invoice line items
  +-- adjustments
  +-- reconciliation
```

Keep raw events. Aggregates are derived data. If pricing changes, a bug is found, or a customer disputes usage, raw events are your source of truth.

## Usage Event Schema

A practical usage event:

```json
{
  "eventId": "evt_01JABC",
  "tenantId": "tenant_123",
  "customerId": "cus_456",
  "product": "ai-platform",
  "meter": "llm_output_tokens",
  "quantity": 1842,
  "unit": "token",
  "occurredAt": "2026-04-08T10:15:30Z",
  "source": {
    "service": "inference-api",
    "requestId": "req_789",
    "region": "us-east-1"
  },
  "attributes": {
    "model": "configured-chat-model",
    "environment": "production"
  }
}
```

Important fields:

- `eventId`: stable idempotency key
- `tenantId`: isolation boundary
- `customerId`: billing entity
- `meter`: what is being measured
- `quantity`: numeric usage
- `occurredAt`: when usage happened
- `source.requestId`: traceability back to product systems

Do not use ingestion time as the usage time unless the business explicitly wants that. Delayed events are normal.

## Raw Event Storage

```sql
CREATE TABLE usage_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  product TEXT NOT NULL,
  meter TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  source JSONB NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}',
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_events_customer_time
  ON usage_events (tenant_id, customer_id, occurred_at DESC);

CREATE INDEX idx_usage_events_meter_time
  ON usage_events (tenant_id, meter, occurred_at DESC);
```

The primary key on `event_id` gives ingestion idempotency. If the same event is retried, the insert should not double count it.

In high-volume systems, raw events often land in Kafka or object storage first, then are compacted into a queryable store. The conceptual model is the same: immutable raw events first, derived aggregates second.

## Idempotent Ingestion

```ts
export async function ingestUsageEvent(event: UsageEvent): Promise<void> {
  validateUsageEvent(event);

  try {
    await db.usageEvents.insert({
      eventId: event.eventId,
      tenantId: event.tenantId,
      customerId: event.customerId,
      product: event.product,
      meter: event.meter,
      quantity: event.quantity,
      unit: event.unit,
      occurredAt: event.occurredAt,
      source: event.source,
      attributes: event.attributes ?? {},
    });

    await usageAggregationQueue.enqueue({
      eventId: event.eventId,
      tenantId: event.tenantId,
      occurredAt: event.occurredAt,
    });
  } catch (error) {
    if (isUniqueViolation(error, "usage_events_pkey")) {
      return; // duplicate retry, already accepted
    }

    throw error;
  }
}
```

Do not aggregate before the raw event insert succeeds. If the process crashes after aggregation but before raw storage, reconciliation becomes much harder.

## Aggregation Buckets

Aggregate into time buckets for queries and quotas:

```sql
CREATE TABLE usage_hourly_buckets (
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  product TEXT NOT NULL,
  meter TEXT NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id, product, meter, bucket_start)
);
```

Aggregation update:

```sql
INSERT INTO usage_hourly_buckets (
  tenant_id,
  customer_id,
  product,
  meter,
  bucket_start,
  quantity
)
VALUES (
  :tenant_id,
  :customer_id,
  :product,
  :meter,
  date_trunc('hour', :occurred_at),
  :quantity
)
ON CONFLICT (tenant_id, customer_id, product, meter, bucket_start)
DO UPDATE SET
  quantity = usage_hourly_buckets.quantity + EXCLUDED.quantity,
  updated_at = now();
```

This is simple, but it has a trap: if the same raw event is processed twice by the aggregator, the bucket increments twice. To avoid that, track processed events.

## Idempotent Aggregation

```sql
CREATE TABLE processed_usage_events (
  event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Aggregator transaction:

```sql
BEGIN;

INSERT INTO processed_usage_events (event_id)
VALUES (:event_id)
ON CONFLICT DO NOTHING;

-- Check whether the insert happened before updating buckets.
-- In application code, skip aggregation if no row was inserted.

INSERT INTO usage_hourly_buckets (...)
VALUES (...)
ON CONFLICT (...) DO UPDATE SET
  quantity = usage_hourly_buckets.quantity + EXCLUDED.quantity,
  updated_at = now();

COMMIT;
```

The raw event table deduplicates ingestion. The processed table deduplicates aggregation. You need both if ingestion and aggregation are decoupled.

## Pricing Rules

Pricing is business logic. Keep it versioned.

```sql
CREATE TABLE pricing_plans (
  plan_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  version INT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Example config:

```json
{
  "currency": "USD",
  "meters": {
    "llm_output_tokens": {
      "included": 1000000,
      "tiers": [
        { "upTo": 5000000, "pricePerUnit": 0.000002 },
        { "upTo": null, "pricePerUnit": 0.0000015 }
      ]
    },
    "storage_gb_month": {
      "included": 100,
      "tiers": [
        { "upTo": null, "pricePerUnit": 0.08 }
      ]
    }
  }
}
```

Do not overwrite pricing rules in place. Invoices must be reproducible months later.

## Invoice Generation

Invoice generation reads usage buckets for a billing period and applies pricing:

```ts
export async function generateInvoice(input: {
  tenantId: string;
  customerId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<Invoice> {
  const idempotencyKey = [
    input.tenantId,
    input.customerId,
    input.periodStart.toISOString(),
    input.periodEnd.toISOString(),
  ].join(":");

  return invoiceRepository.createOnce(idempotencyKey, async () => {
    const usage = await usageRepository.sumUsage(input);
    const pricing = await pricingRepository.findEffectivePlan(input.customerId, input.periodStart);
    const lineItems = priceUsage(usage, pricing);

    return invoiceRepository.create({
      ...input,
      lineItems,
      pricingPlanVersion: pricing.version,
    });
  });
}
```

Invoice generation must be idempotent. A retry should return the same invoice, not create a second invoice for the same period.

## Quotas And Near Real-Time Counters

Billing aggregates can be eventually consistent. Quota enforcement may need fresher counters.

Pattern:

```text
usage event -> raw event store -> aggregation
                         |
                         +-> quota counter update
```

Quota counter:

```sql
CREATE TABLE quota_counters (
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  meter TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id, meter, window_start)
);
```

Quota decisions should define failure behavior:

- fail open: allow usage if quota service is unavailable
- fail closed: block usage if quota service is unavailable
- degraded: allow small bounded usage and alert

For paid production features, degraded mode is often better than either extreme.

## Late And Corrected Events

Late events happen:

- mobile clients reconnect
- batch jobs replay
- upstream services recover
- regions reconnect after outage

Define a lateness window. Example:

```text
events up to 72 hours late update normal aggregates
events older than 72 hours go to adjustment workflow
```

Corrections should be explicit:

```json
{
  "eventId": "evt_adjust_123",
  "type": "ADJUSTMENT",
  "tenantId": "tenant_123",
  "customerId": "cus_456",
  "meter": "llm_output_tokens",
  "quantity": -1842,
  "reason": "duplicate upstream request incorrectly metered",
  "relatedEventId": "evt_01JABC"
}
```

Never delete raw usage events to "fix" billing. Append corrections.

## Reconciliation

Reconciliation compares independent sources:

```text
raw usage events -> aggregate buckets -> invoice line items
```

Checks:

- sum raw events by period equals aggregate buckets
- aggregate buckets match invoice line items
- invoice period uses correct pricing plan version
- duplicate event count is stable
- late event adjustments are included

Example query:

```sql
SELECT
  e.tenant_id,
  e.customer_id,
  e.meter,
  date_trunc('hour', e.occurred_at) AS bucket_start,
  sum(e.quantity) AS raw_quantity,
  b.quantity AS bucket_quantity,
  sum(e.quantity) - b.quantity AS delta
FROM usage_events e
JOIN usage_hourly_buckets b
  ON b.tenant_id = e.tenant_id
 AND b.customer_id = e.customer_id
 AND b.meter = e.meter
 AND b.bucket_start = date_trunc('hour', e.occurred_at)
WHERE e.occurred_at >= :start
  AND e.occurred_at < :end
GROUP BY e.tenant_id, e.customer_id, e.meter, bucket_start, b.quantity
HAVING sum(e.quantity) <> b.quantity;
```

Run reconciliation continuously, not only at month end.

## Customer Usage API

Customers want to see usage before the invoice arrives.

```http
GET /v1/usage?meter=llm_output_tokens&period=current_month
```

Response:

```json
{
  "customerId": "cus_456",
  "periodStart": "2026-04-01T00:00:00Z",
  "periodEnd": "2026-05-01T00:00:00Z",
  "meter": "llm_output_tokens",
  "quantity": 1842000,
  "included": 1000000,
  "estimatedOverage": 842000,
  "lastUpdatedAt": "2026-04-08T10:20:00Z"
}
```

Be honest about freshness. Usage dashboards are often eventually consistent. Show `lastUpdatedAt`.

## Auditability

Billing systems need audit trails:

- pricing plan changes
- invoice generation
- manual adjustments
- quota overrides
- customer contract changes
- backfills
- reconciliation failures

Audit event:

```json
{
  "eventId": "audit_123",
  "actorId": "finance_user_1",
  "action": "BILLING_ADJUSTMENT_CREATED",
  "tenantId": "tenant_123",
  "customerId": "cus_456",
  "resourceId": "adj_789",
  "reason": "Customer support correction for duplicate usage",
  "createdAt": "2026-04-08T10:15:30Z"
}
```

Every manual adjustment should have a reason and actor.

## Failure Modes

**Duplicate events.** Retries replay events and cause overbilling if event IDs are not stable.

**Dropped events.** Product service emits usage synchronously to a down billing service and loses data.

**Double aggregation.** Aggregator retries after partial success and increments buckets twice.

**Late events after invoice.** Usage arrives after the billing period closed and needs adjustment handling.

**Pricing changed in place.** Old invoices cannot be reproduced.

**Quota counter drift.** Quota service says a customer is under limit while billing aggregate says otherwise.

**Backfill overload.** Reprocessing months of usage competes with real-time ingestion.

**Manual adjustment without audit.** Finance cannot explain an invoice difference later.

## Production Checklist

- Use stable event IDs.
- Store immutable raw usage events.
- Deduplicate ingestion and aggregation separately.
- Keep pricing rules versioned and time-bounded.
- Generate invoices idempotently.
- Append corrections instead of deleting usage.
- Define late-event policy.
- Run continuous reconciliation.
- Show usage freshness to customers.
- Keep quota behavior explicit during outages.
- Audit pricing, invoice, adjustment, and quota changes.
- Isolate backfills from real-time ingestion.
- Monitor duplicate rate, ingestion lag, aggregation lag, and reconciliation deltas.
- Never trust aggregate tables as the only source of truth.

## Read Next

- [Idempotency Keys in APIs](/blog/api-idempotency-keys/)
- [Transactional Outbox Pattern](/blog/transactional-outbox-pattern/)
- [System Design: Building an Audit Log System](/blog/system-design-audit-log-system/)
- [Time-Series Databases: InfluxDB, TimescaleDB, and Prometheus](/blog/time-series-databases/)
