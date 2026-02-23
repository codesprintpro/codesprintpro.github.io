---
title: "Designing a High-Throughput Notification System for 100K Events per Second"
description: "End-to-end architecture for a notification system handling 100,000 events per second: capacity planning, Kafka partition sizing, fan-out strategy, rate limiting, idempotency, and incident simulation."
date: "2025-05-10"
category: "System Design"
tags: ["system design", "notifications", "kafka", "throughput", "capacity planning", "distributed systems"]
featured: false
affiliateSection: "system-design-courses"
---

100,000 events per second is not a notification system problem — it's a data pipeline problem that happens to produce notifications. Teams that approach it as a features problem ("we just need push, email, and SMS") build systems that collapse under load. The engineering challenge is the fan-out at scale: one event triggers notifications to potentially thousands of users, each notification routed through different channels, rate-limited per user, deduplicated, and delivered with retry guarantees.

## Functional and Non-Functional Requirements

**Functional:**
- Ingest raw events from producer services (user actions, system events)
- Enrich events with user preferences and notification templates
- Route to appropriate channels: push (FCM/APNs), email, SMS, in-app
- Respect per-user preferences and quiet hours
- Track delivery status per notification

**Non-Functional:**
- Ingest throughput: 100,000 events/second (peak)
- Delivery latency: < 5 seconds end-to-end for push notifications
- Delivery latency: < 60 seconds for email/SMS
- Availability: 99.9% (< 8.7 hours downtime/year)
- At-least-once delivery with idempotent consumers
- Rate limiting: max 10 push notifications/user/hour
- Multi-region: active-active for ingestion, active-passive for delivery

## Throughput Calculation and Capacity Planning

Raw event rate: 100,000 events/second

Fan-out ratio: on average, each event triggers notifications for 5 users (social platform: a viral post triggers notifications to followers). Burst: 50× fan-out (celebrity post, flash sale).

```
Peak notification volume:
100,000 events/s × 50 fan-out = 5,000,000 notifications/second (peak burst)
100,000 events/s × 5 fan-out  = 500,000 notifications/second (average)

Channel distribution:
- Push: 70% → 350,000 push/second
- In-app: 20% → 100,000 in-app/second
- Email: 8%  → 40,000 email/second
- SMS: 2%    → 10,000 SMS/second
```

**Storage sizing:**
- Each notification record: ~2KB
- Retention: 30 days
- Volume: 500,000/s × 86,400s × 30 days × 2KB = **2.59 TB/day**

This is a write-heavy storage problem. Cassandra or DynamoDB, not PostgreSQL.

## Kafka Partition Planning

Kafka partitions determine parallelism. Rule: partition count ≥ peak consumer count × 1.5.

For the event ingestion topic (`raw-events`):
```
Target throughput: 100,000 events/second × 1KB avg = 100 MB/s
Kafka broker write throughput: ~200 MB/s per broker (practical limit)
Minimum brokers: 100/200 = 0.5 → use 3 brokers for HA

Target consumer parallelism: 200 consumer threads
Partition count: 200 × 1.5 = 300 partitions
```

For the fan-out output topic (`notifications-to-send`):
```
Peak output: 5,000,000 notifications/second × 500B = 2,500 MB/s
Brokers needed: 2,500/200 = 12.5 → 15 brokers (safety margin)
Partitions: 1,500 (15 brokers × 100 partitions/broker)
```

```
Topic Configuration:
raw-events:
  partitions: 300
  replication-factor: 3
  min.insync.replicas: 2
  retention.ms: 3600000  # 1 hour (events are processed quickly)

notifications-to-send:
  partitions: 1500
  replication-factor: 3
  retention.ms: 86400000  # 24 hours (for replay on downstream failure)

notification-status:
  partitions: 300
  replication-factor: 3
  retention.ms: 604800000  # 7 days
```

## System Architecture

```
High-Throughput Notification Architecture:

Producer Services (100K events/s)
[Order Service] [Social Service] [Marketing Service]
        │              │                │
        └──────────────┴────────────────┘
                       │
                       ▼ (Kafka, 100K msg/s)
              ┌─────────────────┐
              │   raw-events    │  300 partitions
              │   topic         │
              └────────┬────────┘
                       │
                       ▼
          ┌────────────────────────┐
          │   Event Processor      │  200 instances
          │   - Validate           │  (Kafka consumer group)
          │   - Deduplicate        │
          │   - Enrich with        │
          │     user prefs         │
          └────────┬───────────────┘
                   │ Fan-out (1 event → N notifications)
                   ▼ (Kafka, 500K-5M msg/s peak)
        ┌──────────────────────┐
        │ notifications-to-    │  1500 partitions
        │ send topic           │
        └───┬──────────┬───────┘
            │          │
    ┌───────┘          └──────────┐
    ▼                             ▼
┌─────────────┐           ┌─────────────┐
│  Push       │           │  Email/SMS  │
│  Dispatcher │           │  Dispatcher │
│  (FCM/APNs) │           │  (SES/SNS)  │
│  500 inst   │           │  100 inst   │
└──────┬──────┘           └──────┬──────┘
       │                         │
       ▼                         ▼
┌──────────────────────────────────────┐
│   Notification Status Store          │
│   (Cassandra/DynamoDB)               │
│   + notification-status Kafka topic  │
└──────────────────────────────────────┘
```

