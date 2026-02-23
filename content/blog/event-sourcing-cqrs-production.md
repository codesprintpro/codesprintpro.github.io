---
title: "Event Sourcing and CQRS in Production: Beyond the Theory"
description: "What event sourcing actually looks like in production Java systems: event store design, snapshot strategies, projection rebuilding, CQRS read model synchronization, and the operational challenges nobody talks about."
date: "2025-06-23"
category: "System Design"
tags: ["event sourcing", "cqrs", "system design", "java", "distributed systems", "kafka", "spring boot"]
featured: false
affiliateSection: "distributed-systems-books"
---

Event sourcing is one of those patterns that looks elegant in conference talks and becomes surprisingly complex in production systems. The theory — store events instead of state, derive state by replaying events — is sound. The practice involves snapshot strategies, projection rebuilding, schema evolution, and operational tooling that most tutorials skip entirely.

This article is about what comes after you've decided to use event sourcing.

## The Event Store: Core Design

An event store is an append-only log of domain events. Every state change is expressed as an immutable event:

```sql
-- Event store schema (PostgreSQL):
CREATE TABLE domain_events (
    id              BIGSERIAL PRIMARY KEY,
    aggregate_id    UUID NOT NULL,
    aggregate_type  VARCHAR(100) NOT NULL,       -- 'Order', 'Account', 'Shipment'
    event_type      VARCHAR(100) NOT NULL,        -- 'OrderPlaced', 'OrderShipped'
    event_version   INT NOT NULL DEFAULT 1,       -- Schema version for evolution
    sequence_number BIGINT NOT NULL,              -- Position within aggregate
    data            JSONB NOT NULL,               -- Event payload
    metadata        JSONB,                        -- Correlation ID, user ID, etc.
    occurred_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (aggregate_id, sequence_number)        -- No gaps in sequence per aggregate
);

CREATE INDEX idx_events_aggregate ON domain_events (aggregate_id, sequence_number);
CREATE INDEX idx_events_type_occurred ON domain_events (event_type, occurred_at DESC);
```

Loading an aggregate's current state requires replaying its events:

```java
public class OrderRepository {

    public Order load(UUID orderId) {
        List<DomainEvent> events = eventStore.loadEvents(orderId);
        if (events.isEmpty()) {
            throw new AggregateNotFoundException(orderId);
        }
        return Order.reconstitute(events);
    }

    public void save(Order order) {
        List<DomainEvent> newEvents = order.getUncommittedEvents();
        long expectedSequence = order.getSequenceNumber();

        // Optimistic concurrency: if another process saved between our load and save,
        // sequence number won't match → conflict detected
        eventStore.append(order.getId(), newEvents, expectedSequence);
        order.clearUncommittedEvents();
    }
}

// Order aggregate:
public class Order {
    private UUID id;
    private OrderStatus status;
    private List<OrderItem> items;
    private long sequenceNumber;

    // Reconstitute from events
    public static Order reconstitute(List<DomainEvent> events) {
        Order order = new Order();
        events.forEach(order::apply);
        return order;
    }

    // Apply event (mutates state, no side effects)
    private void apply(DomainEvent event) {
        this.sequenceNumber = event.getSequenceNumber();
        switch (event) {
            case OrderPlacedEvent e -> {
                this.id = e.getOrderId();
                this.status = OrderStatus.PLACED;
                this.items = e.getItems();
            }
            case OrderShippedEvent e -> this.status = OrderStatus.SHIPPED;
            case OrderCancelledEvent e -> this.status = OrderStatus.CANCELLED;
        }
    }
}
```

## Snapshot Strategy

For aggregates with long event histories, replaying 10,000 events to load a single aggregate is unacceptable. Snapshots checkpoint the aggregate's state:

```sql
CREATE TABLE aggregate_snapshots (
    aggregate_id        UUID PRIMARY KEY,
    aggregate_type      VARCHAR(100) NOT NULL,
    snapshot_data       JSONB NOT NULL,
    snapshot_version    INT NOT NULL,            -- Schema version of snapshot
    sequence_number     BIGINT NOT NULL,         -- Event sequence at snapshot time
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
```

```java
public Order loadWithSnapshot(UUID orderId) {
    // 1. Load most recent snapshot
    Optional<Snapshot> snapshot = snapshotStore.loadLatest(orderId);

    // 2. Load events after snapshot
    long fromSequence = snapshot.map(Snapshot::getSequenceNumber).orElse(0L);
    List<DomainEvent> events = eventStore.loadEvents(orderId, fromSequence + 1);

    // 3. Reconstitute from snapshot + subsequent events
    if (snapshot.isPresent()) {
        Order order = Order.fromSnapshot(snapshot.get());
        events.forEach(order::apply);
        return order;
    } else {
        return Order.reconstitute(events);
    }
}

// Snapshot policy: snapshot after every N events
@Scheduled(fixedDelay = 60_000)
public void snapshotHighVolumeAggregates() {
    List<UUID> candidates = eventStore.findAggregatesWithEventsAbove(
        SNAPSHOT_THRESHOLD = 100
    );
    candidates.forEach(id -> {
        Order order = load(id);
        snapshotStore.save(Snapshot.from(order));
    });
}
```

## CQRS: Separate Read and Write Models

CQRS (Command Query Responsibility Segregation) pairs naturally with event sourcing: the event store is the write model; projections (denormalized views) are read models built from events.

