---
title: "Microservices Patterns: Circuit Breaker, Retry, Bulkhead, and Saga"
description: "Master the resilience patterns that keep microservices systems running when individual services fail. Covers circuit breaker, retry with backoff, bulkhead isolation, and distributed transactions with Saga."
date: "2025-02-28"
category: "System Design"
tags: ["microservices", "resilience", "circuit breaker", "saga", "distributed systems", "spring boot"]
featured: false
affiliateSection: "system-design-courses"
---

A monolith fails as a unit — one process, one crash, everything stops. A microservices system fails differently: some services go down, some slow to a crawl, some remain perfectly healthy. This partial-failure behaviour is actually harder to deal with than total failure, because the system is still *partially* up and clients keep sending requests into the degraded parts.

Without resilience patterns, one slow service can bring down your entire system in minutes through a mechanism called cascading failure. With the right patterns applied correctly, the system degrades gracefully — the slow payment service becomes temporarily unavailable to users, while inventory browsing, cart management, and search continue working normally. This article covers the four patterns that make that possible, with Spring Boot + Resilience4j implementations.

## Why Microservices Fail Differently

The most dangerous failure mode in distributed systems is not an immediate crash — it's a slow response. A service that returns an error immediately frees the calling thread right away. A service that hangs for 10 seconds holds a thread for 10 seconds, and at high load those threads accumulate until the thread pool is exhausted.

```
Monolith failure: Everything fails at once (simple, but total)

Microservice failure cascade:
  Order Service calls Inventory Service calls Warehouse Service

  Warehouse Service goes slow (200ms → 10s response time)
  Inventory Service threads pile up waiting for Warehouse
  Order Service threads pile up waiting for Inventory
  All three services become unresponsive
  → Entire system down, from one slow service

This is "cascading failure" — the #1 microservices operational problem.
```

The patterns below address cascading failure at different levels. The circuit breaker stops calls to a failing service. Retry handles transient blips before they reach the circuit breaker. The bulkhead contains failures to one partition of the system. Saga coordinates the cleanup when a multi-step operation fails partway through.

## Pattern 1: Circuit Breaker

The circuit breaker is named after the electrical component that trips when a circuit overloads, preventing damage. The software version does the same: when calls to a downstream service start failing at a high rate, the circuit breaker **opens** and immediately returns an error to callers — without actually calling the downstream service. This gives the failing service breathing room to recover while protecting the calling service's threads.

The three states are the heart of the pattern:

```
Circuit states:
  CLOSED: Normal operation — calls pass through
  OPEN: Failure threshold exceeded — calls fail immediately (fast fail)
  HALF-OPEN: Trial period — limited calls allowed to test recovery

State transitions:
  CLOSED → OPEN: When failure rate > threshold (e.g., 50% of last 10 calls failed)
  OPEN → HALF-OPEN: After wait duration (e.g., 30 seconds)
  HALF-OPEN → CLOSED: If trial calls succeed
  HALF-OPEN → OPEN: If trial calls fail

Timeline:
  0s:  Normal. All calls succeed.
  30s: Downstream service starts failing.
  35s: Failure rate hits 50% → Circuit OPENS.
  35s-65s: All calls fail immediately (fast fail), downstream gets no load.
  65s: Circuit HALF-OPENS, 3 trial calls allowed.
  66s: Trial calls succeed → Circuit CLOSES.
  66s+: Normal operation resumes.
```

The HALF-OPEN state is subtle but important. Without it, a circuit that opens would never close — you'd need manual intervention to restore service. HALF-OPEN is the automatic recovery probe: after the wait duration, the circuit allows a small number of test calls through. If they succeed, normal operation resumes. If they fail, the circuit opens again and waits longer.

The `@CircuitBreaker` annotation in Resilience4j wires all of this up automatically. The `fallbackMethod` is the method called when the circuit is open or when all retries are exhausted — it's your graceful degradation path.

