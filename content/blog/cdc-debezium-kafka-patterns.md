---
title: "Change Data Capture with Debezium: Real-Time Data Synchronization Patterns"
description: "CDC lets you stream every database change as an event. Learn how Debezium captures PostgreSQL WAL logs, publishes to Kafka, and powers cache invalidation, search indexing, and microservice sync."
date: "2025-02-01"
category: "Data Engineering"
tags: ["cdc", "debezium", "kafka", "data engineering", "postgresql", "microservices"]
featured: false
affiliateSection: "data-engineering-resources"
---

Change Data Capture (CDC) is one of those techniques that, once you understand it, you see it everywhere. The pattern: instead of your application explicitly publishing events when data changes, let the database engine itself be the event source — by reading its internal change log.

This article explains how Debezium captures PostgreSQL WAL (Write-Ahead Log) entries and streams them to Kafka, and shows the production patterns this enables.

## Why CDC?

### The Problem: Dual-Write

When a service needs to update a database AND publish an event (for cache invalidation, search indexing, microservice notification), the naive approach is dual-write. The code below looks straightforward, but it contains a race condition that will eventually corrupt your data in production — the kind of bug that's very hard to reproduce and very hard to explain to stakeholders.

```java
// PROBLEMATIC: Dual-write with a race condition
public void createOrder(Order order) {
    orderRepository.save(order);           // Step 1: DB write
    kafkaTemplate.send("orders", order);   // Step 2: Event publish
    // If the app crashes between Step 1 and Step 2:
    // → DB has the order, Kafka doesn't → systems are inconsistent
}
```

This is a distributed transaction problem. Two-phase commit is operationally painful. CDC solves this by making the database write the single source of truth — the event is derived from the write, not paired with it.

### The Outbox Pattern (Another Solution)

Before CDC was widely adopted, teams used the Outbox pattern as a more reliable alternative to dual-write. The idea is elegant: instead of writing to the database and Kafka separately, you write to two database tables in a single transaction, then a background process publishes the second table's entries to Kafka. Because both writes are in the same transaction, you eliminate the crash window entirely.

```java
@Transactional
public void createOrder(Order order) {
    orderRepository.save(order);
    // Same transaction — atomic write to both tables
    outboxRepository.save(new OutboxEvent("order.created", order.toJson()));
}

// Separate poller (less elegant, but reliable)
@Scheduled(fixedDelay = 1000)
public void publishOutboxEvents() {
    List<OutboxEvent> events = outboxRepository.findUnpublished();
    events.forEach(e -> {
        kafkaTemplate.send(e.getType(), e.getPayload());
        outboxRepository.markPublished(e.getId());
    });
}
```

CDC with Debezium automates the outbox pattern — Debezium reads the outbox table changes from WAL and publishes them, eliminating the polling process.

## How Debezium Works

Understanding Debezium requires understanding PostgreSQL's Write-Ahead Log. The WAL is PostgreSQL's crash recovery mechanism — every change is written there first before it touches the main table. Debezium acts as a logical replication client, reading those WAL entries and translating them into structured events. Think of Debezium as a translator sitting between your database's internal diary and your event streaming platform.

```
PostgreSQL WAL (Write-Ahead Log):
  Every INSERT/UPDATE/DELETE is first written to the WAL before the main tables.
  WAL is append-only and durable — used for crash recovery and replication.

Debezium's mechanism:
  1. Connects to PostgreSQL as a logical replication client
  2. PostgreSQL sends WAL entries to Debezium via a replication slot
  3. Debezium decodes WAL entries into structured change events
  4. Events published to Kafka topics (one per table by default)

PostgreSQL WAL entry for INSERT into orders:
  {
    "op": "c",          // c=create, u=update, d=delete, r=read (snapshot)
    "ts_ms": 1704153600000,
    "before": null,     // null for INSERT (no previous state)
    "after": {
      "id": "ord-123",
      "user_id": "usr-456",
      "total": 99.99,
      "status": "PENDING",
      "created_at": 1704153600000
    },
    "source": {
      "version": "2.5.0.Final",
      "connector": "postgresql",
      "name": "pg-prod",
      "ts_ms": 1704153600000,
      "snapshot": "false",
      "db": "myapp",
      "schema": "public",
      "table": "orders",
      "txId": 789,
      "lsn": 24023128   // Log Sequence Number — WAL position
    }
  }
```

