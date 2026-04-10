---
title: "System Design: Building a Distributed Cache"
description: "Design a production distributed cache with sharding, replication, eviction, invalidation, hot-key protection, consistency trade-offs, write patterns, and failure handling."
date: "2026-04-10"
category: "System Design"
tags: ["system design", "distributed cache", "redis", "caching", "distributed systems", "backend engineering"]
featured: false
affiliateSection: "system-design-courses"
---

At small scale, cache looks like a simple optimization.

Put Redis in front of the database, cache a few expensive reads, and enjoy lower latency.

At production scale, a distributed cache stops being a helper library and starts becoming infrastructure. It needs partitioning, replication, expiration strategy, invalidation, hot-key protection, memory efficiency, observability, and failure handling. If the cache design is weak, you do not just miss cache hits. You can melt your database, serve stale data for hours, and create traffic spikes that are worse than having no cache at all.

This guide designs a production distributed cache.

## Problem Statement

Build a shared cache platform used by many application servers.

The cache should:

- reduce read latency
- absorb read traffic from the primary database
- support high QPS
- survive node failures
- avoid unbounded memory growth
- protect downstream systems from cache stampedes
- support predictable invalidation

Examples of cached data:

- product details
- user profiles
- pricing metadata
- feature flags
- permissions snapshots
- rendered page fragments
- session state
- search suggestions

Not all of these have the same consistency needs. That is one of the first things a good cache design must admit openly.

## Requirements

Functional requirements:

- get value by key
- set value with TTL
- delete / invalidate by key
- support batch reads
- support atomic counters
- support distributed locks only if explicitly needed
- support cache warming and preloading
- expose cache metrics

Non-functional requirements:

- low latency, usually sub-5ms in-region
- horizontal scale
- high availability
- memory efficiency
- graceful degradation under failure
- bounded staleness where acceptable
- protection against hot keys and thundering herds

The core truth of distributed caching is this:

**a cache is a consistency trade-off machine.**

You are trading some freshness guarantees for performance and cost. The system design work is deciding exactly where that trade is acceptable and where it is not.

## When a Distributed Cache Is Worth It

Do not add a distributed cache just because the application is slow.

It is usually worth it when:

- the same objects are read repeatedly
- backing storage is much slower than memory
- read traffic is far larger than write traffic
- moderate staleness is acceptable
- recomputation or database fetch is expensive

It is usually the wrong answer when:

- data changes constantly and must be read strongly consistent
- keys are almost never reused
- the real bottleneck is poor SQL or bad indexing
- the team cannot operate another critical data system yet

A cache can hide database pain. It can also delay fixing the real problem.

## Example Scale

Let’s make the numbers concrete.

```text
Read traffic:          200,000 requests/sec
Write traffic:          10,000 updates/sec
Average object size:    2 KB
Hot working set:       50 million objects
Target hit rate:       95%

Hot set memory:
50M * 2 KB = 100 GB raw

Add metadata, allocator overhead, replication, and fragmentation:
100 GB raw -> ~180 to 220 GB practical footprint
```

That already implies:

- one cache node is not enough
- replication policy matters
- eviction behavior matters
- memory overhead matters almost as much as data size

## High-Level Architecture

```text
Application Servers
      |
      v
Cache Client Library
      |
      +--> consistent hashing / routing
      |
      v
Distributed Cache Cluster
  |         |         |
  v         v         v
Shard A   Shard B   Shard C
  |         |         |
 replica   replica   replica
      |
      v
Primary Database / Source of Truth
```

The application should not hardcode host-level topology logic. The client library or a service discovery layer should know how to route keys to shards.

## Core Design Decisions

Every distributed cache design comes down to a few big choices:

1. cache-aside vs read-through
2. write-through vs write-behind vs explicit invalidation
3. sharding strategy
4. replication model
5. eviction policy
6. consistency expectations
7. stampede protection

If these are fuzzy, the system will be fuzzy.

## Cache-Aside Pattern

This is the most common approach because it is simple and gives the application control.

Flow:

1. application requests key
2. cache miss
3. application reads database
4. application stores result in cache
5. subsequent reads hit cache

