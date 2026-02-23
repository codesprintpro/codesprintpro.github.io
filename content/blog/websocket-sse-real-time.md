---
title: "WebSocket and SSE for Real-Time Systems: Architecture and Production Patterns"
description: "Building real-time features at scale: WebSocket vs SSE trade-offs, Spring Boot WebSocket implementation with STOMP, connection management, horizontal scaling with Redis pub/sub, SSE for one-directional streaming, and handling reconnection and backpressure."
date: "2025-05-04"
category: "System Design"
tags: ["websocket", "sse", "real-time", "spring boot", "redis", "stomp", "pub-sub", "system design"]
featured: false
affiliateSection: "system-design-courses"
---

Real-time features — live notifications, collaborative editing, live dashboards, streaming data — require pushing data from server to client without the client repeatedly polling. HTTP polling wastes resources and adds latency. WebSocket and Server-Sent Events (SSE) solve this differently, and choosing the wrong protocol for your use case leads to unnecessary complexity.

## WebSocket vs. SSE: Choosing the Right Protocol

```
WebSocket:
┌─────────┐  HTTP Upgrade   ┌────────┐
│ Client  │ ──────────────→ │ Server │
│         │ ←────────────── │        │
│         │    TCP socket    │        │
│         │ ←────────────── │        │  (bidirectional)
│         │ ──────────────→ │        │
└─────────┘                 └────────┘

SSE (Server-Sent Events):
┌─────────┐  HTTP GET       ┌────────┐
│ Client  │ ──────────────→ │ Server │
│         │ ←────────────── │        │  data: event1
│         │ ←────────────── │        │  data: event2  (one-directional)
│         │ ←────────────── │        │  data: event3
└─────────┘                 └────────┘
```

| Factor | WebSocket | SSE |
|--------|-----------|-----|
| Direction | Bidirectional | Server → Client only |
| Protocol | ws:// (TCP upgrade) | HTTP (text/event-stream) |
| Reconnection | Manual | Automatic (browser handles) |
| Load balancer support | Complex (sticky sessions) | Standard HTTP |
| CDN/proxy compatible | Rarely | Yes |
| Max connections/server | ~50,000 | ~50,000 |
| Browser support | All | All (no IE) |

**Use WebSocket when:** bidirectional communication is required (chat, collaborative editing, multiplayer games).

**Use SSE when:** server pushes updates, client only reads (live dashboards, notifications, activity feeds, progress updates). SSE is simpler, works through standard HTTP infrastructure, and handles reconnection automatically.

## SSE Implementation

SSE is the often-overlooked simpler alternative. For one-directional streaming, it's almost always the right choice:

```java
// Spring Boot SSE endpoint:
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    @Autowired
    private SseEmitterRegistry emitterRegistry;

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamNotifications(@AuthenticationPrincipal Jwt jwt) {
        String userId = jwt.getSubject();

        // SseEmitter with 5-minute timeout (reconnect handles longer sessions):
        SseEmitter emitter = new SseEmitter(5 * 60 * 1000L);

        // Register emitter so other parts of the system can push to this user:
        emitterRegistry.register(userId, emitter);

        // Cleanup on connection close:
        emitter.onCompletion(() -> emitterRegistry.remove(userId, emitter));
        emitter.onTimeout(() -> emitterRegistry.remove(userId, emitter));
        emitter.onError(ex -> emitterRegistry.remove(userId, emitter));

        // Send initial state (so client doesn't wait for first event):
        try {
            emitter.send(SseEmitter.event()
                .name("connected")
                .data("{\"status\":\"connected\",\"userId\":\"" + userId + "\"}")
                .id("0")
            );
        } catch (IOException e) {
            emitter.completeWithError(e);
        }

        return emitter;
    }
}

// Registry of active SSE connections:
@Component
public class SseEmitterRegistry {

    // CopyOnWriteArrayList: multiple emitters per user (same user, multiple tabs)
    private final Map<String, CopyOnWriteArrayList<SseEmitter>> userEmitters =
        new ConcurrentHashMap<>();

    public void register(String userId, SseEmitter emitter) {
        userEmitters.computeIfAbsent(userId, k -> new CopyOnWriteArrayList<>()).add(emitter);
    }

    public void remove(String userId, SseEmitter emitter) {
        CopyOnWriteArrayList<SseEmitter> emitters = userEmitters.get(userId);
        if (emitters != null) {
            emitters.remove(emitter);
            if (emitters.isEmpty()) {
                userEmitters.remove(userId);
            }
        }
    }

    public void sendToUser(String userId, String eventName, Object data) {
        CopyOnWriteArrayList<SseEmitter> emitters = userEmitters.get(userId);
        if (emitters == null || emitters.isEmpty()) return;

        String json = objectMapper.writeValueAsString(data);
        List<SseEmitter> dead = new ArrayList<>();

        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event()
                    .name(eventName)
                    .data(json)
                    .id(String.valueOf(System.currentTimeMillis()))
                );
            } catch (IOException e) {
                dead.add(emitter);  // Connection is dead
            }
        }

        dead.forEach(e -> remove(userId, e));
    }
}
```

**Client-side SSE (automatic reconnection built in):**

```javascript
const eventSource = new EventSource('/api/notifications/stream', {
  withCredentials: true  // Send cookies for authentication
});

eventSource.addEventListener('order-update', (event) => {
  const update = JSON.parse(event.data);
  updateOrderStatus(update.orderId, update.status);
});

eventSource.addEventListener('notification', (event) => {
  const notification = JSON.parse(event.data);
  showNotification(notification.message);
});

// Browser automatically reconnects on disconnect
// The Last-Event-ID header is sent on reconnect — server can replay missed events
eventSource.onerror = (error) => {
  console.log('SSE error:', error);
  // Browser will retry automatically — exponential backoff
};
```

