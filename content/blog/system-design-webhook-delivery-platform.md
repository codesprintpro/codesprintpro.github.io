---
title: "System Design: Building a Webhook Delivery Platform"
description: "Design a production webhook delivery platform with event ingestion, outbox persistence, retries, exponential backoff, signing, endpoint secrets, idempotency, rate limits, dead-letter queues, replay, observability, and tenant isolation."
date: "2026-04-08"
category: "System Design"
tags: ["system design", "webhooks", "event driven architecture", "idempotency", "retries", "distributed systems", "backend engineering"]
featured: false
affiliateSection: "system-design-courses"
---

Webhooks look simple from the outside: "When something happens, send an HTTP POST to the customer's URL."

In production, that sentence becomes a distributed delivery system. Customers have slow endpoints, invalid TLS certificates, flaky DNS, expired secrets, rate limits, firewalls, duplicate deliveries, and payloads that grow over time. Your own system has deploys, retries, backfills, schema changes, and outages. A good webhook platform absorbs that mess without losing events or taking down your core product path.

This guide designs a production webhook delivery platform: event ingestion, durable storage, delivery workers, retries, signing, endpoint configuration, idempotency, replay, dead-letter queues, observability, and tenant isolation.

## Requirements

Functional requirements:

- customers can create webhook endpoints
- customers can subscribe endpoints to event types
- product services can publish webhook events
- platform delivers events to customer URLs
- platform retries failed deliveries
- customers can verify event authenticity
- customers can inspect delivery history
- customers can replay failed events
- admins can pause or disable broken endpoints

Non-functional requirements:

- do not slow down the core product transaction
- do not lose committed events
- deliver at-least-once
- tolerate customer endpoint failures
- prevent retry storms
- isolate noisy tenants
- support schema evolution
- keep delivery history queryable
- provide clear observability and audit trails

At-least-once delivery is the right default. Exactly-once webhook delivery over HTTP is not realistic. Customers must handle duplicates, and your platform should make that easy with stable event IDs and signatures.

## High-Level Architecture

```text
Product service
  |
  +-- writes business transaction
  +-- writes webhook outbox row
        |
        v
Webhook publisher
  |
  +-- event store
  +-- subscription resolver
  +-- delivery queue
        |
        v
Delivery workers
  |
  +-- sign payload
  +-- POST customer endpoint
  +-- record attempt
  +-- schedule retry or mark delivered
```

The core product path writes an event durably, then returns. Actual HTTP delivery happens asynchronously. This prevents one slow customer endpoint from slowing down your checkout, billing, user, or order service.

## Event Model

A webhook event should be stable, versioned, and self-describing.

```json
{
  "id": "evt_01J5X8N9P7",
  "type": "invoice.paid",
  "version": "2026-04-08",
  "tenantId": "tenant_123",
  "createdAt": "2026-04-08T10:15:30Z",
  "data": {
    "invoiceId": "inv_456",
    "customerId": "cus_789",
    "amount": 4999,
    "currency": "USD"
  }
}
```

Keep the top-level envelope consistent. Evolve the `data` shape by event type and version.

Useful fields:

- `id`: stable event ID for idempotency
- `type`: event name, such as `invoice.paid`
- `version`: payload contract version
- `tenantId`: owner of the event
- `createdAt`: event creation time
- `data`: event-specific payload

Do not put every internal field into the webhook payload. Webhooks are public contracts. Once customers depend on a field, removing it becomes a migration.

## Endpoint And Subscription Model

Customers need endpoints and subscriptions.

```sql
CREATE TABLE webhook_endpoints (
  endpoint_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  url TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  max_attempts INT NOT NULL DEFAULT 8,
  timeout_ms INT NOT NULL DEFAULT 10000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_subscriptions (
  subscription_id UUID PRIMARY KEY,
  endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(endpoint_id),
  tenant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (endpoint_id, event_type)
);

CREATE INDEX idx_webhook_subscriptions_type
  ON webhook_subscriptions (tenant_id, event_type)
  WHERE enabled = true;
```

Store a hash of the secret, not the raw secret, unless you need to display it again. If you must sign payloads later, store the secret encrypted with a key management system and restrict access to delivery workers.

