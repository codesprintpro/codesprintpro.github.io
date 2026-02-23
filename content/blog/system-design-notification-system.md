---
title: "System Design: Building a Notification System for 100 Million Users"
description: "Design a scalable notification system that delivers push, email, SMS, and in-app notifications reliably. Covers fan-out strategies, priority queues, delivery guarantees, and user preference management."
date: "2025-02-18"
category: "System Design"
tags: ["system design", "notifications", "kafka", "push notifications", "distributed systems"]
featured: false
affiliateSection: "system-design-courses"
---

Notification systems are deceptively complex. Sending one notification is trivial. Sending 100 million notifications daily — with channel routing, user preferences, delivery tracking, retry logic, and rate limiting — requires careful architectural thinking.

This article designs a notification system like the ones at LinkedIn, Twitter, or Uber.

## Requirements

**Functional:**
- Send notifications via: push (iOS/Android), email, SMS, in-app
- User preferences per channel and notification type (opt-in/opt-out)
- Templated notifications with variable substitution
- Scheduled notifications (send at specific time)
- Delivery tracking (sent, delivered, read)
- Rate limiting per user (max N notifications per hour)

**Non-Functional:**
- 100M users, 50M daily active
- 1B notifications/day = ~11,600 sends/sec
- Priority tiers: critical (OTP, alerts) < 100ms delivery, standard < 5 minutes
- At-least-once delivery guarantee
- Idempotent (no duplicates on retry)

## Back-of-Envelope

Before designing the system, it is worth establishing the numbers that drive your architectural decisions. The peak volume of 115,000 notifications per second — ten times the average, during events like flash sales or breaking news — is the figure that determines how many Kafka partitions and worker instances you need.

```
Notification volume:
  1B/day ÷ 86,400s = 11,574 notifications/sec average
  Peak (10x): ~115,000/sec (e.g., breaking news, flash sale)

Storage:
  Per notification log: ~500 bytes
  1B/day × 365 days × 3 years × 500 bytes = ~548 TB total
  Use tiered storage: hot (recent 30 days) in Cassandra, archive in S3

User preferences:
  100M users × 1 KB preference data = 100 GB → fits in Redis + DB

Templates:
  ~1,000 notification templates, cached in memory
```

Notice that user preference data — at 100 GB — is small enough to fit entirely in Redis. This means every preference lookup can be served from memory without ever touching the database, which is critical when you are processing 11,000 notifications per second.

## System Architecture

The architecture separates the system into three logical zones: ingestion (the API that receives requests), routing (Kafka topics that buffer and prioritize), and delivery (channel workers that call third-party providers). This separation means a slow email provider cannot block push notifications, and a surge in marketing messages cannot delay OTP codes.

```
Producers (API servers, event processors)
    │
    ▼
┌────────────────────────────────────────────┐
│         Notification Service API            │
│  POST /api/v1/notify (single or batch)      │
│  POST /api/v1/notify/schedule               │
└────────────────┬───────────────────────────┘
                 │
    ┌────────────▼────────────┐
    │  Validation & Enrichment │
    │  - User preference check │
    │  - Template resolution   │
    │  - Rate limit check      │
    └────────────┬────────────┘
                 │
    ┌────────────▼────────────────────────────┐
    │     Priority Kafka Topics                │
    │  notifications.critical  (P0 - OTP)      │
    │  notifications.high      (P1 - alerts)   │
    │  notifications.standard  (P2 - marketing)│
    └──┬──────────┬──────────────┬────────────┘
       │          │              │
  ┌────▼──┐  ┌────▼──┐     ┌────▼────────┐
  │ Push  │  │ Email │     │  SMS        │
  │Worker │  │Worker │     │  Worker     │
  └────┬──┘  └────┬──┘     └────┬────────┘
       │          │              │
  ┌────▼──┐  ┌────▼──┐     ┌────▼────────┐
  │ FCM/  │  │SendGrid│    │  Twilio     │
  │ APNs  │  │ SES   │     │  SNS        │
  └───────┘  └───────┘     └────────────┘
                 │
    ┌────────────▼────────────┐
    │   Delivery Tracker       │
    │   Cassandra (logs)       │
    │   Redis (real-time state)│
    └─────────────────────────┘
```

