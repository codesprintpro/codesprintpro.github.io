---
title: "Cassandra Data Modeling: Design for Queries, Not Entities"
description: "Apache Cassandra data modeling from first principles: partition key design, clustering columns, denormalization strategies, avoiding hot partitions, materialized views vs. manual duplication, and the anti-patterns that kill Cassandra performance."
date: "2025-06-18"
category: "Databases"
tags: ["cassandra", "nosql", "data modeling", "distributed databases", "partition key", "cql", "time series"]
featured: false
affiliateSection: "database-resources"
---

Cassandra is a write-optimized distributed database built for linear horizontal scalability. It stores data in a distributed hash ring — every node is equal, there's no primary, and data placement is determined by partition key hashing. Understanding this architecture is not optional; it directly determines your data model choices.

The cardinal rule of Cassandra modeling: **design your tables around your queries, not your entities**. In relational databases, you normalize data and let the query planner figure out joins. In Cassandra, there is no query planner that helps you. Joins don't exist. `ALLOW FILTERING` exists but bypasses the index and performs full-table scans. Your schema must anticipate every query pattern in advance.

## The Storage Model

Before modeling, understand how Cassandra stores data:

```
Cassandra Storage Architecture:

Partition Key (PK):
  → Determines which node stores the data (via consistent hashing)
  → ALL data with the same partition key lives on the same node
  → One partition key = one "row" in Cassandra's storage engine

Clustering Columns (CC):
  → Sort key WITHIN a partition
  → Data is physically stored sorted by CC on disk
  → Range queries (WHERE cc > x AND cc < y) are efficient

Regular Columns:
  → Just values, no ordering significance

Physical storage (simplified):
Partition: user_id=1001
  [name="Alice", email="alice@example.com"] ← static columns (once per partition)
  [ts=2025-01-01, event="login"]            ← clustering row 1
  [ts=2025-01-02, event="purchase"]          ← clustering row 2
  [ts=2025-01-03, event="logout"]            ← clustering row 3
  (sorted by ts ascending)
```

A CQL `SELECT` that specifies the full partition key reads from one node — O(1) lookup. A query that doesn't specify the partition key fans out to every node — O(n) cluster-wide scan.

## Pattern 1: Query-First Modeling

**Use case: Build a social media activity feed — "show user's recent activity, paginated"**

