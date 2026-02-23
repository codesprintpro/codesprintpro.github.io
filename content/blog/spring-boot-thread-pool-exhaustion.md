---
title: "Thread Pool Exhaustion in Spring Boot: Diagnosis, Prevention, and Recovery"
description: "How Tomcat thread pools work, why blocking I/O kills throughput, and the production patterns that prevent thread pool exhaustion in Spring Boot services. Includes real outage scenario and JVM tuning."
date: "2025-04-08"
category: "Java"
tags: ["spring boot", "java", "tomcat", "thread pool", "async", "performance", "resilience"]
featured: false
affiliateSection: "java-courses"
---

Thread pool exhaustion is one of the most deceptive production failures in Spring Boot services. The service is technically running — JVM process alive, health endpoint returning 200, no OutOfMemoryError in logs — but requests pile up, latencies spike to 30 seconds, and then everything times out. On-call gets paged. The fix is usually a restart, which masks the root cause until it happens again.

This article explains the mechanism precisely, shows you the math, and gives you the production patterns to prevent it.

## How Tomcat Thread Pools Work

Spring Boot's default embedded server is Tomcat. Tomcat uses a fixed thread pool to process HTTP requests.

```
HTTP Request
     │
     ▼
┌────────────────────┐
│  Acceptor Thread   │  (accepts TCP connections, non-blocking)
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│  Connection Queue  │  (bounded, default maxConnections=8192)
└────────┬───────────┘
         │
         ▼
┌────────────────────────────────────┐
│  Tomcat Thread Pool                │
│  min: 10 threads (minSpareThreads) │
│  max: 200 threads (maxThreads)     │
└────────────────────────────────────┘
         │
         ▼
    @Controller method executes on this thread
    (BLOCKS until method returns)
```

The critical constraint: **each active HTTP request holds exactly one Tomcat thread**. The thread is occupied for the entire duration of request processing — including all database calls, external HTTP calls, and I/O. The default maximum is 200 threads.

## The Blocking I/O Impact: The Math

Consider a Spring Boot service making a database call. Assume:
- Database query latency: 100ms average
- Tomcat max threads: 200
- Incoming request rate: 1,000 requests/second

Under steady state, how many threads are occupied?

```
Threads occupied = Request rate × Average response time
                 = 1,000 req/s × 0.1 s
                 = 100 threads occupied
```

100 threads occupied out of 200 — we're at 50% capacity with headroom. Now the database slows down to 500ms due to a slow query:

```
Threads occupied = 1,000 req/s × 0.5 s = 500 threads
```

500 threads required, only 200 available. The thread pool exhausts in milliseconds. New requests queue, then time out. This is the cascade.

The dangerous property: **a 5× increase in downstream latency causes a 5× increase in required threads**. Under load, systems don't degrade linearly — they collapse.

## Async vs Sync Controller Comparison

The conventional Spring MVC model is synchronous. Every request blocks a thread:

```java
// SYNC - holds Tomcat thread for entire duration
@GetMapping("/order/{id}")
public OrderResponse getOrder(@PathVariable String id) {
    Order order = orderRepository.findById(id).orElseThrow(); // blocks 20ms
    List<Item> items = itemService.getItems(order.getId());   // blocks 50ms
    PriceResult price = pricingService.calculate(items);      // blocks 30ms
    return OrderResponse.from(order, items, price);
    // Total: ~100ms holding 1 Tomcat thread
}
```

Spring MVC supports `DeferredResult` and `Callable` for asynchronous processing, which releases the Tomcat thread while work proceeds on another thread:

```java
// ASYNC with DeferredResult - releases Tomcat thread immediately
@GetMapping("/order/{id}")
public DeferredResult<OrderResponse> getOrder(@PathVariable String id) {
    DeferredResult<OrderResponse> result = new DeferredResult<>(5000L);

    CompletableFuture
        .supplyAsync(() -> orderRepository.findById(id).orElseThrow(), asyncExecutor)
        .thenApplyAsync(order -> {
            List<Item> items = itemService.getItems(order.getId());
            return Pair.of(order, items);
        }, asyncExecutor)
        .thenAcceptAsync(pair -> {
            PriceResult price = pricingService.calculate(pair.getSecond());
            result.setResult(OrderResponse.from(pair.getFirst(), pair.getSecond(), price));
        }, asyncExecutor)
        .exceptionally(ex -> {
            result.setErrorResult(ex);
            return null;
        });

    return result; // Tomcat thread is FREE after this return
}
```

Spring WebFlux (Reactor-based) takes this further with a reactive pipeline that uses a small number of event loop threads to handle many concurrent requests without blocking:

```java
// WebFlux - non-blocking from top to bottom
@GetMapping("/order/{id}")
public Mono<OrderResponse> getOrder(@PathVariable String id) {
    return orderRepository.findById(id) // reactive repo
        .flatMap(order -> itemService.getItemsReactive(order.getId())
            .flatMap(items -> pricingService.calculateReactive(items)
                .map(price -> OrderResponse.from(order, items, price))
            )
        );
}
```

WebFlux can handle 10,000+ concurrent requests with 8 threads — but it requires your entire stack to be non-blocking. A single blocking call inside a reactive chain pins an event loop thread and destroys your throughput.

## Connection Pool Exhaustion

Thread pool exhaustion and database connection pool exhaustion are different problems that often arrive together. HikariCP defaults:

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 10      # default - dangerously low
      minimum-idle: 10
      connection-timeout: 30000  # 30s - too high for production
      idle-timeout: 600000
      max-lifetime: 1800000
```

The right formula for HikariCP pool size:

```
pool_size = (core_count * 2) + effective_spindle_count

For a 4-core server with SSD:
pool_size = (4 * 2) + 1 = 9 connections
```

This seems counterintuitively small. The reason: more connections than the database can process concurrently causes context switching at the DB server level that makes everything slower. HikariCP's own research shows ~10 connections often outperforms 100.

Set `connection-timeout` to match your SLA minus overhead — if your API must respond in 2 seconds and a query takes up to 1 second, your connection timeout should be under 500ms. A 30-second connection timeout means threads wait 30 seconds for a connection before failing — during which they hold Tomcat threads.

```java
// Explicit HikariCP config for production
@Bean
public DataSource dataSource() {
    HikariConfig config = new HikariConfig();
    config.setJdbcUrl("jdbc:postgresql://db:5432/mydb");
    config.setMaximumPoolSize(10);
    config.setMinimumIdle(5);
    config.setConnectionTimeout(2000);   // Fail fast: 2s timeout
    config.setIdleTimeout(300000);       // 5 minutes
    config.setMaxLifetime(900000);       // 15 minutes
    config.setValidationTimeout(1000);   // 1s validation
    config.addDataSourceProperty("cachePrepStmts", "true");
    config.addDataSourceProperty("prepStmtCacheSize", "250");
    return new HikariDataSource(config);
}
```

## Backpressure Strategy

When your thread pool is full, Tomcat queues requests in the `acceptCount` queue (default: 100). When that fills, new TCP connections are refused. This is Tomcat's built-in backpressure — it's crude but it works.

You can shape it:

```properties
server.tomcat.threads.max=200
server.tomcat.threads.min-spare=20
server.tomcat.accept-count=50       # Keep queue short - fail fast
server.tomcat.max-connections=2000
server.connection-timeout=5000      # 5s connection timeout
```

A short `accept-count` means you fail fast when overloaded — clients see a connection refused immediately rather than waiting 30 seconds in queue. Failing fast is almost always better than hanging.

## Circuit Breaker Integration

Thread pool exhaustion almost always traces to a slow downstream dependency. Wrap external calls with Resilience4j circuit breakers:

```java
@Service
public class PaymentGatewayClient {

