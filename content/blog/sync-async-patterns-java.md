---
title: "Sync vs Async in Java: CompletableFuture, Reactive Streams, and Virtual Threads"
description: "Master Java's concurrency toolkit — from blocking calls and thread pools to CompletableFuture chains, Project Reactor, and the new virtual thread model. Know when each is the right tool."
date: "2025-01-26"
category: "Java"
tags: ["java", "async", "concurrency", "reactive", "spring boot", "webflux"]
featured: false
affiliateSection: "java-courses"
---

Java has accumulated three distinct paradigms for handling concurrency over the past 15 years: traditional blocking threads, CompletableFuture-based async composition, and reactive programming with Project Reactor/RxJava. Now Java 21 adds virtual threads. Each solves a real problem — but choosing the wrong one for your use case introduces unnecessary complexity or leaves performance on the table.

This article gives you the mental model to choose correctly.

## The Core Problem: Threads Are Expensive

Before comparing the options, it helps to understand precisely why concurrency is a challenge in the first place. A Java thread waiting on IO (database query, HTTP call, disk read) **holds an OS thread** that could be serving other requests. With a thread pool of 200 (Tomcat default), you can handle 200 concurrent IO-bound requests before requests start queuing. The following breakdown shows how quickly that limit becomes a bottleneck as concurrency grows:

```
200 concurrent users, each waits 100ms for DB:
  Sequential (1 thread): 200 × 100ms = 20 seconds
  200 threads (Tomcat default): all 200 run concurrently → 100ms total
  1,000 concurrent users: 800 queue behind 200 threads → queueing latency

Solution options:
  1. Bigger thread pool (200 → 2000): High memory usage, GC pressure
  2. Non-blocking async: Release thread during IO wait → serve more with fewer threads
  3. Virtual threads (Java 21): OS-level non-blocking, write blocking code
```

## Option 1: Blocking I/O with Bounded Thread Pool

The simplest model. Still correct for most applications with moderate concurrency. If your service handles fewer than a few hundred concurrent requests and all of them are short CRUD operations, this is likely all you need — additional complexity buys you nothing:

```java
@Service
public class OrderService {

    @Autowired
    private OrderRepository repository;  // Blocking JDBC

    // Runs on Tomcat thread pool (default 200 threads)
    // Blocking — holds thread during DB wait
    public Order getOrder(String orderId) {
        return repository.findById(orderId)  // Blocks thread here
            .orElseThrow(() -> new OrderNotFoundException(orderId));
    }
}
```

**When this is fine:**
- < 200 concurrent requests that involve IO
- Simple CRUD operations
- Teams unfamiliar with async patterns (simplicity wins)

**When this breaks:**
- > 1000 concurrent requests with IO wait
- Long-polling, WebSockets, streaming endpoints
- Services calling 5+ downstream APIs per request

## Option 2: CompletableFuture — Async Composition

CompletableFuture (Java 8+) runs tasks asynchronously and composes their results without blocking threads. It is most useful when you need to execute multiple independent IO operations in parallel and combine their results — turning sequential waits into concurrent ones. The following example builds a dashboard by fetching a user profile, recent orders, and notifications at the same time rather than one after another:

```java
@Service
public class DashboardService {

    // Run three API calls concurrently — don't wait for each one serially
    public CompletableFuture<Dashboard> buildDashboard(String userId) {
        Executor executor = ForkJoinPool.commonPool(); // Or custom executor

        CompletableFuture<UserProfile> profileFuture =
            CompletableFuture.supplyAsync(() -> fetchProfile(userId), executor);

        CompletableFuture<List<Order>> ordersFuture =
            CompletableFuture.supplyAsync(() -> fetchRecentOrders(userId, 10), executor);

        CompletableFuture<List<Notification>> notifFuture =
            CompletableFuture.supplyAsync(() -> fetchNotifications(userId), executor);

        // Combine all three: continue only when all complete
        return CompletableFuture.allOf(profileFuture, ordersFuture, notifFuture)
            .thenApply(__ -> new Dashboard(
                profileFuture.join(),   // .join() here is safe — allOf guarantees completion
                ordersFuture.join(),
                notifFuture.join()
            ))
            .exceptionally(e -> {
                log.error("Dashboard build failed for user {}: {}", userId, e.getMessage());
                return Dashboard.empty(); // Graceful degradation
            });
    }
}
```

### CompletableFuture Chaining

Once you have a single async result, you can chain subsequent operations using `thenApply` and `thenCompose`. The distinction between these two methods is the most important thing to understand: use `thenApply` when the next step is synchronous, and `thenCompose` when the next step is itself asynchronous and returns a `CompletableFuture`. Mixing them up leads to nested `CompletableFuture<CompletableFuture<T>>` types that are difficult to unwrap correctly:

```java
public CompletableFuture<String> processOrder(String orderId) {
    return CompletableFuture
        .supplyAsync(() -> orderRepository.findById(orderId))    // Fetch order
        .thenApply(order -> validateOrder(order))                // Validate (sync)
        .thenCompose(order -> inventoryService.reserveAsync(order)) // Reserve (async)
        .thenCompose(reserved -> paymentService.chargeAsync(reserved)) // Charge (async)
        .thenApply(result -> result.getConfirmationId())        // Extract ID (sync)
        .whenComplete((result, error) -> {
            if (error != null) {
                auditLog.logFailure(orderId, error);
            } else {
                auditLog.logSuccess(orderId, result);
            }
        });
}
```

**Key CompletableFuture methods:**

| Method | Input | Output | Notes |
|---|---|---|---|
| `thenApply` | sync function | CF of result | Transform result synchronously |
| `thenCompose` | async function returning CF | CF of result | Chain async operations (flatMap) |
| `thenCombine` | two CFs | CF of combined | Merge two concurrent results |
| `allOf` | N CFs | CF<Void> | Wait for all |
| `anyOf` | N CFs | CF<Object> | First to complete wins |
| `exceptionally` | exception handler | CF of fallback | Handle errors |
| `whenComplete` | BiConsumer | CF of result | Side effect on completion |

### CompletableFuture Pitfalls

CompletableFuture is easy to misuse in ways that silently defeat its purpose. The two most common mistakes involve either blocking inside the async chain, or using the wrong thread pool for IO-bound work:

```java
// WRONG: Blocking inside async chain — wastes the thread
CompletableFuture.supplyAsync(() -> {
    return httpClient.get(url).get(); // .get() BLOCKS the thread!
    // Defeats the purpose of async
});

// WRONG: Using ForkJoinPool for blocking IO
CompletableFuture.supplyAsync(() -> jdbcTemplate.queryForList(sql));
// ForkJoinPool is for CPU-bound work — blocking IO starves it
// Use a dedicated IO thread pool instead

// RIGHT: Separate executor for IO-bound async tasks
Executor ioExecutor = Executors.newFixedThreadPool(50);

CompletableFuture.supplyAsync(() -> jdbcTemplate.queryForList(sql), ioExecutor);
```

The reason `ForkJoinPool` is wrong for IO work is subtle: `ForkJoinPool` is designed to keep all threads busy with CPU work by work-stealing. If your tasks block on IO, those threads sit idle and the pool cannot compensate by spinning up new ones — you end up with all threads blocked and new tasks queuing up behind them.

## Option 3: Project Reactor (Spring WebFlux)

Reactor provides a fully non-blocking reactive pipeline using `Mono` (0-1 elements) and `Flux` (0-N elements). Unlike `CompletableFuture`, which models a single eventual value, Reactor can model streams of values over time — making it the right choice for server-sent events, WebSocket feeds, and any scenario where the producer generates data faster than the consumer can process it. The entire call stack must be non-blocking — including database drivers (R2DBC) and HTTP clients (WebClient):

```java
@RestController
public class ReactiveOrderController {

    @Autowired
    private R2dbcOrderRepository repository;  // Non-blocking R2DBC

    @Autowired
    private WebClient inventoryClient;

    // Flux: stream of events (Server-Sent Events)
    @GetMapping(value = "/orders/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<Order> streamOrders() {
        return repository.findAll()
            .delayElements(Duration.ofMillis(100)) // Throttle for streaming
            .doOnError(e -> log.error("Stream error", e));
    }

    // Mono: single order with enrichment
    @GetMapping("/orders/{id}")
    public Mono<OrderDetail> getOrderDetail(@PathVariable String id) {
        return repository.findById(id)
            .switchIfEmpty(Mono.error(new OrderNotFoundException(id)))
            .flatMap(order ->
                inventoryClient.get()
                    .uri("/items/{id}", order.getItemId())
                    .retrieve()
                    .bodyToMono(Item.class)
                    .map(item -> new OrderDetail(order, item))
            )
            .timeout(Duration.ofSeconds(3))
            .onErrorResume(TimeoutException.class, e -> {
                log.warn("Inventory timeout for order {}", id);
                return repository.findById(id).map(o -> new OrderDetail(o, Item.unknown()));
            });
    }
}
```

The `onErrorResume` block at the end demonstrates one of Reactor's strengths over `CompletableFuture`: typed error handling. You can match on the specific exception type (`TimeoutException`) and provide a degraded response — in this case returning the order with an `Item.unknown()` placeholder rather than failing the entire request.

### subscribeOn vs publishOn

The most confusing part of Reactor is understanding which thread executes which part of your pipeline. Reactor uses a scheduler model where you explicitly control thread assignment. The key mental model is that `subscribeOn` affects the entire upstream (where subscription starts), while `publishOn` is a one-way switch that affects only the operators that come after it:

```java
Flux.fromIterable(largeList)
    .subscribeOn(Schedulers.boundedElastic())  // Which thread SUBSCRIBES (starts) the chain
    .map(item -> expensiveComputation(item))   // Runs on subscribeOn thread
    .publishOn(Schedulers.parallel())          // Switch thread for downstream ops
    .map(result -> transformResult(result))    // Runs on parallel scheduler
    .subscribe(result -> log.info(result));    // Runs on parallel scheduler

// subscribeOn: affects where the entire upstream runs
// publishOn: switches scheduler for operations AFTER it in the chain
```