```java
// build.gradle
// implementation 'io.github.resilience4j:resilience4j-spring-boot3:2.2.0'

@Service
public class InventoryService {

    private final CircuitBreakerRegistry circuitBreakerRegistry;
    private final InventoryClient inventoryClient;

    public InventoryService(CircuitBreakerRegistry registry, InventoryClient client) {
        this.circuitBreakerRegistry = registry;
        this.inventoryClient = client;
    }

    @CircuitBreaker(name = "inventory", fallbackMethod = "getInventoryFallback")
    public InventoryResponse checkInventory(String productId) {
        return inventoryClient.check(productId);
    }

    // The fallback runs when: circuit is OPEN, or a call fails (and no retry is configured)
    // Its signature must match the original method plus an Exception parameter
    public InventoryResponse getInventoryFallback(String productId, Exception e) {
        log.warn("Circuit breaker activated for inventory service: {}", e.getMessage());
        // Good fallback options: return stale cache, return "UNKNOWN" status,
        // or show a UI message like "Availability not currently shown"
        return inventoryCache.getLastKnown(productId)
            .orElse(new InventoryResponse(productId, AvailabilityStatus.UNKNOWN, 0));
    }
}
```

The YAML configuration gives you fine-grained control over when the circuit trips. The `slow-call-rate-threshold` is particularly useful — a service that responds in 8 seconds is just as harmful as one that throws exceptions, and the circuit can open for slowness, not just errors.

```yaml
# application.yml
resilience4j:
  circuitbreaker:
    instances:
      inventory:
        sliding-window-type: COUNT_BASED
        sliding-window-size: 10              # Evaluate the last 10 calls
        failure-rate-threshold: 50           # Open when 5 of last 10 calls fail
        slow-call-rate-threshold: 80         # Also open when 8 of 10 calls are slow
        slow-call-duration-threshold: 3s     # "Slow" means > 3 seconds
        permitted-number-of-calls-in-half-open-state: 3
        wait-duration-in-open-state: 30s
        register-health-indicator: true      # Exposes circuit state in /actuator/health
```

With `register-health-indicator: true`, your Spring Boot `/actuator/health` endpoint will show the current state of each circuit breaker. This is invaluable during incidents — you can see immediately whether a circuit is open and which downstream service is causing it.

## Pattern 2: Retry with Exponential Backoff

Not all failures are meaningful. A network packet gets dropped, a connection pool momentarily exhausts, a cloud provider briefly throttles a request — these happen in production every day and resolve themselves within milliseconds or seconds. Retry with backoff handles this class of failure automatically.

The key word is **exponential** backoff. A flat retry interval (retry every 500ms) keeps hammering the service at the same rate. Exponential backoff doubles the wait time between each retry attempt, giving the downstream service progressively more time to recover: 500ms, then 1 second, then 2 seconds. This self-limiting behaviour is why exponential backoff is the industry standard.

The code below shows combining `@Retry` with `@CircuitBreaker` — a common production pattern. The retry fires first (for transient failures), and the circuit breaker wraps the entire thing (for persistent failures):

```java
@Service
public class PaymentService {

    // Retry is applied "inside" the circuit breaker:
    // 1. If a call fails, retry up to 3 times (Retry)
    // 2. If failure rate across all attempts exceeds threshold, open circuit (CircuitBreaker)
    @Retry(name = "payment", fallbackMethod = "paymentFallback")
    @CircuitBreaker(name = "payment")
    public PaymentResult charge(PaymentRequest request) {
        return paymentClient.charge(request);
    }

    // Called only after all retry attempts are exhausted
    // Returning "pending" is better than failing outright — the payment can be retried async
    public PaymentResult paymentFallback(PaymentRequest request, Exception e) {
        asyncRetryQueue.enqueue(request);
        return PaymentResult.pending(request.getOrderId(), "Payment queued for retry");
    }
}
```

The YAML configuration for retry is where the subtlety lives. Two decisions matter enormously here: which exceptions to retry (network errors, not business errors), and whether to use jitter.

