---
title: "Designing a Retry System Without Causing a Retry Storm"
description: "Exponential backoff with jitter, circuit breakers, bulkhead isolation, Kafka retry topics, and the retry amplification problem — with Java implementations and a real outage postmortem."
date: "2025-05-22"
category: "System Design"
tags: ["retry", "circuit breaker", "resilience", "spring boot", "kafka", "distributed systems", "java"]
featured: false
affiliateSection: "distributed-systems-books"
---

Retry logic is the second most dangerous code in a distributed system, after "delete all records." The intent is to improve reliability by recovering from transient failures. The actual effect, when implemented naively, is to turn a brief service degradation into a cascading system-wide outage.

The pattern is predictable: a downstream service slows down, client retries pile up, the downstream service is now handling 3× the original load while already struggling, it slows down more, more retries, complete failure. A retry storm.

This article covers every layer of the retry stack — from jitter algorithms to Kafka DLQ topology — and the production outage that reshaped how our team thinks about retry.

## Exponential Backoff: Why Linear Retry Is Wrong

Linear retry: wait 1 second, then try again. If the service is down for 60 seconds and you have 1,000 clients, each retrying every second, that's 1,000 × 60 = 60,000 retry requests during the outage. When the service recovers, it receives all 1,000 pending retries simultaneously.

Exponential backoff: each retry waits 2× longer than the previous:
```
Attempt 1: wait 1s
Attempt 2: wait 2s
Attempt 3: wait 4s
Attempt 4: wait 8s
Attempt 5: wait 16s → give up
```

Total client load during a 60-second outage with exponential backoff: 5 retries per client × 1,000 clients = 5,000 requests — 12× fewer than linear retry.

But exponential backoff alone still causes a thundering herd on recovery: all 1,000 clients synchronized on the same backoff schedule will all retry at t=1s, t=2s, t=4s simultaneously.

## Jitter: The Fix for Synchronized Retries

Jitter adds randomness to the wait time, spreading retries across a time window:

```java
public class ExponentialBackoffWithJitter {

    private final int maxAttempts;
    private final long baseDelayMs;
    private final long maxDelayMs;
    private final double jitterFactor;

    // Full jitter: random(0, min(maxDelay, baseDelay * 2^attempt))
    public long computeDelay(int attempt) {
        long exponentialDelay = (long) (baseDelayMs * Math.pow(2, attempt));
        long cappedDelay = Math.min(maxDelayMs, exponentialDelay);
        return ThreadLocalRandom.current().nextLong(0, cappedDelay);
    }

    // Equal jitter: split between base and random portion
    // Guarantees minimum wait while still spreading load
    public long computeEqualJitterDelay(int attempt) {
        long exponentialDelay = (long) (baseDelayMs * Math.pow(2, attempt));
        long capped = Math.min(maxDelayMs, exponentialDelay);
        return (capped / 2) + ThreadLocalRandom.current().nextLong(0, capped / 2);
    }

    // Decorrelated jitter (AWS recommendation): harder to reason about but best distribution
    public long computeDecorrelatedDelay(int attempt, long previousDelay) {
        return Math.min(maxDelayMs,
            ThreadLocalRandom.current().nextLong(baseDelayMs, previousDelay * 3));
    }
}
```

**Which jitter to use:**
- Full jitter: best load distribution, minimum guaranteed wait is 0 (acceptable for most cases)
- Equal jitter: ensures some minimum delay, good for avoiding hammering on immediate retry
- Decorrelated jitter: AWS's recommended approach, best statistical distribution

## Circuit Breaker

The circuit breaker prevents retrying a service that's known to be down. Instead of each client independently discovering the service is down, the circuit breaker shares this knowledge:

```
Circuit Breaker States:

CLOSED (normal):
  Requests flow through
  Failure rate monitored
  If failure rate > threshold → open circuit
         │
         ▼
OPEN (service is down):
  All requests rejected immediately (fail fast)
  No requests sent to downstream
  After timeout → move to half-open
         │
         ▼
HALF-OPEN (testing recovery):
  Limited requests allowed through
  If they succeed → close circuit
  If they fail → re-open circuit
```

