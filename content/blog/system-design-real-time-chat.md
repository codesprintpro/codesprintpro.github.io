---
title: "System Design: Real-Time Chat Application at Scale"
description: "Design a real-time chat system like WhatsApp or Slack handling 1 billion messages per day. Covers WebSocket connection management, message delivery guarantees, presence detection, and storage."
date: "2025-03-17"
category: "System Design"
tags: ["system design", "websocket", "real-time", "kafka", "redis", "cassandra", "distributed systems"]
featured: false
affiliateSection: "system-design-courses"
---

Real-time chat systems are among the most architecturally interesting distributed systems. They require persistent connections at massive scale, exactly-once message delivery guarantees, presence detection across millions of users, and message history queries that span years. This article designs a system comparable to WhatsApp or Slack.

## Requirements

Before designing anything, you need to quantify the problem precisely. Requirements drive every architectural decision that follows — the choice of database, the number of Kafka partitions, the size of the connection pool. Notice that the numbers below aren't arbitrary; each one is derived from real-world usage patterns and drives specific design choices.

**Functional:**
- 1:1 messaging and group chats (up to 1000 members)
- Real-time delivery (< 100ms end-to-end for online users)
- Message delivery receipts (sent → delivered → read)
- Message history (searchable, up to 5 years)
- User presence (online/offline, last seen)
- Message types: text, images, files, reactions

**Non-Functional:**
- 500M daily active users, 1B messages/day (~11,600 msg/sec average, 3x peak = 35,000/sec)
- Message delivery guarantee: at-least-once (deduplication client-side)
- Message ordering: within a conversation, strict order
- Storage: ~100 bytes/message × 1B/day × 365 days × 5 years = 180TB

## High-Level Architecture

The architecture is driven by one fundamental constraint: with 500M daily active users and real-time delivery requirements, you cannot use traditional request-response HTTP. Each online user needs a persistent, low-latency connection. The diagram below shows how the system is organized around this constraint.

```
Mobile/Web Client
    │
    │ WebSocket (persistent connection)
    ▼
┌──────────────────────────────────────────────────────────┐
│                   WebSocket Gateway Cluster              │
│   (stateful: each server holds N open WebSocket conns)  │
│   ws-1: [user_A, user_B, user_C, ...]                    │
│   ws-2: [user_D, user_E, user_F, ...]                    │
└────────────────────┬─────────────────────────────────────┘
                     │ Publish messages to Kafka
                     ▼
┌──────────────────────────────────────────────────────────┐
│          Kafka (message bus, ordered per partition)      │
│   Topic: chat-messages, partitioned by conversation_id   │
└────────────────────┬─────────────────────────────────────┘
                     │
         ┌───────────┼───────────────┐
         ▼           ▼               ▼
   Message Service  Storage Service  Notification Service
   (delivery,       (Cassandra)      (APNs, FCM for
    routing)                          offline users)

Redis: User → WebSocket server mapping (presence registry)
```

The WebSocket gateways are stateful — each server maintains thousands of open connections in memory. This statefulness creates the core routing challenge: when User A sends to User B, the system must find which server holds User B's connection. Redis serves as the global directory that maps user IDs to server IDs.

## WebSocket Connection Management

The key challenge: when User A sends to User B, which WebSocket server holds User B's connection?

Your WebSocket gateway is like an airport's gate assignment system. Each gate (server) handles a set of flights (connections), and the central directory (Redis) tells everyone which gate a given flight is at. When a new connection lands, you register it. When it leaves, you deregister it. The code below handles the full connection lifecycle.

```java
// WebSocket Gateway — each server handles 50,000-100,000 persistent connections
@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {

    @Autowired
    private UserConnectionRegistry connectionRegistry;

    @Autowired
    private KafkaTemplate<String, ChatMessage> kafkaTemplate;

    // In-process connection map: userId → WebSocket session
    private final ConcurrentHashMap<String, WebSocketSession> localConnections =
        new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String userId = extractUserId(session);  // From JWT in handshake header

        localConnections.put(userId, session);

        // Register in Redis: userId → this server's ID
        connectionRegistry.register(userId, getServerId());

        // Send buffered messages (messages received while user was offline)
        sendOfflineMessages(userId, session);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        String userId = extractUserId(session);
        ChatMessage chatMessage = parseMessage(message, userId);

        // Publish to Kafka (partitioned by conversationId for ordering)
        kafkaTemplate.send(
            "chat-messages",
            chatMessage.getConversationId(),  // partition key — ensures ordering
        chatMessage
        );

        // Ack to sender immediately
        sendAck(session, chatMessage.getClientMessageId());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String userId = extractUserId(session);
        localConnections.remove(userId);
        connectionRegistry.unregister(userId);
        updateLastSeen(userId);
    }

    // Deliver message to a local user (called by Message Delivery Service)
    public boolean deliverLocally(String userId, ChatMessage message) {
        WebSocketSession session = localConnections.get(userId);
        if (session == null || !session.isOpen()) return false;

        try {
            session.sendMessage(new TextMessage(serialize(message)));
            return true;
        } catch (IOException e) {
            return false;
        }
    }
}
```

