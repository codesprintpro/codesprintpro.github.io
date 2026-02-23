---
title: "Redis Caching Strategy at Scale: Beyond Simple Key-Value"
description: "Cache stampede, penetration, avalanche, eviction policy selection, clustering, and persistence trade-offs for production Redis deployments. With Java examples and a real production incident walkthrough."
date: "2025-05-03"
category: "Databases"
tags: ["redis", "caching", "java", "spring boot", "performance", "distributed systems", "cache stampede"]
featured: false
affiliateSection: "distributed-systems-books"
---

Every senior engineer has fought a caching bug that looked simple and turned out to be a distributed systems problem. Cache stampedes, thundering herds, avalanche failures — these happen at scale and they are expensive. This article covers the caching patterns and anti-patterns that separate a cache that works at 100 RPS from one that holds up at 100,000 RPS.

## Cache-Aside vs Write-Through vs Write-Behind

**Cache-aside (lazy loading)** is the default pattern: check cache, miss → fetch from DB, populate cache, return.

```java
public Product getProduct(String productId) {
    // 1. Check cache
    Product cached = redisTemplate.opsForValue().get("product:" + productId);
    if (cached != null) return cached;

    // 2. Cache miss: fetch from DB
    Product product = productRepository.findById(productId)
        .orElseThrow(() -> new ProductNotFoundException(productId));

    // 3. Populate cache with TTL
    redisTemplate.opsForValue().set("product:" + productId, product, Duration.ofMinutes(30));
    return product;
}
```

**Properties:** Reads are fast after warmup. Cache only holds data that's actually requested (space efficient). Inconsistency window = TTL (or until next write invalidates the key). Cache cold start causes DB load spike — important after deploys.

**Write-through** writes to cache and DB simultaneously on every update:

```java
@Transactional
public Product updateProduct(String productId, ProductUpdate update) {
    Product product = productRepository.findById(productId).orElseThrow();
    product.apply(update);
    productRepository.save(product);  // Write to DB

    // Immediately update cache — no stale reads
    redisTemplate.opsForValue().set("product:" + productId, product, Duration.ofMinutes(30));
    return product;
}
```

**Properties:** Cache is always fresh (no inconsistency window). Every write touches both DB and cache, even for data that's never read. Cache warms up on writes, not on reads.

**Write-behind (write-back)** writes to cache immediately and to the DB asynchronously:

```java
public void updateProductPrice(String productId, BigDecimal newPrice) {
    // Update cache synchronously
    String key = "product:" + productId;
    Product product = (Product) redisTemplate.opsForValue().get(key);
    product.setPrice(newPrice);
    redisTemplate.opsForValue().set(key, product, Duration.ofMinutes(30));

    // Schedule async DB write
    writeQueue.submit(() -> productRepository.updatePrice(productId, newPrice));
}
```

**Properties:** Lowest write latency. High risk — if Redis fails before the async write, data is lost. Use only when brief data loss is acceptable (analytics counters, view counts, non-financial metrics).

For most production services: **cache-aside for reads, write-through or cache invalidation on writes**.

## Cache Stampede Problem

The cache stampede (thundering herd) happens when a popular key expires and many concurrent requests all miss the cache simultaneously, all hitting the database at once:

```
T=0: Key "hot-product-123" expires (was serving 1000 req/s)
T=0 to T=200ms: 200 requests miss cache, all query PostgreSQL simultaneously
PostgreSQL: 200 concurrent queries for the same row
Result: DB CPU spike, query queue backs up, timeouts cascade
```

At 1,000 requests/second on a key with a 30-minute TTL, when the key expires, you get ~200 simultaneous DB queries in 200ms.

### Solution 1: Probabilistic Early Expiry (PER)

Recompute the cache before it expires, with probability proportional to how close we are to expiry. Early recompute happens in one thread while others still read the valid (slightly stale) cache:

```java
public Product getProductWithPER(String productId) {
    String key = "product:" + productId;
    CachedValue<Product> cached = getWithTTL(key);

    if (cached == null) {
        return fetchAndCache(productId);
    }

    // Probabilistic early expiry
    long remainingTtlSeconds = cached.ttlSeconds();
    double fetchTime = 0.1; // 100ms to recompute
    double beta = 1.0;

    // Recompute if: -fetchTime * beta * ln(random) >= remainingTtl
    if (-fetchTime * beta * Math.log(Math.random()) >= remainingTtlSeconds) {
        // Early refresh — only one thread wins this race (via lock below)
        return fetchAndCacheIfLeader(productId);
    }

    return cached.value();
}
```

### Solution 2: Distributed Lock (Single Recompute)

Only one thread recomputes on cache miss; others wait or serve stale:

```java
private static final String LOCK_PREFIX = "lock:";
private static final long LOCK_TTL_MS = 5000;

public Product getProductLocked(String productId) {
    String valueKey = "product:" + productId;
    String lockKey = LOCK_PREFIX + productId;

    // Fast path: cache hit
    Product cached = redisTemplate.opsForValue().get(valueKey);
    if (cached != null) return cached;

    // Try to acquire lock (NX = only set if not exists)
    Boolean acquired = redisTemplate.opsForValue()
        .setIfAbsent(lockKey, "1", Duration.ofMillis(LOCK_TTL_MS));

    if (Boolean.TRUE.equals(acquired)) {
        try {
            // Double-check after acquiring lock
            cached = redisTemplate.opsForValue().get(valueKey);
            if (cached != null) return cached;

            // We are the designated recomputer
            Product product = productRepository.findById(productId).orElseThrow();
            redisTemplate.opsForValue().set(valueKey, product, Duration.ofMinutes(30));
            return product;
        } finally {
            redisTemplate.delete(lockKey);
        }
    } else {
        // Another thread is recomputing — wait briefly and retry
        Uninterruptibles.sleepUninterruptibly(100, TimeUnit.MILLISECONDS);
        return getProductLocked(productId); // Retry — will likely hit cache now
    }
}
```

### Solution 3: Staggered TTL

Add random jitter to TTLs so keys in a set don't expire simultaneously:

```java
private Duration jitteredTtl(Duration baseTtl) {
    long jitterSeconds = ThreadLocalRandom.current()
        .nextLong(0, baseTtl.toSeconds() / 10); // ±10% jitter
    return baseTtl.plusSeconds(jitterSeconds);
}

redisTemplate.opsForValue().set(key, value, jitteredTtl(Duration.ofMinutes(30)));
```

## Cache Penetration and Avalanche

**Cache penetration:** Requests for keys that never exist (e.g., `user_id=-1`, or IDs for deleted entities). These always miss cache and always hit the DB.

**Fix:** Cache negative results with a short TTL, or use a Bloom filter to reject impossible keys upfront:

```java
public Optional<User> getUser(Long userId) {
    if (!bloomFilter.mightContain(userId)) {
        return Optional.empty(); // Definitely doesn't exist
    }

    String key = "user:" + userId;
    Object cached = redisTemplate.opsForValue().get(key);

    if (cached instanceof NullSentinel) {
        return Optional.empty(); // Cached negative result
    }

    if (cached instanceof User user) {
        return Optional.of(user);
    }

    // DB lookup
    Optional<User> user = userRepository.findById(userId);
    if (user.isEmpty()) {
        // Cache negative result for 60 seconds
        redisTemplate.opsForValue().set(key, NullSentinel.INSTANCE, Duration.ofSeconds(60));
    } else {
        redisTemplate.opsForValue().set(key, user.get(), Duration.ofMinutes(30));
    }
    return user;
}
```

**Cache avalanche:** Many keys expire simultaneously (same TTL set in a batch job), causing a sudden DB load spike.

**Fix:** Jitter TTLs (shown above). Alternatively, warm the cache before keys expire using a background job that refreshes keys at 80% of their TTL.

## TTL Strategy Design

TTL selection is not guesswork — it's a trade-off between freshness and hit rate.

```
TTL decision matrix:

Data type              | Update frequency  | Staleness tolerance | Recommended TTL
-----------------------|-------------------|--------------------|-----------------
Product price          | Minutes           | Low (financial)    | 5 minutes
Product catalog        | Hours             | Medium             | 1 hour + invalidation
User profile           | Daily             | Low                | 30 minutes
Static content (i18n)  | Weekly            | High               | 24 hours
Search results         | Real-time         | High               | 5 minutes
Session data           | Per request       | None               | Session timeout
Rate limit counters    | Per request       | None               | Window size (60s)
```