Using separate Kafka topics for each priority level is what guarantees low latency for critical notifications. Kafka consumers for `notifications.critical` can be scaled independently and given more CPU resources than the marketing topic, so a backlog of promotional emails never delays an OTP message.

## Core Service: Notification API

The API itself is intentionally thin — it validates the request, checks preferences, resolves the template, and publishes to Kafka. All actual sending happens asynchronously downstream. This design means your API can respond to the caller in milliseconds regardless of how long it takes to deliver the notification, and it decouples the caller from any third-party provider failures.

```java
@RestController
@RequestMapping("/api/v1/notify")
public class NotificationController {

    @Autowired
    private NotificationOrchestrator orchestrator;

    @PostMapping
    public ResponseEntity<NotificationResponse> sendNotification(
            @RequestBody @Valid NotificationRequest request) {

        // Enqueue — return immediately, process async
        String notificationId = orchestrator.enqueue(request);

        return ResponseEntity.accepted()
            .body(new NotificationResponse(notificationId, "QUEUED"));
    }

    @PostMapping("/batch")
    public ResponseEntity<BatchNotificationResponse> sendBatch(
            @RequestBody @Valid BatchNotificationRequest request) {
        // Max 1000 per batch
        if (request.getRecipients().size() > 1000) {
            return ResponseEntity.badRequest().build();
        }
        List<String> ids = orchestrator.enqueueBatch(request);
        return ResponseEntity.accepted().body(new BatchNotificationResponse(ids));
    }
}

@Service
public class NotificationOrchestrator {

    @Autowired
    private UserPreferenceService preferenceService;

    @Autowired
    private TemplateService templateService;

    @Autowired
    private RateLimiter rateLimiter;

    @Autowired
    private KafkaTemplate<String, NotificationEvent> kafka;

    public String enqueue(NotificationRequest request) {
        String notificationId = UUID.randomUUID().toString();

        for (String userId : request.getRecipientIds()) {
            // 1. Check user preferences
            UserPreferences prefs = preferenceService.get(userId);
            List<Channel> enabledChannels = prefs.getEnabledChannels(request.getType());

            if (enabledChannels.isEmpty()) continue; // User opted out

            // 2. Rate limit check
            if (!rateLimiter.isAllowed(userId, request.getPriority())) {
                log.info("Rate limited notification to user {}", userId);
                continue;
            }

            // 3. Resolve template
            String content = templateService.render(request.getTemplateId(), request.getVariables());

            // 4. Publish to priority-appropriate topic
            String topic = "notifications." + request.getPriority().name().toLowerCase();
            NotificationEvent event = NotificationEvent.builder()
                .id(notificationId)
                .userId(userId)
                .channels(enabledChannels)
                .content(content)
                .subject(request.getSubject())
                .createdAt(Instant.now())
                .build();

            kafka.send(topic, userId, event); // Key = userId → consistent partition
        }

        return notificationId;
    }
}
```

The Kafka partition key `userId` is a subtle but important detail: it ensures that all notifications for the same user land on the same partition, which preserves ordering. A user will always see their notifications arrive in the order they were sent, rather than in the order workers happened to process them.

## Fan-Out Strategy: Push vs Pull

With the API and routing in place, the next challenge is how to expand a single event (like a breaking news alert) into millions of per-user notifications efficiently. This is called fan-out, and the right strategy depends on how many recipients an event has.

For large events (breaking news sent to 50M users), push-to-all is too slow. Use **fan-out on write** for small follower counts, **fan-out on read** for celebrities/broadcasts.

