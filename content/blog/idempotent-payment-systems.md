---
title: "Designing Idempotent Payment Systems in Distributed Architecture"
description: "How duplicate payments happen in real systems, idempotency key design, race condition handling, Redis vs DB for idempotency stores, and the production incident that shaped our architecture."
date: "2025-04-26"
category: "System Design"
tags: ["payments", "idempotency", "distributed systems", "java", "spring boot", "fintech", "system design"]
featured: false
affiliateSection: "system-design-courses"
---

Duplicate payments are not a theoretical edge case. In any distributed payment system operating at scale, they are a guaranteed occurrence. Networks time out. Clients retry. Proxies retry on behalf of clients. Load balancers retry on 502s. The question is never "can we prevent duplicate requests?" — we cannot. The question is "can we prevent duplicate charges?"

This article covers the complete design of an idempotent payment system, including the race conditions that catch engineers off guard and the production incident that reshaped how our team thinks about distributed side effects.

## How Duplicate Payment Requests Happen

Duplicates in payment systems originate from multiple layers simultaneously:

```
Duplicate sources:

Client App ──retry─► API Gateway ──retry─► Load Balancer ──► Payment Service
     │                    │                      │
     │                    │                      │
  Network           5xx response             Health check
  timeout           from service             failure +
  (30s default)     (retry policy)           retry
```

**Client-side retries:** A mobile app's payment SDK has a 10-second timeout. The network is slow. At 10 seconds, the SDK retries. The original request arrives at second 11 — now both requests are in flight.

**Proxy and infrastructure retries:** AWS ALB retries on 5xx responses. Nginx has `proxy_next_upstream`. Your service mesh (Istio, Linkerd) has retry policies. Each layer that retries multiplies the duplicate risk.

**Retry storms:** After a downstream payment gateway recovers from a brief outage, all queued retries flush simultaneously. 10,000 retries arrive in 500ms. Your payment service processes some; others are duplicated in the rush.

**At-least-once message delivery:** If payments flow through Kafka, SQS, or any at-least-once messaging system, your consumer will eventually process the same payment event twice.

## Idempotency Keys and Database Design

An idempotency key is a client-generated, globally unique token that identifies a specific payment request. Same key = same request = same result.

```
HTTP Header approach:
POST /payments
Idempotency-Key: idem_key_a3b4c5d6e7f8901234567890

Request body:
{
  "user_id": "usr_123",
  "amount": 9999,
  "currency": "USD",
  "payment_method_id": "pm_456"
}
```

The server stores the idempotency key and its result. On duplicate request: return the stored result, skip processing.

### Database Schema for Idempotency

```sql
-- Idempotency store
CREATE TABLE idempotency_keys (
    idempotency_key     VARCHAR(255) NOT NULL,
    user_id             BIGINT NOT NULL,
    request_hash        VARCHAR(64) NOT NULL,   -- SHA-256 of request body
    status              VARCHAR(20) NOT NULL DEFAULT 'PROCESSING',
    -- status: PROCESSING | COMPLETED | FAILED
    response_status     INT,                    -- HTTP status code
    response_body       JSONB,                  -- Stored response
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
    PRIMARY KEY (idempotency_key),
    INDEX idx_idem_user_created (user_id, created_at)
);

-- Payments table
CREATE TABLE payments (
    payment_id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    idempotency_key     VARCHAR(255) NOT NULL UNIQUE,
    user_id             BIGINT NOT NULL,
    amount              DECIMAL(19,4) NOT NULL,
    currency            CHAR(3) NOT NULL,
    payment_method_id   VARCHAR(255) NOT NULL,
    status              VARCHAR(20) NOT NULL,
    gateway_charge_id   VARCHAR(255),           -- External gateway ID
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (idempotency_key) REFERENCES idempotency_keys(idempotency_key)
);
```

The `request_hash` column enables an important safety check: if a client sends the same idempotency key with a different request body, that's a bug in the client. Return `422 Unprocessable Entity` rather than processing a potentially different amount.

