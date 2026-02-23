---
title: "Spring Boot Performance Tuning: From 200 to 2000 RPS"
description: "Systematic approach to Spring Boot performance tuning. Covers connection pooling, N+1 query elimination, caching strategies, async processing, and JVM tuning to multiply throughput."
date: "2025-03-13"
category: "Java"
tags: ["spring boot", "java", "performance", "hikaricp", "redis", "jpa", "tuning"]
featured: false
affiliateSection: "java-courses"
---

A Spring Boot application that handles 200 RPS on Day 1 often has the same underlying hardware capacity to handle 2000 RPS — the gap is how you use it. Most performance bottlenecks in Java web services follow predictable patterns: the database is waiting, threads are blocking, results are recomputed on every request. This guide walks through a systematic process to find and fix each category.

## Step 1: Measure Before Tuning

The single most important rule: **profile first, optimize second**. Optimizing what you think is slow is almost always wrong.

Before touching a single line of code, you need hard data. The tools below let you generate realistic load and identify exactly where your application spends its time — whether that's CPU computation, memory allocation, or waiting on I/O. Think of this step as the doctor ordering tests before prescribing medicine.

```bash
# Generate production-like load
# Apache Bench: 10,000 requests, 50 concurrent
ab -n 10000 -c 50 http://localhost:8080/api/orders

# k6: more realistic load simulation
k6 run --vus 50 --duration 60s - <<'EOF'
import http from 'k6/http';
import { check } from 'k6';

export default function() {
  const res = http.get('http://localhost:8080/api/orders');
  check(res, { 'status is 200': (r) => r.status === 200 });
}
EOF

# JVM metrics: CPU profiling with async-profiler (production-safe)
./profiler.sh -d 30 -e cpu -f cpu_profile.html <pid>
# Opens as HTML: shows exact methods consuming CPU

# Memory allocation profiling
./profiler.sh -d 30 -e alloc -f alloc_profile.html <pid>
# Shows what code is creating the most garbage
```

The `async-profiler` output will produce a flame graph — the widest bars at the top are your real bottlenecks. Run this against your staging environment under load before deciding where to spend your optimization effort.

## Fix 1: Connection Pool Tuning (HikariCP)

The most common Spring Boot performance problem: too few database connections, or too many.

Your database connection pool is like the number of checkout lanes at a supermarket. Too few lanes and customers queue up. Too many lanes and you waste staff who spend time idle. HikariCP is Spring Boot's default pool, and its defaults are conservative — you almost always need to tune it for your workload.

```yaml
# application.yml
spring:
  datasource:
    hikari:
      # Formula: (core_count × 2) + effective_spindle_count
      # For 8-core server with SSD: (8 × 2) + 1 = 17 → use 20
      # Counter-intuitive: more than ~20 connections slows things down (DB queuing)
      maximum-pool-size: 20
      minimum-idle: 5
      connection-timeout: 3000        # Fail fast: 3s max wait for connection
      idle-timeout: 600000            # 10 minutes — release idle connections
      max-lifetime: 1800000           # 30 minutes — recycle connections (avoid stale)
      keepalive-time: 30000           # 30s keepalive pings
      pool-name: OrderServicePool
      # Validate connection before use (PostgreSQL)
      connection-test-query: SELECT 1
```

Notice that `max-lifetime` recycles connections every 30 minutes — this prevents stale connections that can silently fail after your database or network firewall drops them. Once you've set the pool size, you need visibility into whether it's working correctly.

```java
// Monitor pool health
@Component
public class HikariPoolMonitor {

    @Autowired
    private HikariDataSource dataSource;

    @Scheduled(fixedDelay = 60000)
    public void logPoolStats() {
        HikariPoolMXBean pool = dataSource.getHikariPoolMXBean();
        log.info("Hikari pool - active: {}, idle: {}, waiting: {}, total: {}",
            pool.getActiveConnections(),
            pool.getIdleConnections(),
            pool.getThreadsAwaitingConnection(),
            pool.getTotalConnections());

        // Alert if waiting > 0 consistently (pool starvation)
        if (pool.getThreadsAwaitingConnection() > 5) {
            log.warn("POOL STARVATION: {} threads waiting — increase maximum-pool-size",
                pool.getThreadsAwaitingConnection());
        }
    }
}
```

