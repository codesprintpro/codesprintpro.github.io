---
title: "Designing a Database Sharding Strategy for 100 Million Users"
description: "A practical guide to horizontal sharding at scale: shard key selection, hot shard prevention, consistent hashing, cross-shard queries, and zero-downtime data migration with real fintech architecture examples."
date: "2025-04-14"
category: "Databases"
tags: ["databases", "sharding", "postgresql", "system design", "distributed systems", "scaling"]
featured: false
affiliateSection: "database-resources"
---

Vertical scaling has a ceiling. For most applications, that ceiling arrives somewhere between 1 million and 10 million users, depending on write patterns and data size. At 100 million users, the question is not whether to shard — it's how to shard without destroying query capabilities, operational sanity, and transactional guarantees.

This article is a complete playbook for database sharding at fintech scale.

## Horizontal vs Vertical Sharding

**Vertical sharding** (functional partitioning) splits tables across databases by domain: users database, orders database, payments database. Each service owns its database. This is what microservices architecture gives you naturally.

```
Vertical Sharding:
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│   Users DB          │  │   Orders DB          │  │   Payments DB       │
│   users table       │  │   orders table       │  │   payments table    │
│   profiles table    │  │   order_items table  │  │   ledger table      │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘
```

**Horizontal sharding** splits a single large table across multiple database instances by row. Each shard holds a subset of rows.

```
Horizontal Sharding:
users table → split by user_id range

Shard 0: user_id 0–24,999,999         (Shard DB 0)
Shard 1: user_id 25,000,000–49,999,999 (Shard DB 1)
Shard 2: user_id 50,000,000–74,999,999 (Shard DB 2)
Shard 3: user_id 75,000,000–99,999,999 (Shard DB 3)
```

Vertical sharding should always come first. It's operationally simpler, enables independent scaling per domain, and avoids distributed transactions within a service. Horizontal sharding is the next step when a single domain's write volume exceeds what one machine can handle.

## Shard Key Selection Strategy

The shard key is the most consequential decision in your sharding design. Getting it wrong means data hotspots, expensive cross-shard joins, or re-sharding after launch.

**Rule 1: High cardinality.** The shard key must have enough distinct values to distribute data evenly. `user_id` (UUID or integer) works. `country_code` does not — if 40% of your users are in the US, one shard gets 40% of the load.

**Rule 2: Even access distribution.** The key should distribute both read and write load evenly. Timestamp-based keys (`created_at`) often create write hotspots — all new records hit the latest shard.

**Rule 3: Co-locate related data.** Queries that need to be fast should touch one shard. For a payment system, sharding payments by `user_id` means all of a user's payment history is on one shard, enabling efficient account statements without cross-shard queries.

**Rule 4: Immutable.** Changing the shard key value means moving the row to a different shard — an expensive operation. Use IDs that never change.

For a fintech platform at 100M users:

```sql
-- Schema design: payments table
CREATE TABLE payments (
    payment_id      UUID DEFAULT gen_random_uuid(),
    user_id         BIGINT NOT NULL,          -- Shard key
    merchant_id     BIGINT NOT NULL,
    amount          DECIMAL(19,4) NOT NULL,
    currency        CHAR(3) NOT NULL,
    status          VARCHAR(20) NOT NULL,
    idempotency_key VARCHAR(255) UNIQUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, payment_id)         -- Shard key first in PK
);

-- Shard key determines physical location
-- All rows for user_id 12345678 are on Shard (12345678 % 64)
```

## Consistent Hashing

Naive hash-based sharding uses `shard_id = hash(user_id) % num_shards`. The problem: adding a shard changes the modulus, requiring almost all data to move.

Consistent hashing solves this with a ring:

```
Consistent Hashing Ring (0 to 2^32):

              0 / 2^32
                  │
       ┌──────────┴──────────┐
  Shard 0               Shard 1
  (0 - 2^30)        (2^30 - 2^31)
                │
           Shard 2
        (2^31 - 3·2^30)
                │
           Shard 3
      (3·2^30 - 2^32)
```

Each shard owns a range on the ring. A user's shard is determined by where `hash(user_id)` lands. When you add a fourth shard, only the users whose hash falls between the new shard's range boundaries need to move — roughly 1/N of data, not all of it.