**Invalidation over TTL for write-heavy data:**

When an entity is updated, immediately delete (or update) its cache key rather than waiting for TTL expiry. This requires write operations to know which cache keys to invalidate — a coupling that must be managed carefully.

## Memory Fragmentation

Redis allocates memory using jemalloc. Over time, allocating and freeing keys of varying sizes causes fragmentation — Redis reports 2GB used but actually occupies 3GB of system memory.

Monitor fragmentation ratio:
```bash
redis-cli INFO memory | grep mem_fragmentation_ratio
# > 1.5 = high fragmentation, consider restart or activedefrag
# 1.0–1.5 = normal
# < 1.0 = Redis is using swap (severe problem)
```

Enable active defragmentation for long-running Redis instances:
```
activedefrag yes
active-defrag-ignore-bytes 100mb  # Start defrag when 100MB fragmented
active-defrag-threshold-lower 10  # Start defrag when fragmentation > 10%
active-defrag-threshold-upper 25  # Use max CPU when fragmentation > 25%
```

## Eviction Policy Comparison

When Redis reaches `maxmemory`, it evicts keys according to the policy:

| Policy | Behavior | Best For |
|--------|----------|---------|
| `noeviction` | Returns error on writes when full | When cache full = outage (unacceptable for most) |
| `allkeys-lru` | Evict least recently used across all keys | General-purpose cache |
| `volatile-lru` | Evict LRU only from keys with TTL | Mixed cache + session store |
| `allkeys-lfu` | Evict least frequently used | Workloads with hotspot keys |
| `volatile-ttl` | Evict keys closest to expiry | When you want expiry-driven eviction |
| `allkeys-random` | Random eviction | Uniform access patterns |

For a pure cache: `allkeys-lru` or `allkeys-lfu`. `allkeys-lfu` is better for workloads where a small set of keys is accessed constantly (product catalog, configuration) — LFU keeps hot keys in memory longer than LRU.

For a mixed cache + session store: `volatile-lru` — only evicts keys with TTL, protecting session keys that have no TTL.

## Redis Clustering

Redis Cluster shards data across nodes using 16,384 hash slots:

```
Redis Cluster (3 primary + 3 replica):

Key: "product:123"
hash_slot = CRC16("product:123") % 16384 = 7483

Slot 7483 is owned by Primary-2
→ Route request to Primary-2

Primary-1 (slots 0-5460)          Primary-2 (slots 5461-10922)        Primary-3 (slots 10923-16383)
     │                                   │                                    │
     ▼                                   ▼                                    ▼
Replica-1                           Replica-2                            Replica-3
```

**Cluster limitations:**
- Multi-key operations (`MGET`, `MSET`, pipeline) only work when all keys are in the same slot
- Use hash tags `{user:123}:profile` to force co-location: `{user:123}` is used for slot calculation, so all keys with the same tag go to the same slot
- Transactions (`MULTI/EXEC`) only work on single nodes — avoid cross-slot transactions

```java
// Hash tags for co-located keys:
String profileKey = "{user:" + userId + "}:profile";
String settingsKey = "{user:" + userId + "}:settings";
// Both keys route to the same slot → MGET works
List<Object> results = redisTemplate.opsForValue().multiGet(
    List.of(profileKey, settingsKey));
```

## Persistence: RDB vs AOF

| | RDB (Snapshots) | AOF (Append-Only File) |
|-|----------------|------------------------|
| Recovery | Point-in-time snapshot | Replay every write since last snapshot |
| Data loss on crash | Up to snapshot interval (minutes) | Up to 1 second (with fsync=everysec) |
| Performance | Low CPU overhead | fsync adds ~10% write overhead |
| Restart time | Fast (load snapshot) | Slow (replay log, can take minutes) |
| File size | Compact | Grows unbounded, requires AOF rewrite |

**For a cache:** RDB only. Losing cache data on crash is acceptable — the cache warms up from the DB.

**For a cache with session data:** AOF with `appendfsync everysec`. Max 1 second of session data loss on crash.

