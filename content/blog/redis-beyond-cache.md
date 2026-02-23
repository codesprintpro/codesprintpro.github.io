---
title: "Redis Beyond Cache: Sorted Sets, Streams, and Pub/Sub Patterns"
description: "Redis is far more than a cache. Explore how sorted sets power leaderboards, streams enable event sourcing, and pub/sub enables real-time notifications — with production Java examples."
date: "2025-01-22"
category: "Databases"
tags: ["redis", "cache", "java", "distributed systems", "streams"]
featured: true
affiliateSection: "distributed-systems-books"
---

Most teams use Redis for one thing: caching. They store objects with a TTL, check the cache before hitting the database, and call it a day. This barely scratches the surface.

Redis is a data structure server. Its real power lies in five data structures that solve distributed computing problems elegantly — problems that would otherwise require separate specialized systems. This article covers each with production Java examples using Lettuce (the recommended Redis client for Spring Boot).

## Setup: Lettuce Configuration

Before you can use any of these data structures, you need a properly configured Redis connection. The setup below uses Lettuce, which is the default client bundled with Spring Boot's `spring-boot-starter-data-redis`. Notice the 2-second command timeout — in production, a Redis call that hangs indefinitely can cascade into a full service outage, so always set a timeout that matches your SLA.

```java
@Configuration
public class RedisConfig {

    @Bean
    public RedisConnectionFactory redisConnectionFactory() {
        RedisStandaloneConfiguration config = new RedisStandaloneConfiguration("localhost", 6379);
        LettuceClientConfiguration clientConfig = LettuceClientConfiguration.builder()
            .commandTimeout(Duration.ofSeconds(2))
            .build();
        return new LettuceConnectionFactory(config, clientConfig);
    }

    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory factory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(factory);
        template.setKeySerializer(new StringRedisSerializer());
        template.setValueSerializer(new GenericJackson2JsonRedisSerializer());
        return template;
    }
}
```

The `GenericJackson2JsonRedisSerializer` means your Java objects are stored as JSON in Redis, which keeps them human-readable and debuggable from the Redis CLI — a small choice that saves a lot of pain during incidents.

## Sorted Sets: Leaderboards and Rate Limiting

The sorted set (`ZSET`) stores members with a floating-point score, automatically maintaining order. Adding, removing, and querying by rank are all O(log N).

Think of a sorted set like a scoreboard at an arcade: every player has a name (member) and a score, and the board is always kept in order. Redis does all the sorting for you, and any operation — add a score, find someone's rank, get the top 10 — runs in logarithmic time regardless of how many players are on the board.

### Use Case 1: Real-Time Leaderboard

A leaderboard sounds simple until you try to build one with a relational database. Updating a score, querying a rank, and fetching neighbors all require either expensive queries or complex caching logic. With a sorted set, these are single-command operations. The `incrementScore` call below is atomic — no race conditions when two requests update the same player simultaneously.

```java
@Service
public class LeaderboardService {

    private static final String LEADERBOARD_KEY = "leaderboard:weekly";

    @Autowired
    private StringRedisTemplate redis;

    // Add or update a player's score — O(log N)
    public void recordScore(String playerId, double points) {
        redis.opsForZSet().incrementScore(LEADERBOARD_KEY, playerId, points);
    }

    // Get top N players with their scores — O(log N + N)
    public List<PlayerRank> getTopPlayers(int count) {
        Set<ZSetOperations.TypedTuple<String>> topPlayers =
            redis.opsForZSet().reverseRangeWithScores(LEADERBOARD_KEY, 0, count - 1);

        List<PlayerRank> result = new ArrayList<>();
        int rank = 1;
        for (ZSetOperations.TypedTuple<String> tuple : topPlayers) {
            result.add(new PlayerRank(rank++, tuple.getValue(), tuple.getScore()));
        }
        return result;
    }

    // Get a specific player's rank — O(log N)
    public Long getPlayerRank(String playerId) {
        Long rank = redis.opsForZSet().reverseRank(LEADERBOARD_KEY, playerId);
        return rank != null ? rank + 1 : null; // Convert 0-indexed to 1-indexed
    }

    // Get players around a specific player — for "your neighbors" feature
    public List<PlayerRank> getNeighbors(String playerId, int range) {
        Long rank = redis.opsForZSet().reverseRank(LEADERBOARD_KEY, playerId);
        if (rank == null) return Collections.emptyList();

        long start = Math.max(0, rank - range);
        long end = rank + range;
        return getTopPlayers((int)(end - start + 1));
    }
}
```

The `getNeighbors` method is the kind of feature that would require a complex window function in SQL. In Redis, it's just two commands: find the rank, then slice the sorted set around it.

