---
title: "System Design: Building a URL Shortener That Handles Billions of Requests"
description: "A complete system design walkthrough for a URL shortener — from requirements and storage estimates through hashing strategy, caching architecture, and global deployment patterns."
date: "2025-01-29"
category: "System Design"
tags: ["system design", "distributed systems", "databases", "caching", "aws"]
featured: true
affiliateSection: "system-design-courses"
---

The URL shortener is the "Hello World" of system design interviews — but most candidates treat it superficially. The interesting parts are not in generating a short code; they're in the numbers that reveal the true scale, the caching strategy that makes redirects feel instant, and the analytics pipeline that handles billions of click events without slowing down the redirect path.

Let's build bit.ly.

## Requirements

**Functional:**
- Create a short URL from a long URL (with optional custom alias)
- Redirect short URL to the original long URL
- Set optional expiry on URLs
- Track click analytics (count, geo, referrer, device)

**Non-Functional:**
- 100M new URLs created per day
- 10:1 read-to-write ratio (1B redirects/day)
- Redirect latency p99 < 50ms globally
- High availability (99.99% uptime — ~52 minutes downtime/year)
- URL data retained for 5 years

## Back-of-Envelope Calculations

Before writing any code, you need to understand the numbers. This calculation reveals the most important architectural constraint: the system is overwhelmingly read-heavy, which means caching is not an optimization — it's the core design requirement.

```
Write throughput:
  100M URLs/day ÷ 86,400 sec/day = ~1,160 writes/sec
  Peak (10x): ~12,000 writes/sec

Read throughput:
  1B redirects/day = ~11,600 reads/sec
  Peak: ~115,000 reads/sec

Storage (5 years):
  100M URLs/day × 365 days × 5 years = 182.5B URLs
  Per URL record: 500 bytes (URL + metadata + indexes)
  Total: 182.5B × 500 = ~91 TB

Cache:
  Pareto principle: 20% of URLs generate 80% of traffic
  Hot URLs to cache: 20% of daily URLs = 20M
  Cache storage: 20M × 500 bytes = ~10 GB (fits on a single Redis node)

Short code namespace:
  Using Base62 (a-z, A-Z, 0-9) with 7 characters:
  62^7 = 3.5 trillion unique codes (covers 182.5B URLs with room to spare)
```

Notice the asymmetry: reads outpace writes 100:1 at peak. This single insight drives nearly every architectural decision you'll make — from separate read and write APIs to the three-tier caching strategy described later.

## API Design

Your API surface should be minimal and purpose-driven. The three core endpoints map directly to the three user actions: create a short link, follow it, and measure its impact. Notice that the redirect uses a `302` status code rather than `301` — a deliberate choice explained in the redirect implementation section.

```
POST /api/v1/urls
Body: { "longUrl": "https://...", "customAlias": "my-link", "expiresAt": "2026-01-01" }
Response: { "shortUrl": "https://codesprt.pro/ab3Xk2p", "shortCode": "ab3Xk2p" }

GET /{shortCode}
Response: 302 Redirect to long URL
Headers: Location: https://original-url.com

DELETE /api/v1/urls/{shortCode}
Auth: Bearer token (only URL owner can delete)

GET /api/v1/urls/{shortCode}/analytics
Response: { "totalClicks": 15420, "uniqueVisitors": 8930, "clicksByDay": [...] }
```

## Database Schema

Your database schema needs to serve two very different workloads: the URL lookup (read path) and click analytics (write-heavy, time-series). Keeping them in the same table — or even the same database — would let the analytics writes compete with redirect reads. The schema below separates these concerns explicitly.

