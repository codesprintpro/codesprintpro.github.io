---
title: "Scaling Spring Boot Applications to Handle 10 Million Daily Active Users"
description: "A practical performance engineering guide: load balancing, horizontal scaling, database tuning, JVM optimization, autoscaling, and the observability stack to find and fix bottlenecks before they page you."
date: "2025-05-28"
category: "Java"
tags: ["spring boot", "java", "scaling", "performance", "jvm", "kubernetes", "prometheus", "grafana"]
featured: false
affiliateSection: "java-courses"
---

10 million daily active users is not an exotic scale — it's where a successful mid-stage startup or a growing enterprise service lands. At this scale, the things that worked for 100,000 users start breaking in interesting ways. Your single database instance is gasping. Your JVM is GC-pausing under heap pressure. Your API response times have developed a long tail you can't explain. Your Kubernetes pods are scaling but latency isn't improving.

This article is a practical guide to getting a Spring Boot application to that scale — and keeping it there.

## Sizing the Problem

First, understand what 10M DAU actually means in request terms:

```
10,000,000 DAU
Traffic distribution: 20% of users active in peak 4-hour window
Peak concurrent users: 10M × 0.20 / 4h = 500K users at peak hour

Average requests per active session: 50 (browsing, search, actions)
Peak RPS: 500,000 users × 50 requests / 3,600s = ~7,000 RPS sustained peak

P95 session: 200 requests in 30 minutes = 6.7 req/s per user
Peak concurrent requests: 500,000 × 0.1s avg response time = 50,000 inflight

Read/write ratio: typically 80:20 for content apps, 95:5 for social feeds
```

This gives you the numbers to size your infrastructure, not guesses.

## Load Balancing Strategy

```
Traffic distribution architecture:

                         DNS (Route 53)
                              │
                    ┌─────────┴──────────┐
                    │   Global Load Bal   │  (AWS Global Accelerator)
                    └────────────┬────────┘
                    ┌────────────┴────────────┐
               us-east-1                  eu-west-1
           ┌────────┴────────┐        ┌────────┴────────┐
           │   ALB (Layer 7) │        │   ALB (Layer 7) │
           └────────┬────────┘        └────────┬────────┘
               ┌────┼────┐
      ┌─────┐ ┌┴───┐ ┌──┴──┐
      │ Pod │ │ Pod│ │ Pod │  (Spring Boot instances)
      └─────┘ └────┘ └─────┘
```