### Use Case 2: Sliding Window Rate Limiter

A naive rate limiter counts requests in a fixed bucket (e.g., "max 100 per minute"). The problem: a user can fire 100 requests at 00:59 and 100 more at 01:01, effectively making 200 requests in 2 seconds. A sliding window fixes this by always counting the last N seconds from the current moment. Sorted sets make this elegant — each request is stored with its timestamp as the score, so pruning old requests is a single range-delete by score.

```java
@Service
public class RateLimiter {

    @Autowired
    private StringRedisTemplate redis;

    /**
     * Sliding window rate limiter using sorted sets.
     * Each request is stored with its timestamp as the score.
     * Old entries outside the window are pruned on each check.
     */
    public boolean isAllowed(String userId, int maxRequests, Duration window) {
        String key = "rate_limit:" + userId;
        long now = System.currentTimeMillis();
        long windowStart = now - window.toMillis();

        return redis.execute((RedisCallback<Boolean>) connection -> {
            connection.multi(); // BEGIN transaction

            // Remove entries outside the window
            connection.zRemRangeByScore(key.getBytes(), 0, windowStart);

            // Count remaining entries
            connection.zCard(key.getBytes());

            // Add current request
            connection.zAdd(key.getBytes(), now, String.valueOf(now).getBytes());

            // Set expiry on the key (auto-cleanup)
            connection.expire(key.getBytes(), window.getSeconds() + 1);

            List<Object> results = connection.exec();

            Long currentCount = (Long) results.get(1);
            return currentCount != null && currentCount < maxRequests;
        });
    }
}
```

The entire check-and-add is wrapped in a Redis transaction (`MULTI`/`EXEC`), which guarantees that no other client can sneak a request in between the count and the add. This is the kind of correctness that is very hard to achieve with application-level locking.

## Streams: Persistent Event Log

Redis Streams (added in 5.0) are a persistent, append-only log similar to Kafka partitions — but inside Redis. They support consumer groups, acknowledgment, and pending message tracking.

If you've used Kafka, Streams will feel familiar: producers append events, consumer groups distribute work, and unacknowledged messages stay in a Pending Entries List (PEL) so they can be retried. The key difference is scale — Redis Streams are the right tool when your event volume fits in memory and you don't want the operational overhead of a separate Kafka cluster.

```java
@Service
public class OrderEventStream {

    private static final String STREAM_KEY = "order-stream";
    private static final String CONSUMER_GROUP = "order-processors";

    @Autowired
    private StreamOperations<String, Object, Object> streamOps;

    // Producer: publish an event
    public String publishOrderEvent(OrderEvent event) {
        Map<String, Object> fields = Map.of(
            "orderId", event.getOrderId(),
            "status", event.getStatus(),
            "userId", event.getUserId(),
            "amount", event.getAmount(),
            "timestamp", Instant.now().toString()
        );

        // XADD order-stream * orderId 123 status PLACED ...
        // Returns auto-generated message ID: "1704067200000-0"
        RecordId messageId = streamOps.add(STREAM_KEY, fields);
        log.info("Published order event, messageId={}", messageId);
        return messageId.toString();
    }

    // Consumer: read and acknowledge messages
    public void consumeEvents() {
        // Create consumer group if not exists
        try {
            streamOps.createGroup(STREAM_KEY, ReadOffset.from("0"), CONSUMER_GROUP);
        } catch (Exception e) {
            // Group already exists — ignore
        }

        while (true) {
            // XREADGROUP GROUP order-processors consumer-1 COUNT 10 BLOCK 2000 STREAMS order-stream >
            List<MapRecord<String, Object, Object>> messages = streamOps.read(
                Consumer.from(CONSUMER_GROUP, "consumer-1"),
                StreamReadOptions.empty().count(10).block(Duration.ofSeconds(2)),
                StreamOffset.create(STREAM_KEY, ReadOffset.lastConsumed())
            );

            for (MapRecord<String, Object, Object> message : messages) {
                try {
                    processOrderEvent(message.getValue());
                    // Acknowledge successful processing
                    streamOps.acknowledge(STREAM_KEY, CONSUMER_GROUP, message.getId());
                } catch (Exception e) {
                    log.error("Failed to process message {}", message.getId(), e);
                    // Message stays in PEL (Pending Entries List) — can be reclaimed
                }
            }
        }
    }

    // Reclaim messages that have been pending too long (crashed consumers)
    public void reclaimStalledMessages() {
        // XAUTOCLAIM: claim messages idle > 5 minutes
        PendingMessages pending = streamOps.pending(
            STREAM_KEY,
            Consumer.from(CONSUMER_GROUP, "consumer-1"),
            Range.unbounded(), 100
        );
        // Process pending messages with a different consumer
    }
}
```

