---
title: "Transactional Outbox Pattern: Reliable Event Publishing Without Dual Writes"
description: "A production guide to the transactional outbox pattern: schema design, polling publishers, Debezium CDC, Kafka publishing, retries, ordering, cleanup, and exactly-once myths."
date: "2026-04-07"
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

## Event Versioning

The outbox table is also where you should become disciplined about event contracts. A common mistake is treating event payloads like internal DTOs. Internal DTOs can change with application code. Events are public contracts once another service consumes them.

Add an explicit schema version:

```json
{
  "eventId": "51ea2ed9-7ac9-4c18-8cc2-05f36c4f30a1",
  "eventType": "ORDER_CREATED",
  "schemaVersion": 2,
  "occurredAt": "2025-07-18T10:15:30Z",
  "data": {
    "orderId": "ord_123",
    "userId": "u_456",
    "amount": 1299,
    "currency": "INR"
  }
}
```

Rules that keep event evolution safe:

- Add fields instead of renaming fields
- Keep old fields until all consumers migrate
- Use nullable fields for optional data
- Do not change the meaning of an existing field
- Version breaking changes with a new event type or schema version

For example, changing `amount` from rupees to paise without renaming it is a breaking change. Prefer `amountInPaise` or include a `minorUnitAmount` field and migrate consumers deliberately.

## Poison Events

A poison event is an event that fails every time it is published or consumed. In the outbox publisher, poison events usually happen because of malformed payloads, serialization bugs, topic authorization problems, or payloads larger than Kafka's max message size.

If you retry poison events forever, they can block the queue and hide newer valid events. Add a terminal state:

```sql
ALTER TABLE outbox_events
ADD COLUMN last_error TEXT,
ADD COLUMN failed_at TIMESTAMP;
```

Then mark events as failed after a maximum retry count:

```java
if (event.getRetryCount() >= 10) {
    outboxRepository.markFailed(event.getId(), exception.getMessage());
    alertingService.raise("Outbox event moved to FAILED: " + event.getId());
    return;
}

outboxRepository.markForRetry(event.getId(), backoff(event.getRetryCount()));
```

Failed events should be visible in dashboards and easy to replay after a fix. Do not silently drop them.

## Monitoring the Outbox

Outbox failures are dangerous because the user-facing request can still succeed while downstream systems stop receiving events. You need explicit outbox health metrics:

```
outbox.pending.count
outbox.pending.oldest_age_seconds
outbox.publish.success.count
outbox.publish.failure.count
outbox.publish.duration
outbox.failed.count
outbox.retry.count
```

The most important alert is usually age, not count:

```
alert: OutboxPublisherStuck
condition: outbox.pending.oldest_age_seconds > 300 for 5 minutes
```

A sudden count spike may be normal during a traffic spike. An event that has been pending for 20 minutes is almost always a problem.

## Testing the Pattern

Unit tests are not enough. Test failure windows explicitly:

1. Database commit succeeds, application crashes before publishing
2. Kafka publish succeeds, database update to `PUBLISHED` fails
3. Publisher processes the same event twice
4. Consumer receives the same event twice
5. Poison event exceeds retry limit
6. Cleanup job deletes only published events

A useful integration test:

```java
@Test
void shouldRecoverEventAfterApplicationCrash() {
    Order order = orderService.createOrder(request);

    // Simulate publisher not running during request handling.
    assertThat(outboxRepository.findPendingByAggregateId(order.getId()))
        .hasSize(1);

    outboxPublisher.publishPendingEvents();

    assertThat(kafkaTestConsumer.receivedEvent("ORDER_CREATED", order.getId()))
        .isTrue();
    assertThat(outboxRepository.findByAggregateId(order.getId()).getStatus())
        .isEqualTo("PUBLISHED");
}
```

This is the real guarantee you care about: if the service commits business data, the event remains recoverable even if publishing does not happen immediately.

## Production Checklist

- Write business data and outbox row in the same database transaction
- Use a unique event ID
- Publish with aggregate ID as Kafka key when per-entity ordering matters
- Make consumers idempotent
- Add retry with backoff
- Move poison events to a visible failed state
- Version event schemas deliberately
- Alert on the age of the oldest pending event
- Alert on old pending events
- Alert on repeated publishing failures
- Batch cleanup of published events
- Document event schema ownership

The outbox pattern is not glamorous, but it is one of the highest-leverage reliability patterns in backend architecture. It turns a fragile dual write into a durable local transaction plus an asynchronous publisher, which is exactly the kind of tradeoff production systems need.