The key metric to watch is `threadsAwaitingConnection` — if this is consistently above zero, your pool is too small and requests are queuing. Expose this to your monitoring dashboard so you catch pool starvation before users do.

## Fix 2: Eliminate N+1 Queries

N+1 is the most common JPA performance killer. One query fetches N entities, then N queries fetch their relationships — total: N+1 database round trips.

This is one of those bugs that's invisible in development with small datasets but devastating in production. To understand it, imagine walking into a library and asking for a list of 100 books. The librarian gives you the titles, but then you have to walk back to the desk individually to ask who authored each one — 100 extra trips instead of just getting everything upfront.

```java
// PROBLEM: N+1 in action
@Entity
public class Order {
    @OneToMany(fetch = FetchType.LAZY)  // Lazy is default and correct
    private List<OrderItem> items;

    @ManyToOne(fetch = FetchType.LAZY)
    private Customer customer;
}

@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    // BAD: This loads N orders, then fires N queries for customer, N for items
    List<Order> findByStatus(String status);
}

// In service:
List<Order> orders = orderRepo.findByStatus("PENDING");
orders.forEach(o -> {
    log.info("Customer: {}", o.getCustomer().getName()); // N queries
    log.info("Items: {}", o.getItems().size());          // N more queries
});
// Total: 1 + N + N = 201 queries for 100 orders
```

The problem above is subtle — the code looks innocent, but each property access on a lazy-loaded relationship triggers a separate database round trip. JPA provides three ways to fix this depending on your access pattern.

```java
// SOLUTION 1: JOIN FETCH (when you always need the associations)
@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    @Query("SELECT DISTINCT o FROM Order o " +
           "LEFT JOIN FETCH o.customer " +
           "LEFT JOIN FETCH o.items " +
           "WHERE o.status = :status")
    List<Order> findByStatusWithDetails(@Param("status") String status);
    // Total: 1 query
}

// SOLUTION 2: @EntityGraph (cleaner syntax)
@EntityGraph(attributePaths = {"customer", "items"})
List<Order> findByStatus(String status);

// SOLUTION 3: Projections (when you only need specific fields — fastest)
public interface OrderSummary {
    Long getId();
    String getStatus();
    String getCustomerName();  // Derived from JOIN
}

@Query("SELECT o.id as id, o.status as status, c.name as customerName " +
       "FROM Order o JOIN o.customer c WHERE o.status = :status")
List<OrderSummary> findSummaryByStatus(@Param("status") String status);
// Returns a flat projection — no entity loading, no lazy initialization
```

Projections are often the best solution for list views — you skip loading full entity objects entirely and get back only the fields your UI actually needs, which is both faster and lighter on memory. To catch N+1 problems early, add query counting to your development environment.

```java
// Detect N+1 in development
// Datasource-proxy: logs every query with stack trace
@Bean
public DataSource dataSource() {
    var realDataSource = actualDataSource();
    return ProxyDataSourceBuilder
        .create(realDataSource)
        .name("DS-Proxy")
        .logQueryBySlf4j(SLF4JLogLevel.DEBUG)
        .countQuery()                   // Count total queries per request
        .build();
}
```

With `datasource-proxy` active, you'll see a total query count logged after every request — if a single API call shows 50+ queries, you've found an N+1 problem. This tool pays for itself in the first week.

## Fix 3: Caching with Spring Cache + Redis

Results that are expensive to compute and change rarely are prime caching candidates.

Caching is the single highest-leverage optimization in most web applications. Think of it like a sticky note on your desk: instead of walking to the file cabinet every time someone asks for the same information, you check the note first. Spring's caching abstraction lets you add this behavior to any method with a single annotation, without changing the method's logic.

```java
// Enable Spring Cache
@SpringBootApplication
@EnableCaching
public class Application {}
```

```yaml
spring:
  cache:
    type: redis
  data:
    redis:
      host: localhost
      port: 6379
      timeout: 200ms
      lettuce:
        pool:
          max-active: 20
          min-idle: 5
```

With Redis configured, Spring automatically routes your `@Cacheable` annotations to store and retrieve from Redis — giving you a distributed cache that all your application instances share. Here's how to apply the most common caching patterns to a product service.