**Reactor schedulers:**

| Scheduler | Use For |
|---|---|
| `Schedulers.parallel()` | CPU-bound work, sized to CPU cores |
| `Schedulers.boundedElastic()` | Blocking IO wrappers, sized dynamically (max 10×CPU) |
| `Schedulers.immediate()` | Current thread (no context switch) |
| `Schedulers.single()` | Sequential background tasks, 1 thread |

### Wrapping Blocking IO in Reactor

If you are migrating an existing application to WebFlux incrementally, you will likely have some JDBC or legacy code that cannot be made reactive immediately. The correct approach is to wrap it in `Mono.fromCallable` and offload it to `boundedElastic`, which is specifically designed to handle a dynamic number of blocking IO tasks:

```java
// Database calls (without R2DBC), legacy APIs — wrap in boundedElastic
public Mono<Order> getOrder(String id) {
    return Mono.fromCallable(() -> jdbcOrderRepository.findById(id)) // Blocking
        .subscribeOn(Schedulers.boundedElastic()) // Run on IO-capable scheduler
        .doOnError(e -> log.error("DB error", e));
}

// DON'T: Call blocking code on parallel() scheduler — starves CPU threads
public Mono<Order> broken(String id) {
    return Mono.fromCallable(() -> jdbcOrderRepository.findById(id))
        .subscribeOn(Schedulers.parallel()); // WRONG for IO
}
```

## Option 4: Virtual Threads (Java 21)

Virtual threads write like blocking code but scale like reactive code. If you are starting a new project on Java 21, virtual threads should be your first consideration for IO-bound services — they give you the readability of blocking code without the scalability ceiling of platform threads and without the learning curve of reactive programming:

```java
// Same blocking code — but runs on a virtual thread
// No CompletableFuture composition, no subscribeOn, no reactive operators
@GetMapping("/orders/{id}")
public OrderDetail getOrderDetail(@PathVariable String id) {
    // All these block the current virtual thread — not the OS carrier thread
    Order order = orderRepository.findById(id)  // Blocks VT
        .orElseThrow(() -> new OrderNotFoundException(id));

    Item item = inventoryClient.getItem(order.getItemId()); // Blocks VT

    return new OrderDetail(order, item); // Simple, readable, debuggable
}
```

Compare this to the equivalent `Mono`-based version above. The virtual thread version is shorter, has full stack traces, works naturally with debuggers, and is immediately readable to anyone who knows Java — without sacrificing the ability to handle thousands of concurrent requests. See the Java Virtual Threads article for full details on configuration and pitfalls.

## Decision Tree

With all four options covered, use this decision tree to choose the right approach for your situation. The single most impactful question is whether you are on Java 21 or later — if you are, virtual threads eliminate most of the reasons to reach for `CompletableFuture` or Reactor for IO-bound work:

```
Is your workload IO-bound (DB, HTTP, files)?
├── YES: How many concurrent requests?
│   ├── < 500: Platform threads (blocking), simple, fast to develop
│   ├── 500-10K: Virtual threads (Java 21) OR CompletableFuture
│   └── > 10K: Virtual threads (Java 21) OR Reactive (WebFlux + R2DBC)
│
└── NO (CPU-bound: sorting, compression, ML inference):
    └── ForkJoinPool / parallel streams (thread-per-core)

Using Java 21+?
├── YES: Virtual threads for most IO cases — simple and scalable
└── NO:  CompletableFuture (fan-out) or Reactor (streaming, backpressure)

Need backpressure (consumer slower than producer)?
└── YES: Project Reactor Flux — built-in backpressure via demand signals

Need to stream data to client (SSE, WebSocket)?
└── YES: Project Reactor Flux with streaming media type
```

## Performance Comparison (IO-bound, 50ms wait per request)

The numbers in the table below are the most important takeaway from this article. They quantify what the decision tree above implies: at low concurrency every approach performs similarly, but the differences become dramatic as you scale past the platform thread pool limit. Notice how blocking threads hit a hard wall while the other approaches continue to scale:

```
Concurrency │ Blocking (200 threads) │ CompletableFuture │ Reactor │ Virtual Threads
────────────┼────────────────────────┼────────────────────┼─────────┼────────────────
       200  │ 3,900 rps, p99: 52ms   │ 3,950 rps, 51ms   │ 3,980   │ 3,960 rps, 51ms
     1,000  │   980 rps, p99: 1.02s  │ 9,700 rps, 103ms  │ 9,800   │ 9,800 rps, 52ms
    10,000  │ timeout (queue full)   │ 47K rps, 210ms    │ 96K rps  │ 97K rps, 53ms
    50,000  │ OOM                    │ 50K rps, OOM risk │ 97K rps  │ 96K rps, 56ms
```

**Takeaways:**
- CompletableFuture helps but still requires thread pool management
- Reactor and virtual threads achieve similar throughput for IO-bound workloads
- Reactor has better backpressure for streaming; virtual threads are simpler to write and maintain

The right choice depends on your Java version, team familiarity, and streaming requirements — not on which paradigm is theoretically "best".