ALB configuration for Spring Boot:
- `idle_timeout`: 60s (match your Spring Boot `server.connection-timeout`)
- `slow_start`: 30s (new instances get gradually increasing traffic during warmup — avoids cold-start spikes)
- Health check: `/actuator/health` with 2 healthy checks to mark healthy, 3 unhealthy to mark unhealthy
- Stickiness: off (stateless Spring Boot shouldn't need session affinity)

## Horizontal Scaling

Design your Spring Boot service to be completely stateless before scaling horizontally. Common statefulness that breaks horizontal scaling:

**In-memory caches:** `@Cacheable` with `ConcurrentHashMap` is per-instance. 10 instances = 10 different caches, each potentially stale. Replace with distributed Redis cache.

**File uploads to local disk:** Instance receives file, processes, stores. On a different instance, the file doesn't exist. Replace with S3 + presigned URLs or shared EFS.

**In-process event queues:** A background job queue built on `ThreadPoolTaskExecutor` is lost on restart. Replace with persistent queue (SQS, Redis Queue, or Kafka).

```java
// Stateful - breaks horizontal scaling:
@Cacheable(value = "products")  // Default: in-memory
public Product getProduct(String id) { ... }

// Stateless - scales horizontally:
@Cacheable(value = "products", cacheManager = "redisCacheManager")
public Product getProduct(String id) { ... }
```

**Kubernetes HPA configuration:**

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-service
  minReplicas: 10
  maxReplicas: 100
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 65      # Scale at 65% CPU, not 80%
  - type: Pods
    pods:
      metric:
        name: http_requests_in_progress  # Custom metric from Prometheus
      target:
        type: AverageValue
        averageValue: "200"         # Scale when avg 200 inflight requests/pod
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30   # Aggressive scale-up
      policies:
      - type: Pods
        value: 5                        # Add max 5 pods per 30s
        periodSeconds: 30
    scaleDown:
      stabilizationWindowSeconds: 300  # Conservative scale-down (5 min)
```

Scale up fast (avoid underprovisioning), scale down slow (avoid thrashing). Never scale below your minimum at peak hours — use a scheduled `CronJob` to increase `minReplicas` before known traffic events.

## Database Tuning

At 7,000 RPS with 80:20 read/write, your read traffic is 5,600 RPS. A single PostgreSQL instance handles about 10,000 simple queries/second, but at 5,600 RPS with complex queries, JOINs, and index scans, you'll be at capacity.

**Read replicas:** Route all read queries (SELECT without FOR UPDATE) to replicas. Spring Boot + Hikari + AbstractRoutingDataSource:

```java
@Configuration
public class DataSourceConfig {

    @Bean
    @Primary
    public DataSource routingDataSource(
            @Qualifier("primaryDataSource") DataSource primary,
            @Qualifier("replicaDataSource") DataSource replica) {

        ReadWriteRoutingDataSource routing = new ReadWriteRoutingDataSource();
        routing.setDefaultTargetDataSource(primary);
        routing.setTargetDataSources(Map.of(
            DataSourceType.PRIMARY, primary,
            DataSourceType.REPLICA, replica
        ));
        return routing;
    }
}

// AOP: route @Transactional(readOnly=true) to replica
@Aspect
@Component
public class DataSourceRoutingAspect {
    @Before("@annotation(transactional)")
    public void setDataSource(JoinPoint point, Transactional transactional) {
        DataSourceContextHolder.set(
            transactional.readOnly() ? DataSourceType.REPLICA : DataSourceType.PRIMARY
        );
    }
}
```

**Connection pool sizing per instance:**
```
Per Spring Boot pod:
  Primary pool: 5 connections (writes only)
  Replica pool: 15 connections (reads)
  Total: 20 connections per pod

At 50 pods:
  Primary: 50 × 5 = 250 connections to primary DB
  Replica: 50 × 15 = 750 connections per replica

PostgreSQL max_connections = 500 for primary
→ Need PgBouncer (connection pooler) in front of primary
PgBouncer pools 250 app connections into 50 actual DB connections
```

**Index strategy for high-traffic queries:**
```sql
-- Slow query from APM: product search by category + price range
EXPLAIN ANALYZE
SELECT p.*, COUNT(r.id) as review_count
FROM products p
LEFT JOIN reviews r ON p.id = r.product_id
WHERE p.category_id = 5
  AND p.price BETWEEN 10.00 AND 50.00
  AND p.status = 'active'
ORDER BY p.created_at DESC
LIMIT 20;

-- Add composite index covering the WHERE and ORDER BY:
CREATE INDEX CONCURRENTLY idx_products_category_price_created
ON products (category_id, status, price, created_at DESC)
WHERE status = 'active';  -- Partial index: only active products

-- Separate index for JOIN:
CREATE INDEX CONCURRENTLY idx_reviews_product_id ON reviews (product_id);
```

## Connection Pool Sizing

Wrong HikariCP sizing is the most common Spring Boot performance mistake:

```yaml
spring:
  datasource:
    hikari:
      # For a write-heavy service (20% writes):
      maximum-pool-size: 20
      minimum-idle: 10
      connection-timeout: 2000     # Fail fast: 2 seconds
      idle-timeout: 300000         # 5 minutes
      max-lifetime: 900000         # 15 minutes
      keepalive-time: 60000        # Test idle connections every 60s
      validation-timeout: 1000     # 1s connection validation
      # Performance properties:
      data-source-properties:
        cachePrepStmts: true
        prepStmtCacheSize: 250
        prepStmtCacheSqlLimit: 2048
        useServerPrepStmts: true    # Server-side prepared statements
```

Monitor `hikaricp_connections_pending` in Prometheus. If this metric is ever > 0, your pool is undersized.

## Caching Layer Design

Three tiers:

**Tier 1: Application-level cache (Caffeine)** — for extremely hot, tiny data (config, feature flags):
```java
@Bean
public CacheManager localCacheManager() {
    CaffeineCacheManager manager = new CaffeineCacheManager();
    manager.setCaffeine(Caffeine.newBuilder()
        .maximumSize(1_000)
        .expireAfterWrite(Duration.ofSeconds(30))
        .recordStats()
    );
    return manager;
}
```

**Tier 2: Distributed Redis cache** — for hot data shared across pods:
```java
@Cacheable(value = "products", key = "#id", cacheManager = "redisCacheManager")
public ProductDTO getProduct(String id) {
    return productRepository.findById(id).map(ProductDTO::from).orElseThrow();
}

@CacheEvict(value = "products", key = "#product.id")
public void updateProduct(Product product) {
    productRepository.save(product);
}
```

**Tier 3: CDN (CloudFront)** — for public, user-agnostic responses (category pages, search results, product pages):
```java
@GetMapping("/products/{id}")
public ResponseEntity<ProductDTO> getProduct(@PathVariable String id) {
    ProductDTO product = productService.getProduct(id);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.maxAge(Duration.ofMinutes(5))
            .cachePublic())              // Cache in CDN for 5 minutes
        .eTag(product.getVersion())      // ETag for conditional requests
        .body(product);
}
```

## Async Processing

Move non-critical work off the request path:

```java
// BEFORE: Synchronous - holds request thread for 800ms
@PostMapping("/orders")
public OrderResponse createOrder(@RequestBody OrderRequest request) {
    Order order = orderService.create(request);
    emailService.sendConfirmation(order);    // 200ms — blocks thread
    analyticsService.track(order);           // 300ms — blocks thread
    recommendationEngine.update(order);      // 300ms — blocks thread
    return OrderResponse.from(order);
}