```yaml
resilience4j:
  retry:
    instances:
      payment:
        max-attempts: 3
        wait-duration: 500ms
        enable-exponential-backoff: true
        exponential-backoff-multiplier: 2      # Retry at 500ms, 1s, 2s
        exponential-max-wait-duration: 10s
        retry-exceptions:
          - java.net.ConnectException          # Network-level failures — safe to retry
          - java.net.SocketTimeoutException
          - feign.RetryableException
        ignore-exceptions:
          - com.example.PaymentDeclinedException  # Business failure — retrying won't help
          - com.example.DuplicatePaymentException # Idempotency error — don't retry!
        randomized-wait-factor: 0.5            # Adds jitter: ±50% of the wait time
```

**Why `ignore-exceptions` matters**: A `PaymentDeclinedException` means the card was declined — retrying three times won't change that outcome, and charging the card three times creates a terrible user experience. Always separate retryable infrastructure errors from non-retryable business errors.

**Jitter is critical**: Without jitter, all retrying clients retry at the same time, creating a "thundering herd" that overwhelms the recovering service.

```
Without jitter (thundering herd):
  T=500ms: All 1000 clients retry simultaneously → service gets 1000 requests at once

With jitter (spread load):
  T=250-750ms: Clients retry randomly in this window → ~4 requests per millisecond
```

With `randomized-wait-factor: 0.5`, the 500ms wait becomes anywhere from 250ms to 750ms — a small change that dramatically reduces retry storm load on the recovering service.

## Pattern 3: Bulkhead — Isolation

The ship's bulkhead divides the hull into watertight compartments. When one compartment floods, the others remain dry and the ship stays afloat. The software pattern does exactly this for thread pools.

Without bulkheads, all downstream calls compete for the same shared thread pool. When the payment service goes slow and its threads don't return, they're borrowed from the pool indefinitely. Eventually the pool is exhausted and every service call fails — even inventory checks that have nothing to do with payment.

```
Without bulkhead:
  Thread pool: 200 threads total
  Slow payment service consumes all 200 threads
  → No threads left for inventory, user, order services
  → Entire system unresponsive

With bulkhead:
  Payment thread pool: 20 threads (separate pool)
  Other services share remaining 180 threads
  → Payment slowness isolated; other services unaffected
```

The implementation below uses `Bulkhead.Type.THREADPOOL`, which gives each downstream service its own dedicated thread pool. Even if payment service threads are all blocked waiting, inventory threads are in a completely separate pool and continue working.

```java
@Service
public class OrderOrchestrator {

    // THREADPOOL bulkhead: each downstream service gets its own isolated thread pool
    // If payment service blocks all 20 of its threads, inventory is unaffected
    @Bulkhead(name = "payment", type = Bulkhead.Type.THREADPOOL)
    @CircuitBreaker(name = "payment")
    public CompletableFuture<PaymentResult> processPayment(PaymentRequest request) {
        return CompletableFuture.supplyAsync(() -> paymentClient.charge(request));
    }

    @Bulkhead(name = "inventory", type = Bulkhead.Type.THREADPOOL)
    @CircuitBreaker(name = "inventory")
    public CompletableFuture<InventoryResult> checkInventory(String productId) {
        return CompletableFuture.supplyAsync(() -> inventoryClient.check(productId));
    }

    public OrderResult createOrder(OrderRequest request) throws Exception {
        // Fan-out: both calls start simultaneously, each in their own bulkhead pool
        // Total time = max(payment_time, inventory_time), not payment_time + inventory_time
        CompletableFuture<PaymentResult> paymentFuture = processPayment(request.getPayment());
        CompletableFuture<InventoryResult> inventoryFuture = checkInventory(request.getProductId());

        // Wait for both to complete before proceeding
        CompletableFuture.allOf(paymentFuture, inventoryFuture).join();

        return buildOrder(paymentFuture.get(), inventoryFuture.get());
    }
}
```