## WebSocket with STOMP (Spring Boot)

STOMP (Simple Text Oriented Messaging Protocol) adds message routing over WebSocket — subscribe to topics, send to specific users:

```java
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        // Use built-in simple broker for topics and queues:
        config.enableSimpleBroker("/topic", "/queue");
        // Or use external broker (RabbitMQ/ActiveMQ) for production:
        // config.enableStompBrokerRelay("/topic", "/queue")
        //     .setRelayHost("rabbitmq.internal")
        //     .setRelayPort(61613);

        // Application destination prefix (for @MessageMapping):
        config.setApplicationDestinationPrefixes("/app");

        // User-specific destination prefix (for SimpMessagingTemplate.convertAndSendToUser):
        config.setUserDestinationPrefix("/user");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
            .setAllowedOrigins("https://app.example.com")  // CORS
            .withSockJS();  // SockJS fallback for environments blocking WebSocket
    }
}

// Controller: handle messages FROM client:
@Controller
public class ChatController {

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    // Client sends to /app/chat.sendMessage → broadcast to /topic/chat
    @MessageMapping("/chat.sendMessage")
    @SendTo("/topic/chat")  // Broadcast to all subscribers
    public ChatMessage sendMessage(@Payload ChatMessage message,
                                   Principal principal) {
        message.setSender(principal.getName());
        message.setTimestamp(Instant.now());
        return message;
    }

    // Send to specific user's private queue:
    public void sendPrivateMessage(String userId, Notification notification) {
        // Client subscribes to /user/queue/notifications
        // This sends to THAT specific user's queue:
        messagingTemplate.convertAndSendToUser(
            userId,
            "/queue/notifications",
            notification
        );
    }
}
```

**WebSocket authentication (often overlooked):**

```java
@Component
public class WebSocketAuthInterceptor implements ChannelInterceptor {

    @Autowired
    private JwtService jwtService;

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(
            message, StompHeaderAccessor.class);

        if (accessor != null && StompCommand.CONNECT.equals(accessor.getCommand())) {
            // Extract JWT from Authorization header in CONNECT frame:
            String authHeader = accessor.getFirstNativeHeader("Authorization");
            if (authHeader == null || !authHeader.startsWith("Bearer ")) {
                throw new MessagingException("Missing or invalid Authorization header");
            }

            String token = authHeader.substring(7);
            Authentication auth = jwtService.validateAndGetAuth(token);

            // Set the authenticated principal on the WebSocket session:
            accessor.setUser(auth);
        }

        return message;
    }
}
```

## Horizontal Scaling: The Core Problem

Each server instance maintains its own in-memory set of WebSocket/SSE connections. When an event occurs (e.g., "order shipped"), it needs to reach the user's connection — which may be on a different server instance.

```
Without Redis pub/sub (BROKEN at scale):

User connects → Server A (SSE connection stored here)
Order ships   → Event processed by Server B
Server B sends SSE → Nobody receives it (connection is on Server A)

With Redis pub/sub (CORRECT):

User connects → Server A (SSE stored)
Order ships   → Server B publishes to Redis: channel="user:{userId}", msg=event
Redis broadcasts → Server A receives it (subscribed to all user channels)
Server A sends SSE → User receives event ✓
```

```java
// Redis pub/sub for cross-instance SSE delivery:
@Service
public class NotificationPublisher {

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    public void publishToUser(String userId, NotificationEvent event) {
        String channel = "user-notifications:" + userId;
        String payload = objectMapper.writeValueAsString(event);
        redisTemplate.convertAndSend(channel, payload);
    }
}

@Service
public class NotificationSubscriber implements MessageListener {

    @Autowired
    private SseEmitterRegistry emitterRegistry;

    @Autowired
    private RedisMessageListenerContainer container;

    @PostConstruct
    public void subscribeToAllUsers() {
        // Subscribe to all user notification channels:
        container.addMessageListener(this,
            new PatternTopic("user-notifications:*"));
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        String channel = new String(message.getChannel());
        String userId = channel.replace("user-notifications:", "");
        String payload = new String(message.getBody());

        // Push to local SSE connection (if user is connected to this instance):
        emitterRegistry.sendToUser(userId, "notification", payload);
    }
}
```

## Backpressure and Slow Clients

A client that consumes events slowly creates backpressure. The server must not buffer unboundedly:

```java
// Bounded SSE with overflow handling:
public class BoundedSseEmitter {

    private final SseEmitter emitter;
    private final BlockingQueue<SseEvent> queue = new LinkedBlockingQueue<>(100);
    private final AtomicBoolean running = new AtomicBoolean(true);

    public BoundedSseEmitter(SseEmitter emitter) {
        this.emitter = emitter;
        // Background thread drains queue to emitter:
        Thread.ofVirtual().start(this::drain);
    }

    public boolean offer(SseEvent event) {
        boolean accepted = queue.offer(event);  // Returns false if queue full
        if (!accepted) {
            log.warn("SSE queue full for connection — dropping event");
            // Or: disconnect slow client
        }
        return accepted;
    }

    private void drain() {
        while (running.get()) {
            try {
                SseEvent event = queue.poll(1, TimeUnit.SECONDS);
                if (event != null) {
                    emitter.send(event);
                }
            } catch (Exception e) {
                running.set(false);
            }
        }
    }
}
```

Real-time features are rarely the hardest part of a system — they feel complex because HTTP's request-response model is the mental default. Once you internalize that SSE is just a long-lived HTTP response that trickles data, and WebSocket is a bidirectional TCP channel negotiated via HTTP, the implementation patterns become straightforward. The operational complexity (scaling with Redis pub/sub, handling reconnections, managing connection counts) is where production experience matters.