## Durable Event Storage

Webhook events should be durable before delivery starts.

```sql
CREATE TABLE webhook_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_version TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_events_tenant_time
  ON webhook_events (tenant_id, created_at DESC);
```

For each subscribed endpoint, create a delivery row:

```sql
CREATE TABLE webhook_deliveries (
  delivery_id UUID PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES webhook_events(event_id),
  endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(endpoint_id),
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_status_code INT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, endpoint_id)
);

CREATE INDEX idx_webhook_deliveries_due
  ON webhook_deliveries (status, next_attempt_at)
  WHERE status IN ('PENDING', 'RETRY');

CREATE INDEX idx_webhook_deliveries_endpoint_time
  ON webhook_deliveries (tenant_id, endpoint_id, created_at DESC);
```

The `UNIQUE (event_id, endpoint_id)` constraint prevents duplicate delivery rows if the publisher retries subscription resolution.

## Publishing With The Outbox Pattern

The product service should not publish webhooks directly to customer URLs.

Instead:

```java
@Transactional
public Invoice markInvoicePaid(String invoiceId) {
    Invoice invoice = invoiceRepository.markPaid(invoiceId);

    webhookOutboxRepository.save(WebhookOutboxEvent.builder()
        .eventId("evt_" + idGenerator.next())
        .tenantId(invoice.getTenantId())
        .eventType("invoice.paid")
        .payloadVersion("2026-04-08")
        .payload(toJson(invoicePaidPayload(invoice)))
        .build());

    return invoice;
}
```

The outbox publisher reads committed rows and moves them into the webhook platform:

```java
public void publishOutboxBatch() {
    List<WebhookOutboxEvent> batch = outboxRepository.lockNextBatch(100);

    for (WebhookOutboxEvent event : batch) {
        try {
            webhookEventStore.createEvent(event);
            outboxRepository.markPublished(event.getId());
        } catch (DuplicateEventException alreadyPublished) {
            outboxRepository.markPublished(event.getId());
        } catch (Exception e) {
            outboxRepository.incrementRetry(event.getId(), e.getMessage());
        }
    }
}
```

This keeps the product transaction and the "event must be delivered" fact in the same database commit.

## Resolving Subscriptions

When a webhook event is created, resolve subscriptions:

```sql
INSERT INTO webhook_deliveries (
  delivery_id,
  event_id,
  endpoint_id,
  tenant_id,
  status,
  next_attempt_at
)
SELECT
  gen_random_uuid(),
  :event_id,
  s.endpoint_id,
  s.tenant_id,
  'PENDING',
  now()
FROM webhook_subscriptions s
JOIN webhook_endpoints e ON e.endpoint_id = s.endpoint_id
WHERE s.tenant_id = :tenant_id
  AND s.event_type = :event_type
  AND s.enabled = true
  AND e.status = 'ACTIVE'
ON CONFLICT (event_id, endpoint_id) DO NOTHING;
```

This can run synchronously inside the webhook platform after event creation, or asynchronously in a subscription resolver worker. For high-volume systems, keep this step asynchronous so event ingestion stays fast.

## Delivery Worker

A delivery worker claims due deliveries, posts them to customer endpoints, and records attempts.

```ts
type Delivery = {
  deliveryId: string;
  eventId: string;
  endpointId: string;
  tenantId: string;
  url: string;
  secret: string;
  payload: unknown;
  attemptCount: number;
  maxAttempts: number;
  timeoutMs: number;
};

export async function deliverWebhook(delivery: Delivery): Promise<void> {
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signWebhook({
    secret: delivery.secret,
    timestamp,
    body,
  });

  const startedAt = Date.now();

  try {
    const response = await fetch(delivery.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "CodeSprintPro-Webhooks/1.0",
        "x-webhook-event-id": delivery.eventId,
        "x-webhook-delivery-id": delivery.deliveryId,
        "x-webhook-timestamp": timestamp,
        "x-webhook-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(delivery.timeoutMs),
    });

    await recordAttempt({
      deliveryId: delivery.deliveryId,
      statusCode: response.status,
      latencyMs: Date.now() - startedAt,
      responseBodyPreview: await safePreview(response),
    });

    if (response.status >= 200 && response.status < 300) {
      await markDelivered(delivery.deliveryId);
      return;
    }

    if (isRetryableStatus(response.status)) {
      await scheduleRetry(delivery, `HTTP ${response.status}`);
    } else {
      await markFailed(delivery.deliveryId, `Non-retryable HTTP ${response.status}`);
    }
  } catch (error) {
    await recordAttempt({
      deliveryId: delivery.deliveryId,
      statusCode: null,
      latencyMs: Date.now() - startedAt,
      responseBodyPreview: null,
      error: error instanceof Error ? error.message : "unknown error",
    });

    await scheduleRetry(delivery, error instanceof Error ? error.message : "delivery failed");
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}
```