Notice that when a message arrives from a client, it's immediately published to Kafka rather than routed directly to the recipient. This decoupling is intentional — Kafka provides durability (the message is persisted even if the delivery service crashes), ordering (messages in the same conversation stay in order), and fan-out (multiple consumers like storage and notification services process the same event).

## Message Delivery Service

With messages flowing through Kafka, the delivery service consumes them and routes each one to the right WebSocket server. This service handles the three cases that arise in any real deployment: the recipient is online on this server, on a different server, or offline entirely.

```java
// Kafka consumer: route messages to the right WebSocket server
@Service
public class MessageDeliveryService {

    @Autowired
    private UserConnectionRegistry connectionRegistry;  // Redis

    @Autowired
    private Map<String, ChatWebSocketHandler> wsHandlers;  // Local + remote stubs

    @Autowired
    private OfflineMessageStore offlineStore;

    @KafkaListener(
        topics = "chat-messages",
        concurrency = "12"  // One thread per Kafka partition
    )
    public void deliver(ChatMessage message) {
        List<String> recipients = getRecipients(message);  // From conversation members

        for (String recipientId : recipients) {
            String serverIdForRecipient = connectionRegistry.getServer(recipientId);

            if (serverIdForRecipient == null) {
                // User is offline: store for later delivery + send push notification
                offlineStore.store(recipientId, message);
                pushNotificationService.send(recipientId, message);
            } else if (serverIdForRecipient.equals(getServerId())) {
                // User is on THIS server: deliver directly
                boolean delivered = localWsHandler.deliverLocally(recipientId, message);
                if (!delivered) {
                    // Session closed between check and delivery
                    offlineStore.store(recipientId, message);
                }
            } else {
                // User is on a DIFFERENT server: route via internal HTTP/gRPC
                deliverToServer(serverIdForRecipient, recipientId, message);
            }
        }

        // Store in Cassandra (message history)
        messageStore.save(message);

        // Update delivery status
        updateDeliveryStatus(message.getId(), recipients, DeliveryStatus.DELIVERED);
    }
}
```

The `concurrency = "12"` setting means 12 threads consume from 12 Kafka partitions in parallel — matching consumer threads to partitions is the correct way to maximize Kafka throughput. The fallback to offline storage when a session has closed between the Redis check and the delivery attempt is an important edge case — without it, messages would silently drop during the brief window of a connection closing.

## User Presence with Redis

Presence detection is the feature users take for granted but which requires careful engineering. The approach below uses Redis TTL as the mechanism — a heartbeat keeps the key alive, and natural expiry signals the user has gone offline. This is simpler and more scalable than maintaining a connection registry with explicit disconnect events, which can be missed during network failures.

```java
@Service
public class PresenceService {

    @Autowired
    private StringRedisTemplate redis;

    private static final String ONLINE_KEY_PREFIX = "presence:online:";
    private static final Duration ONLINE_TTL = Duration.ofSeconds(30);

    // Called by WebSocket heartbeat every 20 seconds
    public void heartbeat(String userId) {
        redis.opsForValue().set(
            ONLINE_KEY_PREFIX + userId,
            Instant.now().toString(),
            ONLINE_TTL
        );
    }

    public boolean isOnline(String userId) {
        return redis.hasKey(ONLINE_KEY_PREFIX + userId);
    }

    // Batch check: are these 100 users online?
    public Map<String, Boolean> getBulkPresence(List<String> userIds) {
        List<String> keys = userIds.stream()
            .map(id -> ONLINE_KEY_PREFIX + id).toList();

        List<String> values = redis.opsForValue().multiGet(keys);

        Map<String, Boolean> result = new HashMap<>();
        for (int i = 0; i < userIds.size(); i++) {
            result.put(userIds.get(i), values.get(i) != null);
        }
        return result;
    }

    // Last seen: stored in Redis when user goes offline
    public void markOffline(String userId) {
        redis.delete(ONLINE_KEY_PREFIX + userId);
        redis.opsForValue().set(
            "presence:lastseen:" + userId,
            Instant.now().toString()
        );
    }
}
```

The `getBulkPresence` method using `multiGet` is a critical optimization for group chats — instead of making 100 Redis round trips to check 100 members' presence, you make one. In a 1000-member group chat, the difference between single and batch presence checks is the difference between acceptable and unusable latency.

## Message Storage: Cassandra

Messages require high write throughput and time-ordered reads per conversation.

Relational databases aren't a good fit for chat message storage at this scale. The access pattern is extremely predictable — you always fetch the latest N messages for a specific conversation — and you need write throughput far beyond what a single PostgreSQL instance can handle. Cassandra's data model is designed exactly for this: partition by a natural key (conversation ID + time bucket) and cluster by time within each partition.

