---
title: "PostgreSQL Performance Tuning: From Slow Queries to Sub-Millisecond Reads"
description: "A production guide to PostgreSQL query optimization: EXPLAIN ANALYZE, index design, VACUUM tuning, connection pooling with PgBouncer, partitioning, and the configuration changes that actually move the needle."
date: "2025-06-03"
category: "Databases"
tags: ["postgresql", "databases", "performance", "sql", "indexing", "query optimization"]
featured: false
affiliateSection: "database-resources"
---

PostgreSQL ships with defaults tuned for a 512MB machine from 2005. Every production deployment needs to be re-tuned. Beyond that, most slow queries are not a PostgreSQL problem — they're a query design problem that PostgreSQL surfaces. This article covers both: the query patterns that create avoidable load, and the server configuration that extracts maximum performance from your hardware.

## Reading EXPLAIN ANALYZE Like a Senior DBA

Every performance investigation starts here:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT u.id, u.name, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.status = 'active'
  AND u.created_at > '2024-01-01'
GROUP BY u.id, u.name
ORDER BY order_count DESC
LIMIT 100;
```

Key output fields to read:

```
Hash Left Join  (cost=12500.00..89432.00 rows=100 width=40)
                (actual time=1823.421..4231.005 rows=100 loops=1)
  Buffers: shared hit=2841 read=31823
  ->  Seq Scan on users  (cost=0.00..42000.00 rows=500000 width=32)
                         (actual time=0.023..1203.000 rows=500000 loops=1)
        Filter: ((status = 'active') AND (created_at > '2024-01-01'))
        Rows Removed by Filter: 250000
  ->  Hash  (cost=8000.00..8000.00 rows=2000000 width=16) (...)
        Buckets: 131072  Batches: 16  Memory Usage: 4096kB
```

**What to look for:**
- `Seq Scan` on large tables: missing index
- `actual time` much higher than `cost`: stale statistics — run `ANALYZE`
- `Buffers: read=31823`: reading 31K pages from disk (cache miss) — memory too small or missing index
- `Rows Removed by Filter: 250000`: filter applied post-scan — index on filter column needed
- `Batches: 16` on Hash: hash join spilled to disk — increase `work_mem`

## Index Design That Actually Helps

### Composite Indexes: Column Order Matters

```sql
-- Query:
SELECT * FROM orders
WHERE user_id = 123 AND status = 'pending' AND created_at > NOW() - INTERVAL '7 days';

-- WRONG: index can only use leftmost prefix
CREATE INDEX idx_orders_status_user ON orders (status, user_id);
-- Query has high-cardinality filter (user_id) after low-cardinality (status) — bad

-- RIGHT: highest cardinality first, then equality, then range
CREATE INDEX idx_orders_user_status_created ON orders (user_id, status, created_at DESC);
-- user_id equality → status equality → created_at range: all 3 columns used
```

**Rule:** Equality columns before range columns. High-cardinality before low-cardinality within equality columns.

### Partial Indexes for Selective Queries

```sql
-- Only index active users (90% of queries)
CREATE INDEX idx_users_active_created
ON users (created_at DESC)
WHERE status = 'active';

-- Only index unprocessed orders
CREATE INDEX idx_orders_pending
ON orders (created_at, user_id)
WHERE status = 'pending';
-- If 5% of orders are pending, this index is 20× smaller — faster scans, better cache utilization
```

### Index-Only Scans with INCLUDE

```sql
-- Query needs id + email + name, but WHERE is on email
CREATE INDEX idx_users_email ON users (email);
-- Requires heap fetch to get id and name → not index-only

-- Include the extra columns:
CREATE INDEX idx_users_email_include ON users (email) INCLUDE (id, name);
-- Query satisfied entirely from index — no heap access
-- Check with EXPLAIN: "Index Only Scan" instead of "Index Scan"
```

## Fixing N+1 Queries

The most common performance killer in ORMs:

```sql
-- N+1: 1 query for users + N queries for orders
SELECT * FROM users WHERE status = 'active';
-- Then for each user:
SELECT * FROM orders WHERE user_id = $1;

