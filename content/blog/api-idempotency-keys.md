---
title: "Idempotency Keys in APIs: Retries, Duplicate Requests, and Exactly-Once Illusions"
description: "A production guide to designing idempotent APIs with idempotency keys, request fingerprinting, response replay, database constraints, TTL cleanup, and race-condition handling."
date: "2025-07-14"
category: "System Design"
tags: ["idempotency", "api design", "distributed systems", "retries", "backend engineering", "payments"]
featured: false
affiliateSection: "system-design-courses"
---

Any API that changes state will eventually receive the same request more than once. Mobile clients retry on flaky networks. Load balancers retry after connection resets. Users double-click. Workers crash after doing the work but before acknowledging the job. Payment providers call your webhook again because they never received a 200 response.

Idempotency is how you make duplicate requests safe.

The goal is simple: **the same logical request should produce the same final effect, even if it is delivered multiple times**.

## Idempotency Is Not Exactly-Once

Exactly-once delivery is usually the wrong mental model. In real systems, you get at-least-once delivery from clients, queues, webhooks, and retries. The application must make repeated processing safe.

For example, this is dangerous:

```http
POST /orders
{
  "userId": "u123",
  "sku": "book-42",
  "quantity": 1
}
```

If the client times out after the server creates the order, it may retry and create a second order.

An idempotent version includes a key:

```http
POST /orders
Idempotency-Key: 7f4c1b0e-6f3e-4c8d-bd1a
{
  "userId": "u123",
  "sku": "book-42",
  "quantity": 1
}
```

The server stores the key and the result. If the same key arrives again, the server returns the original response instead of repeating the side effect.

## Idempotency Table Design

A practical schema looks like this:

```sql
CREATE TABLE idempotency_keys (
  key                VARCHAR(128) PRIMARY KEY,
  request_hash       CHAR(64) NOT NULL,
  status             VARCHAR(20) NOT NULL,
  response_code      INT,
  response_body      JSONB,
  resource_type      VARCHAR(50),
  resource_id        VARCHAR(128),
  created_at         TIMESTAMP NOT NULL DEFAULT now(),
  expires_at         TIMESTAMP NOT NULL
);
```

The key details:

- `key` prevents duplicate processing
- `request_hash` catches accidental key reuse with a different payload
- `status` tracks `PROCESSING`, `SUCCEEDED`, or `FAILED`
- `response_body` enables response replay
- `expires_at` allows cleanup

Do not store idempotency forever. Most APIs use a TTL between 24 hours and 7 days, depending on retry windows and compliance requirements.

## The Race Condition

Two identical requests can arrive at the same time. If both check for the key before either inserts it, both may proceed.

Use a unique constraint and insert first:

```sql
INSERT INTO idempotency_keys (key, request_hash, status, expires_at)
VALUES (:key, :hash, 'PROCESSING', now() + interval '24 hours')
ON CONFLICT (key) DO NOTHING;
```

Then check whether your insert won:

```java
if (inserted) {
    // This request owns processing.
    Order order = orderService.createOrder(request);
    saveSuccess(idempotencyKey, 201, order);
    return order;
}

IdempotencyRecord existing = repository.findByKey(idempotencyKey);
if (!existing.requestHash().equals(requestHash)) {
    throw new ConflictException("Idempotency key reused with different request body");
}

if (existing.status().equals("SUCCEEDED")) {
    return existing.responseBody();
}

throw new ConflictException("Request is already being processed");
```

The unique constraint is the lock. You do not need a distributed lock for the common path.

## Should Failed Requests Be Cached?

Cache deterministic failures, not transient failures.

Good to cache:

- validation failed
- insufficient balance
- duplicate business operation
- resource not found for this user

Bad to cache:

- database timeout
- downstream 503
- network timeout
- unknown internal error

If the failure might succeed on retry, do not permanently bind the idempotency key to that failure. Mark it as failed with a retryable status or delete it after the transaction rolls back.

## Request Fingerprinting

The idempotency key alone is not enough. Clients can accidentally reuse a key for a different operation.

Create a stable hash from the meaningful request fields:

```java
String fingerprint = sha256(
    request.userId() + "|" +
    request.sku() + "|" +
    request.quantity() + "|" +
    request.currency()
);
```

Do not include unstable fields like timestamps, trace IDs, or auth tokens. The same logical request should produce the same fingerprint.

## HTTP Response Semantics

Idempotent APIs should be predictable for clients. A useful convention:

| Situation | Response |
|---|---|
| First request succeeds | `201 Created` or `200 OK` |
| Same key and same payload after success | Replay original response |
| Same key but different payload | `409 Conflict` |
| Same key while first request is processing | `409 Conflict` or `202 Accepted` |
| Missing key for required endpoint | `400 Bad Request` |

For public APIs, replaying the original status code is usually best. If the first request created an order and returned `201`, the retry should return the same `201` body or a clearly documented replay response.

Example replay response:

```http
HTTP/1.1 201 Created
Idempotency-Replayed: true
Content-Type: application/json

{
  "orderId": "ord_123",
  "status": "CREATED"
}
```

That header is not required, but it helps debugging. Clients can tell whether the server performed new work or replayed a previous result.

## Full Service Flow

Here is a more complete service flow:

```java
public OrderResponse createOrder(CreateOrderRequest request, String key) {
    if (key == null || key.isBlank()) {
        throw new BadRequestException("Idempotency-Key is required");
    }

    String requestHash = fingerprint(request);
    Optional<IdempotencyRecord> existing = repository.findByKey(key);

    if (existing.isPresent()) {
        return handleExistingRecord(existing.get(), requestHash);
    }

    boolean claimed = repository.tryCreateProcessingRecord(key, requestHash);
    if (!claimed) {
        // Another request inserted the key between findByKey and insert.
        return handleExistingRecord(repository.findByKey(key).orElseThrow(), requestHash);
    }

    try {
        Order order = orderService.create(request);
        OrderResponse response = OrderResponse.from(order);

        repository.markSucceeded(
            key,
            201,
            objectMapper.writeValueAsString(response),
            "ORDER",
            order.getId()
        );

        return response;
    } catch (ValidationException ex) {
        repository.markFailedDeterministically(key, 400, errorBody(ex));
        throw ex;
    } catch (Exception ex) {
        repository.releaseForRetry(key);
        throw ex;
    }
}
```

The important distinction is deterministic vs transient failure. A validation failure can be saved and replayed. A database timeout should not become the permanent result for that key.

## State Machine

Avoid letting idempotency records become ambiguous. Treat them as a small state machine:

```
NEW -> PROCESSING -> SUCCEEDED
NEW -> PROCESSING -> FAILED_DETERMINISTIC
NEW -> PROCESSING -> RETRYABLE_FAILED
```

If a request finds `PROCESSING`, there are two common strategies:

1. Return `409 Conflict` and ask the client to retry later
2. Return `202 Accepted` with a status endpoint

For synchronous APIs, `409` is simpler:

```json
{
  "error": "request_in_progress",
  "message": "A request with this idempotency key is already being processed."
}
```

For long-running workflows, `202` is better:

```http
HTTP/1.1 202 Accepted
Location: /orders/status/idem_123
```

The API style should match the operation. Creating a small order should not need polling. Starting a large export job probably should.

## TTL and Cleanup Details

TTL is not just a storage decision. It defines how long clients can safely retry.

If you advertise a 24-hour idempotency window, a retry after 25 hours may create a second operation. That is acceptable only if it is documented.

Cleanup query:

```sql
DELETE FROM idempotency_keys
WHERE expires_at < now()
  AND status IN ('SUCCEEDED', 'FAILED_DETERMINISTIC')
LIMIT 1000;
```

For PostgreSQL, `DELETE ... LIMIT` is not directly supported, so use:

```sql
DELETE FROM idempotency_keys
WHERE key IN (
  SELECT key
  FROM idempotency_keys
  WHERE expires_at < now()
    AND status IN ('SUCCEEDED', 'FAILED_DETERMINISTIC')
  LIMIT 1000
);
```

Clean in batches to avoid table bloat and long locks.

## Webhook Idempotency

Webhook handlers need the same pattern, but the key usually comes from the provider event ID:

```sql
CREATE TABLE processed_webhook_events (
  provider VARCHAR(50) NOT NULL,
  event_id VARCHAR(128) NOT NULL,
  processed_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);
```

Insert the event ID before doing work. If the insert conflicts, acknowledge the webhook without reprocessing.

## Production Checklist

- Require `Idempotency-Key` for state-changing public APIs
- Store request hash and reject key reuse with different payloads
- Use a database unique constraint, not only an application check
- Replay the original success response
- Choose clear behavior for in-progress duplicate requests
- Set a clear TTL and cleanup job
- Do not cache transient 5xx responses as final outcomes
- Make webhook handlers idempotent by event ID
- Document the idempotency window for clients
- Add metrics for key conflicts, processing state age, and replay rate

Idempotency is not a fancy payment-system feature. It is a basic reliability pattern for every API that accepts retries. Once you design for duplicate delivery, distributed systems become much less surprising.