```java
@Service
public class ProductService {

    // Cache miss: execute method + store result
    // Cache hit: return cached result, skip method
    @Cacheable(
        value = "products",
        key = "#productId",
        condition = "#productId != null",
        unless = "#result == null"  // Don't cache null results
    )
    public Product findById(String productId) {
        return productRepository.findById(productId).orElse(null);
    }

    // Invalidate on update
    @CacheEvict(value = "products", key = "#product.id")
    public Product update(Product product) {
        return productRepository.save(product);
    }

    // Update cache in-place (instead of evict + fetch)
    @CachePut(value = "products", key = "#result.id")
    public Product save(Product product) {
        return productRepository.save(product);
    }

    // Evict entire cache
    @CacheEvict(value = "products", allEntries = true)
    @Scheduled(cron = "0 0 2 * * *")  // Nightly cache clear
    public void clearProductCache() {}
}
```

The `unless = "#result == null"` condition is important — without it, cache misses (null results) get stored, and every subsequent request skips the database and returns null even after the product is created. For cases where you need more control than annotations provide, use `RedisTemplate` directly.

```java
// For fine-grained cache control, use RedisTemplate directly
@Service
public class LeaderboardService {

    @Autowired
    private RedisTemplate<String, String> redis;

    private static final Duration LEADERBOARD_TTL = Duration.ofMinutes(5);

    public List<LeaderboardEntry> getTopUsers(int limit) {
        String key = "leaderboard:top:" + limit;

        // Try cache first
        List<String> cached = redis.opsForList().range(key, 0, -1);
        if (cached != null && !cached.isEmpty()) {
            return cached.stream().map(this::deserialize).toList();
        }

        // Cache miss: compute and cache
        List<LeaderboardEntry> entries = computeLeaderboard(limit);
        redis.opsForList().rightPushAll(key, entries.stream().map(this::serialize).toList());
        redis.expire(key, LEADERBOARD_TTL);

        return entries;
    }
}
```

The leaderboard is a good example of where the annotation-based cache isn't flexible enough — you need to store a list and set an explicit TTL based on business logic. With a 5-minute TTL, your leaderboard computation runs at most 12 times per hour instead of thousands of times.

## Fix 4: Async Processing with Virtual Threads (Java 21)

Blocking I/O (database, HTTP calls) ties up threads. Virtual threads let you run thousands of concurrent I/O operations cheaply.

The traditional thread model is like having a fixed team of workers where each worker can only do one thing at a time — if they're waiting on an API response, they're blocked and unavailable for other work. Virtual threads are like workers who can put a task on hold, do something else, and return to it when the response arrives — all without creating actual OS threads.

```yaml
# Enable virtual threads for Spring MVC (Java 21+)
spring:
  threads:
    virtual:
      enabled: true
# That's it — Spring Boot 3.2+ automatically uses virtual threads for Tomcat
# Each request gets its own virtual thread — blocking I/O is cheap
```

```java
// Before virtual threads: thread pool exhaustion
// server.tomcat.max-threads=200 (default)
// At 200 concurrent slow requests → all threads blocked → new requests queue

// After virtual threads: unlimited concurrency
// Each request has its own virtual thread — 10,000 concurrent blocked I/O calls
// cost the same as 200 platform threads

// Async service calls with CompletableFuture
@Service
public class OrderOrchestrationService {

    public OrderSummary getOrderSummary(String orderId) {
        // Fire all fetches concurrently — each runs in its own virtual thread
        CompletableFuture<Order> orderFuture =
            CompletableFuture.supplyAsync(() -> orderService.findById(orderId));

        CompletableFuture<Customer> customerFuture =
            CompletableFuture.supplyAsync(() -> customerService.findById(orderId));

        CompletableFuture<List<OrderItem>> itemsFuture =
            CompletableFuture.supplyAsync(() -> itemService.findByOrderId(orderId));

        // Wait for all to complete
        CompletableFuture.allOf(orderFuture, customerFuture, itemsFuture).join();

        return buildSummary(orderFuture.join(), customerFuture.join(), itemsFuture.join());
        // Total time: max(order, customer, items) instead of sum
        // If each takes 50ms: 50ms instead of 150ms
    }
}
```

The key insight here is the comment at the bottom: instead of paying 150ms for three sequential 50ms calls, you pay only 50ms by running them in parallel. This pattern is especially valuable for dashboard endpoints that aggregate data from multiple sources — the user experience improvement is dramatic.

## Fix 5: Efficient Serialization