// AFTER: Async - request completes in 50ms
@PostMapping("/orders")
public OrderResponse createOrder(@RequestBody OrderRequest request) {
    Order order = orderService.create(request);       // 50ms
    eventPublisher.publishEvent(new OrderCreated(order)); // non-blocking
    return OrderResponse.from(order);
}

@Async("asyncTaskExecutor")
@EventListener
public void handleOrderCreated(OrderCreated event) {
    emailService.sendConfirmation(event.order());
    analyticsService.track(event.order());
    recommendationEngine.update(event.order());
}

@Bean("asyncTaskExecutor")
public TaskExecutor asyncTaskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(20);
    executor.setMaxPoolSize(50);
    executor.setQueueCapacity(500);
    executor.setThreadNamePrefix("async-");
    executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
    executor.initialize();
    return executor;
}
```

## JVM Tuning

For a 10M DAU service running on 4-core, 16GB instances:

```bash
# Heap sizing: start with 70% of available RAM
-Xms8g -Xmx8g          # Fixed heap (avoids resizing pauses)

# G1GC for low-latency (default in JDK 11+):
-XX:+UseG1GC
-XX:MaxGCPauseMillis=100      # Target 100ms max GC pause
-XX:G1HeapRegionSize=16m      # 16MB regions for large heap
-XX:InitiatingHeapOccupancyPercent=40  # Start concurrent GC earlier
-XX:+ParallelRefProcEnabled   # Parallel reference processing
-XX:ConcGCThreads=4           # Concurrent GC threads (= CPU cores)
-XX:G1RSetUpdatingPauseTimePercent=10

# ZGC (JDK 15+) for sub-millisecond GC pauses:
-XX:+UseZGC
-XX:SoftMaxHeapSize=7g        # ZGC leaves headroom above this
-Xmx8g

# Metaspace (class metadata):
-XX:MetaspaceSize=256m
-XX:MaxMetaspaceSize=512m

# JIT compilation:
-XX:+TieredCompilation
-XX:ReservedCodeCacheSize=256m

# Thread stack size (reduce for many threads):
-Xss256k               # 256KB vs default 512KB

