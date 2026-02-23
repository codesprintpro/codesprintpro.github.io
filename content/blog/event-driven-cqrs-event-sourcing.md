---
title: "Event-Driven Architecture: CQRS and Event Sourcing in Practice"
description: "Master CQRS (Command Query Responsibility Segregation) and Event Sourcing patterns for scalable, auditable systems. Includes Spring Boot + Axon Framework implementation with Kafka event store."
date: "2025-03-03"
category: "System Design"
tags: ["event sourcing", "cqrs", "event-driven", "kafka", "spring boot", "axon"]
featured: false
affiliateSection: "system-design-courses"
---

Traditional CRUD systems store **current state**. Event-driven systems store the **history of state changes**. This single difference is more profound than it first appears: instead of asking "what is the current status of order #123?", you ask "what sequence of events happened to order #123?" — and you can derive the current status from that sequence at any point in time.

The trade-off is real: event sourcing introduces complexity that a simple CRUD app doesn't need. But for systems where audit trails matter (finance, healthcare, e-commerce), where you need to replay history to fix bugs, or where you want to scale reads and writes independently, the pattern pays for itself over time. This article shows you when it's worth it and how to implement it right.

## The Problem CQRS and Event Sourcing Solve

Consider what happens in a traditional system when an order is shipped. You run a single UPDATE statement and the previous state — when it was confirmed, who approved it, what the original items were — is gone forever. This is fine for many applications. It becomes a serious problem when:

- A compliance team asks: "Show me every change made to this order and who made it."
- A bug caused incorrect state and you need to reconstruct what actually happened.
- Your dashboard query locks the table that your order creation query also needs.

```
Traditional CRUD:
  UPDATE orders SET status = 'SHIPPED', updated_at = NOW() WHERE id = 123

  Problems:
  1. History lost — you can't answer "when did this order become CONFIRMED?"
  2. Read and write load couple — slow reporting queries block order creation
  3. No audit trail — compliance asks "who changed this?" and you have nothing
  4. Temporal queries impossible — "what was the state on Jan 1?" = mystery

Event Sourcing:
  INSERT INTO events (aggregate_id, type, data, timestamp) VALUES
    (123, 'OrderCreated', {...}, T1),
    (123, 'PaymentProcessed', {...}, T2),
    (123, 'OrderShipped', {...}, T3)

  Benefits:
  1. Full history — every state change recorded
  2. Rebuild any past state by replaying events to point-in-time
  3. Natural audit log (SOX, GDPR, financial compliance)
  4. Events drive downstream projections, notifications, analytics
```

Notice that in the event-sourced version, you never update a row — you only ever append new events. The current state of an order is derived by replaying those events from the beginning. This immutability is what gives you the time-machine capability.

## CQRS: Separate Read and Write Models

CQRS (Command Query Responsibility Segregation) is a natural companion to event sourcing. The core idea is that the model you use to change data (the write model) doesn't have to be the same model you use to read data (the read model).

- **Command side**: Handles writes. Validates business rules. Emits events. Optimised for correctness, not query flexibility.
- **Query side**: Handles reads. Denormalized. Shaped to answer specific queries fast. Can have as many different read models as you need.

```
                    ┌─────────────────────┐
                    │   Command Handler   │
Command ──────────► │ (validate + execute)│──► Event Store ──► Events
                    └─────────────────────┘         │
                                                     │ Event Bus
                                                     │
                    ┌─────────────────────┐          ▼
Query  ──────────► │   Query Handler     │◄── Read Model (Projections)
Result ◄────────── │  (read-optimized)   │    (denormalized views)
                    └─────────────────────┘
```

The write side emits events. Those events flow to one or more **projections** — read-optimized views of the data. You can have a projection for the customer dashboard, a different one for admin reporting, and another one for analytics — all built from the same stream of events. This is the real power: one source of truth, many tailored views.

## Implementation: Order System with Axon Framework

### Commands and Events

The most important conceptual distinction in this pattern is the difference between **commands** and **events**. They sound similar but serve opposite purposes:

- A **command** is an **intent** — "Please create this order." It's imperative and can be rejected. If business validation fails (e.g., the cart is empty), the command is rejected and no event is produced.
- An **event** is a **fact** — "An order was created." It's past tense and immutable. Once emitted, it cannot be undone.

This separation enforces a clean boundary: all validation happens before the event is produced. By the time an event exists, it represents something that definitively happened.

```java
// Commands represent intent ("do this") — can be rejected
public record CreateOrderCommand(
    @TargetAggregateIdentifier String orderId,
    String customerId,
    List<OrderItem> items
) {}

public record ConfirmOrderCommand(
    @TargetAggregateIdentifier String orderId
) {}

public record ShipOrderCommand(
    @TargetAggregateIdentifier String orderId,
    String trackingNumber
) {}

// Events represent facts ("this happened") — immutable, past tense
public record OrderCreatedEvent(
    String orderId,
    String customerId,
    List<OrderItem> items,
    Instant createdAt
) {}

public record OrderConfirmedEvent(
    String orderId,
    Instant confirmedAt
) {}

public record OrderShippedEvent(
    String orderId,
    String trackingNumber,
    Instant shippedAt
) {}
```

Notice that commands are named imperatively (`CreateOrderCommand`) while events are named in past tense (`OrderCreatedEvent`). This naming convention isn't cosmetic — it reflects whether something is a request that could fail or a historical fact that already happened.

### The Aggregate: Command Side

An **aggregate** is the consistency boundary in your domain model. It's the gatekeeper: all business rules live here, and it's the only thing that decides whether a command is valid and what events it produces.

The crucial rule in event sourcing: **state is never set directly in command handlers**. Instead, a command handler validates the request and applies an event. The `@EventSourcingHandler` methods then update the internal state. This indirection exists because the same event sourcing handlers are called both when processing new commands *and* when replaying historical events to rebuild state. The state-change logic must live in one place.

```java
@Aggregate
public class OrderAggregate {

    @AggregateIdentifier
    private String orderId;
    private String customerId;
    private OrderStatus status;
    private List<OrderItem> items;

    // Constructor command handler: validates, then emits an event
    @CommandHandler
    public OrderAggregate(CreateOrderCommand command) {
        // Step 1: Validate the business rule
        if (command.items().isEmpty()) {
            throw new IllegalArgumentException("Order must have at least one item");
        }

        // Step 2: Apply an event — NEVER set fields directly here
        // AggregateLifecycle.apply() calls the @EventSourcingHandler below
        AggregateLifecycle.apply(new OrderCreatedEvent(
            command.orderId(),
            command.customerId(),
            command.items(),
            Instant.now()
        ));
    }

    @CommandHandler
    public void handle(ConfirmOrderCommand command) {
        // Guard: only valid state transitions are allowed
        if (status != OrderStatus.PENDING) {
            throw new IllegalStateException("Can only confirm PENDING orders, current: " + status);
        }
        AggregateLifecycle.apply(new OrderConfirmedEvent(orderId, Instant.now()));
    }

    @CommandHandler
    public void handle(ShipOrderCommand command) {
        if (status != OrderStatus.CONFIRMED) {
            throw new IllegalStateException("Can only ship CONFIRMED orders");
        }
        AggregateLifecycle.apply(new OrderShippedEvent(orderId, command.trackingNumber(), Instant.now()));
    }

    // @EventSourcingHandler: updates internal state from events.
    // Called for NEW events (after apply()) AND when REPLAYING historical events.
    // This is the only place where fields are assigned.
    @EventSourcingHandler
    public void on(OrderCreatedEvent event) {
        this.orderId = event.orderId();
        this.customerId = event.customerId();
        this.items = event.items();
        this.status = OrderStatus.PENDING;
    }

    @EventSourcingHandler
    public void on(OrderConfirmedEvent event) {
        this.status = OrderStatus.CONFIRMED;
    }

    @EventSourcingHandler
    public void on(OrderShippedEvent event) {
        this.status = OrderStatus.SHIPPED;
    }
}
```