## Race Conditions and Locking Strategies

The naive implementation has a classic TOCTOU race condition:

```
Thread A: SELECT * FROM idempotency_keys WHERE key='idem_123' → Not found
Thread B: SELECT * FROM idempotency_keys WHERE key='idem_123' → Not found
Thread A: INSERT INTO idempotency_keys → Success
Thread B: INSERT INTO idempotency_keys → Duplicate key error OR succeeds (duplicate charge!)
```

### Strategy 1: Database Unique Constraint (Preferred)

```java
@Transactional(isolation = Isolation.READ_COMMITTED)
public PaymentResponse processPayment(String idempotencyKey, PaymentRequest request) {
    // Attempt atomic insert - fails on duplicate key
    try {
        jdbcTemplate.update(
            """
            INSERT INTO idempotency_keys (idempotency_key, user_id, request_hash, status)
            VALUES (?, ?, ?, 'PROCESSING')
            """,
            idempotencyKey, request.userId(), sha256(request)
        );
    } catch (DuplicateKeyException e) {
        // Another thread or request is processing / has processed this key
        return getStoredResponse(idempotencyKey, request);
    }

    // Only one thread reaches here per idempotency key
    try {
        PaymentResult result = chargeGateway(request);
        storeResult(idempotencyKey, result);
        return PaymentResponse.success(result);
    } catch (Exception e) {
        markFailed(idempotencyKey, e);
        throw e;
    }
}

private PaymentResponse getStoredResponse(String key, PaymentRequest request) {
    IdempotencyRecord record = findRecord(key);

    // Validate request body matches
    if (!record.requestHash().equals(sha256(request))) {
        throw new IdempotencyConflictException(
            "Idempotency key reused with different request body");
    }

    return switch (record.status()) {
        case "PROCESSING" -> throw new PaymentInProgressException(
            "Payment is being processed, retry in 1 second");
        case "COMPLETED"  -> PaymentResponse.fromStored(record.responseBody());
        case "FAILED"     -> PaymentResponse.fromStoredFailure(record.responseBody());
        default -> throw new IllegalStateException("Unknown status: " + record.status());
    };
}
```

The database unique constraint enforces mutual exclusion at the storage layer. No distributed lock needed.

### Strategy 2: Pessimistic Locking with SELECT FOR UPDATE

For scenarios where you need to read-then-update atomically:

```java
@Transactional
public PaymentResponse processPaymentLocked(String idempotencyKey, PaymentRequest request) {
    // Lock the row, or insert if absent
    Optional<IdempotencyRecord> existing = jdbcTemplate.query(
        "SELECT * FROM idempotency_keys WHERE idempotency_key = ? FOR UPDATE",
        idempotencyKeyRowMapper, idempotencyKey
    ).stream().findFirst();

    if (existing.isPresent()) {
        return handleExisting(existing.get(), request);
    }

    // Safe to insert — we hold the lock on this key's position
    jdbcTemplate.update(
        "INSERT INTO idempotency_keys (idempotency_key, user_id, request_hash, status) VALUES (?, ?, ?, 'PROCESSING')",
        idempotencyKey, request.userId(), sha256(request)
    );

    return executePayment(idempotencyKey, request);
}
```

`SELECT FOR UPDATE` with a non-existent row doesn't actually lock anything in most databases. Use gap locking or a distributed lock for that case.

## Redis vs Database for Idempotency Store

Both work, but they have different trade-off profiles:

| Dimension | PostgreSQL | Redis |
|-----------|------------|-------|
| Consistency | ACID, durable | Eventual (if using Redis Cluster) |
| Latency | 1–5ms | < 1ms |
| Throughput | 10K ops/s (single node) | 100K+ ops/s |
| TTL management | Manual (cron job) | Native TTL |
| Data co-location | Same DB transaction | Separate system, no transactions |
| Operational complexity | Existing infra | Additional service |
| Risk on failure | Payment processing stops | Falls back gracefully |