```sql
-- URLs table (primary storage)
CREATE TABLE urls (
    id            BIGINT PRIMARY KEY,          -- Auto-increment or Snowflake ID
    short_code    VARCHAR(10) UNIQUE NOT NULL, -- "ab3Xk2p"
    long_url      TEXT NOT NULL,               -- Original URL (up to 2048 chars)
    user_id       BIGINT,                      -- NULL for anonymous
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMP,                   -- NULL = never expires
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    click_count   BIGINT NOT NULL DEFAULT 0    -- Approximate counter (for display)
);

CREATE INDEX idx_urls_short_code ON urls(short_code); -- Primary lookup index
CREATE INDEX idx_urls_user_id ON urls(user_id);       -- User's URL history
CREATE INDEX idx_urls_expires_at ON urls(expires_at) WHERE expires_at IS NOT NULL;

-- Click events (analytics) — separate table, separate DB
-- Consider: ClickHouse or Cassandra for write-heavy analytics
CREATE TABLE click_events (
    id            UUID DEFAULT gen_random_uuid(),
    short_code    VARCHAR(10) NOT NULL,
    clicked_at    TIMESTAMP NOT NULL,
    ip_hash       VARCHAR(64),                -- Hashed for privacy
    country       VARCHAR(2),
    city          VARCHAR(100),
    device_type   VARCHAR(20),               -- mobile, desktop, tablet, bot
    browser       VARCHAR(50),
    referer       TEXT
) PARTITION BY RANGE (clicked_at);           -- Monthly partitions
```

The partial index on `expires_at WHERE expires_at IS NOT NULL` is a subtle but important optimization: it only indexes rows that actually have an expiry, keeping the index small and fast for the cleanup job that runs nightly.

## Short Code Generation: Why Base62 Over MD5

With the schema established, the next question is how to generate the short code itself. This is where most candidates go straight to "just MD5 the URL," but that approach has fundamental problems at scale. Here's a comparison of the real options and why each matters.

**Option A: MD5 hash of URL** — Take first 7 characters of MD5(long_url)
- Problem: Two identical long URLs produce the same short code
- Problem: Collision probability grows with scale (birthday problem)
- Problem: Must check database for collision on every create — expensive

**Option B: Auto-increment ID encoded in Base62** — Generate an auto-increment ID, encode to Base62
- ID 1 → "1", ID 10,000 → "2bI", ID 3,500,000,000 → "DTRK4"
- Collision-free by design — each ID is unique
- No database read-before-write needed
- Predictable (slightly guessable) — acceptable for public short links

**Option C: Snowflake ID** — 64-bit unique ID with timestamp + worker ID + sequence
- Globally unique across distributed systems without coordination
- Not guessable (includes worker ID and microseconds)
- Encodes to 7-8 Base62 characters

**Recommended: Option B for simplicity, Option C for security.**

The following implementation shows how a Base62 encoder works. Think of it like converting a decimal number to a different base — the same way you convert binary to hexadecimal — except here your "digits" are 62 characters from a-z, A-Z, and 0-9.

```java
public class Base62Encoder {

    private static final String ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    public static String encode(long id) {
        if (id == 0) return String.valueOf(ALPHABET.charAt(0));
        StringBuilder sb = new StringBuilder();
        while (id > 0) {
            sb.append(ALPHABET.charAt((int)(id % 62)));
            id /= 62;
        }
        return sb.reverse().toString();
    }

    public static long decode(String code) {
        long id = 0;
        for (char c : code.toCharArray()) {
            id = id * 62 + ALPHABET.indexOf(c);
        }
        return id;
    }
}

// Usage
long nextId = idGenerator.nextId(); // Redis INCR or DB sequence
String shortCode = Base62Encoder.encode(nextId); // "ab3Xk2p"
```

Notice that `decode` is the inverse operation: it lets you reconstruct the original database row ID from any short code, which is useful for debugging and for analytics joins.

## System Architecture

With your data model and encoding strategy in place, here is how all the components fit together. The key insight is that reads and writes are handled by entirely separate API services — this lets you scale them independently and protects the high-throughput read path from any slowness in the write path.

