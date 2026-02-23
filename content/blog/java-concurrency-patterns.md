---
title: "Java Concurrency Patterns: CompletableFuture, Structured Concurrency, and Thread-Safe Design"
description: "Production Java concurrency: CompletableFuture pipelines, handling exceptions in async chains, Java 21 structured concurrency, thread-safe collection patterns, and the concurrency bugs that cause data corruption."
date: "2025-07-08"
category: "Java"
tags: ["java", "concurrency", "completablefuture", "virtual threads", "java21", "thread-safe", "async"]
featured: false
affiliateSection: "java-courses"
---

Java concurrency has three eras: raw `Thread` and `synchronized` (Java 1-4), the `java.util.concurrent` framework (Java 5+), and the virtual thread/structured concurrency era (Java 21+). Each era's patterns still exist in production codebases. Understanding all three — and knowing which to use when — separates engineers who write concurrent code from engineers who write correct concurrent code.

## CompletableFuture: Composing Async Operations

`CompletableFuture` is the fundamental async primitive since Java 8. It represents a future value and provides a fluent API for transforming and combining async results.

```java
// Parallel data fetching with CompletableFuture:
public OrderSummary buildOrderSummary(String orderId) {
    Executor executor = ForkJoinPool.commonPool(); // Or custom executor

    CompletableFuture<Order> orderFuture = CompletableFuture
        .supplyAsync(() -> orderRepo.findById(orderId), executor);

    CompletableFuture<Customer> customerFuture = orderFuture
        .thenApplyAsync(order -> customerRepo.findById(order.getCustomerId()), executor);

    CompletableFuture<List<Product>> productsFuture = orderFuture
        .thenApplyAsync(order ->
            productRepo.findAllById(order.getProductIds()), executor);

    CompletableFuture<ShippingStatus> shippingFuture = orderFuture
        .thenApplyAsync(order ->
            shippingService.getStatus(order.getShipmentId()), executor);

    // Combine results (customer + products + shipping in parallel after order loads):
    return CompletableFuture.allOf(customerFuture, productsFuture, shippingFuture)
        .thenApply(v -> OrderSummary.builder()
            .order(orderFuture.join())
            .customer(customerFuture.join())
            .products(productsFuture.join())
            .shipping(shippingFuture.join())
            .build())
        .join();
}
```

`orderFuture` runs first; `customerFuture`, `productsFuture`, and `shippingFuture` all start after `orderFuture` completes but run in parallel with each other. The total time is `order_fetch + max(customer, products, shipping)` instead of the sum.

**Exception handling in async chains:**

```java
CompletableFuture<PricingResult> priceFuture = CompletableFuture
    .supplyAsync(() -> pricingService.calculate(request))
    .exceptionally(ex -> {
        log.warn("Pricing service failed, using fallback: {}", ex.getMessage());
        return PricingResult.fallback(request.getBasePrice()); // Graceful degradation
    })
    .thenApply(pricing -> applyDiscounts(pricing))
    .handle((result, ex) -> {
        // handle() receives BOTH result and exception (either may be null)
        if (ex != null) {
            metrics.recordPricingError(ex);
            return PricingResult.fallback(request.getBasePrice());
        }
        metrics.recordPricingSuccess();
        return result;
    });
```

**Critical pitfall: join() blocks — use carefully:**

```java
// BAD: Calling join() inside an async chain on ForkJoinPool common pool
CompletableFuture.supplyAsync(() -> {
    // This is running on ForkJoinPool.commonPool()
    String result = anotherFuture.join(); // BLOCKS a ForkJoinPool thread
    // If all threads are blocked waiting for other futures: DEADLOCK
    return process(result);
});

// GOOD: Use thenCompose for chaining async operations:
CompletableFuture<String> result = firstFuture
    .thenComposeAsync(value -> createSecondFuture(value), customExecutor);
```

## Custom Executors: Don't Use the Default

`ForkJoinPool.commonPool()` is shared across the entire JVM. In a Spring Boot application, Tomcat, Spring's `@Async`, CompletableFuture defaults, and parallel streams all compete for it. Use dedicated executors:

```java
@Configuration
public class ExecutorConfig {

    @Bean("ioExecutor")
    public ExecutorService ioExecutor() {
        return new ThreadPoolExecutor(
            10,           // corePoolSize
            50,           // maximumPoolSize
            60, TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(200),  // bounded queue — important!
            new ThreadFactoryBuilder()
                .setNameFormat("io-worker-%d")
                .build(),
            new ThreadPoolExecutor.CallerRunsPolicy()  // Backpressure: caller thread runs task
        );
    }

    @Bean("cpuExecutor")
    public ExecutorService cpuExecutor() {
        int cores = Runtime.getRuntime().availableProcessors();
        return Executors.newFixedThreadPool(cores,
            new ThreadFactoryBuilder().setNameFormat("cpu-worker-%d").build());
    }
}

// Usage:
CompletableFuture
    .supplyAsync(() -> fetchFromDatabase(id), ioExecutor)     // I/O bound
    .thenApplyAsync(data -> processData(data), cpuExecutor)  // CPU bound
    .thenApplyAsync(result -> saveResult(result), ioExecutor) // I/O bound
```

**Bounded queues are mandatory.** An unbounded queue (`LinkedBlockingQueue()` with no capacity) allows tasks to queue indefinitely, consuming memory and masking backpressure problems. A bounded queue with `CallerRunsPolicy` provides natural backpressure: when the executor is full, the calling thread executes the task directly — slowing the producer.

## Java 21 Structured Concurrency

Structured concurrency (JEP 453, finalized in Java 21) makes concurrent task lifetime match lexical scope — no task outlives its parent scope:

```java
// Classic CompletableFuture: tasks can outlive scope, error handling is scattered
// Structured concurrency: all tasks within try-block, exceptions propagate cleanly

public OrderSummary buildSummary(String orderId) throws InterruptedException {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        // Fork concurrent subtasks:
        Subtask<Order> orderTask = scope.fork(() -> orderRepo.findById(orderId));
        Subtask<Inventory> inventoryTask = scope.fork(() -> inventoryService.check(orderId));
        Subtask<PriceResult> priceTask = scope.fork(() -> pricingService.calculate(orderId));

        // Wait for all tasks (or until one fails):
        scope.join()           // Wait for all
             .throwIfFailed(); // Throw if any failed (cancels remaining)

        // All tasks succeeded — results are available:
        return OrderSummary.of(
            orderTask.get(),
            inventoryTask.get(),
            priceTask.get()
        );
    }
    // When try-block exits: ALL forked tasks are guaranteed to have completed
    // No task leaks, no partial results, clean cancellation
}
```

**ShutdownOnSuccess:** Return the first successful result, cancel the rest (racing pattern):

```java
public String fetchFromFastestReplica(String key) throws InterruptedException {
    try (var scope = new StructuredTaskScope.ShutdownOnSuccess<String>()) {
        scope.fork(() -> replicaA.get(key));
        scope.fork(() -> replicaB.get(key));
        scope.fork(() -> replicaC.get(key));

        scope.join();
        return scope.result();  // Returns result of first successful subtask
    }
    // The other 2 replicas are automatically cancelled
}
```

## Thread-Safe Collection Patterns

**ConcurrentHashMap vs synchronized HashMap:**

```java
// ConcurrentHashMap: lock striping — 16 independent segments, highly concurrent
ConcurrentHashMap<String, User> cache = new ConcurrentHashMap<>();

// computeIfAbsent is atomic — safe for cache population:
User user = cache.computeIfAbsent(userId, id -> userRepo.findById(id));

// NOT atomic: check-then-act on ConcurrentHashMap
if (!cache.containsKey(key)) {          // Thread A checks: false
    cache.put(key, computeExpensive());  // Thread B also passes check, both compute!
}
// Use computeIfAbsent instead.
```