**Use PostgreSQL when:**
- You need the idempotency check and payment insert to be in the same ACID transaction
- You cannot afford to lose idempotency records on Redis failure
- Throughput is under 5,000 payments/second

**Use Redis when:**
- Your payment volume exceeds PostgreSQL's comfortable range
- You accept that Redis failure means falling back to processing (with idempotent downstream)
- You use Redis Cluster with persistence (AOF + RDB) for durability

**Hybrid approach** used at high-scale fintechs:

```
Request arrives with idempotency key
     │
     ▼
Check Redis cache (fast path):
     │
     ├── Found in Redis → Return cached response (< 1ms)
     │
     └── Not in Redis
               │
               ▼
         PostgreSQL (authoritative):
               │
               ├── Found in DB → Cache in Redis, return response
               │
               └── Not in DB → Process payment, insert to DB, cache in Redis
```

Redis acts as a read-through cache. Database is authoritative. On Redis failure, requests fall through to the database — slower but correct.

```java
@Service
public class HybridIdempotencyService {

    public Optional<PaymentResponse> checkCache(String key) {
        try {
            String cached = redisTemplate.opsForValue().get("idem:" + key);
            return Optional.ofNullable(cached)
                .map(json -> deserialize(json, PaymentResponse.class));
        } catch (RedisConnectionFailureException e) {
            log.warn("Redis unavailable, falling through to DB: {}", e.getMessage());
            return Optional.empty(); // Degrade gracefully
        }
    }

    public void cacheResult(String key, PaymentResponse response) {
        try {
            redisTemplate.opsForValue().set(
                "idem:" + key,
                serialize(response),
                Duration.ofHours(24)
            );
        } catch (RedisConnectionFailureException e) {
            log.warn("Redis unavailable, result not cached: {}", e.getMessage());
            // Continue — DB has the authoritative record
        }
    }
}
```

## Failure Scenarios

**Scenario 1: Payment succeeds at gateway, response lost on return**

```
Service → Gateway: charge($100) → Gateway charges card ✓
Gateway → Service: HTTP 200 with charge_id [network failure]
Service: times out, marks as FAILED
Client: retries with same idempotency key
Service: processes payment again → DOUBLE CHARGE
```

**Fix:** Use the gateway's idempotency support. Stripe, Braintree, and Adyen all accept an idempotency key on charge requests. If the same key is sent twice, they return the same result without charging twice. Store `gateway_charge_id` and verify before processing:

```java
public PaymentResult chargeWithGatewayIdempotency(PaymentRequest req, String idempotencyKey) {
    StripeRequest stripeReq = StripeRequest.builder()
        .amount(req.amount())
        .currency(req.currency())
        .paymentMethodId(req.paymentMethodId())
        .idempotencyKey(idempotencyKey)  // Pass through to gateway
        .build();

    return stripeClient.charges().create(stripeReq);
}
```

**Scenario 2: PROCESSING status stuck (service crash mid-payment)**

If the service crashes after inserting `PROCESSING` but before updating to `COMPLETED`, the idempotency key is locked in PROCESSING forever. Client retries get `PaymentInProgressException`.

Fix: Time-bound PROCESSING status:

```sql
-- Detect stuck PROCESSING keys (job runs every minute)
SELECT idempotency_key
FROM idempotency_keys
WHERE status = 'PROCESSING'
  AND created_at < NOW() - INTERVAL '2 minutes';

-- For each stuck key: check gateway for actual status
-- If gateway has charge: mark COMPLETED with gateway result
-- If gateway has no charge: mark FAILED, safe to retry
```

## Text-Based Architecture Diagram