```
                        ┌─────────────────────────┐
                        │      CloudFront CDN       │
                        │  (caches 301 redirects)   │
                        └────────────┬────────────┘
                                     │
                        ┌────────────▼────────────┐
                        │    Application Load       │
                        │    Balancer (ALB)         │
                        └──┬──────────────────┬──┘
                           │                  │
               ┌───────────▼──┐          ┌────▼────────────┐
               │  Write API   │          │   Read API       │
               │  (URL create)│          │   (redirects)    │
               │  ~1.2K rps   │          │   ~115K rps      │
               └──────┬───────┘          └────┬────────────┘
                      │                       │
         ┌────────────▼───┐     ┌─────────────▼───────────┐
         │   PostgreSQL   │     │     Redis Cluster        │
         │   Primary      │     │   (URL cache, ~10GB)     │
         │   (writes)     │◄────┤   Cache-hit rate: >95%   │
         └────────────────┘     └─────────────────────────┘
                  │                         │ cache miss
         ┌────────▼────────┐      ┌─────────▼────────────┐
         │  PG Read        │      │   PostgreSQL Read     │
         │  Replicas (2x)  │◄─────┤   Replicas           │
         └─────────────────┘      └──────────────────────┘
                                           │
                              ┌────────────▼──────────────┐
                              │   Analytics Pipeline       │
                              │  Kafka → ClickHouse        │
                              └───────────────────────────┘
```

Notice how the analytics pipeline sits entirely off the critical read path. Click events are written asynchronously to Kafka, which means a slow analytics write can never delay a redirect response.

## The Critical Path: Redirect in Under 50ms

The redirect is the most latency-sensitive operation in the system. Think of it like a highway toll booth: you need the transaction to complete in under a second, or traffic backs up. The implementation below achieves this by checking Redis first (1-2ms), falling back to the database only on a miss, and dispatching analytics entirely asynchronously so it never adds to your response time.

```java
@RestController
public class RedirectController {

    @Autowired
    private RedisTemplate<String, String> redis;

    @Autowired
    private UrlRepository urlRepository;

    @Autowired
    private KafkaTemplate<String, ClickEvent> kafkaTemplate;

    @GetMapping("/{shortCode}")
    public ResponseEntity<Void> redirect(
            @PathVariable String shortCode,
            HttpServletRequest request) {

        String cacheKey = "url:" + shortCode;

        // Step 1: Redis lookup (~1-2ms)
        String longUrl = redis.opsForValue().get(cacheKey);

        if (longUrl == null) {
            // Step 2: Database lookup (cache miss, ~5-10ms)
            Url url = urlRepository.findByShortCode(shortCode)
                .filter(u -> u.isActive())
                .filter(u -> u.getExpiresAt() == null || u.getExpiresAt().isAfter(Instant.now()))
                .orElseThrow(() -> new UrlNotFoundException(shortCode));

            longUrl = url.getLongUrl();

            // Populate cache (24h TTL, refresh on access)
            redis.opsForValue().set(cacheKey, longUrl, Duration.ofHours(24));
        }

        // Step 3: Async analytics (never in critical path)
        String finalUrl = longUrl;
        CompletableFuture.runAsync(() ->
            kafkaTemplate.send("click-events", ClickEvent.builder()
                .shortCode(shortCode)
                .timestamp(Instant.now())
                .ipHash(hashIp(request.getRemoteAddr()))
                .userAgent(request.getHeader("User-Agent"))
                .referer(request.getHeader("Referer"))
                .build())
        );

        // Step 4: Redirect (302 = don't cache, 301 = browser caches)
        return ResponseEntity.status(HttpStatus.FOUND)
            .header(HttpHeaders.LOCATION, finalUrl)
            .build();
    }
}
```

The `302` vs `301` choice is worth understanding deeply: a `301` tells browsers to cache the redirect permanently, reducing server load but making it impossible to update or expire the URL without clearing browser caches across all users. A `302` ensures every redirect hits your servers, which is why `301` is only appropriate for truly permanent, immutable links.

**Total redirect time breakdown:**
- Redis hit: ~2ms
- Redis miss + DB read: ~12ms
- Response serialization: ~1ms
- Network: depends on region

## Caching Strategy

Now that you understand the critical path, the caching strategy becomes clear: you want to intercept requests as close to the user as possible, at each of three layers. Think of this like a library's book retrieval system — you first check if the book is on your desk (Redis), then the local shelf (read replica), and only then send a request to the central archive (primary database).

```
Three-tier caching for redirects:

Tier 1: CDN (CloudFront)
  - Cache 301 redirects at edge nodes (50+ global PoPs)
  - TTL: match URL expiry, or 24h for non-expiring URLs
  - Reduces latency to <10ms globally for hot URLs
  - Invalidate via CloudFront API on URL deletion

Tier 2: Redis Cluster
  - 10GB cluster covers top 20M URLs (80% of traffic)
  - Eviction: allkeys-lfu (keeps frequently-accessed URLs)
  - TTL: 24 hours, refreshed on access
  - Replication: 1 primary + 2 replicas per shard

Tier 3: PostgreSQL Read Replicas
  - 2 replicas with connection pooling (PgBouncer)
  - Only for cache misses (<5% of traffic)
  - Handles ~5,000 queries/sec comfortably
```