```
CQRS Architecture:

Command Side:                 Event Side:                Read Side:

User → OrderController  →   Event Store (append)  →   Projection Worker
       (Command)             domain_events              ↓
       ↓                                            Read Model DB
       Order.apply()                                (PostgreSQL/Elasticsearch/Redis)
       ↓                                                ↓
       Emit events →  ──────────────────────────→  API Response
```

```java
// Projection: build a denormalized order summary for quick reads
@Component
@Transactional
public class OrderSummaryProjection {

    @EventHandler
    public void on(OrderPlacedEvent event) {
        orderSummaryRepository.save(new OrderSummary(
            event.getOrderId(),
            event.getUserId(),
            event.getTotalAmount(),
            "PLACED",
            event.getOccurredAt()
        ));
    }

    @EventHandler
    public void on(OrderShippedEvent event) {
        orderSummaryRepository.updateStatus(event.getOrderId(), "SHIPPED");
    }

    @EventHandler
    public void on(OrderItemAddedEvent event) {
        orderSummaryRepository.addItem(event.getOrderId(), event.getItem());
    }
}
```

## Projection Rebuilding

Projections are disposable — they can always be rebuilt from the event store. This is a key advantage. When you add a new projection, or fix a bug in an existing one, you replay all events:

```java
@Component
public class ProjectionRebuilder {

    public void rebuild(Class<? extends Projection> projectionClass, String aggregateType) {
        Projection projection = context.getBean(projectionClass);

        // Clear existing projection data
        projection.reset();

        // Stream events from beginning
        long position = 0;
        int batchSize = 1000;
        List<DomainEvent> batch;

        do {
            batch = eventStore.loadAll(aggregateType, position, batchSize);
            batch.forEach(event -> {
                try {
                    projection.apply(event);
                } catch (Exception e) {
                    log.error("Failed to apply event {} to projection {}",
                        event.getId(), projectionClass.getSimpleName(), e);
                }
            });
            position += batch.size();
        } while (batch.size() == batchSize);

        log.info("Rebuilt projection {} with {} events", projectionClass.getSimpleName(), position);
    }
}
```

For millions of events, rebuilding in-process is too slow. Use a dedicated rebuild pipeline: stream events from the store to Kafka, run projection workers at full throughput in parallel.

## Schema Evolution

Events are immutable. Once committed, the `OrderPlacedEvent` from 2022 cannot be changed. But your schema will evolve. Handle this with upcasters — functions that transform old event versions to the current format:

```java
public interface EventUpcaster<T extends DomainEvent> {
    int fromVersion();
    T upcast(JsonNode rawEvent);
}

@Component
public class OrderPlacedEventV1ToV2Upcaster implements EventUpcaster<OrderPlacedEvent> {

    @Override
    public int fromVersion() { return 1; }

    @Override
    public OrderPlacedEvent upcast(JsonNode rawEvent) {
        // V1 had 'customer_id', V2 renamed to 'user_id'
        ObjectNode upgraded = rawEvent.deepCopy();
        upgraded.put("user_id", rawEvent.get("customer_id").asText());
        upgraded.remove("customer_id");
        return objectMapper.treeToValue(upgraded, OrderPlacedEvent.class);
    }
}

// Event serialization layer applies upcasters transparently:
public DomainEvent deserialize(StoredEvent stored) {
    DomainEvent event = objectMapper.readValue(stored.getData(), getDomainEventClass(stored.getEventType()));
    return upcasterRegistry.upcastChain(event, stored.getEventVersion(), currentVersion());
}
```

## The Operational Challenges Nobody Talks About

**1. Event store grows unboundedly.** Unlike a state-based system where you UPDATE rows, event sourcing only INSERTs. A system with 100 commands/second generates 8.6M events/day. After 1 year: 3.1B events. Plan for:
- Archival: move events older than N years to cold storage (S3 + Parquet)
- Index maintenance: `domain_events` index grows with the table
- Backup strategies: event stores are large

**2. Eventual consistency between write and read models.** After a command executes, the projection may not be updated for tens of milliseconds. API clients reading immediately after a write may see stale data. Options:
- Return event data directly in command response (avoid the read model for the "write response")
- Client polls until the projection catches up (pessimistic, bad UX)
- Optimistic UI updates (update UI before projection confirms)

**3. Process manager complexity.** Long-running business processes (order fulfillment, subscription renewals) require sagas that span multiple aggregates. These are stateful and must handle partial failures. The saga state machine itself needs an event log to be recoverable.

**4. Querying across aggregates.** The event store is aggregate-centric. "Give me all orders placed in the last 24 hours over $500" requires a projection. Every new query pattern potentially needs a new projection. Plan your read model database carefully.

## When Event Sourcing is Worth It

Event sourcing is excellent for:
- Domains with audit requirements (finance, healthcare, compliance)
- Complex domain logic where understanding "how did we get here" matters
- Systems that benefit from temporal queries (state at any point in time)
- High-throughput write paths (append-only is fast)

It adds complexity that rarely pays off for:
- Simple CRUD systems
- Systems without audit requirements
- Small teams without DDD expertise
- Services with simple, flat domain models

The decision should be per-domain, not per-system. Your order management service might benefit from event sourcing; your user profile service almost certainly doesn't.