```
Idempotent Payment Flow:

Mobile Client
     │
     │  POST /payments
     │  Idempotency-Key: idem_abc123
     ▼
API Gateway (rate limiting, auth)
     │
     ▼
Payment Service
     │
     ├─[1]─► Redis: GET idem:idem_abc123
     │           │
     │           ├── Cache hit → Return cached response (END)
     │           └── Cache miss → continue
     │
     ├─[2]─► PostgreSQL: INSERT INTO idempotency_keys
     │           │
     │           ├── DuplicateKeyException → Fetch + return stored result (END)
     │           └── Insert success → continue (exclusive processing)
     │
     ├─[3]─► Payment Gateway (Stripe/Braintree)
     │        with gateway idempotency key
     │           │
     │           ├── Success: charge_id=ch_xyz
     │           └── Failure: error code + message
     │
     ├─[4]─► PostgreSQL: UPDATE idempotency_keys SET status='COMPLETED'
     │        + INSERT INTO payments
     │        (single transaction)
     │
     └─[5]─► Redis: SET idem:idem_abc123 = response (TTL=24h)
                   └── Return response to client
```

## Monitoring and Observability

```java
@Component
public class PaymentMetrics {

    private final Counter duplicatePaymentAttempts;
    private final Counter stuckProcessingKeys;

    public PaymentMetrics(MeterRegistry registry) {
        this.duplicatePaymentAttempts = Counter.builder("payments.duplicate_attempts")
            .description("Idempotency key reuse count")
            .register(registry);

        this.stuckProcessingKeys = Counter.builder("payments.stuck_processing_keys")
            .description("Payments stuck in PROCESSING status")
            .register(registry);
    }
}
```

Key metrics to alert on:
- `payments.duplicate_attempts > 100/min` — possible retry storm in progress
- `payments.stuck_processing_keys > 0` — service crashes or network partitions happening
- `payments.gateway_idempotency_conflict > 0` — gateway received same key with different amount (client bug)
- P99 latency of idempotency key lookup > 50ms — database under pressure

## Real Production Incident

**Context:** Fintech platform, 50,000 payments/day, Spring Boot + PostgreSQL.

**Incident:** Black Friday sale. Payment volume spiked 10×. Our payment gateway (external) was slow — 8-second response times vs normal 800ms. Our API timeout was 10 seconds. Result: 80% of payment requests timed out client-side at the 10-second mark. All clients retried immediately with the same idempotency keys.

The retry storm overwhelmed the gateway. The gateway rate-limited us. More timeouts. More retries. A feedback loop.

**What saved us:** Idempotency keys in our database. Despite the chaos, every payment was processed exactly once. Clients that got timeouts eventually got responses on retry — the response was pulled from our idempotency store rather than charging the card again.

**What hurt us:** 70% of our API capacity was consumed by duplicate requests hitting the idempotency cache. Our P99 API latency hit 15 seconds for legitimate new payments.

**Post-incident fixes:**
1. Redis cache for idempotency hot path — duplicate requests now cost 0.5ms instead of 5ms database lookup
2. Separate thread pool for idempotency lookups vs new payment processing
3. Exponential backoff enforced server-side: 429 Too Many Requests with `Retry-After` header
4. Gateway circuit breaker: open after 20% of requests exceed 5 seconds

## Lessons Learned in Production

**1. Idempotency is not optional.** It is a core payment system requirement, not an edge case handler. Build it in from day one, not after your first duplicate charge incident.

**2. Client-side idempotency keys must be generated before the first attempt.** Generate the key before calling the API, persist it locally, use the same key on retries. Don't generate a new key on retry — that defeats the purpose.

**3. Your gateway must support idempotency keys too.** A payment service that is idempotent but calls a gateway that isn't still causes double charges. Validate your gateway's idempotency behavior explicitly.

**4. `PROCESSING` status must be time-bounded with a recovery job.** A payment stuck in PROCESSING indefinitely blocks the customer's ability to retry. This is as bad as a double charge from a UX perspective.

**5. Separate idempotency check latency from payment processing latency in your metrics.** Cache hits should be sub-millisecond. If your idempotency P99 is growing, you have either a traffic spike or an index problem — both need different responses.