Relational model (what you'd do in PostgreSQL):
```sql
-- Normalized: store users and events separately
CREATE TABLE users (id UUID PRIMARY KEY, name TEXT);
CREATE TABLE events (id UUID, user_id UUID, type TEXT, created_at TIMESTAMP);
-- Join at query time, ORDER BY created_at
```

Cassandra model (design for the query):
```sql
-- Table is named for the query it answers
CREATE TABLE user_activity_by_user (
    user_id     UUID,
    occurred_at TIMESTAMP,
    event_type  TEXT,
    payload     TEXT,
    PRIMARY KEY (user_id, occurred_at)  -- PK: user_id | CC: occurred_at
) WITH CLUSTERING ORDER BY (occurred_at DESC);  -- Most recent first

-- Query (efficient — hits one partition, reads sequentially):
SELECT * FROM user_activity_by_user
WHERE user_id = ?
ORDER BY occurred_at DESC
LIMIT 20;

-- Pagination: use occurred_at of last seen row as cursor
SELECT * FROM user_activity_by_user
WHERE user_id = ? AND occurred_at < ?  -- "before this timestamp"
ORDER BY occurred_at DESC
LIMIT 20;
```

Why this works: `user_id` is the partition key — all of a user's events live on the same node, sorted by `occurred_at` DESC on disk. The query reads a contiguous range of sorted data — no scatter, no sort.

**Anti-pattern:** `SELECT * FROM user_activity WHERE type = 'purchase'` — no partition key specified. Cassandra must scan every partition on every node. Never do this in production.

## Pattern 2: Compound Partition Keys for Distributed Writes

**Problem: Storing IoT sensor readings**

Naive model:
```sql
CREATE TABLE sensor_readings (
    sensor_id   UUID,
    recorded_at TIMESTAMP,
    value       DOUBLE,
    PRIMARY KEY (sensor_id, recorded_at)
);
```

This works for queries (`WHERE sensor_id = ?`). But what if you have one sensor generating 10,000 writes/second? All writes for that sensor go to a single partition on a single node. That's a **hot partition** — you've created a bottleneck in a supposedly distributed system.

Fix with compound partition key (time bucketing):
```sql
CREATE TABLE sensor_readings_v2 (
    sensor_id   UUID,
    bucket      TEXT,        -- 'YYYY-MM-DD' — one bucket per day
    recorded_at TIMESTAMP,
    value       DOUBLE,
    PRIMARY KEY ((sensor_id, bucket), recorded_at)  -- compound PK
) WITH CLUSTERING ORDER BY (recorded_at ASC);

-- Write:
INSERT INTO sensor_readings_v2 (sensor_id, bucket, recorded_at, value)
VALUES (?, '2025-01-15', ?, ?);

-- Query (must know the bucket):
SELECT * FROM sensor_readings_v2
WHERE sensor_id = ? AND bucket = '2025-01-15'
AND recorded_at >= '2025-01-15 00:00:00'
AND recorded_at < '2025-01-16 00:00:00';

-- Multi-day query (application-level loop):
// Fetch each bucket separately and merge client-side
for (String bucket : getDateRange(startDate, endDate)) {
    results.addAll(query(sensorId, bucket));
}
```

The compound partition key `(sensor_id, bucket)` spreads writes for the same sensor across different partitions (different days hash to different nodes). The tradeoff: your application must know the bucket to query, and cross-bucket queries require multiple round trips.

**Partition size guidance:** Keep partitions under 100MB (soft) or 1GB (hard Cassandra limit). For time-series data, choose a bucket size where `writes_per_second × row_size × seconds_in_bucket < 100MB`. Daily buckets work for most IoT data.

## Pattern 3: Denormalization — Duplicate for Query Patterns

If you need to query the same data in two different ways, you need two tables:

**Use case: E-commerce orders — query by customer AND by product**

```sql
-- Table 1: orders by customer (primary access pattern)
CREATE TABLE orders_by_customer (
    customer_id UUID,
    order_id    UUID,
    order_date  TIMESTAMP,
    total_cents BIGINT,
    status      TEXT,
    PRIMARY KEY (customer_id, order_date, order_id)
) WITH CLUSTERING ORDER BY (order_date DESC, order_id ASC);

-- Table 2: orders by product (secondary access pattern)
CREATE TABLE orders_by_product (
    product_id  UUID,
    order_date  TIMESTAMP,
    order_id    UUID,
    customer_id UUID,
    quantity    INT,
    PRIMARY KEY (product_id, order_date, order_id)
) WITH CLUSTERING ORDER BY (order_date DESC, order_id ASC);

-- Application writes to BOTH tables (usually via batch):
BEGIN BATCH
  INSERT INTO orders_by_customer (customer_id, order_id, order_date, total_cents, status)
    VALUES (?, ?, ?, ?, ?);
  INSERT INTO orders_by_product (product_id, order_date, order_id, customer_id, quantity)
    VALUES (?, ?, ?, ?, ?);
APPLY BATCH;
```

Cassandra logged batches guarantee atomicity (either both writes succeed or neither does). Use them for maintaining consistency across denormalized tables representing the same logical event.

**Storage cost:** You're duplicating data. For most workloads, disk is cheap; latency and availability are expensive. Cassandra clusters typically run with a replication factor of 3, so data is already 3× replicated. Duplicating for a query pattern is not a major cost concern.

## Pattern 4: Materialized Views vs. Manual Duplication

Cassandra offers Materialized Views (MV) — automatically maintained denormalized tables:

```sql
-- Base table:
CREATE TABLE users (
    user_id   UUID PRIMARY KEY,
    email     TEXT,
    username  TEXT,
    country   TEXT
);

-- Materialized View: query users by email
CREATE MATERIALIZED VIEW users_by_email AS
    SELECT * FROM users
    WHERE email IS NOT NULL AND user_id IS NOT NULL
    PRIMARY KEY (email, user_id);

-- Query:
SELECT * FROM users_by_email WHERE email = 'alice@example.com';
```

Cassandra maintains `users_by_email` automatically on every write to `users`. No application-level dual-write needed.

**Why production teams avoid MVs:**
- MV writes are asynchronous — a base table write returns before the MV is updated. Brief inconsistency windows exist.
- MV maintenance adds write amplification and coordination overhead — increasing latency on the base table.
- MV bugs existed in earlier Cassandra versions; some teams distrust them.

**Production recommendation:** Use manual dual-write (via application code or Kafka + CDC) for critical query patterns. Use MVs only for non-critical secondary indexes where brief staleness is acceptable.

## Pattern 5: Secondary Indexes — When and When Not To

Cassandra's secondary index (`CREATE INDEX ON table(column)`) enables queries on non-partition-key columns:

```sql
CREATE INDEX ON users (country);

-- Now this works:
SELECT * FROM users WHERE country = 'US';
```

**The hidden danger:** This query fans out to every node. Each node checks its local index, returns matching rows. For high-cardinality columns (many distinct values) this is inefficient but tolerable. For low-cardinality columns on large datasets (e.g., `status IN ('active', 'inactive')` on 100M users), every node returns millions of rows — catastrophic.

**Safe secondary index use cases:**
- Low-cardinality columns on small datasets (< 1M rows per query result)
- Rarely-executed admin queries where full-node-fan-out is acceptable
- Columns where you always also filter on the partition key (making it a single-node lookup)

**For anything else:** Denormalize into a separate table.

## Cassandra Anti-Patterns to Avoid

**1. Large partitions (the tombstone problem)**

Deletes in Cassandra write tombstones — markers that say "this data was deleted." Tombstones are compacted away during compaction, but until then, they accumulate. Reading a partition requires scanning all tombstones for it.

```sql
-- DANGEROUS: Storing all events for a user in one partition
CREATE TABLE user_events (
    user_id UUID,
    event_id UUID,
    data TEXT,
    PRIMARY KEY (user_id, event_id)
);
-- Deleting old events creates tombstones
-- If users have millions of events + deletions: partition becomes unreadable
-- (coordinator times out scanning tombstones, gc_grace_seconds doesn't help)
```

Fix: Use time-bucketed partitions. Delete whole partitions (less tombstones) instead of individual rows.

**2. Using Cassandra like a relational database**

```sql
-- BROKEN: This causes a full cluster scan
SELECT * FROM orders WHERE status = 'pending';

-- BROKEN: UPDATE requires partition key
UPDATE orders SET status = 'shipped' WHERE status = 'pending'; -- Not how CQL works

-- BROKEN: Aggregations without partition key
SELECT COUNT(*) FROM orders WHERE created_at > '2025-01-01'; -- Full scan
```

**3. Unbounded partition growth**

```sql
-- DANGEROUS: "All events for order 1234" in one partition
-- If an order accumulates 10,000+ events, partition exceeds 100MB limit
PRIMARY KEY (order_id, event_timestamp)

-- FIX: Bucket by time period
PRIMARY KEY ((order_id, week_bucket), event_timestamp)
```

## Lightweight Transactions (LWT) and Why to Avoid Them

```sql
-- LWT: Compare-and-set operations using Paxos
INSERT INTO user_sessions (session_id, user_id, created_at)
VALUES (?, ?, ?)
IF NOT EXISTS;  -- Only insert if no row exists with this session_id

UPDATE inventory SET quantity = quantity - 1
WHERE product_id = ?
IF quantity > 0;  -- Only update if condition is true
```

LWTs guarantee linearizability — exactly one write wins among concurrent writers. This sounds great. The cost:

- LWT requires 4 round trips (Paxos phases: Prepare, Promise, Propose, Accept)
- LWT is 4-10× slower than regular writes
- LWT reduces throughput by up to 40% under contention

**Use LWT only for:** Uniqueness constraints (usernames, emails) and inventory reservation. For everything else, design around eventual consistency or use optimistic concurrency at the application layer.

## Choosing Cassandra

Cassandra is the right tool when:
- Write throughput is the primary concern (millions of writes/second, linearly scalable)
- Time-series or event data with known access patterns
- No joins required, query patterns are defined upfront
- Multi-region active-active replication is required (no single master)
- Availability > consistency (AP system in CAP theorem)

Cassandra is the wrong tool when:
- You need ad-hoc queries or reporting (use PostgreSQL/Elasticsearch)
- Complex transactions spanning multiple entities
- Unknown query patterns that will evolve (schema changes are expensive)
- Small dataset where Cassandra's operational overhead isn't justified

The investment in Cassandra pays off at scale — the same cluster that handles 10,000 writes/second handles 100,000 writes/second with added nodes, no schema changes, no query rewrites. That linear scalability is why teams adopt it, and why getting the data model right from the start is non-negotiable.