-- Fix: JOIN or subquery
SELECT
    u.id,
    u.name,
    COALESCE(
        JSON_AGG(
            JSON_BUILD_OBJECT('id', o.id, 'total', o.total)
            ORDER BY o.created_at DESC
        ) FILTER (WHERE o.id IS NOT NULL),
        '[]'
    ) AS recent_orders
FROM users u
LEFT JOIN LATERAL (
    SELECT id, total, created_at
    FROM orders
    WHERE user_id = u.id
    ORDER BY created_at DESC
    LIMIT 5
) o ON true
WHERE u.status = 'active'
GROUP BY u.id, u.name;
```

`LATERAL JOIN` is PostgreSQL's correlated subquery that's evaluated per-row but uses indexes on the subquery table — perfect for "top N per group" patterns.

## VACUUM and AUTOVACUUM Tuning

PostgreSQL uses MVCC — old row versions accumulate as "dead tuples." VACUUM reclaims them. Without proper VACUUM, tables bloat and queries slow down.

Default autovacuum triggers when 20% of a table is dead tuples (`autovacuum_vacuum_scale_factor = 0.2`). For a 10M row table, that's 2M dead rows before vacuum runs — too late.

```sql
-- Per-table autovacuum tuning for high-update tables:
ALTER TABLE orders SET (
    autovacuum_vacuum_scale_factor = 0.01,   -- Vacuum at 1% dead tuples (not 20%)
    autovacuum_vacuum_threshold = 100,        -- Minimum 100 dead tuples
    autovacuum_analyze_scale_factor = 0.005, -- Analyze at 0.5%
    autovacuum_vacuum_cost_delay = 2          -- Less throttling for busy tables
);

-- Monitor table bloat:
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    n_dead_tup,
    n_live_tup,
    round(n_dead_tup::numeric / nullif(n_live_tup + n_dead_tup, 0) * 100, 2) AS dead_pct,
    last_autovacuum
FROM pg_stat_user_tables
WHERE n_dead_tup > 10000
ORDER BY dead_pct DESC;
```

## Connection Pooling with PgBouncer

PostgreSQL creates a new OS process per connection (~5MB RAM each). At 500 connections: 2.5GB of RAM just for connection overhead. PgBouncer pools many client connections into a small number of server connections:

```ini
# pgbouncer.ini
[databases]
mydb = host=localhost port=5432 dbname=mydb

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/users.txt

# Transaction pooling: release server connection on COMMIT/ROLLBACK
# Most aggressive pooling — incompatible with prepared statements
pool_mode = transaction