The lifecycle when `ShipOrder` is received on a new request: Axon loads all past events for that order from the event store, replays them through the `@EventSourcingHandler` methods to reconstruct the current state, then calls the `@CommandHandler` with that state available. If validation passes, the new event is appended to the store. If it fails, nothing is written.

### Query Side: Projections

A **projection** is a read-optimized view of your data, built by listening to events. Think of it as a continuously-updated materialized view. Unlike the command side (which is normalized and focused on correctness), projections are denormalized and shaped to answer specific queries as fast as possible.

The key insight is that you can have as many projections as you want, each serving a different use case. A customer-facing dashboard projection might join order + customer data and cache it in Redis. An admin reporting projection might aggregate order totals by region and store them in a reporting database. Both are built from the same events — you're not duplicating writes, you're building tailored read models.

```java
// Projection: listens to events and maintains a denormalized read model
@Component
@ProcessingGroup("order-projections")
public class OrderProjection {

    @Autowired
    private OrderViewRepository repository;  // Simple JPA repository — plain SQL table

    // When an order is created, build the initial read-model row
    @EventHandler
    public void on(OrderCreatedEvent event) {
        OrderView view = new OrderView();
        view.setOrderId(event.orderId());
        view.setCustomerId(event.customerId());
        view.setStatus("PENDING");
        view.setItemCount(event.items().size());
        view.setTotalAmount(calculateTotal(event.items()));
        view.setCreatedAt(event.createdAt());
        repository.save(view);
    }

    // When an order is confirmed, update just the fields that changed
    @EventHandler
    public void on(OrderConfirmedEvent event) {
        repository.findById(event.orderId()).ifPresent(view -> {
            view.setStatus("CONFIRMED");
            view.setConfirmedAt(event.confirmedAt());
            repository.save(view);
        });
    }

    @EventHandler
    public void on(OrderShippedEvent event) {
        repository.findById(event.orderId()).ifPresent(view -> {
            view.setStatus("SHIPPED");
            view.setTrackingNumber(event.trackingNumber());
            view.setShippedAt(event.shippedAt());
            repository.save(view);
        });
    }
}

// Query handlers serve the read model directly — no joins, no aggregation at query time
@Component
public class OrderQueryHandler {

    @Autowired
    private OrderViewRepository repository;

    @QueryHandler
    public OrderView handle(GetOrderQuery query) {
        return repository.findById(query.orderId())
            .orElseThrow(() -> new OrderNotFoundException(query.orderId()));
    }

    @QueryHandler
    public List<OrderView> handle(GetCustomerOrdersQuery query) {
        return repository.findByCustomerIdOrderByCreatedAtDesc(query.customerId());
    }

    @QueryHandler
    public Page<OrderView> handle(GetOrdersByStatusQuery query) {
        return repository.findByStatus(query.status(), query.pageable());
    }
}
```

Notice that `GetCustomerOrdersQuery` is a simple `findByCustomerIdOrderByCreatedAtDesc` call — no complex joins, no aggregation, just a fast indexed lookup. The read model was pre-shaped at event time, so queries are cheap regardless of how complex the business logic is.

### API Layer

The controller is deliberately thin. It delegates write operations to the `CommandGateway` (which routes to the aggregate) and read operations to the `QueryGateway` (which routes to the projections). The controller doesn't contain any business logic — it just translates HTTP into commands and queries.