The `queue-capacity` setting in the YAML below is your overflow valve. When all threads in the pool are busy, new requests queue up to this limit before being rejected. Size it based on how long callers can reasonably wait and how many concurrent requests you expect.

```yaml
resilience4j:
  thread-pool-bulkhead:
    instances:
      payment:
        max-thread-pool-size: 20           # Maximum concurrent payment calls
        core-thread-pool-size: 5           # Always-warm thread count
        queue-capacity: 50                 # Queue up to 50 requests before rejecting
        keep-alive-duration: 20ms
      inventory:
        max-thread-pool-size: 30           # Inventory is called more frequently
        core-thread-pool-size: 10
        queue-capacity: 100
```

Size your bulkhead pools based on observed concurrency, not guesswork. Run a load test, check how many threads are typically in use, and set the maximum pool to 20-30% above peak. This leaves headroom for spikes while still containing failures.

## Pattern 4: Saga — Distributed Transactions

The trickiest failure scenario in microservices: a multi-step business operation that spans several services. Consider order creation — you need to reserve inventory, charge the customer, and confirm the order. In a monolith, you'd wrap all of this in a database transaction and get atomicity for free. In microservices, each service has its own database — there's no shared transaction to roll back.

The Saga pattern solves this by breaking the operation into a sequence of **local transactions**, each followed by a **compensating transaction** that reverses the step if a later step fails.

```
Order creation saga (Choreography-based):

Step 1: Order Service creates order (PENDING)
    → publishes "OrderCreated" event

Step 2: Inventory Service reserves stock
    → publishes "StockReserved" event
    (if fails → publishes "StockReservationFailed")

Step 3: Payment Service charges customer
    → publishes "PaymentProcessed" event
    (if fails → publishes "PaymentFailed")

Step 4: Order Service updates order to CONFIRMED
    → publishes "OrderConfirmed"

Failure handling (compensating transactions):
  PaymentFailed →
    Inventory Service: release reserved stock (compensation)
    Order Service: mark order as CANCELLED

  StockReservationFailed →
    Order Service: mark order as CANCELLED (no payment taken yet)
```

There are two ways to implement Sagas: **choreography** and **orchestration**. Understanding the difference is essential for choosing the right approach.

**Choreography** has no central coordinator — each service reacts to events and publishes its own. Services are loosely coupled and can evolve independently. The downside is that the overall business flow is difficult to visualise — it's spread across multiple services, and tracing a failure requires correlating events from all of them.

**Orchestration** has a central saga orchestrator that explicitly tells each service what to do next. The entire business flow lives in one place, making it much easier to understand and debug. The trade-off is a coordination point that must be kept resilient.