Do not retry all 4xx responses. A `400`, `401`, `403`, or `404` usually means the customer needs to fix configuration. Retrying those forever wastes capacity.

## Signing Webhooks

Customers need to verify that a webhook came from you and was not modified.

Use HMAC with a timestamp:

```ts
import crypto from "crypto";

export function signWebhook(input: {
  secret: string;
  timestamp: string;
  body: string;
}): string {
  const payload = `${input.timestamp}.${input.body}`;
  const digest = crypto
    .createHmac("sha256", input.secret)
    .update(payload)
    .digest("hex");

  return `v1=${digest}`;
}

export function verifyWebhook(input: {
  secret: string;
  timestamp: string;
  body: string;
  signatureHeader: string;
  toleranceSeconds?: number;
}): boolean {
  const toleranceSeconds = input.toleranceSeconds ?? 300;
  const now = Math.floor(Date.now() / 1000);
  const timestamp = Number(input.timestamp);

  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > toleranceSeconds) {
    return false;
  }

  const expected = signWebhook({
    secret: input.secret,
    timestamp: input.timestamp,
    body: input.body,
  });

  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(input.signatureHeader)
  );
}
```

The timestamp prevents replay attacks with old payloads. The timing-safe comparison prevents leaking signature information through string comparison timing.

## Retry Policy

Retries should be slow enough to avoid storms and fast enough to recover from temporary outages.

Example schedule:

| Attempt | Delay |
|---|---|
| 1 | immediate |
| 2 | 30 seconds |
| 3 | 2 minutes |
| 4 | 10 minutes |
| 5 | 30 minutes |
| 6 | 2 hours |
| 7 | 6 hours |
| 8 | 24 hours |

Implementation:

```ts
const RETRY_DELAYS_SECONDS = [30, 120, 600, 1800, 7200, 21600, 86400];

export function nextRetryAt(attemptCount: number): Date | null {
  const index = attemptCount - 1;
  const delay = RETRY_DELAYS_SECONDS[index];
  if (delay === undefined) {
    return null;
  }

  const jitter = Math.floor(Math.random() * Math.min(delay * 0.2, 300));
  return new Date(Date.now() + (delay + jitter) * 1000);
}
```

Add jitter. If a customer endpoint is down for 30 minutes and you retry all failed deliveries at exactly the same moment, you create your own retry storm.

## Dead-Letter Queue

After max attempts, move the delivery to a terminal state:

```ts
async function scheduleRetry(delivery: Delivery, reason: string): Promise<void> {
  const next = nextRetryAt(delivery.attemptCount + 1);

  if (!next || delivery.attemptCount + 1 >= delivery.maxAttempts) {
    await markDeadLettered(delivery.deliveryId, reason);
    return;
  }

  await updateDeliveryRetry({
    deliveryId: delivery.deliveryId,
    nextAttemptAt: next,
    lastError: reason,
  });
}
```

Dead-lettered does not mean deleted. It means automatic delivery stopped and the customer or operator needs to act.

Show customers:

- endpoint URL
- event ID
- event type
- attempt count
- last status code
- last error
- next retry time or terminal state
- replay button

## Replay

Replay should create a new delivery attempt, not mutate history.