Notice that `acknowledge` is only called after successful processing. If a consumer crashes mid-process, the message stays in the PEL and `reclaimStalledMessages` can hand it to another consumer — this is how you get at-least-once delivery guarantees without a dedicated message broker.

## Pub/Sub: Real-Time Notifications

Redis Pub/Sub is a fire-and-forget messaging system. Publishers send messages to channels; all current subscribers receive them. Messages are **not persisted** — if a subscriber is down, it misses messages.

Think of Pub/Sub like a radio broadcast: the station transmits at all times, and you only hear it while your radio is on. This is perfect for live notifications where freshness matters more than completeness — telling a user they have a new chat message is only useful while they're online anyway.

```java
// Publisher
@Service
public class NotificationPublisher {

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    public void notifyUser(String userId, NotificationEvent event) {
        String channel = "notifications:" + userId;
        redisTemplate.convertAndSend(channel, event);
    }

    public void broadcastSystemAlert(AlertEvent alert) {
        redisTemplate.convertAndSend("system-alerts", alert);
    }
}

// Subscriber configuration
@Configuration
public class RedisPubSubConfig {

    @Bean
    public RedisMessageListenerContainer redisMessageListenerContainer(
            RedisConnectionFactory factory,
            NotificationMessageListener listener) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(factory);

        // Subscribe to user-specific notifications
        container.addMessageListener(listener,
            new PatternTopic("notifications:*")); // Wildcard subscription

        // Subscribe to system alerts
        container.addMessageListener(listener,
            new ChannelTopic("system-alerts"));

        return container;
    }
}

@Component
public class NotificationMessageListener implements MessageListener {

    @Autowired
    private WebSocketService webSocketService;

    @Override
    public void onMessage(Message message, byte[] pattern) {
        String channel = new String(message.getChannel());
        String body = new String(message.getBody());

        if (channel.startsWith("notifications:")) {
            String userId = channel.replace("notifications:", "");
            webSocketService.sendToUser(userId, body);
        } else if (channel.equals("system-alerts")) {
            webSocketService.broadcast(body);
        }
    }
}
```

**When to use Pub/Sub vs Streams:**
- **Pub/Sub**: Real-time notifications where it's acceptable to miss messages (user online alerts, live dashboards)
- **Streams**: Event sourcing, order processing, any case where you need persistence and guaranteed delivery

## Distributed Locking with SETNX

Distributed locks solve a problem that seems simple but isn't: ensuring only one instance of your application performs a critical operation at a time. Imagine two payment service instances both receiving a retry for the same order — without a lock, you could charge the user twice. Redis's `SETNX` (Set if Not eXists) combined with a TTL gives you a lock that is both exclusive and self-expiring.

```java
@Service
public class DistributedLockService {

    @Autowired
    private StringRedisTemplate redis;

    private static final long LOCK_TTL_SECONDS = 30;

    /**
     * Acquire a distributed lock. Returns lock token if acquired, null if not.
     * The token is needed to safely release the lock.
     */
    public String acquireLock(String resourceId) {
        String lockKey = "lock:" + resourceId;
        String lockToken = UUID.randomUUID().toString(); // Unique per lock acquisition

        Boolean acquired = redis.opsForValue().setIfAbsent(
            lockKey,
            lockToken,
            Duration.ofSeconds(LOCK_TTL_SECONDS)
        );

        return Boolean.TRUE.equals(acquired) ? lockToken : null;
    }

    /**
     * Release only if we still own the lock. Uses Lua script for atomicity.
     * Without Lua: check-then-delete is a TOCTOU race condition.
     */
    public boolean releaseLock(String resourceId, String lockToken) {
        String lockKey = "lock:" + resourceId;

        String luaScript = """
            if redis.call('get', KEYS[1]) == ARGV[1] then
                return redis.call('del', KEYS[1])
            else
                return 0
            end
            """;

        Long result = redis.execute(
            new DefaultRedisScript<>(luaScript, Long.class),
            List.of(lockKey),
            lockToken
        );

        return Long.valueOf(1).equals(result);
    }

    // Usage pattern
    public void processPayment(String orderId) {
        String lockToken = acquireLock("payment:" + orderId);
        if (lockToken == null) {
            throw new ResourceBusyException("Payment already being processed for order " + orderId);
        }

        try {
            paymentService.charge(orderId);
        } finally {
            releaseLock("payment:" + orderId, lockToken);
        }
    }
}
```