```java
public Product getProduct(String productId) {
    String cacheKey = "product:" + productId;

    Product cached = redisClient.get(cacheKey, Product.class);
    if (cached != null) {
        return cached;
    }

    Product product = productRepository.findById(productId);
    if (product != null) {
        redisClient.set(cacheKey, product, Duration.ofMinutes(10));
    }
    return product;
}
```

Why teams like it:

- easy to implement
- database remains the source of truth
- selective caching is straightforward

Why it bites teams:

- cache miss storms under traffic spikes
- stale data if invalidation is weak
- repeated misses for missing keys unless you use negative caching

## Write Strategies

### 1. Invalidate on write

Update database, then delete cache key.

```java
@Transactional
public void updateProduct(ProductUpdateRequest request) {
    productRepository.update(request);
    redisClient.delete("product:" + request.productId());
}
```

This is usually the safest default.

Pros:

- simple
- avoids serving definitely wrong cached values after update

Cons:

- next read is a miss
- hot objects may stampede after invalidation

### 2. Write-through

Write database and cache on every update.

Pros:

- next read is likely a hit
- good when the updated value is already available in application memory

Cons:

- dual-write coordination problem
- more write amplification
- cache can become a second system of record by accident

### 3. Write-behind

Write cache first, flush to database asynchronously.

Pros:

- very low write latency

Cons:

- dangerous for critical business data
- data loss risk during failures
- reconciliation complexity

Use write-behind only when some loss is acceptable, such as analytics counters or temporary aggregations.

## Data Model

The key design matters more than people think.

Bad keys create collisions, poor invalidation, and awkward bulk operations.

Good cache keys are:

- namespaced
- versionable
- scoped to tenant/environment
- predictable

Examples:

```text
product:v3:tenant_42:product_991
user-profile:v2:user_123
permissions:v7:tenant_42:user_123
feature-flag:prod:new-checkout-flow
search-suggestions:en-IN:q=redi
```

Versioned keys are a powerful escape hatch. If a serializer changes or invalidation is messy, you can bump a namespace version instead of deleting millions of keys one by one.

## Value Encoding

Storing Java objects as huge JSON blobs feels convenient until memory pressure arrives.

Consider:

- compact JSON for interoperability
- MessagePack / protobuf for smaller footprint
- field-level decomposition for hot partial reads

Trade-off:

- binary formats reduce memory and network cost
- JSON is easier to inspect and debug

For many teams, JSON is a good default until memory pressure becomes real.

## Sharding Strategy

A distributed cache has to split keys across many nodes.

### Modulo hashing

```text
shard = hash(key) % N
```

Easy, but painful.

If `N` changes from 10 to 11, almost every key remaps and hit rate collapses.

### Consistent hashing

Map keys and nodes onto a hash ring. Keys move only when nearby nodes change.

Pros:

- less churn during scale-out
- better operational behavior

Cons:

- more implementation complexity
- virtual nodes are usually needed for balance

A simplified routing sketch:

```ts
type Node = { id: string; hash: number };

function pickNode(keyHash: number, ring: Node[]): Node {
  for (const node of ring) {
    if (keyHash <= node.hash) {
      return node;
    }
  }
  return ring[0];
}
```

In real systems, use mature client libraries rather than hand-rolled ring logic.

## Replication Model

A cache node failure should not mean immediate cold start for its shard.

Typical design:

- one primary per shard
- one or more replicas
- async replication for low latency

Trade-off:

- async replication is fast, but can lose the newest writes during failover
- sync replication improves durability, but adds latency and fragility

For most caches, async replication is acceptable because the database remains the durable source of truth.

## Read Path

A healthy read path looks like this:

```text
Request
  -> cache lookup
      -> hit: return in 1-5ms
      -> miss: load from database
                -> populate cache
                -> return result
```

The dangerous read path is this:

```text
10,000 concurrent requests
  -> same key missing
  -> all hit database
  -> database spikes
  -> latency rises
  -> app timeouts
  -> retries amplify the storm
```

That is the thundering herd problem.

## Stampede Protection

### Single-flight / request coalescing

Only one request loads the missing key. Others wait briefly for the result.