ObjectMapper creation is expensive. Reuse it. And choose the right format.

Every time you serialize or deserialize JSON in your application, Jackson uses an `ObjectMapper`. Creating a new `ObjectMapper` per request is surprisingly expensive — it's like setting up a translation booth from scratch every time someone needs a word translated, rather than keeping a permanent translator on staff. Spring Boot auto-configures one, but customizing it centrally ensures consistent behavior and maximum reuse.

```java
@Configuration
public class SerializationConfig {

    @Bean
    @Primary
    public ObjectMapper objectMapper() {
        return JsonMapper.builder()
            // Performance
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .enable(MapperFeature.DEFAULT_VIEW_INCLUSION)
            // Date handling
            .addModule(new JavaTimeModule())
            // Don't serialize null fields (smaller payload)
            .serializationInclusion(JsonInclude.Include.NON_NULL)
            .build();
    }
}

// For internal service-to-service: use MessagePack (binary, 30-50% smaller)
// For high-frequency events: use Avro with schema registry
```

The `NON_NULL` inclusion setting alone can reduce your JSON payload size by 20-40% on entities with optional fields, which directly reduces bandwidth and deserialization time on the client. With serialization handled, you now need to instrument your application so you can see the impact of all these changes in production.

## Production Monitoring Checklist

Now that you've applied optimizations, you need to know if they're working — and catch regressions before users notice. Spring Boot Actuator with Prometheus gives you the metrics backbone to build alerts around the most important performance signals.

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  metrics:
    export:
      prometheus:
        enabled: true
  endpoint:
    health:
      show-details: always

# Key metrics to alert on:
# hikaricp.connections.active > (max_pool * 0.8) → pool saturation
# jvm.gc.pause{action="end of major GC"} > 1s → GC pressure
# http.server.requests p99 > 2s → latency degradation
# http.server.requests error rate > 1% → error spike
# system.cpu.usage > 0.8 → CPU saturation
```

Beyond infrastructure metrics, you want business-level metrics that tie performance directly to outcomes. The following shows how to track order creation latency and volume — metrics that let you correlate performance changes with business impact.

```java
// Custom business metrics
@Service
public class OrderMetrics {

    private final MeterRegistry registry;

    private final Counter orderCreationTotal;
    private final Timer orderCreationDuration;
    private final Gauge pendingOrdersGauge;

    public OrderMetrics(MeterRegistry registry) {
        this.registry = registry;
        this.orderCreationTotal = Counter.builder("orders.created.total")
            .description("Total orders created")
            .tag("version", "v1")
            .register(registry);

        this.orderCreationDuration = Timer.builder("orders.creation.duration")
            .description("Order creation latency")
            .register(registry);
    }

    public Order createOrder(OrderRequest request) {
        return orderCreationDuration.record(() -> {
            Order order = orderService.create(request);
            orderCreationTotal.increment();
            return order;
        });
    }
}
```

Wrapping your business logic in a `Timer` gives you p50, p95, and p99 latency percentiles automatically — this is far more useful than averages because a p99 spike tells you that 1% of your users are having a bad experience even when the average looks fine.

## The Performance Tuning Priority List

With all the fixes covered, here's how to prioritize your effort. This ordering reflects real-world impact: database problems almost always cost 10x more than JVM tuning, so fix the database layer first.

```
Impact → Fix
──────────────────────────────────────────────
Highest  N+1 queries               → @EntityGraph, JOIN FETCH
         Missing database indexes  → EXPLAIN ANALYZE + add indexes
         Absent caching            → Redis @Cacheable on hot reads
         Small connection pool     → Tune HikariCP max-pool-size
         Synchronous fan-out       → CompletableFuture.allOf()

Medium   Lazy serialization        → Jackson optimization
         Full object load          → Projections for list views
         Per-request computation   → @Scheduled + cache result

Lower    JVM GC tuning             → G1GC MaxGCPauseMillis
         HTTP client timeouts      → Prevent thread starvation
         Logging verbosity         → INFO in prod, not DEBUG
```

Performance optimization is detective work: follow the evidence. Measure, find the bottleneck, fix it, measure again. The common mistakes are optimizing in the wrong layer (tuning JVM when the bottleneck is the database) and premature optimization (spending days on a service that handles 50 RPS). Profile first, fix what the profiler shows, and repeat.