```sql
CREATE TABLE webhook_replay_requests (
  replay_id UUID PRIMARY KEY,
  delivery_id UUID NOT NULL REFERENCES webhook_deliveries(delivery_id),
  requested_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Replay rules:

- only replay events inside retention
- require endpoint to be active
- require permission
- keep the original event ID
- create new attempt history
- rate-limit replay batches

Keeping the original event ID lets customers preserve idempotency behavior.

## Tenant Isolation

One noisy tenant should not starve everyone.

Controls:

- per-tenant delivery queues
- per-endpoint concurrency limits
- global worker pool with fair scheduling
- rate limits by endpoint and tenant
- max payload size
- max subscriptions per endpoint
- max endpoints per tenant

Example concurrency rule:

```ts
type EndpointLimit = {
  endpointId: string;
  maxInFlight: number;
};

async function canClaimDelivery(endpointId: string, limit: EndpointLimit): Promise<boolean> {
  const inFlight = await countInFlightDeliveries(endpointId);
  return inFlight < limit.maxInFlight;
}
```

Without endpoint-level concurrency limits, a single slow endpoint can occupy many workers with long timeouts.

## Observability

Metrics:

- `webhook_events_created_total`
- `webhook_deliveries_attempted_total`
- `webhook_deliveries_succeeded_total`
- `webhook_deliveries_failed_total`
- `webhook_delivery_latency_ms`
- `webhook_delivery_attempt_count`
- `webhook_delivery_lag_seconds`
- `webhook_dead_lettered_total`
- `webhook_replay_requests_total`

Dimensions:

- tenant ID
- event type
- endpoint status
- HTTP status class
- failure reason

Trace:

```text
webhook.publish
  create_event
  resolve_subscriptions
  enqueue_deliveries

webhook.deliver
  claim_delivery
  sign_payload
  http_post_customer_endpoint
  record_attempt
  mark_delivered_or_retry
```

Structured attempt log:

```json
{
  "event": "webhook_delivery_attempt",
  "deliveryId": "del_123",
  "eventId": "evt_456",
  "tenantId": "tenant_abc",
  "endpointId": "end_789",
  "attempt": 3,
  "statusCode": 500,
  "latencyMs": 2084,
  "nextAttemptAt": "2026-04-08T11:30:00Z"
}
```

Do not log full response bodies by default. Store a small preview with a size limit and redact obvious secrets.

## Operational Controls

Add controls for support and operations:

- pause endpoint
- resume endpoint
- rotate secret
- resend one delivery
- replay a time range
- disable an event subscription
- mark endpoint unhealthy after repeated failures
- notify customer after failure threshold
- cap retry volume during incidents

Pause should stop future attempts without deleting history:

```sql
UPDATE webhook_endpoints
SET status = 'PAUSED', updated_at = now()
WHERE tenant_id = :tenant_id
  AND endpoint_id = :endpoint_id;
```

Delivery workers should check endpoint status before each attempt.

## Security Checklist

- Allow only `https://` endpoints in production.
- Block private IP ranges unless explicitly allowed for private connectivity.
- Resolve DNS carefully to avoid SSRF.
- Enforce payload size limits.
- Sign every delivery.
- Include timestamp in signature.
- Support secret rotation.
- Redact payload previews.
- Rate-limit replay.
- Audit endpoint changes.
- Audit manual replays.

SSRF matters because customers control endpoint URLs. A webhook platform should not let a tenant configure a URL like `http://169.254.169.254/latest/meta-data/`.

## Production Checklist

- Write webhook events through an outbox.
- Store events durably before delivery.
- Create one delivery row per endpoint.
- Use at-least-once delivery.
- Provide stable event IDs.
- Sign payloads with HMAC and timestamps.
- Retry only retryable failures.
- Use exponential backoff with jitter.
- Dead-letter after max attempts.
- Support replay without mutating history.
- Enforce per-tenant and per-endpoint limits.
- Keep delivery history queryable.
- Expose customer-facing delivery logs.
- Monitor delivery lag, success rate, and dead-letter rate.
- Protect against SSRF.
- Make customers handle duplicates.

## Read Next

- [Transactional Outbox Pattern](/blog/transactional-outbox-pattern/)
- [Idempotency Keys in APIs](/blog/api-idempotency-keys/)
- [Retry Storm Prevention](/blog/retry-storm-prevention/)
- [System Design: Notification System](/blog/system-design-notification-system/)