Virtual nodes (vnodes) improve distribution: each physical shard has multiple positions on the ring (typically 150–300 vnodes). This smooths uneven distributions caused by non-uniform hash outputs.

## Hot Shard Problem

Even with good key selection, certain shards can become disproportionately busy:
- A viral merchant has 10M transactions, all landing on Shard 4
- A batch job processes all users in `user_id` range 0–1M sequentially
- A celebrity user account is read millions of times per day

**Detection:** Monitor per-shard QPS, CPU, and I/O independently. A shard running at 80% CPU while others run at 20% is a hot shard.

**Mitigation strategies:**

1. **Key-based hot shard splitting:** Split the hot shard into two, re-hashing the subset. Requires migration.

2. **Read replicas for read-heavy hot shards:** Add read replicas to the hot shard. Route reads there, writes to the primary.

3. **Application-layer caching for celebrity objects:** Cache the hot user/merchant data in Redis. This solves read hotspots without re-sharding.

4. **Secondary shard key for compound hotness:** If merchant_id causes hotspots, shard the `merchant_payments` aggregate table by `merchant_id` separately from the main `payments` table sharded by `user_id`.

## Cross-Shard Query Challenges

The most painful limitation of horizontal sharding: queries spanning multiple shards require scatter-gather.

```
SELECT amount, currency, merchant_id
FROM payments
WHERE created_at BETWEEN '2025-01-01' AND '2025-01-31'
  AND status = 'completed'
ORDER BY created_at DESC
LIMIT 100;
```

This query has no `user_id` predicate, so it must run on all 64 shards and results must be merged. Approaches:

**1. Application-layer scatter-gather:**
```java
List<CompletableFuture<List<Payment>>> futures = shards.stream()
    .map(shard -> CompletableFuture.supplyAsync(
        () -> shard.query(sql, startDate, endDate), executor))
    .collect(toList());

List<Payment> allResults = futures.stream()
    .flatMap(f -> f.join().stream())
    .sorted(Comparator.comparing(Payment::getCreatedAt).reversed())
    .limit(100)
    .collect(toList());
```

For N shards, you retrieve `N × 100` rows and discard `(N-1) × 100`. At 64 shards, you're fetching 6,400 rows to return 100.

**2. Denormalized query tables in a separate unsharded database:**
For analytics and reporting queries, maintain a denormalized table in a single reporting database (or data warehouse) that aggregates across shards. ETL runs periodically (or via CDC) to populate it.

**3. Elasticsearch or ClickHouse as query layer:**
Index payment data into Elasticsearch or ClickHouse for flexible querying without shard boundaries. The source of truth stays in sharded PostgreSQL; the query engine handles aggregation.

## Transaction Management Across Shards

Distributed transactions across shards require either 2-Phase Commit (2PC) or Saga pattern. 2PC is slow and blocking; Saga is complex but resilient.

For a payment that debits `user_id=A` (Shard 12) and credits `user_id=B` (Shard 47), the Saga pattern:

```
Saga: Cross-Shard Payment Transfer

Step 1: Debit user A on Shard 12
        → Write debit record, set status=PENDING
        → Publish event: MoneyDebited(txn_id, user_A, amount)

Step 2: Credit user B on Shard 47 (on event receipt)
        → Write credit record
        → Publish event: MoneyCredited(txn_id, user_B, amount)

Step 3: Confirm debit on Shard 12 (on event receipt)
        → Set debit status=COMPLETED

Compensating transactions (on failure):
Step 2 fails → Publish event: CreditFailed(txn_id)
Step 1 compensation → Reverse debit on Shard 12, set status=REVERSED
```

The transaction coordinator is event-driven. Each step is locally atomic on its shard. The saga state machine tracks overall progress.

## Rebalancing Shards

When you add shards, data must be re-distributed. The naive approach (stop world, migrate, restart) is unacceptable at scale. Use live migration:

```
Zero-Downtime Rebalancing (Double-Write Pattern):

Phase 1: Add new shard. Start double-writing to old and new shard.
         Read from old shard only.

Phase 2: Backfill historical data from old shard to new shard.
         Verify row counts and checksums.

Phase 3: Switch reads to new shard. Continue double-writing.
         Verify reads are correct on new shard.

Phase 4: Stop writing to old shard. New shard is authoritative.

Phase 5: After validation window, decommission old shard data.
```