```java
@RestController
@RequestMapping("/api/v1/orders")
public class OrderController {

    @Autowired
    private CommandGateway commandGateway;  // Routes to @CommandHandler methods

    @Autowired
    private QueryGateway queryGateway;      // Routes to @QueryHandler methods

    // WRITE side: send a command and get back the result asynchronously
    // Returns 202 Accepted (not 201 Created) because events are processed async
    @PostMapping
    public CompletableFuture<ResponseEntity<String>> createOrder(
            @RequestBody CreateOrderRequest request) {
        String orderId = UUID.randomUUID().toString();
        return commandGateway
            .send(new CreateOrderCommand(orderId, request.customerId(), request.items()))
            .thenApply(result -> ResponseEntity.accepted()
                .header("Location", "/api/v1/orders/" + orderId)
                .body(orderId));
    }

    @PostMapping("/{id}/confirm")
    public CompletableFuture<Void> confirmOrder(@PathVariable String id) {
        return commandGateway.send(new ConfirmOrderCommand(id));
    }

    // READ side: query the denormalized projection, not the event store
    @GetMapping("/{id}")
    public CompletableFuture<OrderView> getOrder(@PathVariable String id) {
        return queryGateway.query(new GetOrderQuery(id), OrderView.class);
    }

    @GetMapping
    public CompletableFuture<List<OrderView>> getOrdersByStatus(
            @RequestParam String status) {
        return queryGateway.query(new GetOrdersByStatusQuery(status),
            ResponseTypes.multipleInstancesOf(OrderView.class));
    }
}
```

Why `202 Accepted` instead of `201 Created`? Because CQRS systems are often eventually consistent — the command is processed and the event is stored, but the projection (which feeds the read model) updates asynchronously. Returning the orderId in the `Location` header lets the client poll for the created resource.

## Event Sourcing Without a Framework

Axon is powerful but heavyweight. For teams that want the event sourcing concept without adopting a full framework, the pattern translates directly into plain Spring + JDBC.

The essence of a DIY event store is simple: every state-changing operation appends a row to the `domain_events` table. To load an aggregate, you read all its events ordered by version and replay them — calling `aggregate.apply(event)` for each one — until the aggregate's internal state reflects the current reality.

```java
@Service
public class OrderEventStore {

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private ObjectMapper mapper;

    public void appendEvent(String aggregateId, DomainEvent event) {
        long expectedVersion = getCurrentVersion(aggregateId);
        // Each event gets the next version number — this is how ordering is guaranteed
        jdbc.update("""
            INSERT INTO domain_events (aggregate_id, version, event_type, event_data, occurred_at)
            VALUES (?, ?, ?, ?::jsonb, ?)
            """,
            aggregateId,
            expectedVersion + 1,
            event.getClass().getSimpleName(),
            mapper.writeValueAsString(event),
            event.getOccurredAt()
        );
    }

    public List<DomainEvent> loadEvents(String aggregateId) {
        // Always load in ascending version order — replay must be chronological
        return jdbc.query("""
            SELECT event_type, event_data
            FROM domain_events
            WHERE aggregate_id = ?
            ORDER BY version ASC
            """,
            (rs, row) -> deserializeEvent(rs.getString("event_type"), rs.getString("event_data")),
            aggregateId
        );
    }

    // Load aggregate by replaying its entire event history
    public OrderAggregate load(String orderId) {
        List<DomainEvent> events = loadEvents(orderId);
        if (events.isEmpty()) throw new AggregateNotFoundException(orderId);

        OrderAggregate aggregate = new OrderAggregate();
        // Each call to apply() mutates the aggregate's internal state
        // After the loop, aggregate reflects the current state
        events.forEach(aggregate::apply);
        return aggregate;
    }
}
```

The `load()` method is the core of event sourcing: start with an empty aggregate, replay every event from version 1 to the latest, and you have the current state. This is conceptually simple but has a performance implication for long-lived aggregates — which is why snapshots exist.

## Event Store Schema

The schema design for an event store is deceptively simple but has important details worth understanding.