```java
@Bean
public CircuitBreaker paymentCircuitBreaker(CircuitBreakerRegistry registry) {
    CircuitBreakerConfig config = CircuitBreakerConfig.custom()
        .slidingWindowType(SlidingWindowType.TIME_BASED)
        .slidingWindowSize(30)                           // 30 seconds window
        .minimumNumberOfCalls(10)                        // Min calls before evaluating
        .failureRateThreshold(50)                        // Open at 50% failure rate
        .slowCallRateThreshold(80)                       // Also open at 80% slow calls
        .slowCallDurationThreshold(Duration.ofSeconds(2))
        .waitDurationInOpenState(Duration.ofSeconds(30)) // Stay open 30s
        .permittedNumberOfCallsInHalfOpenState(5)
        .recordExceptions(IOException.class, TimeoutException.class,
                         ServiceUnavailableException.class)
        .ignoreExceptions(ValidationException.class,    // Don't count business logic failures
                         AuthenticationException.class)
        .build();

    return registry.circuitBreaker("payment-service", config);
}

// Usage:
public PaymentResult charge(PaymentRequest request) {
    return circuitBreaker.executeSupplier(() -> {
        return paymentClient.charge(request);
    });
}
```

The `slowCallDurationThreshold` is critical and often missed. A service that responds in 5 seconds is not "failing" — the exception-based circuit breaker stays closed. But 5-second calls are exhausting your thread pool. Trip the circuit breaker on slow calls, not just errors.

## Bulkhead Pattern

Bulkheads isolate failure domains. Without bulkheads, a slow downstream service exhausts all your thread pool capacity, taking down unrelated functionality.

```
Without bulkhead:
All requests share 200 Tomcat threads
Payment service slow → 200 threads busy waiting for payments
All other endpoints (search, profile, cart) → timeout

With bulkhead:
┌─────────────────────────────────────────────┐
│ Tomcat (200 total threads)                  │
│                                             │
│ ┌──────────────┐  ┌──────────────┐          │
│ │ Payment pool │  │ Search pool  │          │
│ │ 30 threads   │  │ 50 threads   │          │
│ └──────────────┘  └──────────────┘          │
│ ┌──────────────┐  ┌──────────────┐          │
│ │ Profile pool │  │ Cart pool    │          │
│ │ 20 threads   │  │ 20 threads   │          │
│ └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────┘
```

```java
// Resilience4j ThreadPoolBulkhead:
@Bean
public ThreadPoolBulkhead paymentBulkhead(ThreadPoolBulkheadRegistry registry) {
    ThreadPoolBulkheadConfig config = ThreadPoolBulkheadConfig.custom()
        .maxThreadPoolSize(30)
        .coreThreadPoolSize(15)
        .queueCapacity(20)          // Queue depth before rejecting
        .keepAliveDuration(Duration.ofSeconds(20))
        .build();

    return registry.bulkhead("payment", config);
}

public CompletableFuture<PaymentResult> chargeAsync(PaymentRequest request) {
    return paymentBulkhead.executeSupplier(() ->
        CompletableFuture.supplyAsync(() -> paymentClient.charge(request))
    );
}
```

When the payment service is slow, only the 30 payment threads are affected. Search, profile, and cart keep running with their own thread pools.

## Dead Letter Queues

Messages that consistently fail need to go somewhere that isn't "try again forever." DLQ design:

```
DLQ requirements:
1. Not lost (durable storage)
2. Observable (alert on DLQ message arrival)
3. Reprocessable (ability to replay after fix)
4. Auditable (track when message failed and why)

DLQ record schema:
┌────────────────────────────────────────┐
│ original_payload: <message bytes>      │
│ original_topic: "payments"             │
│ original_partition: 7                  │
│ original_offset: 10034567              │
│ failure_count: 4                       │
│ last_failure_time: 2025-04-15T14:32:00 │
│ last_error: "GatewayTimeoutException"  │
│ last_error_trace: "..."               │
└────────────────────────────────────────┘
```

## Kafka Retry Topics