## Database Schema

```sql
-- Cassandra schema for notification storage
-- Partition key = user_id for co-located user notification history
-- Clustering key = created_at DESC for reverse-chronological reads

CREATE TABLE notifications (
    user_id         UUID,
    notification_id UUID,
    type            TEXT,          -- push | email | sms | in_app
    title           TEXT,
    body            TEXT,
    status          TEXT,          -- pending | sent | delivered | failed
    channel_msg_id  TEXT,          -- FCM message_id, SES message_id, etc.
    idempotency_key TEXT,
    metadata        MAP<TEXT, TEXT>,
    created_at      TIMESTAMP,
    delivered_at    TIMESTAMP,
    PRIMARY KEY ((user_id), created_at, notification_id)
) WITH CLUSTERING ORDER BY (created_at DESC)
  AND compaction = {'class': 'TimeWindowCompactionStrategy',
                    'compaction_window_size': '1',
                    'compaction_window_unit': 'DAYS'};

-- TTL: auto-expire after 90 days
ALTER TABLE notifications WITH default_time_to_live = 7776000;
```

## Fan-Out Problem and Solution

Fan-out is the amplification problem. One event → many notifications. Two strategies:

**Push fan-out (eager):** Expand the fan-out immediately when the event is ingested. For a post liked by 1M followers: generate 1M notification records instantly.

```
Pros: Delivery latency is predictable (no fan-out latency at read time)
Cons: Hot events cause traffic spikes; wasteful for inactive users
```

**Pull fan-out (lazy):** Store the event once; fan-out happens when the user opens the app.

```
Pros: Low write amplification; inactive users don't receive unnecessary processing
Cons: First read after event is slow (fan-out happens on read)
```

**Hybrid (what large platforms use):** Push fan-out for regular users (< 10K followers). Pull fan-out for celebrity/high-follower accounts. Threshold: if sender follower count > 100K, use pull fan-out.

```java
@Service
public class FanOutRouter {

    private static final int PUSH_FANOUT_THRESHOLD = 100_000;

    public void route(NotificationEvent event) {
        long followerCount = userService.getFollowerCount(event.getSenderId());

        if (followerCount <= PUSH_FANOUT_THRESHOLD) {
            // Eager fan-out: write a notification for each follower now
            fanOutService.pushFanOut(event);
        } else {
            // Lazy fan-out: write event once, expand on read
            fanOutService.lazyFanOut(event);
        }
    }
}
```

## Rate Limiting

Rate limiting protects users from notification spam and protects downstream channels from overload.

**Per-user rate limits:** Redis sliding window counter:

```java
public boolean isAllowed(String userId, String channel) {
    String key = "ratelimit:" + channel + ":" + userId;
    long windowSeconds = 3600L; // 1 hour window
    int maxAllowed = switch (channel) {
        case "push"  -> 10;
        case "email" -> 3;
        case "sms"   -> 2;
        default      -> 20;
    };

    // Lua script: atomic sliding window check
    Long count = redisTemplate.execute(
        SLIDING_WINDOW_SCRIPT,
        Collections.singletonList(key),
        String.valueOf(System.currentTimeMillis()),
        String.valueOf(windowSeconds * 1000),
        String.valueOf(maxAllowed)
    );

    return count != null && count <= maxAllowed;
}
```

**Channel-level rate limits:** FCM allows 600 notifications/second per project, SES defaults to 14 emails/second. Use a token bucket per channel:

```java
@Component
public class ChannelRateLimiter {
    // RateLimiter from Guava: token bucket implementation
    private final Map<String, RateLimiter> channelLimiters = Map.of(
        "fcm",  RateLimiter.create(500),  // 500/s, below FCM limit
        "apns", RateLimiter.create(1000), // 1000/s
        "ses",  RateLimiter.create(100),  // 100/s, limit for burst safety
        "sns",  RateLimiter.create(200)
    );

    public void acquire(String channel) {
        channelLimiters.get(channel).acquire(); // Blocks until permit available
    }
}
```

## Backpressure Handling

When downstream channels are slow (FCM is degraded, SES is throttling), Kafka consumer lag grows. Handle it explicitly:

```java
@KafkaListener(topics = "notifications-to-send", groupId = "push-dispatcher")
public void dispatch(ConsumerRecord<String, NotificationMessage> record,
                     Acknowledgment ack) {
    NotificationMessage msg = record.value();

    // Check channel health before consuming more
    if (channelHealthMonitor.isUnhealthy("fcm")) {
        // Pause this partition — let lag build in Kafka
        consumer.pause(Collections.singleton(record.topicPartition()));
        scheduledExecutor.schedule(() -> {
            consumer.resume(Collections.singleton(record.topicPartition()));
        }, 5, TimeUnit.SECONDS);
        return; // Don't ack — will be redelivered
    }

    try {
        channelRateLimiter.acquire("fcm");
        FcmResult result = fcmClient.send(msg);
        notificationStore.updateStatus(msg.getNotificationId(), "sent", result.getMessageId());
        ack.acknowledge();
    } catch (FcmThrottledException e) {
        // Don't ack — will retry
        Thread.sleep(1000);
    }
}
```

## Idempotency Design

The event processor may process the same event twice (Kafka at-least-once). Fan-out must be idempotent:

```java
@Transactional
public void fanOut(NotificationEvent event) {
    String dedupKey = "fanout:" + event.getEventId();

    // Atomic insert — skip if already processed
    boolean inserted = cassandraOps.insert(
        new FanOutRecord(event.getEventId(), Instant.now())
    ).wasApplied(); // Cassandra lightweight transaction

    if (!inserted) {
        log.info("Fan-out already processed for event: {}", event.getEventId());
        return;
    }

    // Process fan-out only once
    List<Notification> notifications = generateNotifications(event);
    kafkaTemplate.send("notifications-to-send", notifications);
}
```

## Retry Strategy

```
Retry topology:
notifications-to-send
        │
        ├── FCM success → notification-status (delivered)
        │
        ├── FCM retryable error (5xx, timeout)
        │       └── notifications-retry-30s (wait 30s)
        │               └── notifications-retry-5m
        │                       └── notifications-retry-30m
        │                               └── notifications-dlq
        │
        └── FCM non-retryable (invalid token, app uninstalled)
                └── Update user record: push token invalid
                └── notifications-dlq (for audit)
```

## Horizontal Scaling

Each component scales independently:

| Component | Scale trigger | Scale mechanism |
|-----------|--------------|-----------------|
| Event Processor | Kafka consumer lag > 10K | Add consumer instances |
| Push Dispatcher | Kafka consumer lag + FCM latency | Add consumer instances |
| Email Dispatcher | SES send rate limit | Add SES sending identities |
| Cassandra | Disk > 70% or read latency > 5ms | Add Cassandra nodes |

Kafka consumers scale horizontally up to the partition count. With 1,500 partitions on `notifications-to-send`, you can run 1,500 consumer threads — spread across ~100 pods × 15 threads each.

## Monitoring and Alerting

```
Critical alerts (page immediately):
- Kafka consumer lag on notifications-to-send > 1,000,000 messages
- Push delivery success rate < 95% over 5 minutes
- DLQ topic lag growing > 1000/minute
- Cassandra write latency P99 > 100ms

Warning alerts (ticket/slack):
- Fan-out throughput > 80% of capacity (approaching limit)
- Per-user rate limit hit rate > 5% (users getting suppressed at high rate)
- Email bounce rate > 2%
```

Grafana dashboard panels:
- Events ingested/second (with 24h comparison)
- Fan-out ratio (events → notifications) — spike indicates viral content
- Notification delivery success rate by channel
- Kafka consumer lag by consumer group
- Channel latency P50/P95/P99

## Incident Simulation

**Scenario:** FCM has a 30-minute partial outage (50% error rate).

**Impact without proper design:**
- Push dispatcher retries immediately
- 2× traffic to FCM
- FCM rate-limits our project
- All push notifications backed up
- Downstream timeout cascade

**Impact with proper design:**
- Circuit breaker opens after 20% FCM error rate
- Push Dispatcher pauses Kafka consumption on FCM topic
- Kafka lag builds (Kafka as buffer — this is the right behavior)
- Backpressure propagates cleanly — no retry storm
- Email/SMS/in-app continue unaffected (separate consumer groups)
- When FCM recovers: circuit breaker half-opens, dispatcher resumes, lag drains over 10 minutes

The system degrades gracefully. Push notifications are delayed, not lost.

## Trade-offs Discussion

**Consistency vs availability for rate limits:** Using Redis for per-user rate limits means Redis failure bypasses rate limiting. Decision: accept this. Redis failure is transient; brief notification overshoot is acceptable. Alternative (DB-based rate limits) would cause rate limit checks to become a bottleneck under load.

**Fan-out at write vs read:** Push fan-out guarantees low delivery latency but wastes compute for inactive users. For a 100M user platform where 20% are active, push fan-out wastes 80% of fan-out compute. Hybrid strategy based on sender follower count is the right balance.

**Kafka retention:** 24-hour retention on the notification topic is long enough for downstream failures to recover and replay. 7-day retention would require much larger storage. 1-hour retention would not cover extended outages.

The architecture scales to 100K events/second because every component is stateless and horizontally scalable, and Kafka absorbs all the burst capacity between components. The hard part is the fan-out math — design your Kafka partition count around your peak fan-out ratio, not your ingestion rate.