The Lua script for releasing the lock is the critical piece here: it checks and deletes the key atomically. Without it, there's a window where your lock could expire between the `GET` check and the `DEL` — and you'd end up deleting another process's lock. The unique `lockToken` per acquisition is what prevents this: even if the TTL fires, you can't accidentally release a lock you don't own.

## HyperLogLog: Counting Unique Visitors at Scale

Counting exact unique visitors requires storing every visitor ID — expensive at scale. HyperLogLog estimates cardinality with ~0.81% error using only 12KB regardless of input size.

Imagine trying to count how many unique people walked through a mall's entrance over a year. You could keep a list of every face, but storing millions of names is expensive. HyperLogLog is like a probabilistic tally counter — it can't tell you exactly who visited, but it can tell you "roughly 2.3 million unique visitors" while using the same amount of memory whether you have 100 or 100 million visitors.

```java
@Service
public class UniqueVisitorCounter {

    @Autowired
    private StringRedisTemplate redis;

    public void trackVisit(String pageId, String visitorId) {
        String key = "page_visitors:" + pageId + ":" + LocalDate.now();
        // PFADD: O(1), uses ~12KB regardless of cardinality
        redis.opsForHyperLogLog().add(key, visitorId);
        redis.expire(key, Duration.ofDays(30));
    }

    public long getUniqueVisitors(String pageId) {
        String key = "page_visitors:" + pageId + ":" + LocalDate.now();
        // PFCOUNT: returns estimated cardinality with 0.81% error
        return redis.opsForHyperLogLog().size(key);
    }

    public long getUniqueVisitorsAcrossPages(List<String> pageIds) {
        String[] keys = pageIds.stream()
            .map(id -> "page_visitors:" + id + ":" + LocalDate.now())
            .toArray(String[]::new);
        // PFCOUNT on multiple keys: union estimate
        return redis.opsForHyperLogLog().size(keys);
    }
}
```

The 0.81% error rate is the trade-off you're accepting: for a page with 1 million visitors, your count will be off by at most ~8,100. For analytics dashboards where "approximately 1 million" is meaningful, this is a worthwhile trade for a 99.9% reduction in memory usage compared to storing exact visitor IDs.

## Production Configuration

Getting Redis working in development is easy; getting it right in production requires deliberate configuration. The settings below cover connection pooling (to avoid connection storms during traffic spikes), cluster topology awareness (so your client can find the right shard after a failover), and eviction policy (which determines what Redis does when memory fills up).

```yaml
# Redis configuration for production
spring:
  redis:
    host: redis-cluster.internal
    port: 6379
    timeout: 2000ms
    lettuce:
      pool:
        max-active: 50
        max-idle: 10
        min-idle: 5
        max-wait: 1000ms
      cluster:
        refresh:
          adaptive: true           # Detect cluster topology changes
          period: 30s

# Key eviction policy — critical for cache usage
# volatile-lru: evict keys with TTL, LRU order (recommended for mixed cache/persistent)
# allkeys-lru: evict any key, LRU order (for pure cache)
# noeviction: reject writes when full (use for persistent data)
```

```bash
# maxmemory and eviction policy (redis.conf or CONFIG SET)
CONFIG SET maxmemory 8gb
CONFIG SET maxmemory-policy allkeys-lfu  # LFU: better than LRU for Zipf distributions

# Monitor evicted keys — should be near 0 for persistent data
INFO stats | grep evicted_keys
```

If you are using Redis for both caching and persistent data structures (like Streams or sorted sets with leaderboard data), use `volatile-lru` so only keys with a TTL are evicted — your persistent data stays safe. If Redis is purely a cache, `allkeys-lfu` is the best modern choice because it evicts the least-frequently-used keys, which handles the real-world "long tail" of cached objects better than a strict LRU.

## When to Use Redis vs What

| Use Case | Redis Data Structure | Alternative |
|---|---|---|
| Simple cache | String | Memcached |
| Session storage | Hash | Database |
| Leaderboard | Sorted Set | PostgreSQL (complex query) |
| Rate limiting | Sorted Set / String | API Gateway |
| Pub/Sub | Pub/Sub | WebSockets (no persistence) |
| Event log | Stream | Kafka (for high volume) |
| Unique count | HyperLogLog | Exact count in DB |
| Distributed lock | String (SETNX) | ZooKeeper |
| Queue | List | RabbitMQ |
| Membership test | Bloom Filter (RedisBloom) | Exact set |

Redis's sweet spot is low-latency, high-throughput operations on data structures where the dataset fits in memory. The moment your dataset exceeds available RAM or you need complex query patterns, reach for PostgreSQL or a specialized system.

The key insight is to **match the data structure to the access pattern** — not to treat Redis as a generic key-value store where everything is a serialized JSON blob.