```java
// === CHOREOGRAPHY: Each service reacts to events independently ===

@Service
public class InventoryService {

    // Listen for orders, reserve stock, emit result
    @KafkaListener(topics = "order-events", filter = "OrderCreated")
    public void handleOrderCreated(OrderCreatedEvent event) {
        try {
            reserveStock(event.getProductId(), event.getQuantity());
            // Success: tell the next participant (Payment Service) to proceed
            kafkaTemplate.send("inventory-events",
                new StockReservedEvent(event.getOrderId(), event.getProductId()));
        } catch (InsufficientStockException e) {
            // Failure: publish a failure event so the saga can compensate
            kafkaTemplate.send("inventory-events",
                new StockReservationFailedEvent(event.getOrderId(), e.getMessage()));
        }
    }

    // Compensating transaction: runs if payment fails AFTER stock was reserved
    // This is what "undoes" the stock reservation to keep data consistent
    @KafkaListener(topics = "payment-events", filter = "PaymentFailed")
    public void handlePaymentFailed(PaymentFailedEvent event) {
        releaseStock(event.getOrderId());
        log.info("Released stock for failed order {}", event.getOrderId());
    }
}

// === ORCHESTRATION: A central orchestrator coordinates the flow ===

@Service
public class OrderSagaOrchestrator {

    @SagaOrchestrationStart
    public void createOrder(OrderRequest request) {
        // The orchestrator explicitly tracks saga state in the database
        // This gives you a single place to see the status of any in-flight order
        OrderSaga saga = OrderSaga.builder()
            .orderId(UUID.randomUUID().toString())
            .request(request)
            .state(SagaState.STARTED)
            .build();

        sagaRepository.save(saga);

        // The orchestrator calls each service in sequence and handles outcomes
        inventoryService.reserve(saga.getOrderId(), request.getProductId(), request.getQuantity())
            .onSuccess(result -> {
                saga.setState(SagaState.INVENTORY_RESERVED);
                sagaRepository.save(saga);  // Persist progress — survives restarts
                paymentService.charge(saga.getOrderId(), request.getPayment())
                    .onSuccess(payResult -> confirmOrder(saga))
                    .onFailure(e -> compensateInventory(saga, e));  // Run compensation explicitly
            })
            .onFailure(e -> cancelOrder(saga, "Insufficient stock: " + e.getMessage()));
    }

    private void compensateInventory(OrderSaga saga, Exception e) {
        // Explicitly undo the previous step
        inventoryService.release(saga.getOrderId());
        cancelOrder(saga, "Payment failed: " + e.getMessage());
    }
}
```

The orchestration approach saves saga state to the database after each step. This means if the orchestrator process crashes mid-saga, a new instance can pick up from the last saved state and continue from where it left off — rather than starting over and potentially double-charging customers.

**Which to choose?** For a small number of services with clear ownership, choreography's loose coupling is appealing. For complex flows involving many services, or whenever you need visibility into "where did this order get stuck?", orchestration is worth the added coordination. Most production systems with 4+ saga participants use orchestration.

## Combining Patterns: The Full Resilience Stack

In production, you combine all four patterns for critical service calls. The annotation order matters because Resilience4j applies them inside-out:

```java
// Read the annotations from innermost to outermost:
// Bulkhead → TimeLimiter → CircuitBreaker → Retry
// 1. Bulkhead: assigns this call to the payment thread pool
// 2. TimeLimiter: cuts the call off if it runs longer than N seconds
// 3. CircuitBreaker: tracks failures and opens the circuit if threshold is exceeded
// 4. Retry: if the call fails, tries again (up to max-attempts) before the circuit records it
@CircuitBreaker(name = "payment", fallbackMethod = "paymentFallback")
@Retry(name = "payment")
@Bulkhead(name = "payment", type = Bulkhead.Type.THREADPOOL)
@TimeLimiter(name = "payment")
public CompletableFuture<PaymentResult> chargeCustomer(PaymentRequest request) {
    return CompletableFuture.supplyAsync(() -> paymentClient.charge(request));
}
```

Why this order? Retry wraps around CircuitBreaker means retries can occur even when the circuit is open — which defeats the purpose. The correct order ensures: the Bulkhead limits concurrent threads first, TimeLimiter enforces a hard deadline, CircuitBreaker accumulates failure statistics, and Retry attempts recovery before declaring a failure to the circuit breaker.

**Resilience pattern decision guide:**

| Failure Type | Pattern |
|---|---|
| Transient (network blip) | Retry with backoff |
| Persistent downstream failure | Circuit Breaker |
| Resource exhaustion | Bulkhead |
| Long response times | Timeout + Circuit Breaker |
| Multi-step distributed operation | Saga |
| All of the above | All of the above |

The key insight: **resilience is not about preventing failures, it's about controlling how failures propagate**. Every distributed system will experience failures — the question is whether a payment service outage takes down your entire platform or just the checkout flow. These four patterns answer that question.

Start with the circuit breaker and retry — they cover the majority of failure scenarios with minimal complexity. Add bulkheads when you identify that one slow service is stealing resources from others. Add sagas when you have multi-step operations that need compensating logic. Apply them incrementally, measure the impact, and only add the next layer when the data shows you need it.