```sql
CREATE TABLE domain_events (
    id          BIGSERIAL PRIMARY KEY,
    aggregate_id VARCHAR(36) NOT NULL,
    version     INTEGER NOT NULL,
    event_type  VARCHAR(100) NOT NULL,
    event_data  JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata    JSONB DEFAULT '{}',

    -- This UNIQUE constraint is doing important work: it prevents two concurrent
    -- transactions from both writing version=5 for the same aggregate.
    -- The second one will get a DB constraint violation, not a silent overwrite.
    -- This is "optimistic concurrency control" without explicit locking.
    UNIQUE (aggregate_id, version)
);

CREATE INDEX idx_domain_events_aggregate_id ON domain_events (aggregate_id, version);
CREATE INDEX idx_domain_events_type_time ON domain_events (event_type, occurred_at);

-- Snapshot table (for aggregates with thousands of events)
CREATE TABLE aggregate_snapshots (
    aggregate_id  VARCHAR(36) PRIMARY KEY,
    version       INTEGER NOT NULL,
    snapshot_data JSONB NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The `UNIQUE (aggregate_id, version)` constraint is the most important line. Without it, two concurrent requests processing the same aggregate could both read version 7, both decide to write version 8, and you'd have a conflict or data corruption. With the constraint, only one succeeds — the other gets a `UniqueConstraintViolationException` and must retry. This is optimistic concurrency control using the database's own integrity checks.

## Snapshots: Avoiding Replay at Scale

Replaying 10 events to reconstruct an aggregate is trivial. Replaying 10,000 events every time an order is loaded is not. This is the snapshot problem — and it's real for long-running aggregates like user accounts or multi-year subscription records.

The solution is to periodically save a complete snapshot of the aggregate's state. On the next load, instead of replaying from event 1, you restore from the snapshot and only replay events that occurred after the snapshot was taken.

```java
@Service
public class SnapshotService {

    private static final int SNAPSHOT_THRESHOLD = 100;

    public OrderAggregate loadWithSnapshot(String orderId) {
        Optional<Snapshot> snapshot = snapshotRepo.findLatest(orderId);

        OrderAggregate aggregate;
        int fromVersion;

        if (snapshot.isPresent()) {
            // Fast path: restore from snapshot (O(1)), then replay only recent events
            aggregate = mapper.convertValue(snapshot.get().getData(), OrderAggregate.class);
            fromVersion = snapshot.get().getVersion();
        } else {
            // Slow path: no snapshot yet, replay from the beginning
            aggregate = new OrderAggregate();
            fromVersion = 0;
        }

        // Only load events AFTER the snapshot version — much smaller set
        List<DomainEvent> events = eventStore.loadEventsAfter(orderId, fromVersion);
        events.forEach(aggregate::apply);

        // If we've accumulated enough new events since last snapshot, take a new one
        // This keeps the "replay gap" bounded at SNAPSHOT_THRESHOLD events maximum
        if (aggregate.getVersion() - fromVersion >= SNAPSHOT_THRESHOLD) {
            snapshotRepo.save(new Snapshot(orderId, aggregate.getVersion(), aggregate));
        }

        return aggregate;
    }
}
```

With snapshots, the worst-case replay is always bounded at `SNAPSHOT_THRESHOLD` events — in this case, 100. An aggregate that has processed 50,000 events over its lifetime loads in the same time as one that has processed 150, because the snapshot absorbs the bulk of the history.

## When to Use Event Sourcing

Before adopting this pattern, be honest about whether your problem actually requires it.

```
✓ Use Event Sourcing when:
  - Audit trail is required (finance, healthcare, legal)
  - Temporal queries needed ("what was state on date X?")
  - Event replay for debugging or what-if analysis
  - Multiple read models from same data (CQRS works naturally)
  - Event-driven integrations (events drive downstream services)

✗ Avoid Event Sourcing when:
  - Simple CRUD with no audit requirements
  - Small team — complexity cost exceeds benefit
  - Read-heavy workload with simple data shapes (just use a good DB)
  - You need strong consistency across multiple aggregates
    (sagas required for cross-aggregate transactions)

The complexity tax:
  Traditional CRUD: 200 lines of Spring code
  Event Sourcing equivalent: 500+ lines
  Worth it if you have compliance/audit requirements or complex business domains
```

The real power of event sourcing appears months after deployment. A bug introduced data corruption in March? Replay events from February, apply a fix, and rebuild the projection from clean history — without losing anything. A product manager asks "what did our order data look like before the pricing change in December?" Query the event store with a timestamp filter. A new team wants a different reporting view? Build a new projection by replaying historical events. That capability — the time machine — is what makes the upfront complexity worthwhile for systems where history matters.