```sql
-- Cassandra schema (optimized for "get last 50 messages in conversation X")
CREATE TABLE messages (
    conversation_id  UUID,
    bucket           INT,          -- Time bucket (year-month): limits partition size
    message_id       TIMEUUID,     -- TimeUUID: unique + ordered by time
    sender_id        UUID,
    content          TEXT,
    message_type     TEXT,         -- text, image, file, reaction
    metadata         MAP<TEXT, TEXT>,
    deleted_at       TIMESTAMP,    -- Soft delete

    PRIMARY KEY ((conversation_id, bucket), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC)
  AND compaction = {'class': 'TimeWindowCompactionStrategy',
                    'compaction_window_unit': 'DAYS',
                    'compaction_window_size': 7};

-- Query: latest 50 messages in conversation
SELECT * FROM messages
WHERE conversation_id = ? AND bucket = ?
ORDER BY message_id DESC
LIMIT 50;

-- Bucket calculation: ensures no partition grows unbounded
-- bucket = year * 100 + month (e.g., 202502 for Feb 2025)
-- Active conversations: query current bucket + previous if needed
```

The `bucket` column is the key design insight here — without it, a very active conversation could accumulate millions of rows in a single Cassandra partition, which degrades read and compaction performance. By bucketing per month, you cap each partition at roughly one month's worth of messages per conversation. `TimeWindowCompactionStrategy` then efficiently compacts data within time windows, which matches the write pattern perfectly.

## Message Deduplication

At-least-once delivery means duplicates are possible. Handle client-side:

Because the system guarantees at-least-once delivery (not exactly-once), the same message can arrive at a client more than once — for example, during a network reconnect where the client re-requests messages from the last received position. The deduplication service below prevents duplicates from appearing in the UI by tracking which client-generated IDs have already been processed.

```java
// Each message has a client-generated idempotency key
// Client generates: clientMessageId = UUID.randomUUID()
// Server stores: (conversationId, clientMessageId) → messageId

@Service
public class MessageDeduplicationService {

    @Autowired
    private RedisTemplate<String, String> redis;

    private static final Duration DEDUP_TTL = Duration.ofHours(24);

    public Optional<String> isDuplicate(String conversationId, String clientMessageId) {
        String key = "dedup:" + conversationId + ":" + clientMessageId;
        String existingMessageId = redis.opsForValue().get(key);
        return Optional.ofNullable(existingMessageId);
    }

    public void markProcessed(String conversationId, String clientMessageId, String messageId) {
        String key = "dedup:" + conversationId + ":" + clientMessageId;
        redis.opsForValue().set(key, messageId, DEDUP_TTL);
    }
}
```

The 24-hour TTL is a deliberate trade-off — it covers the window in which a duplicate is likely to arrive (network retries, reconnects), while preventing unlimited Redis growth. Messages older than 24 hours will simply be re-stored if re-delivered, which is acceptable because the client can deduplicate by `message_id` in its local database.

## Scalability Analysis

With the components understood, here's how each one scales to meet the requirements. These numbers give you a concrete target for capacity planning.

```
Component         Scale           Technology
─────────────────────────────────────────────────────────
WebSocket GW      50K conn/server  Netty/Spring WebFlux
                  → 10K servers for 500M users
                  → Use consistent hashing to route users

Kafka             35K msg/sec peak  30 partitions (1K/partition)
                  Retention: 24h for real-time delivery

Cassandra         35K writes/sec    10 nodes, RF=3
                  100TB/year        Use TTL for 5-year retention

Redis (presence)  500M keys         Redis Cluster, 6 shards
                  30s TTL → natural expiry

Message routing   gRPC between GW   P2P mesh for intra-cluster
                  servers           pub/sub for cross-cluster

CDN               Images/files      S3 + CloudFront
                  Pre-signed URLs   Direct upload from client
```

## Guarantees and Trade-offs

Every distributed system design involves deliberate trade-offs. The choices below reflect the reality that chat applications prioritize availability — users should always be able to send messages, even under network partitions — over strict consistency guarantees that would require coordination overhead.

```
Message ordering:
  Within a conversation: guaranteed (Kafka partitioned by conversationId,
                                     Cassandra TIMEUUID ordering)
  Across conversations: best-effort

Delivery guarantee:
  Online users: at-least-once (deduplicated client-side)
  Offline users: at-least-once (stored + retried)
  No guarantee of exactly-once end-to-end (intentional trade-off for performance)

Consistency:
  Message storage: eventual (Cassandra RF=3, quorum reads)
  Delivery status: eventual (Redis, replicated)
  Group membership: strong (PostgreSQL for group metadata)

CAP theorem position: AP (availability + partition tolerance)
  During network partition: accept writes (store in Kafka),
  deliver when partition heals → may deliver out of order
  Trade-off: always available vs always consistent
```

The hardest part of chat system design isn't the message passing — it's the edge cases. What happens when a user is on 3 devices? (deliver to all) What if a conversation has 1000 members and all are online? (fan-out at scale requires message fan-out service) What if a server crashes mid-delivery? (Kafka offset management + at-least-once). Design the happy path first, then systematically find failure modes.