```
Fan-out on write (for most notifications):
  Event occurs → expand recipient list immediately → queue per-user notifications
  Pro: Fast delivery, simple consumers
  Con: Hot users/events cause write amplification (celebrity with 10M followers)

Fan-out on read (for broadcast/marketing):
  Store one notification record → users fetch on next app open
  Pro: No write amplification
  Con: Delivery delay, users must poll

Hybrid (recommended for large scale):
  - Personal notifications (friend request, order update): fan-out on write
  - Marketing/broadcast: fan-out on read with batch job
  - System alerts: fan-out on write with priority queue
```

Think of the hybrid approach like postal mail versus a newspaper: personal letters are addressed and delivered to each recipient individually (fan-out on write), while newspapers are printed once and picked up at the newsstand by whoever wants one (fan-out on read). The right model depends entirely on the nature of the message.

## Channel Workers

Channel workers are the component that bridges your internal system to third-party providers. Each worker subscribes to all priority topics, handles the platform-specific API calls, and manages failure modes like expired tokens. The most important design principle here is that channel workers must be idempotent — if a worker crashes after successfully sending but before acknowledging the Kafka message, the message will be reprocessed. Tracking the provider's `messageId` in the delivery tracker is what prevents the user from receiving a duplicate notification.

```java
@Component
public class PushNotificationWorker {

    @Autowired
    private FcmService fcm;

    @Autowired
    private ApnsService apns;

    @Autowired
    private DeviceTokenRepository deviceTokens;

    @Autowired
    private DeliveryTracker tracker;

    @KafkaListener(topics = {"notifications.critical", "notifications.high", "notifications.standard"},
                   groupId = "push-worker",
                   containerFactory = "priorityKafkaListenerFactory")
    public void process(NotificationEvent event) {
        List<DeviceToken> tokens = deviceTokens.findByUserId(event.getUserId());

        for (DeviceToken token : tokens) {
            try {
                String messageId = switch (token.getPlatform()) {
                    case ANDROID -> fcm.send(token.getToken(), event.getContent(), event.getTitle());
                    case IOS -> apns.send(token.getToken(), event.getContent(), event.getTitle());
                };

                tracker.markDelivered(event.getId(), token.getDeviceId(), messageId);

            } catch (TokenExpiredException e) {
                deviceTokens.deactivate(token.getId());
            } catch (RateLimitException e) {
                // Requeue with delay
                throw new RetryableException("FCM rate limited", e);
            }
        }
    }
}
```

Deactivating expired tokens immediately on `TokenExpiredException` is both a correctness fix and a performance optimization: it prevents future notifications from attempting delivery to a device that has been wiped or uninstalled the app, saving FCM/APNs quota.

## Delivery Tracking with Cassandra

Now that notifications are being sent, you need to track their state. Cassandra is ideal for notification logs: write-heavy, time-series, high cardinality. The choice of Cassandra over PostgreSQL here comes down to the write pattern: at 11,000 notifications per second, every send triggers a status update. PostgreSQL's row-level locking and B-tree indexes do not scale to this write rate without expensive sharding, while Cassandra was designed from the ground up for exactly this kind of append-heavy, partition-key-based access.

```sql
-- Cassandra schema
CREATE TABLE notification_events (
    notification_id  UUID,
    user_id          TEXT,
    channel          TEXT,    -- push, email, sms, in_app
    status           TEXT,    -- queued, sent, delivered, read, failed
    created_at       TIMESTAMP,
    updated_at       TIMESTAMP,
    error_message    TEXT,
    PRIMARY KEY ((user_id), created_at, notification_id)
) WITH CLUSTERING ORDER BY (created_at DESC)
  AND default_time_to_live = 7776000;  -- 90 days TTL

-- Query: Get user's recent notifications
SELECT * FROM notification_events
WHERE user_id = 'user123'
  AND created_at > '2025-01-01'
LIMIT 50;
```

The `CLUSTERING ORDER BY (created_at DESC)` means the most recent notifications are physically stored first on disk, so the common "show me recent activity" query reads the minimum amount of data without any sorting step.

## User Preference Management