default_pool_size = 20       # Server connections per database/user pair
max_client_conn = 1000       # Max client connections PgBouncer accepts
reserve_pool_size = 5        # Emergency connections
reserve_pool_timeout = 3
server_idle_timeout = 600    # Close idle server connections after 10 min
```

With PgBouncer in transaction mode: 1,000 app threads → 20 actual PostgreSQL connections. PostgreSQL max_connections can be set to 50 instead of 1,000.

**Caveat:** Transaction pooling breaks SET LOCAL, LISTEN/NOTIFY, advisory locks, and session-level prepared statements. Use session pooling if your app uses these.

## Partitioning for Large Tables

Table partitioning keeps query plans efficient by allowing PostgreSQL to skip entire partitions:

```sql
-- Range partitioning by month for time-series data
CREATE TABLE events (
    id          BIGSERIAL,
    user_id     BIGINT NOT NULL,
    event_type  TEXT NOT NULL,
    data        JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

CREATE TABLE events_2025_01 PARTITION OF events
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE events_2025_02 PARTITION OF events
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
-- ... automate with pg_partman extension

-- Query with partition key in WHERE → partition pruning:
SELECT * FROM events
WHERE created_at BETWEEN '2025-01-01' AND '2025-01-31'
  AND user_id = 12345;
-- Scans only events_2025_01, not all partitions
```

**Partition maintenance:** Use `pg_partman` to auto-create future partitions and drop old ones. Dropping an old partition is instant (DROP TABLE) — much faster than DELETE.

## Key postgresql.conf Changes

```ini
# Memory (for a 16GB server):
shared_buffers = 4GB              # 25% of RAM — PostgreSQL's buffer pool
effective_cache_size = 12GB       # Tells query planner how much OS cache exists
work_mem = 64MB                   # Per sort/hash operation (set conservatively — multiplies)
maintenance_work_mem = 1GB        # For VACUUM, CREATE INDEX

# WAL and checkpoints:
wal_buffers = 64MB
checkpoint_completion_target = 0.9    # Spread checkpoint writes over 90% of interval
max_wal_size = 4GB                    # Allow larger WAL before forced checkpoint

# Query planner:
random_page_cost = 1.1               # SSD: set close to seq_page_cost (1.0)
                                     # HDD: default 4.0 is appropriate
effective_io_concurrency = 200       # SSD: set to 200; HDD: 2
parallel_workers_per_gather = 4      # Enable parallel query execution
max_parallel_workers_per_gather = 4

# Logging slow queries:
log_min_duration_statement = 1000    # Log queries > 1 second
log_checkpoints = on                 # Log checkpoint activity
log_autovacuum_min_duration = 250    # Log autovacuum runs > 250ms
```

`work_mem` is the most dangerous setting. Each sort/hash operation uses up to `work_mem`. A query with 5 hash joins, run by 50 concurrent connections with 4 parallel workers = `50 × 5 × 4 × 64MB = 64GB`. Set it in session for analytical queries, not globally.

## Statistics and Query Plans

PostgreSQL's query planner uses table statistics (row counts, value distributions) to choose plans. Stale statistics cause bad plans:

```sql
-- Update statistics for a specific table:
ANALYZE orders;

-- Increase statistics target for columns with skewed distributions:
ALTER TABLE orders ALTER COLUMN status SET STATISTICS 500;
-- Default is 100 — more samples for better cardinality estimates
ANALYZE orders;

-- Check when statistics were last updated:
SELECT tablename, last_analyze, last_autoanalyze
FROM pg_stat_user_tables
WHERE tablename = 'orders';

-- Force a specific plan for debugging (never in production permanently):
SET enable_seqscan = off;  -- Force index usage
EXPLAIN ANALYZE SELECT ...;
SET enable_seqscan = on;
```

## Production Monitoring Queries

```sql
-- Top 10 slowest queries (requires pg_stat_statements extension):
SELECT
    query,
    calls,
    round(total_exec_time::numeric / calls, 2) AS avg_ms,
    round(total_exec_time::numeric, 2) AS total_ms,
    rows / calls AS avg_rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;

-- Indexes never used (candidates for removal):
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
    idx_scan AS times_used
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexname NOT LIKE '%pkey%'  -- Keep primary keys
ORDER BY pg_relation_size(indexrelid) DESC;

-- Active locks (detect blocking queries):
SELECT
    pid,
    now() - pg_stat_activity.query_start AS duration,
    query,
    state
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes'
ORDER BY duration DESC;
```

## Real Production Case: 15-Second Query to 80ms

**Starting point:** E-commerce platform, orders table with 50M rows, query for customer order history timing out at 15 seconds.

```sql
-- Original query:
SELECT o.*, oi.*, p.name as product_name
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id
WHERE o.customer_id = 12345
ORDER BY o.created_at DESC
LIMIT 20;

-- EXPLAIN showed:
-- Seq Scan on orders (rows=50000000, actual rows=847, time=12000ms)
```

**Diagnosis:** Sequential scan on orders table — no index on `customer_id`.

**Fix 1:** Composite index:
```sql
CREATE INDEX CONCURRENTLY idx_orders_customer_created
ON orders (customer_id, created_at DESC);
```
Result: 15s → 400ms. Good progress.

**Fix 2:** EXPLAIN still showed `Buffers: read=12000` — reading 12K pages for the joins. Added covering index for order_items:
```sql
CREATE INDEX CONCURRENTLY idx_order_items_order_product
ON order_items (order_id) INCLUDE (product_id, quantity, unit_price);
```
Result: 400ms → 80ms.

**Fix 3:** pg_stat_statements showed this query running 50,000 times/day. Added application-level Redis cache with 5-minute TTL for customer order history. Database load reduced by 90%.

The lesson: indexing solves the query, caching solves the system.