    private final CircuitBreaker circuitBreaker;
    private final TimeLimiter timeLimiter;

    public PaymentGatewayClient(CircuitBreakerRegistry registry,
                                 TimeLimiterRegistry timeLimiterRegistry) {
        CircuitBreakerConfig config = CircuitBreakerConfig.custom()
            .slidingWindowSize(20)
            .failureRateThreshold(50)        // Open after 50% failure rate
            .waitDurationInOpenState(Duration.ofSeconds(10))
            .permittedNumberOfCallsInHalfOpenState(5)
            .slowCallDurationThreshold(Duration.ofMillis(500)) // 500ms = slow
            .slowCallRateThreshold(80)        // Open if 80% calls are slow
            .build();

        this.circuitBreaker = registry.circuitBreaker("payment-gateway", config);

        TimeLimiterConfig tlConfig = TimeLimiterConfig.custom()
            .timeoutDuration(Duration.ofMillis(800))
            .cancelRunningFuture(true)
            .build();
        this.timeLimiter = timeLimiterRegistry.timeLimiter("payment-gateway", tlConfig);
    }

    public PaymentResult charge(PaymentRequest req) {
        Supplier<CompletableFuture<PaymentResult>> futureSupplier =
            () -> CompletableFuture.supplyAsync(() -> callExternalGateway(req), asyncExecutor);

        Callable<PaymentResult> restrictedCall =
            TimeLimiter.decorateFutureSupplier(timeLimiter, futureSupplier);

        Callable<PaymentResult> circuitBreakerCall =
            CircuitBreaker.decorateCallable(circuitBreaker, restrictedCall);

        return Try.ofCallable(circuitBreakerCall)
            .recover(CallNotPermittedException.class, e -> PaymentResult.circuitOpen())
            .recover(TimeoutException.class, e -> PaymentResult.timeout())
            .get();
    }
}
```

The `slowCallDurationThreshold` is critical. A circuit breaker that only trips on errors won't protect you from a slow dependency that eventually exhausts your thread pool while technically succeeding.

## Real Production Outage Scenario

**System:** Order processing service, Spring Boot 2.7, Tomcat 200 threads, HikariCP 10 connections, PostgreSQL RDS.

**Timeline:**
- 14:00: RDS replica promotion during maintenance window, brief failover
- 14:03: During 30-second DB reconnect window, all 10 HikariCP connections time out waiting
- 14:03: Requests pile up waiting for DB connections (30s `connectionTimeout`)
- 14:04: All 200 Tomcat threads occupied, waiting for DB connections
- 14:04: Tomcat accept queue fills (50 requests), new connections refused
- 14:04: API gateway marks service unhealthy, starts shedding load
- 14:05: DB reconnects. HikariCP establishes connections. But...
- 14:05–14:08: Backlog of 200+ in-flight requests completes, some after 30s timeout
- 14:08: Service recovers on its own — but 5 minutes of downtime and thousands of errors

**Root cause:** A 30-second `connection-timeout` created a 30-second thread holding duration during DB unavailability. The fix was reducing `connection-timeout` to 2000ms and adding exponential backoff retry logic for transient DB failures.

## JVM Tuning for Thread-Heavy Applications

Each thread reserves stack memory. Default stack size is 512KB on most JVMs:

```
200 threads × 512KB = 100MB of stack memory reserved
```

For applications with many threads, reduce stack size if your call stacks are shallow:

```bash
-Xss256k   # Reduce thread stack from 512K to 256K
```

G1GC settings for latency-sensitive services:

```bash
-XX:+UseG1GC
-XX:MaxGCPauseMillis=100        # Target 100ms max GC pause
-XX:G1HeapRegionSize=16m        # Larger regions for big heaps
-XX:InitiatingHeapOccupancyPercent=35
-XX:+ParallelRefProcEnabled
-XX:+DisableExplicitGC          # Prevent System.gc() calls
```

## Monitoring with Prometheus and Grafana

Key metrics to track thread pool health:

```yaml
# application.properties
management.endpoints.web.exposure.include=prometheus,health,metrics
management.metrics.enable.tomcat=true
```

```java
// Custom metric: track thread pool utilization
@Component
public class ThreadPoolMetrics {