The `before` and `after` fields are especially useful — for UPDATE operations, you get both the old and new values, enabling downstream consumers to detect exactly what changed rather than having to compare against a previous state they may have stored. The `lsn` (Log Sequence Number) is Debezium's bookmark in the WAL — it uses this to resume from exactly the right position after a restart.

## PostgreSQL Configuration

Before Debezium can connect, PostgreSQL needs to be configured to support logical replication. The default WAL level (`replica`) only supports physical replication for read replicas — you need to change it to `logical` to allow Debezium to decode the WAL entries into structured events.

```bash
# postgresql.conf — requires PostgreSQL restart
 wal_level = logical                    # Default is 'replica' — change to 'logical'
max_replication_slots = 5              # Debezium uses one slot per connector
max_wal_senders = 5                    # Max concurrent replication connections

# Retention: don't let WAL grow unbounded if Debezium falls behind
 wal_keep_size = 1024                   # Keep at least 1GB of WAL segments
```

With the server configured, create a dedicated replication user with the minimum necessary permissions — this follows the principle of least privilege and limits blast radius if the credentials are ever compromised.

```sql
-- Create a replication user with minimal permissions
CREATE ROLE debezium REPLICATION LOGIN PASSWORD 'strong_password';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO debezium;
GRANT CREATE ON DATABASE myapp TO debezium;  -- For creating replication slots

-- Verify replication slots (Debezium creates these automatically)
SELECT slot_name, plugin, slot_type, active, restart_lsn FROM pg_replication_slots;
-- slot_name: debezium_pg_prod
-- plugin: pgoutput (or decoderbufs)
-- active: true (Debezium is connected)
```

## Debezium Connector Configuration

Debezium runs as a Kafka Connect plugin, which means you deploy it by submitting a JSON configuration to the Kafka Connect REST API. The configuration below sets up capture for three tables and uses Avro serialization with a Schema Registry — this is the production-grade setup that handles schema evolution safely.

```json
{
  "name": "postgres-connector",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "plugin.name": "pgoutput",
    "tasks.max": "1",

    "database.hostname": "postgres.internal",
    "database.port": "5432",
    "database.user": "debezium",
    "database.password": "${file:/opt/kafka/connect/secrets.properties:DB_PASSWORD}",
    "database.dbname": "myapp",
    "database.server.name": "pg-prod",

    "table.include.list": "public.orders,public.products,public.users",

    "slot.name": "debezium_pg_prod",
    "publication.name": "debezium_publication",
    "publication.autocreate.mode": "filtered",

    "snapshot.mode": "initial",
    "snapshot.locking.mode": "none",

    "topic.prefix": "pg-prod",
    "topic.creation.default.replication.factor": 3,
    "topic.creation.default.partitions": 6,

    "key.converter": "io.confluent.kafka.serializers.KafkaAvroSerializer",
    "key.converter.schema.registry.url": "http://schema-registry:8081",
    "value.converter": "io.confluent.kafka.serializers.KafkaAvroSerializer",
    "value.converter.schema.registry.url": "http://schema-registry:8081",

    "transforms": "unwrap",
    "transforms.unwrap.type": "io.debezium.transforms.ExtractNewRecordState",
    "transforms.unwrap.drop.tombstones": "false",
    "transforms.unwrap.delete.handling.mode": "rewrite"
  }
}
```

The `transforms.unwrap` section applies the `ExtractNewRecordState` Single Message Transform (SMT), which strips the Debezium metadata envelope and gives consumers a clean, flat event with just the row data. Without this transform, consumers would need to parse the nested `before`/`after` structure on every event.