```
Architecture During Migration:

Application Server
        │
        ▼
┌───────────────────┐
│  Shard Router     │  (reads routing table from config store)
└───┬───────────────┘
    │
    ├──► Old Shard (reads + writes during phase 1-3)
    │
    └──► New Shard (writes only in phase 1, reads+writes in phase 3+)
```

## Failure Recovery Strategy

Each shard should be a primary-replica pair:

```
Shard 12 Architecture:
┌─────────────────────┐
│  Shard 12 Primary   │  RDS PostgreSQL, Multi-AZ
│  (us-east-1a)       │◄─── Writes
└──────────┬──────────┘
           │ Synchronous replication (< 5ms lag)
           ▼
┌─────────────────────┐
│  Shard 12 Replica   │
│  (us-east-1b)       │◄─── Reads (optional)
└─────────────────────┘
```

Shard failure handling: The shard router maintains a health map. When a shard's health check fails, the router returns a 503 for requests targeting that shard rather than routing to a degraded node. Partial service availability (63/64 shards healthy) is better than full outage.

## Monitoring Shard Health

```sql
-- Per-shard monitoring query (run on each shard):
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
    n_live_tup AS row_count,
    n_dead_tup AS dead_rows,
    last_autovacuum,
    last_autoanalyze
FROM pg_stat_user_tables
WHERE tablename = 'payments'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

Prometheus metrics to expose per shard:
- `db_shard_connections_active` — active connections
- `db_shard_query_latency_p99` — per-shard P99 query latency
- `db_shard_row_count` — total rows (detects uneven distribution)
- `db_shard_replication_lag_seconds` — replica lag
- `db_shard_disk_usage_bytes` — storage growth rate

Alert when any shard's P99 latency is 2× the median shard latency — early indicator of a hot shard.

## Real Fintech-Scale Example

A payment processor handling 100M registered users, 5M daily active, 2M payments per day (23 payments/second average, 200 peak):

**Schema design:**
```sql
-- 64 shards, keyed by user_id % 64
-- Each shard: ~1.5M users, ~31K payments/day

CREATE TABLE payments (
    payment_id      UUID DEFAULT gen_random_uuid(),
    user_id         BIGINT NOT NULL,
    merchant_id     BIGINT NOT NULL,
    amount          DECIMAL(19,4) NOT NULL,
    currency        CHAR(3) NOT NULL,
    payment_method  JSONB NOT NULL,
    status          VARCHAR(20) NOT NULL,
    failure_code    VARCHAR(50),
    idempotency_key VARCHAR(255) NOT NULL,
    metadata        JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, payment_id),
    UNIQUE (idempotency_key)
);

CREATE INDEX idx_payments_user_created ON payments (user_id, created_at DESC);
CREATE INDEX idx_payments_merchant ON payments (merchant_id, created_at DESC);
CREATE INDEX idx_payments_status ON payments (status) WHERE status IN ('pending', 'processing');
```

**Infrastructure:** 64 RDS PostgreSQL Multi-AZ instances (`db.r6g.xlarge`), plus 64 read replicas for reporting queries. A separate ClickHouse cluster for analytics.

**Shard router:** A thin Spring Boot service with routing table in Redis. Routing table maps `shard_id → jdbc_url`. Changing routing table in Redis propagates to all router instances within 5 seconds.

## Anti-Patterns

**Anti-pattern 1: Using a monotonically increasing integer as shard key.** New users always go to the latest shard. Use UUID or hash-based IDs.

**Anti-pattern 2: Sharding too early.** Sharding adds enormous operational complexity. Shard at 10M users, not 10K.

**Anti-pattern 3: Cross-shard foreign keys.** They don't exist in a sharded system. Denormalize aggressively; join at the application layer.

**Anti-pattern 4: Shard count that's not a power of 2.** Start with 16 or 32 shards. Re-sharding from 16 to 32 means each shard splits cleanly in two. Re-sharding from 15 to 30 requires moving data across almost every shard boundary.

**Anti-pattern 5: Global auto-increment IDs.** Auto-increment across shards requires a centralized sequence, which becomes a bottleneck. Use UUIDs or distributed ID generation (Snowflake-style).

Sharding is not a technology problem — it's a data modeling problem. The shard key shapes every query pattern, every operational procedure, and every failure mode for the life of the system. Get it right upfront.