    private final ThreadPoolTaskExecutor asyncExecutor;
    private final MeterRegistry meterRegistry;

    @PostConstruct
    public void registerMetrics() {
        Gauge.builder("app.thread_pool.active_threads", asyncExecutor,
                      executor -> executor.getActiveCount())
            .description("Active threads in async executor")
            .register(meterRegistry);

        Gauge.builder("app.thread_pool.queue_size", asyncExecutor,
                      executor -> executor.getThreadPoolExecutor().getQueue().size())
            .description("Async executor queue depth")
            .register(meterRegistry);
    }
}
```

Grafana alert rules:
```
# Alert: Thread pool near exhaustion
tomcat_threads_busy_threads / tomcat_threads_config_max_threads > 0.85

# Alert: Connection pool exhausted
hikaricp_connections_pending > 0 for 30s

# Alert: High response latency (symptom of thread starvation)
http_server_requests_seconds_p99 > 2.0
```

## Thread Dump Analysis

When a service is hanging, take a thread dump immediately:

```bash
jstack <pid> > thread-dump.txt
# Or via JMX:
kill -3 <pid>   # Sends SIGQUIT, dumps to stdout
```

Patterns that indicate thread pool exhaustion:

```
# Thread blocked waiting for DB connection:
"http-nio-8080-exec-47" WAITING on com.zaxxer.hikari.util.ConcurrentBag$1
    at sun.misc.Unsafe.park(Native Method)
    at HikariPool.getConnection(HikariPool.java:213)
    at OrderController.getOrder(OrderController.java:45)

# Count blocked threads:
grep -c "WAITING on com.zaxxer.hikari" thread-dump.txt
```

If you see 50+ threads waiting on HikariCP, your connection pool is the bottleneck. If threads are waiting on external HTTP calls, your downstream is slow.

## Tomcat Configuration for Production

```java
@Bean
public TomcatServletWebServerFactory tomcatFactory() {
    TomcatServletWebServerFactory factory = new TomcatServletWebServerFactory();
    factory.addConnectorCustomizers(connector -> {
        ProtocolHandler handler = connector.getProtocolHandler();
        if (handler instanceof AbstractProtocol<?> protocol) {
            protocol.setMaxThreads(200);
            protocol.setMinSpareThreads(20);
            protocol.setAcceptCount(50);
            protocol.setConnectionTimeout(5000);
            protocol.setKeepAliveTimeout(20000);
            protocol.setMaxKeepAliveRequests(200);
        }
    });
    return factory;
}
```

## Lessons Learned from Production

**1. Short timeouts everywhere.** Every blocking operation — DB query, HTTP call, lock acquisition — must have a timeout shorter than your SLA. A missing timeout is a thread leak waiting to happen.

**2. Size thread pools to match downstream capacity.** If your DB can handle 10 concurrent queries, having 200 Tomcat threads is counterproductive — they'll all race for 10 connections. Align pool sizes across the call chain.

**3. Instrument thread pool utilization, not just request latency.** P99 latency spikes are a lagging indicator. Thread pool utilization at 80% is an early warning.

**4. Fail fast under load.** A 50-request `accept-count` and 2-second `connection-timeout` mean failures are visible in 2 seconds, not 30. Operators can respond; monitoring can alert. Silent accumulation is far worse.

**5. One slow downstream can take down your service.** Circuit breakers are not optional in microservice architectures. Every external call that can be slow must be wrapped.

Thread pool exhaustion is entirely preventable once you understand the mechanics. The failure mode is almost always: slow downstream + missing timeout + no circuit breaker = cascading thread starvation. Fix any one of those three and the cascade stops.