This produces Kafka topics:
- `pg-prod.public.orders` — all order changes
- `pg-prod.public.products` — all product changes
- `pg-prod.public.users` — all user changes

## Consumer Patterns

Now that changes are flowing into Kafka topics, you can attach multiple independent consumers — each solving a different downstream problem without any coupling between them. This fan-out is CDC's key architectural benefit: one data source, many consumers, zero application changes required to add a new one.

### Pattern 1: Cache Invalidation

Cache invalidation is one of the hardest problems in distributed systems. CDC makes it straightforward: every time a row changes in the database, Kafka delivers the event to your cache invalidator, which removes the stale entry. The cache and database can never diverge for more than the Kafka propagation latency (typically under a second).

```java
@Component
public class OrderCacheInvalidator {

    @Autowired
    private RedisTemplate<String, Object> redis;

    @KafkaListener(topics = "pg-prod.public.orders", groupId = "cache-invalidator")
    public void handleOrderChange(ConsumerRecord<String, OrderChangeEvent> record) {
        OrderChangeEvent event = record.value();

        // The ExtractNewRecordState transform extracts the "after" state
        // event.getId() is the order ID (set as Kafka message key)
        String cacheKey = "order:" + event.getId();

        if (event.getOp().equals("d")) {
            // DELETE: remove from cache
            redis.delete(cacheKey);
        } else {
            // INSERT or UPDATE: invalidate so next read fetches fresh data
            // (or write-through: set the new value directly)
            redis.delete(cacheKey);
        }

        log.debug("Invalidated cache for order {}, op={}", event.getId(), event.getOp());
    }
}
```

### Pattern 2: Elasticsearch Indexing

Keeping your search index in sync with your database is a problem CDC solves cleanly. Previously this required either synchronous writes to Elasticsearch in your application code (coupling your service to your search infrastructure) or a scheduled batch job that lagged hours behind. With CDC, your search index stays near-real-time automatically.

```java
@Component
public class ProductSearchIndexer {

    @Autowired
    private ElasticsearchClient esClient;

    @KafkaListener(topics = "pg-prod.public.products", groupId = "search-indexer")
    public void handleProductChange(ConsumerRecord<String, ProductChangeEvent> record) {
        ProductChangeEvent event = record.value();

        if (event.getOp().equals("d")) {
            // Delete from search index
            esClient.delete(d -> d
                .index("products")
                .id(event.getId().toString())
            );
        } else {
            // Upsert into search index
            ProductSearchDocument doc = ProductSearchDocument.from(event);
            esClient.index(i -> i
                .index("products")
                .id(event.getId().toString())
                .document(doc)
            );
        }
    }
}
```

### Pattern 3: Materialized View Maintenance (CQRS Read Model)

The CQRS (Command Query Responsibility Segregation) pattern separates the write model from the read model. CDC is the most natural way to keep the read model up-to-date — when the write model changes, Debezium publishes the event, and the read model updater below enriches and denormalizes it into a form optimized for fast queries. This eliminates expensive JOINs at read time by paying the cost once at write time.

```java
// Separate read model: orders enriched with user info, denormalized for fast reads
@Component
public class OrderReadModelUpdater {

    @Autowired
    private OrderReadRepository readRepository;

    @Autowired
    private UserService userService;

    @KafkaListener(topics = "pg-prod.public.orders", groupId = "read-model-updater")
    public void handleOrderChange(ConsumerRecord<String, OrderChangeEvent> record) {
        OrderChangeEvent event = record.value();

        if (event.getOp().equals("d")) {
            readRepository.deleteById(event.getId());
            return;
        }

        // Enrich with user data (from another service or local cache)
        UserInfo user = userService.getUser(event.getUserId());

        OrderReadModel readModel = OrderReadModel.builder()
            .id(event.getId())
            .userId(event.getUserId())
            .userName(user.getName())         // Denormalized
            .userEmail(user.getEmail())       // Denormalized
            .total(event.getTotal())
            .status(event.getStatus())
            .updatedAt(Instant.now())
            .build();

        readRepository.upsert(readModel);
    }
}
```