**For Redis as primary data store (not cache):** AOF with `appendfsync always` + RDB for backup. Maximum durability, highest write overhead.

```
# redis.conf for production cache:
maxmemory 12gb
maxmemory-policy allkeys-lfu
save 900 1     # RDB snapshot if 1 key changed in 900s
save 300 10    # RDB snapshot if 10 keys changed in 300s
save 60 10000  # RDB snapshot if 10000 keys changed in 60s
appendonly no  # No AOF for pure cache
```

## Distributed Locks with Redis

Redis Redlock is the distributed lock algorithm. For single-node Redis or Redis Cluster, a simpler approach:

```java
public <T> T withLock(String resource, Duration timeout, Supplier<T> task) {
    String lockKey = "lock:" + resource;
    String lockValue = UUID.randomUUID().toString(); // Unique per lock acquisition
    boolean acquired = false;

    try {
        acquired = Boolean.TRUE.equals(
            redisTemplate.opsForValue()
                .setIfAbsent(lockKey, lockValue, timeout)
        );

        if (!acquired) {
            throw new LockNotAvailableException("Resource locked: " + resource);
        }

        return task.get();
    } finally {
        if (acquired) {
            // Release only if we own the lock (Lua script ensures atomicity)
            redisTemplate.execute(
                RELEASE_LOCK_SCRIPT,
                Collections.singletonList(lockKey),
                lockValue
            );
        }
    }
}

// Lua script for atomic check-and-delete:
private static final RedisScript<Long> RELEASE_LOCK_SCRIPT = RedisScript.of(
    "if redis.call('get', KEYS[1]) == ARGV[1] then " +
    "    return redis.call('del', KEYS[1]) " +
    "else return 0 end",
    Long.class
);
```

The Lua script is critical. Without it, two operations occur: `GET` to verify ownership, then `DEL`. A different process could acquire the lock between those two operations, and you'd delete their lock.

## Real World Production Issue

**System:** E-commerce product catalog service, 50,000 SKUs, Redis Cluster (6 nodes), Spring Boot.

**Incident:** Flash sale launch. At 12:00:00, 50,000 concurrent users loaded the sale page. Cache hit rate: 98%. The remaining 2% — 1,000 users — missed on the most popular sale items because those specific keys had expired at 11:59:58 due to a batch TTL reset job.

All 1,000 users simultaneously queried PostgreSQL for 3 products. PostgreSQL's connection pool (20 connections) was saturated. Other queries (cart, checkout) backed up. API P99 hit 45 seconds.

**Root causes:**
1. Batch job set the same TTL on all keys → mass expiry
2. No stampede protection
3. PostgreSQL connection pool too small for burst

**Fixes applied:**
1. Jitter added to all TTL values (±10%)
2. Probabilistic early expiry for top-100 accessed keys
3. PostgreSQL connection pool increased to 50
4. Read replicas added; cache miss reads route to replicas

Sale metrics before/after fix: Cache stampede incidents dropped from 8/month to 0.

## Monitoring Redis Memory and CPU

```bash
# Key memory metrics:
redis-cli INFO memory
# used_memory_human: 8.50G     → actual data
# maxmemory_human: 12.00G      → limit
# mem_fragmentation_ratio: 1.12 → healthy
# used_memory_rss_human: 9.54G  → OS-reported

# Eviction monitoring:
redis-cli INFO stats | grep evicted_keys
# Rising number = memory pressure, increase maxmemory or evict manually

# Slow query log:
redis-cli CONFIG SET slowlog-log-slower-than 10000  # 10ms threshold
redis-cli SLOWLOG GET 25  # View last 25 slow commands
```

Prometheus alert rules:
```yaml
# Memory usage > 80% of maxmemory
redis_memory_used_bytes / redis_memory_max_bytes > 0.8

# High eviction rate (cache under memory pressure)
rate(redis_evicted_keys_total[5m]) > 100

# Cache hit rate dropping
redis_keyspace_hits_total / (redis_keyspace_hits_total + redis_keyspace_misses_total) < 0.90
```

The difference between a cache that helps you and one that causes your worst production incidents is usually 3 things: TTL jitter, stampede protection, and eviction policy selection. Everything else is tuning.