**CopyOnWriteArrayList:** For read-heavy, write-rare scenarios:
```java
// Good for: event listeners, read-heavy configuration lists
// Bad for: frequent writes (every write copies the entire array)
CopyOnWriteArrayList<EventListener> listeners = new CopyOnWriteArrayList<>();
// Reads: zero synchronization (reads see a consistent snapshot)
// Writes: creates a new copy of the underlying array
```

**BlockingQueue for producer-consumer:**
```java
BlockingQueue<Task> queue = new LinkedBlockingQueue<>(1000); // Bounded!

// Producer thread:
queue.put(task); // Blocks if queue is full — natural backpressure

// Consumer thread:
Task task = queue.take(); // Blocks if queue is empty — no busy-waiting
```

## Common Concurrency Bugs

**Bug 1: Unsafe lazy initialization (double-checked locking without volatile)**

```java
// BROKEN: compilers/CPUs can reorder writes
private static DatabaseConnection instance;

public static DatabaseConnection getInstance() {
    if (instance == null) {
        synchronized (DatabaseConnection.class) {
            if (instance == null) {
                instance = new DatabaseConnection(); // 3 operations: alloc, init, assign
                // CPU can reorder: assign before init → other threads see half-initialized object
            }
        }
    }
    return instance;
}

// FIXED: volatile ensures visibility ordering
private static volatile DatabaseConnection instance;
// Or better: use initialization-on-demand holder:
private static class Holder {
    static final DatabaseConnection INSTANCE = new DatabaseConnection();
}
public static DatabaseConnection getInstance() { return Holder.INSTANCE; }
```

**Bug 2: Lost updates with compound operations**

```java
// BROKEN: read-modify-write is not atomic
private int counter = 0;
public void increment() { counter++; } // Actually: temp=counter; temp+1; counter=temp
// Two threads: both read 5, both write 6. Count is 6 not 7.

// FIXED:
private AtomicInteger counter = new AtomicInteger(0);
public void increment() { counter.incrementAndGet(); } // CAS — atomic

// Or for complex state:
private final Object lock = new Object();
private int counter = 0;
public synchronized void increment() { counter++; }
```

**Bug 3: Publishing objects before initialization completes**

```java
// BROKEN: 'this' escapes constructor before fully initialized
public class EventProcessor {
    private final List<String> processors;

    public EventProcessor(EventBus bus) {
        bus.register(this); // 'this' is published here...
        this.processors = new ArrayList<>(); // ...but this runs AFTER
        // Another thread calls handle() before processors is initialized → NPE
    }

    public void handle(Event e) {
        processors.add(e.toString()); // NullPointerException
    }
}

// FIXED: use factory method
public static EventProcessor create(EventBus bus) {
    EventProcessor ep = new EventProcessor();
    bus.register(ep); // Register after fully constructed
    return ep;
}
```

## AtomicReference for Lock-Free Updates

```java
// Thread-safe config hot-reload without locking:
private final AtomicReference<FeatureFlags> config =
    new AtomicReference<>(FeatureFlags.loadFromFile());

// Background thread refreshes config:
@Scheduled(fixedDelay = 60_000)
public void refreshConfig() {
    FeatureFlags newFlags = FeatureFlags.loadFromFile();
    config.set(newFlags); // Atomic swap — readers always see consistent snapshot
}

// Readers:
public boolean isEnabled(String feature) {
    return config.get().isEnabled(feature); // No locking needed
}

// CAS for optimistic updates:
public boolean tryUpdateFlag(String feature, boolean expected, boolean newValue) {
    FeatureFlags current = config.get();
    FeatureFlags updated = current.withFlag(feature, newValue);
    return config.compareAndSet(current, updated); // Succeeds only if unchanged
}
```

The rule for Java concurrency in 2025: prefer virtual threads + structured concurrency for I/O-bound concurrent work; use `CompletableFuture` when you need fine-grained composition; reach for `AtomicReference`/`ConcurrentHashMap` for shared mutable state; avoid raw `synchronized` blocks except for simple critical sections. The concurrency primitives introduced in Java 21 make the "correct by construction" approach significantly easier than it was five years ago.