Kafka's at-least-once delivery means consumers must handle retries. The naive approach — retry in the consumer loop — holds the partition and blocks other messages. Use a retry topic pattern instead:

```
Kafka Retry Topology:

payments (main)
    │
    ▼
Consumer (payments-group)
    │
    ├── Success → ack, continue
    │
    ├── Retryable failure (1st time)
    │       └── Publish to payments-retry-30s
    │
    └── Non-retryable → payments-dlq (immediately)

payments-retry-30s
    │  Consumer pauses 30s before consuming
    ▼
Consumer (retry-group-30s)
    │
    ├── Success → ack
    ├── Retryable → payments-retry-5m
    └── Max retries → payments-dlq

payments-retry-5m → payments-retry-30m → payments-dlq
```

```java
@RetryableTopic(
    attempts = "4",
    backoff = @Backoff(
        delay = 30_000,           // 30 seconds initial
        multiplier = 6,           // × 6 each attempt: 30s, 3m, 18m
        maxDelay = 1_800_000      // Cap at 30 minutes
    ),
    dltStrategy = DltStrategy.FAIL_ON_ERROR,
    autoCreateTopics = "false",   // Create topics via IaC, not code
    include = {
        RetryablePaymentException.class,
        GatewayTimeoutException.class
    },
    exclude = {
        NonRetryablePaymentException.class,
        InvalidRequestException.class
    }
)
@KafkaListener(topics = "payments", groupId = "payment-processor")
public void process(ConsumerRecord<String, PaymentEvent> record) {
    paymentService.process(record.value());
}

@DltHandler
public void handleDeadLetter(
        PaymentEvent event,
        @Header(KafkaHeaders.RECEIVED_TOPIC) String topic,
        @Header(KafkaHeaders.EXCEPTION_FQCN) String exceptionFqcn) {
    deadLetterService.record(event, topic, exceptionFqcn);
    alertingService.notifyDltArrival(event);
}
```

## Idempotency Considerations

Retries without idempotent consumers cause duplicate processing. Every message that might be retried must be safe to process twice:

```java
@Transactional
public void processPayment(PaymentEvent event) {
    // Idempotency check upfront
    if (processedPayments.existsByEventId(event.getEventId())) {
        log.info("Duplicate event skipped: {}", event.getEventId());
        return;
    }

    // Mark as processing (atomic insert, fails on duplicate)
    processedPayments.markProcessing(event.getEventId());

    try {
        PaymentResult result = gateway.charge(event);
        processedPayments.markComplete(event.getEventId(), result);
    } catch (Exception e) {
        processedPayments.markFailed(event.getEventId(), e.getMessage());
        throw e; // Re-throw for retry
    }
}
```

## Retry Amplification Problem

Each service in a call chain that retries independently amplifies the total request count:

```
Service A calls B calls C calls D
Each service retries 3 times on failure

D fails:
C retries D 3 times → 3 calls to D
B retries C 3 times → 3 × 3 = 9 calls to D
A retries B 3 times → 3 × 3 × 3 = 27 calls to D

27 calls to D for 1 user request
At 1,000 concurrent users: 27,000 calls to D
```

The fix: **retry at the edge, not in the interior of a call chain**. Services B and C should not retry — they should propagate errors back to A. A (the edge service, closest to the user) retries the full request.

Alternatively, use idempotency keys in the retry headers so interior services can deduplicate:

```java
@GetMapping("/order")
public ResponseEntity<OrderResponse> createOrder(@RequestBody OrderRequest request) {
    String idempotencyKey = UUID.randomUUID().toString();

    return retryTemplate.execute(context -> {
        // Same idempotency key on all retries
        return orderService.createOrder(request, idempotencyKey);
    });
}
```

## Real Outage Scenario

**System:** Payment processing service, Spring Boot, calls external payment gateway.