The choice of `allkeys-lfu` (Least Frequently Used) eviction in Redis is deliberate: it keeps the URLs that receive the most ongoing traffic, rather than the most recently added ones (`allkeys-lru`). This ensures viral links stay in cache even if they were created weeks ago.

## Analytics: ClickHouse for Sub-Second Queries on Billions of Rows

PostgreSQL cannot efficiently aggregate billions of click events. ClickHouse, a column-oriented OLAP database, handles this natively. The distinction matters because PostgreSQL stores data row-by-row (great for fetching complete records), while ClickHouse stores data column-by-column (great for aggregating one column across billions of rows). When you run `COUNT(*)` on a 90-day click log, ClickHouse only reads the `clicked_at` column — not the entire row — which is why it stays fast at scale.

```sql
-- ClickHouse schema
CREATE TABLE click_events (
    short_code    LowCardinality(String),   -- dictionary-encoded for efficiency
    clicked_at    DateTime,
    country       LowCardinality(String),
    device_type   LowCardinality(String),
    browser       LowCardinality(String),
    ip_hash       FixedString(32)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(clicked_at)
ORDER BY (short_code, clicked_at);

-- Analytics query: 30-day click trend — runs in <1 second on billions of rows
SELECT
    toDate(clicked_at) AS date,
    count() AS total_clicks,
    uniqExact(ip_hash) AS unique_visitors,
    countIf(device_type = 'mobile') AS mobile_clicks
FROM click_events
WHERE short_code = 'ab3Xk2p'
  AND clicked_at >= now() - INTERVAL 30 DAY
GROUP BY date
ORDER BY date;
```

The `LowCardinality(String)` type is a ClickHouse optimization worth noting: for columns with a small number of distinct values (like `device_type` or `country`), ClickHouse applies dictionary encoding automatically, reducing storage by up to 10x and accelerating GROUP BY operations significantly.

## Edge Cases That Matter in Interviews

With the happy path designed, you need to handle the failure modes. These edge cases are not hypothetical — each represents a real abuse vector or operational issue that production URL shorteners encounter daily.

**1. Custom alias collision:**

When a user requests a custom alias, you must check for uniqueness before committing, because unlike auto-generated codes, custom aliases can conflict with existing entries.

```java
if (customAlias != null) {
    if (urlRepository.existsByShortCode(customAlias)) {
        throw new AliasAlreadyTakenException(customAlias);
    }
    shortCode = customAlias;
}
```

**2. URL validation:**

Without validation, your shortener becomes a free proxy for phishing and malware distribution. Checking that the target URL is not your own domain prevents redirect loops, while the safety check guards against abuse.

```java
// Prevent redirect loops and abuse
private void validateUrl(String longUrl) {
    if (longUrl.contains("codesprt.pro")) {
        throw new InvalidUrlException("Cannot shorten our own URLs");
    }
    // Check against malware/phishing blocklist
    if (safetyCheckService.isMalicious(longUrl)) {
        throw new MaliciousUrlException();
    }
}
```

**3. Expired URL cleanup:**

Expired URLs should never be hard-deleted, because the analytics records still reference them. A nightly soft-delete sets `is_active = false` so the redirect path rejects the code while the analytics data remains intact.

```java
@Scheduled(cron = "0 0 2 * * *") // 2 AM daily
public void deactivateExpiredUrls() {
    urlRepository.deactivateExpired(Instant.now()); // Soft delete
    // Don't hard delete — analytics need the record
}
```

**4. Rate limiting URL creation:**

```java
// 100 URLs/day for free tier, 10,000/day for pro
// Redis sliding window: see rate limiter article
```

The URL shortener is a microcosm of distributed systems challenges: write idempotency, cache invalidation, async event processing, and global latency targets. Nail these, and you've demonstrated the architectural thinking that matters.