The `userName` and `userEmail` fields being stored directly in the order read model means your order list queries never need to JOIN against the users table — a significant performance win at scale. The trade-off is that if a user updates their name, you need a separate process to backfill affected order read models.

## The Outbox Pattern with Debezium

Building on the outbox pattern introduced earlier, you can combine it with Debezium to achieve the most reliable event publishing architecture available. The application writes to its domain table and an outbox table in a single transaction; Debezium reads the outbox changes and publishes them — no polling thread, no risk of missed events.

```java
// Domain service: writes to domain table + outbox atomically
@Service
@Transactional
public class OrderService {

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private OutboxRepository outboxRepository;

    public Order createOrder(CreateOrderRequest request) {
        Order order = orderRepository.save(buildOrder(request));

        // Outbox entry: same transaction → guaranteed to be written
        outboxRepository.save(OutboxEvent.builder()
            .id(UUID.randomUUID())
            .aggregateType("Order")
            .aggregateId(order.getId())
            .type("order.created")
            .payload(objectMapper.writeValueAsString(OrderCreatedEvent.from(order)))
            .build());

        return order;
    }
}

// Debezium watches the outbox table
// When outbox row is inserted → WAL entry → Debezium reads → publishes to Kafka
// No polling thread, no duplicate publish risk, no dual-write race condition
```

The beauty of this pattern is that your application code is simple and transactional — it writes to two tables and returns. All the complexity of reliable event delivery is handled by Debezium at the infrastructure layer, not scattered through your application code. The Kafka Connect EventRouter SMT routes each outbox event to the appropriate topic based on the `aggregate_type` field.

```json
{
  "transforms": "outbox",
  "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter",
  "transforms.outbox.table.field.event.id": "id",
  "transforms.outbox.table.field.event.type": "type",
  "transforms.outbox.table.field.event.payload": "payload",
  "transforms.outbox.route.by.field": "aggregate_type",
  "transforms.outbox.route.topic.replacement": "outbox.${routedByValue}"
}
```

## Operational Considerations

### Replication Slot Lag

The most critical production concern: if Debezium is down or slow, PostgreSQL **cannot clean up WAL** until the replication slot reads it. WAL can grow to fill your disk.

This is the one operational risk you must monitor closely. If your Debezium connector goes offline for hours during a busy period, your PostgreSQL disk can fill up entirely — which takes down your entire database, not just the CDC pipeline. Set up this query as an alert in your monitoring system, and treat it with the same urgency as disk space alerts.

```bash
# Monitor replication slot lag (in bytes)
SELECT slot_name,
       pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) AS lag_bytes,
       active
FROM pg_replication_slots;

# Alert if lag_bytes > 10GB (customize based on disk space and write rate)
```

Set a WAL disk limit and drop the slot if Debezium is offline too long:

```bash
# Drop stalled replication slot (Debezium will re-snapshot on reconnect)
SELECT pg_drop_replication_slot('debezium_pg_prod');
```

Dropping the slot is a drastic action — Debezium will need to perform a full snapshot on reconnect — but it's better than losing your primary database to disk exhaustion. The right approach is to automate slot removal after a configurable lag threshold.

### Schema Evolution

When your database schema changes (new column, renamed column), Debezium handles this through Schema Registry versioning. Use `ALTER TABLE ... ADD COLUMN` safely — Debezium handles new columns gracefully. Renaming/dropping columns requires coordination with consumers.

### Snapshot Mode

On initial deployment, Debezium can snapshot existing data:
- `initial`: Snapshot all existing rows, then stream new changes (default — use for most cases)
- `never`: Skip snapshot, only stream changes from now (use when data is already migrated)
- `schema_only`: Only capture the schema, not existing data

CDC with Debezium turns your database into a reliable event bus without changing application code. The WAL is already there — Debezium just makes it readable. For any microservice architecture where services need to react to data changes in other services' databases, CDC is the most reliable and operationally simple solution available.
