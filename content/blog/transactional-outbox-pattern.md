---
title: "Transactional Outbox Pattern: Reliable Event Publishing Without Dual Writes"
description: "A production guide to the transactional outbox pattern: schema design, polling publishers, Debezium CDC, Kafka publishing, retries, ordering, cleanup, and exactly-once myths."
date: "2025-07-18"
category: "System Design"
tags: ["transactional outbox", "kafka", "event driven architecture", "distributed systems", "debezium", "reliability"]
featured: false
affiliateSection: "distributed-systems-books"
---

The transactional outbox pattern solves one of the most common reliability bugs in distributed systems: **the dual-write problem**.

Imagine an order service that writes to PostgreSQL and publishes an `OrderCreated` event to Kafka:

```java
orderRepository.save(order);
kafkaTemplate.send("order-created", event);
```

This looks harmless, but there are two writes to two different systems. If the database write succeeds and Kafka publishing fails, the order exists but no downstream service knows about it. If Kafka succeeds and the database transaction rolls back, consumers react to an order that does not exist.

Distributed transactions are rarely worth the operational cost. The outbox pattern gives you a simpler option: write the business row and the event row into the same database transaction, then publish the event asynchronously.

## The Core Idea

Instead of publishing directly to Kafka inside the request path:

```java
@Transactional
public Order createOrder(CreateOrderRequest request) {
    Order order = orderRepository.save(Order.from(request));
    kafkaTemplate.send("order-created", OrderCreated.from(order)); // risky
    return order;
}
```

Write an outbox row in the same transaction:

```java
@Transactional
public Order createOrder(CreateOrderRequest request) {
    Order order = orderRepository.save(Order.from(request));

    outboxRepository.save(OutboxEvent.builder()
        .aggregateType("ORDER")
        .aggregateId(order.getId())
        .eventType("ORDER_CREATED")
        .payload(toJson(OrderCreated.from(order)))
        .build());

    return order;
}
```

Now the database commit atomically persists both:

- the order
- the fact that an event must be published

If the process crashes after commit, the event is still in the outbox table and can be published later.

## Outbox Table Schema

A practical PostgreSQL schema:

```sql
CREATE TABLE outbox_events (
  id              UUID PRIMARY KEY,
  aggregate_type  VARCHAR(50) NOT NULL,
  aggregate_id    VARCHAR(128) NOT NULL,
  event_type      VARCHAR(100) NOT NULL,
  payload         JSONB NOT NULL,
  headers         JSONB NOT NULL DEFAULT '{}',
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  retry_count     INT NOT NULL DEFAULT 0,
  next_retry_at   TIMESTAMP NOT NULL DEFAULT now(),
  created_at      TIMESTAMP NOT NULL DEFAULT now(),
  published_at    TIMESTAMP
);

CREATE INDEX idx_outbox_pending
  ON outbox_events (status, next_retry_at, created_at)
  WHERE status = 'PENDING';

CREATE INDEX idx_outbox_aggregate
  ON outbox_events (aggregate_type, aggregate_id, created_at);
```

Important fields:

- `aggregate_type` and `aggregate_id` define the business entity
- `event_type` tells consumers how to interpret the payload
- `status` controls publisher state
- `retry_count` and `next_retry_at` support backoff
- `created_at` helps preserve publish order

## Polling Publisher

The simplest outbox publisher polls pending rows and publishes them to Kafka:

```java
@Scheduled(fixedDelay = 1000)
public void publishPendingEvents() {
    List<OutboxEvent> events = outboxRepository.claimNextBatch(100);

    for (OutboxEvent event : events) {
        try {
            kafkaTemplate.send(
                topicFor(event.getEventType()),
                event.getAggregateId(),
                event.getPayload()
            ).get(5, TimeUnit.SECONDS);

            outboxRepository.markPublished(event.getId());
        } catch (Exception ex) {
            outboxRepository.markForRetry(
                event.getId(),
                backoff(event.getRetryCount())
            );
        }
    }
}
```

The critical part is claiming rows safely when multiple publisher instances run:

```sql
WITH next_events AS (
  SELECT id
  FROM outbox_events
  WHERE status = 'PENDING'
    AND next_retry_at <= now()
  ORDER BY created_at
  LIMIT 100
  FOR UPDATE SKIP LOCKED
)
UPDATE outbox_events
SET status = 'PROCESSING'
WHERE id IN (SELECT id FROM next_events)
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` lets multiple workers claim different rows without blocking each other.

## What Happens If Mark-Published Fails?

Suppose Kafka publish succeeds but `markPublished` fails because the database connection drops. The event will remain pending and may be published again.

That means consumers must still be idempotent.

The outbox pattern guarantees durable event publishing. It does not magically guarantee exactly-once side effects in every downstream system.

Consumers should track event IDs:

```sql
CREATE TABLE processed_events (
  consumer_name VARCHAR(100) NOT NULL,
  event_id UUID NOT NULL,
  processed_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_name, event_id)
);
```

Then each consumer can insert before processing. Duplicate insert means the event was already handled.

## Debezium CDC Variant

Polling is easy to understand, but CDC is often cleaner at high volume.

With Debezium:

1. Service writes to `outbox_events` inside the business transaction
2. Debezium reads PostgreSQL WAL changes
3. Debezium publishes outbox rows to Kafka
4. Kafka consumers receive events without a custom polling job

This removes publisher code from the application, but adds operational responsibility for Kafka Connect and Debezium.

Use polling when:

- volume is moderate
- the team wants simple operational ownership
- a few seconds of delay is acceptable

Use CDC when:

- event volume is high
- you already run Debezium
- you want transaction log ordering
- many services use the same pattern

## Ordering Guarantees

If event order matters per aggregate, use `aggregate_id` as the Kafka key:

```java
kafkaTemplate.send(topic, event.getAggregateId(), event.getPayload());
```

Kafka preserves order within a partition. All events for the same aggregate key land in the same partition, so consumers see:

```
ORDER_CREATED -> ORDER_PAID -> ORDER_SHIPPED
```

Do not expect global ordering across all orders. It is expensive and rarely needed.

## Cleanup Strategy

Outbox tables grow quickly. Keep published rows only as long as you need for audit/debugging:

```sql
DELETE FROM outbox_events
WHERE status = 'PUBLISHED'
  AND published_at < now() - interval '7 days';
```

For high-volume systems, delete in batches:

```sql
DELETE FROM outbox_events
WHERE id IN (
  SELECT id
  FROM outbox_events
  WHERE status = 'PUBLISHED'
    AND published_at < now() - interval '7 days'
  LIMIT 1000
);
```

Large deletes can create table bloat. Monitor autovacuum and consider partitioning by `created_at`.

## Production Checklist

- Write business data and outbox row in the same database transaction
- Use a unique event ID
- Publish with aggregate ID as Kafka key when per-entity ordering matters
- Make consumers idempotent
- Add retry with backoff
- Alert on old pending events
- Alert on repeated publishing failures
- Batch cleanup of published events
- Document event schema ownership

The outbox pattern is not glamorous, but it is one of the highest-leverage reliability patterns in backend architecture. It turns a fragile dual write into a durable local transaction plus an asynchronous publisher, which is exactly the kind of tradeoff production systems need.