**Timeline:**
- 09:00: Payment gateway experiences degraded performance (30% of requests timing out at 10 seconds)
- 09:01: Payment service's `RestTemplate` has `connectTimeout=10s, readTimeout=10s`
- 09:01: Retry logic: 3 retries with 1-second delay (linear, no jitter)
- 09:02: 1,000 concurrent payment requests × 3 retries × 10s timeout = 30,000 seconds of thread holding. 200 Tomcat threads exhausted within 2 minutes.
- 09:03: Payment service appears down. API gateway returns 503. Alert fires.
- 09:03: On-call restarts payment service. Gateway still degraded. Service exhausts threads again in 90 seconds.
- 09:04: Retry on restart causes 3,000 requests to hit the still-struggling gateway simultaneously (retry storm on service startup)
- 09:15: Gateway recovers. Payment service recovers.
- **Total downtime:** 15 minutes. Payment service fully available for only 10 minutes of that window.

**Root causes:**
1. 10-second timeout was too long — threads held too long during degradation
2. Linear retry with no jitter created synchronized load spikes
3. No circuit breaker — service kept sending requests to a known-degraded gateway
4. No bulkhead — payment calls exhausted the shared thread pool

**Fixes applied:**
```java
// Before:
restTemplate.setConnectTimeout(10_000);
restTemplate.setReadTimeout(10_000);
// 3 retries, 1-second delay

// After:
restTemplate.setConnectTimeout(2_000);   // 2 seconds - fail fast
restTemplate.setReadTimeout(5_000);      // 5 seconds max read

CircuitBreakerConfig config = CircuitBreakerConfig.custom()
    .slowCallDurationThreshold(Duration.ofSeconds(3))
    .slowCallRateThreshold(50)
    .failureRateThreshold(30)
    .waitDurationInOpenState(Duration.ofSeconds(20))
    .build();

RetryConfig retryConfig = RetryConfig.custom()
    .maxAttempts(3)
    .intervalFunction(IntervalFunction.ofExponentialRandomBackoff(
        Duration.ofMillis(500),  // base delay
        2.0,                     // multiplier
        Duration.ofSeconds(10)   // max delay
    ))
    .build();
```

Result: During the next gateway degradation event (4 weeks later), the circuit breaker opened after 30 seconds of degraded performance, fast-failing requests instead of holding threads, payment service remained available (returning "payment gateway temporarily unavailable" to users), gateway recovered, circuit breaker closed, normal operations resumed. Total user-visible downtime: 30 seconds.

## Monitoring Retry Rates

```java
@Component
public class RetryMetrics {

    @EventListener
    public void onRetry(RetryOnRetryEvent event) {
        meterRegistry.counter("retry.attempts",
            "service", event.getName(),
            "attempt", String.valueOf(event.getNumberOfRetryAttempts())
        ).increment();
    }

    @EventListener
    public void onError(RetryOnErrorEvent event) {
        meterRegistry.counter("retry.failures",
            "service", event.getName(),
            "exception", event.getLastThrowable().getClass().getSimpleName()
        ).increment();
    }
}
```

Grafana alert: `rate(retry.attempts[5m]) > 100` — indicates upstream degradation in progress before it becomes an outage.

## Architecture Diagram

```
Resilient Retry Architecture:

User Request
     │
     ▼
API Gateway
(rate limiting, auth)
     │
     ▼
Edge Service
     │
     ├── Bulkhead: Payment pool (30 threads)
     │       │
     │       ├── Circuit Breaker (open/closed/half-open)
     │       │       │
     │       │       ▼
     │       │   Retry (3 attempts, exponential + jitter)
     │       │       │
     │       │       ▼
     │       │   Payment Gateway (external)
     │       │
     │       └── Circuit open → Return cached/degraded response
     │
     ├── Bulkhead: Inventory pool (20 threads)
     │       └── [same pattern]
     │
     └── Bulkhead: User profile pool (15 threads)
             └── [same pattern]

Async Kafka path:
Event → payments topic → Consumer
                              │
                              ├── Success → payments-processed
                              ├── Retry   → payments-retry-* topics
                              └── Max retry → payments-dlq → alert
```

Retry logic is not a feature — it's infrastructure. It needs the same rigor as your deployment pipeline. An untested retry strategy will fail exactly when you need it most: during an outage, when the retry storm amplifies the problem it was meant to solve.