User preferences are the gateway that determines whether a notification is ever sent at all. The Redis-first approach here is critical: checking preferences is on the hot path for every notification, and a database call for each of 11,000 notifications per second would saturate your PostgreSQL cluster immediately.

```java
// Preferences stored in Redis (hot path) + PostgreSQL (source of truth)
@Service
public class UserPreferenceService {

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private PreferenceRepository repo;

    public UserPreferences get(String userId) {
        String cacheKey = "prefs:" + userId;
        String cached = redis.opsForValue().get(cacheKey);

        if (cached != null) {
            return objectMapper.readValue(cached, UserPreferences.class);
        }

        UserPreferences prefs = repo.findByUserId(userId)
            .orElse(UserPreferences.defaults());

        redis.opsForValue().set(cacheKey, objectMapper.writeValueAsString(prefs), Duration.ofHours(1));
        return prefs;
    }

    public void update(String userId, UpdatePreferenceRequest request) {
        repo.upsert(userId, request);
        redis.delete("prefs:" + userId); // Invalidate cache
    }
}
```

Notice that the `update` method invalidates the Redis key rather than writing the new value directly. This cache-aside pattern avoids a race condition where two simultaneous updates could leave stale data in Redis — by deleting the key, the next read is guaranteed to fetch the freshest value from the database.

## Handling Third-Party Rate Limits

FCM, APNs, SendGrid, and Twilio all have rate limits. Handle them gracefully. Without this throttle, a burst of outgoing notifications could exhaust your provider's quota within seconds, causing your entire notification system to fail for the rest of the billing period. Think of it like a water tap with a flow restrictor: you control the output rate to stay within the pipe's capacity, even when the demand upstream is higher.

```java
@Component
public class AdaptiveRateLimiter {

    private final Map<String, TokenBucket> providerBuckets = Map.of(
        "FCM",      new TokenBucket(600_000, 600_000), // 600K/min
        "APNs",     new TokenBucket(300_000, 300_000),
        "SendGrid", new TokenBucket(100,  100),         // 100/sec
        "Twilio",   new TokenBucket(1,    1)            // 1/sec (varies by plan)
    );

    public void throttle(String provider) {
        TokenBucket bucket = providerBuckets.get(provider);
        if (!bucket.tryConsume()) {
            long waitMs = bucket.getMillisToNextToken();
            try { Thread.sleep(waitMs); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
    }
}
```

## Scheduled Notifications

The final capability to add is scheduling, where a notification should be delivered at a specific future time rather than immediately. Redis sorted sets are the perfect data structure for this: the score is the delivery timestamp in milliseconds, so a range query from 0 to "now" always returns exactly the notifications that are due, in order.

```java
// Store scheduled notifications in a sorted set (score = delivery timestamp)
public void schedule(NotificationRequest request, Instant deliveryTime) {
    String key = "scheduled:notifications";
    String payload = objectMapper.writeValueAsString(request);
    redis.opsForZSet().add(key, payload, deliveryTime.toEpochMilli());
}

// Scheduler: poll every second, process due notifications
@Scheduled(fixedDelay = 1000)
public void processScheduled() {
    long now = Instant.now().toEpochMilli();
    Set<String> due = redis.opsForZSet().rangeByScore("scheduled:notifications", 0, now);

    for (String payload : due) {
        NotificationRequest request = objectMapper.readValue(payload, NotificationRequest.class);
        enqueue(request);
        redis.opsForZSet().remove("scheduled:notifications", payload);
    }
}
```

The one-second polling interval gives you a delivery accuracy of ±1 second, which is sufficient for virtually all scheduling use cases. If you needed sub-second precision, you would replace the scheduler with a dedicated delay queue backed by a time-wheel data structure.

The notification system's core challenge is not the happy path — it's the edge cases: user preferences changing mid-delivery, third-party provider outages, duplicate suppression on retry, and fan-out storms during viral events. Design each component to handle failure gracefully, and your notification system will be invisible to users (which is exactly what you want).