```java
public Product getWithSingleFlight(String productId) {
    return singleFlight.execute("product:" + productId, () -> {
        Product cached = redisClient.get("product:" + productId, Product.class);
        if (cached != null) return cached;

        Product loaded = productRepository.findById(productId);
        if (loaded != null) {
            redisClient.set("product:" + productId, loaded, Duration.ofMinutes(10));
        }
        return loaded;
    });
}
```

### Jittered TTLs

Do not let a million keys expire at the same second.

```ts
function withJitter(baseSeconds: number): number {
  const jitter = Math.floor(Math.random() * 120);
  return baseSeconds + jitter;
}
```

### Soft TTL + background refresh

Serve slightly stale data for a short window while one worker refreshes in the background.

This is great for:

- product catalogs
- feature metadata
- content pages

Not great for:

- account balances
- permission revocation
- critical security state

## Negative Caching

If a key is frequently requested but does not exist, cache the miss briefly.

```java
if (product == null) {
    redisClient.set(cacheKey, NullValue.INSTANCE, Duration.ofSeconds(30));
    return null;
}
```

Without negative caching, bots and broken clients can repeatedly hammer the database for nonexistent objects.

## Invalidation Strategies

This is where most cache systems get into trouble.

### TTL-only

Let values expire naturally.

Good for:

- weakly consistent reference data
- low-risk metadata

Bad for:

- fast-changing user data
- permissions
- prices

### Explicit delete on write

Best default for mutable entities.

### Event-driven invalidation

Publish a domain event when data changes, and let consumers invalidate related keys.

```text
Product updated
   -> publish ProductUpdated event
   -> invalidate product:{id}
   -> invalidate category listing pages
   -> invalidate search cache entries
```

This scales better than hardcoding invalidation fanout in one service, but it introduces eventual consistency and requires reliable event delivery.

### Namespace versioning

Store a logical version and include it in the key:

```text
permissions:v7:user_123
```

When you need broad invalidation:

```text
v7 -> v8
```

This avoids mass deletes but can temporarily increase memory usage until old keys age out.

## Hot Keys

Some keys get disproportionate traffic:

- homepage config
- flash-sale product
- top trending item
- global feature flag bundle

A single hot key can saturate one shard while the rest of the cluster is mostly idle.

Mitigations:

### Replicate hot keys locally

Keep a very hot subset in process memory inside each app instance.

### Key replication

Duplicate the same value across several cache keys and load-balance reads:

```text
product:flash-sale:copy1
product:flash-sale:copy2
product:flash-sale:copy3
```

This adds invalidation complexity, so use it only when the hotspot is real.

### Request-level memoization

For extremely short windows, keep the result in the application for a few seconds.

## Consistency Trade-Offs

There is no single cache consistency model. Pick by use case.

### Strong freshness needed

Examples:

- permission revocation
- account balance
- fraud decision state

Use:

- very short TTL or no cache
- explicit invalidation
- read-through only where safe

### Bounded staleness acceptable

Examples:

- product descriptions
- recommendation carousels
- content metadata

Use:

- cache-aside
- event invalidation
- soft TTLs

### Highly stale-tolerant

Examples:

- dashboards
- top-N counters
- rendered marketing fragments

Use:

- long TTL
- aggressive caching
- write-behind or async refresh where acceptable

## Failure Modes

### 1. Cache node failure

Impact:

- reduced hit rate
- database fallback surge

Mitigation:

- shard replicas
- controlled failover
- database protection limits

### 2. Full-cluster cache flush

Impact:

- catastrophic cold start
- database overload

Mitigation:

- never use flush-all casually in production
- isolate environments
- rate-limit cold misses
- preload critical keys

### 3. Stale data after write

Impact:

- user sees outdated information

Mitigation:

- explicit invalidation
- write ordering discipline
- event delivery guarantees where needed

### 4. Memory fragmentation or eviction storm

Impact:

- hit rate collapse
- unpredictable latency

Mitigation:

- headroom, not just exact-fit memory planning
- right eviction policy
- object-size discipline

### 5. Hot key overload

Impact:

- one shard saturates
- uneven cluster performance

Mitigation:

- detect skew
- local replicas
- hot-key fanout

## Eviction Policy

A cache without eviction is just a memory leak with branding.

Common policies:

- `allkeys-lru`: evict least recently used keys
- `volatile-ttl`: evict only expiring keys, usually shortest TTL first
- `allkeys-lfu`: evict least frequently used keys

For mixed workloads, LFU is often a strong default because it keeps repeatedly hot keys better than simple recency alone.

But policy should match workload:

- content cache: LRU/LFU both reasonable
- session cache: TTL-sensitive policy matters more
- derived aggregates: short TTL + volatile policy can work well

## Memory Planning

Do not size the cluster only from logical payload size.

Include:

- key overhead
- allocator fragmentation
- replication
- metadata
- growth buffer

Rule of thumb:

- if raw payload estimate is 100 GB
- do not provision 105 GB

Give yourself enough headroom that eviction is a deliberate policy, not a surprise.

## Multi-Region Considerations

If the app is global, you have two choices:

### Per-region caches

- low latency
- simpler failure isolation
- eventual divergence across regions

### Shared cross-region cache

- terrible latency
- more failure coupling

Usually, per-region cache is the right answer. Repopulate from regional databases or replicated state rather than doing remote cache reads across continents.

## Observability

You cannot operate a distributed cache from hit rate alone.

Track:

- hit rate by keyspace
- miss rate by keyspace
- p50 / p95 / p99 latency
- eviction rate
- memory used vs available
- replica lag
- top hot keys
- command error rate
- database fallback QPS

The most important metric is often:

**database traffic during cache degradation**

Because that tells you whether the cache failure is survivable.

## Example Client Wrapper

Wrap cache access in a small abstraction so policies stay consistent.

```java
public class CacheClient {

    private final RedisClient redis;
    private final Metrics metrics;

    public <T> T getOrLoad(String key, Class<T> type, Duration ttl, Supplier<T> loader) {
        long start = System.nanoTime();

        T cached = redis.get(key, type);
        if (cached != null) {
            metrics.increment("cache.hit", "keyspace", keyspace(key));
            metrics.timing("cache.latency", System.nanoTime() - start);
            return cached;
        }

        metrics.increment("cache.miss", "keyspace", keyspace(key));

        T loaded = loader.get();
        if (loaded != null) {
            redis.set(key, loaded, ttl);
        }

        metrics.timing("cache.latency", System.nanoTime() - start);
        return loaded;
    }

    public void invalidate(String key) {
        redis.delete(key);
        metrics.increment("cache.invalidate", "keyspace", keyspace(key));
    }

    private String keyspace(String key) {
        int idx = key.indexOf(':');
        return idx > 0 ? key.substring(0, idx) : "unknown";
    }
}
```

The goal is not abstraction purity. It is keeping cache behavior consistent across dozens of services.

## What I Would Build First

Phase 1:

- cache-aside reads
- explicit invalidation on writes
- TTLs with jitter
- hit/miss/latency metrics

Phase 2:

- consistent hashing or Redis Cluster
- replica-aware failover
- single-flight protection for hot misses
- negative caching

Phase 3:

- event-driven invalidation
- hot-key detection and mitigation
- local in-process near-cache for ultra-hot reads
- cache warming for high-value keyspaces

This order matters. Teams often jump to fancy invalidation pipelines before they have basic TTLs, metrics, and miss controls. That usually ends in confusion.

## Production Checklist

- cache key format standardized
- TTLs defined per keyspace
- jitter applied to expirations
- invalidation path tested
- negative caching for high-miss keys
- hit/miss metrics by keyspace
- hot-key detection in place
- no critical correctness path depends on cache availability
- downstream database protected during cache outages
- environment isolation prevents accidental full flush

## Final Takeaway

A distributed cache is not just "fast storage."

It is a traffic-shaping, latency-reduction, and failure-amplification system all at once.

If you design it well, the database stays calm, latency stays low, and most users never notice it exists.

If you design it poorly, one expired key can create a cascading incident.

## Read Next

- [Cache Invalidation Patterns: TTL, Write-Through, Cache-Aside, and Event-Driven Eviction](/blog/cache-invalidation-patterns/)
- [Redis Caching Strategy at Scale](/blog/redis-caching-strategy-at-scale/)
- [System Design: Building a URL Shortener That Handles Billions of Requests](/blog/system-design-url-shortener/)
