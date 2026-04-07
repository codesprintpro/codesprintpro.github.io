---
title: "Cache Invalidation Patterns: TTL, Write-Through, Cache-Aside, and Event-Driven Eviction"
description: "A practical guide to cache invalidation in production systems: TTLs, cache-aside, write-through, versioned keys, event-driven eviction, stampede prevention, and stale-read tradeoffs."
date: "2025-07-22"
category: "Databases"
tags: ["cache invalidation", "redis", "caching", "distributed systems", "performance", "backend engineering"]
featured: false
affiliateSection: "database-resources"
---

Cache invalidation is hard because the cache is not the source of truth. It is a copy, and every copy has a consistency problem.

The real question is not "how do we make cache perfectly consistent?" The better question is: **how stale can this data be, and what happens if it is wrong?**

Different data needs different cache strategies. A product description can be stale for minutes. A bank balance cannot. A feature flag might tolerate seconds of staleness. A permission change may need immediate invalidation.

## Cache-Aside

Cache-aside is the most common pattern:

```java
public Product getProduct(String productId) {
    String key = "product:" + productId;

    Product cached = redis.get(key, Product.class);
    if (cached != null) {
        return cached;
    }

    Product product = productRepository.findById(productId);
    redis.set(key, product, Duration.ofMinutes(10));
    return product;
}
```

The application owns cache population. On a miss, read from the database and put the result into Redis.

Pros:

- simple
- works with any database
- easy to apply per endpoint

Cons:

- first request after expiry is slow
- stale data exists until TTL or explicit eviction
- cache stampede risk on hot keys

## TTL-Based Invalidation

TTL is the simplest invalidation strategy:

```java
redis.set("product:" + productId, product, Duration.ofMinutes(10));
```

Use TTL when:

- data changes infrequently
- some staleness is acceptable
- correctness is not safety-critical

Avoid long TTLs for user-specific permissions, pricing, inventory, or account state unless you have another invalidation mechanism.

TTL should be based on business tolerance, not guesswork:

| Data | Example TTL |
|---|---|
| Static catalog metadata | 30-60 minutes |
| Product price | 1-5 minutes |
| User profile | 5-15 minutes |
| Permissions | seconds or explicit invalidation |
| Account balance | usually avoid caching or use strict invalidation |

## Explicit Eviction on Write

When the source of truth changes, delete the cache:

```java
@Transactional
public void updateProduct(String productId, UpdateProductRequest request) {
    productRepository.update(productId, request);
    redis.delete("product:" + productId);
}
```

This is better than only relying on TTL. But there is a subtle issue: if the transaction rolls back after deletion, the cache may be removed even though the database did not change. Usually that is acceptable because the next read repopulates the old value. More dangerous is deleting before the database commit while another reader repopulates stale data.

Prefer evicting after commit:

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onProductUpdated(ProductUpdatedEvent event) {
    redis.delete("product:" + event.productId());
}
```

## Write-Through Cache

In write-through, writes go through the cache layer, which updates both cache and database:

```java
public void updateProduct(Product product) {
    productRepository.save(product);
    redis.set("product:" + product.id(), product, Duration.ofMinutes(10));
}
```

This reduces stale reads after writes, but it still has failure windows. If the database write succeeds and Redis write fails, the cache may remain stale. You still need TTL as a fallback.

Write-through works best when:

- writes are not too frequent
- read-after-write consistency matters
- the write path is centralized

It gets messy when multiple services can update the same entity.

## Event-Driven Invalidation

For distributed systems, publish an event when data changes:

```json
{
  "eventType": "PRODUCT_UPDATED",
  "productId": "p123",
  "changedAt": "2025-07-22T12:00:00Z"
}
```

Consumers evict relevant keys:

```java
@KafkaListener(topics = "product-events")
public void handle(ProductUpdated event) {
    redis.delete("product:" + event.productId());
    redis.delete("product-summary:" + event.productId());
}
```

This is powerful when multiple services cache the same data. The product service does not need to know every cache key in every downstream service. It publishes a domain event, and each service invalidates its own caches.

Failure mode: consumers can lag. Keep TTLs even with event invalidation so stale data eventually disappears.

## Versioned Cache Keys

Versioned keys avoid delete races:

```java
String key = "product:" + productId + ":v" + product.getVersion();
```

If the product version increments on update, old cache entries become unreachable:

```
product:p123:v41
product:p123:v42
```

This is useful when you can cheaply know the current version. The old keys expire naturally via TTL.

Versioned keys are excellent for immutable or semi-immutable objects, but can create many keys if updates are frequent.

## Cache Stampede Prevention

When a hot key expires, many requests can miss at once and hit the database together.

Use a short lock:

```java
Product cached = redis.get(key, Product.class);
if (cached != null) return cached;

String lockKey = "lock:" + key;
boolean locked = redis.setIfAbsent(lockKey, "1", Duration.ofSeconds(5));

if (locked) {
    try {
        Product product = productRepository.findById(productId);
        redis.set(key, product, Duration.ofMinutes(10));
        return product;
    } finally {
        redis.delete(lockKey);
    }
}

Thread.sleep(50);
return redis.get(key, Product.class);
```

In high-traffic systems, also add TTL jitter:

```java
Duration ttl = Duration.ofMinutes(10)
    .plusSeconds(ThreadLocalRandom.current().nextInt(0, 60));
```

Jitter prevents many keys from expiring at exactly the same time.

## Negative Caching

If missing data is requested frequently, cache the miss:

```java
if (product == null) {
    redis.set("product:" + productId, "NOT_FOUND", Duration.ofMinutes(1));
    throw new NotFoundException();
}
```

Use a short TTL. Negative caching can hide newly created data if the TTL is too long.

## Production Checklist

- Define acceptable staleness per data type
- Use TTL even with explicit/event invalidation
- Evict after database commit
- Use event-driven invalidation across services
- Add TTL jitter for hot keys
- Prevent stampedes on expensive cache misses
- Use versioned keys when object versions are easy to access
- Avoid caching highly sensitive correctness-critical state unless the invalidation story is strong
- Monitor hit rate, miss rate, evictions, Redis latency, and database load after cache expiry

Caching is not just a performance optimization. It is a consistency design decision. The best cache strategy is the one that makes staleness explicit and survivable.