# Diagnostics (non-prod):
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/var/log/app/gc.log
-XX:+UseGCLogFileRotation
-XX:NumberOfGCLogFiles=5
-XX:GCLogFileSize=20m
```

## Autoscaling Strategy

Custom metrics-based autoscaling performs better than CPU-only:

```yaml
# KEDA ScaledObject using Kafka consumer lag:
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: order-processor
spec:
  scaleTargetRef:
    name: order-processor-deployment
  minReplicaCount: 5
  maxReplicaCount: 100
  triggers:
  - type: kafka
    metadata:
      bootstrapServers: kafka:9092
      consumerGroup: order-processor
      topic: orders
      lagThreshold: "1000"        # Scale up when lag > 1000 per partition
      activationLagThreshold: "10"
```

## Bottleneck Identification

When P99 latency is rising, find the bottleneck systematically:

```bash
# 1. CPU vs I/O bound?
# CPU bound: top shows high CPU%, thread dump shows threads RUNNING
# I/O bound: top shows low CPU%, thread dump shows threads WAITING

# 2. Which endpoint is slow?
# Spring Boot Actuator + Prometheus:
http_server_requests_seconds_p99{uri="/api/products/{id}"} > 2.0

# 3. Database slow queries?
# PostgreSQL slow query log:
SET log_min_duration_statement = 1000;  # Log queries > 1 second

# 4. Thread pool exhaustion?
# Actuator thread dump:
curl http://localhost:8080/actuator/threaddump | python3 -c "
import json, sys
data = json.load(sys.stdin)
states = {}
for t in data['threads']:
    state = t['threadState']
    states[state] = states.get(state, 0) + 1
print(states)"

# 5. GC pressure?
# GC pauses causing latency spikes:
jstat -gcutil <pid> 1000 10
# If GC_TIME > 10% = GC is a bottleneck
```

## Observability Stack

```yaml
# docker-compose.yml for local observability:
services:
  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin

  elasticsearch:
    image: elasticsearch:8.12.0

  logstash:
    image: logstash:8.12.0

  kibana:
    image: kibana:8.12.0

  jaeger:
    image: jaegertracing/all-in-one
```

Spring Boot Micrometer configuration:

```java
@Bean
public MeterRegistryCustomizer<MeterRegistry> commonTags(
        @Value("${spring.application.name}") String appName) {
    return registry -> registry.config()
        .commonTags("app", appName, "region", System.getenv("AWS_REGION"));
}
```

Key dashboards:
1. **RED dashboard:** Rate, Errors, Duration per endpoint
2. **USE dashboard:** Utilization, Saturation, Errors per resource (CPU, memory, DB connections)
3. **Business metrics:** Orders/second, payment success rate, cart conversion

```
Critical alerts for production:
- http_server_requests_seconds_p99 > 2s for 5 minutes → page
- hikaricp_connections_pending > 0 for 2 minutes → page
- jvm_gc_pause_seconds_max > 2s → page
- process_cpu_usage > 0.9 for 5 minutes → scale-up trigger
- kafka_consumer_lag > 10000 → page
```

## Production Debugging Strategy

When you get paged at 3 AM:

```bash
# 1. Is it a recent deploy? Check:
kubectl rollout history deployment/api-service
# If yes: kubectl rollout undo deployment/api-service

# 2. Is it a traffic spike?
# Check CloudWatch/Prometheus: requests/second vs baseline

# 3. Heap/GC issue?
kubectl exec -it <pod> -- jcmd 1 GC.heap_info
kubectl exec -it <pod> -- jcmd 1 VM.flags | grep Xmx

# 4. Thread dump:
kubectl exec -it <pod> -- jstack 1 > /tmp/threaddump.txt
# Look for BLOCKED threads, threads waiting on locks/DB

# 5. Heap dump (if OOM suspected):
kubectl exec -it <pod> -- jcmd 1 GC.heap_dump /tmp/heap.hprof
kubectl cp <pod>:/tmp/heap.hprof ./heap.hprof
# Analyze with Eclipse Memory Analyzer (MAT)

# 6. Check downstream dependencies:
curl http://pod:8080/actuator/health  # Spring Boot health indicators
# Checks DB, Redis, Kafka connectivity
```

The path from 100K to 10M DAU is not a single optimization — it's a sequence of bottleneck-find-fix cycles. Each scale milestone reveals a new bottleneck: first the database, then the cache, then the JVM, then the network, then the application code itself. The teams that navigate this successfully are the ones who instrument everything, build systematic diagnosis tools, and respond to metrics before they become incidents.
