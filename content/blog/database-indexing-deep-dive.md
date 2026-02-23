---
title: "Database Indexing Deep Dive: B-Trees, Hash Indexes, and Query Planning"
description: "Master database indexing internals. Understand B-tree structure, hash indexes, composite indexes, covering indexes, and how query planners use them. Includes PostgreSQL EXPLAIN analysis."
date: "2025-03-09"
category: "Databases"
tags: ["postgresql", "indexing", "b-tree", "query optimization", "databases", "performance"]
featured: false
affiliateSection: "database-resources"
---

Indexes are the single most impactful optimization in database performance. A 10-second query becomes 20ms with the right index. A wrong index slows writes and misleads the query planner. Understanding the internals — not just "add an index on the WHERE column" — is what separates engineers who tune databases from those who keep adding hardware.

## How B-Tree Indexes Work

PostgreSQL's default index type is B-Tree (Balanced Tree). Every index lookup starts here.

Think of a B-Tree like a filing cabinet with a hierarchical sorting system. If you want to find a customer with ID `cust-123` in a 10-million-row table without an index, you have to flip through every single record. With a B-Tree, you start at the root, follow a branch left or right at each node based on the key value, and arrive at the exact record in roughly 24 steps — no matter how large the table grows. This is the difference between O(n) and O(log n).

```
Table: orders (10 million rows)
Column: customer_id (VARCHAR, not indexed)

Full table scan:
  SELECT * FROM orders WHERE customer_id = 'cust-123'
  → Read all 10M rows, discard 9,999,990
  → Cost: O(n) — terrible

With B-Tree index on customer_id:

B-Tree structure:
                    [cust-500]
                   /          \
          [cust-200]            [cust-800]
         /         \            /        \
  [cust-100]  [cust-300] [cust-600] [cust-900]
   /      \    /      \    ...
[cust-123] ...

Lookup: cust-123
  1. Root: cust-123 < cust-500 → go left
  2. Node: cust-123 < cust-200 → go left
  3. Node: cust-123 > cust-100 → go right
  4. Found: cust-123 → pointer to row location

Cost: O(log n) = ~24 comparisons for 10M rows
Result: 0.02ms vs 10 seconds
```

Each B-Tree leaf node stores:
- Index key value (customer_id)
- Pointer to heap page (the actual table row)
- Pointer to next/previous leaf node (for range scans)

The leaf-node linking is what makes range queries (`WHERE created_at BETWEEN x AND y`) efficient on B-Trees. Once you find the starting key, you just follow the linked list of leaf nodes forward — no need to traverse the tree again for each value.

## Index Scans vs Heap Fetches

Creating an index is only half the work. You also need to understand what happens after the index is used — specifically, the extra step of fetching the actual row data from the table heap. The `EXPLAIN ANALYZE` output below shows what this looks like in practice and hints at the opportunity for covering indexes.

```sql
-- Create table and index
CREATE TABLE orders (
    id          BIGSERIAL PRIMARY KEY,
    customer_id VARCHAR(36),
    status      VARCHAR(20),
    total_cents INTEGER,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_customer ON orders (customer_id);

-- Query 1: Point lookup — extremely efficient
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 'cust-123';

-- Output:
-- Index Scan using idx_orders_customer on orders
--   (cost=0.56..8.58 rows=5 width=80) (actual time=0.030..0.045 rows=5 loops=1)
--   Index Cond: (customer_id = 'cust-123')

-- Query 2: Range scan — also efficient
EXPLAIN ANALYZE SELECT * FROM orders
WHERE customer_id = 'cust-123' AND created_at > NOW() - INTERVAL '30 days';

-- The planner uses the index on customer_id, then filters by created_at
-- Better: composite index (customer_id, created_at)
```

## Composite Indexes: Order Matters

The column order in a composite index determines which queries benefit.

A composite index is like a phone book sorted by last name, then first name. You can efficiently look up everyone named "Smith" (leftmost column), or find "John Smith" specifically (both columns). But you cannot efficiently find everyone named "John" across all last names — there is no way to skip the first sort key. This is the leftmost prefix rule, and it governs every composite index you create.

```sql
-- Index: (customer_id, created_at)
CREATE INDEX idx_orders_customer_date ON orders (customer_id, created_at DESC);

-- This index CAN satisfy these queries (leftmost prefix rule):
-- 1. WHERE customer_id = ?                          ← uses full index
-- 2. WHERE customer_id = ? AND created_at > ?       ← uses full index
-- 3. WHERE customer_id = ? ORDER BY created_at DESC ← uses index order (no sort)

-- This index CANNOT satisfy:
-- 4. WHERE created_at > ?                           ← can't skip first column
-- 5. WHERE status = ?                               ← not in index

-- For query 4, you need a separate index: CREATE INDEX ON orders (created_at);

-- Rule: put equality conditions first, range conditions last
-- (a = ?, b = ?, c > ?)  →  INDEX(a, b, c)  ← correct
-- (c > ?, a = ?, b = ?)  →  INDEX(a, b, c)  ← correct index, wrong column order
```

Always place equality conditions before range conditions in a composite index. PostgreSQL can use equality conditions to narrow down a specific sub-tree of the B-Tree, then scan forward for the range — but only if the range column comes after the equality columns.

## Covering Indexes: Eliminate Heap Fetches

A covering index contains all columns the query needs — the index itself answers the query without touching the table.

Every time your query returns a column that is not in the index, PostgreSQL must jump from the index to the actual table heap to fetch that column. For a query returning 50,000 rows, that is 50,000 random disk reads. A covering index eliminates all of them by embedding the needed column values directly in the index leaf nodes using `INCLUDE`.

```sql
-- Query: get order IDs and totals for a customer (no need to fetch full row)
SELECT id, total_cents FROM orders WHERE customer_id = 'cust-123';

-- Without covering index:
--   1. Scan index → find matching row pointers
--   2. Fetch each row from heap (random I/O — expensive for many rows)

-- Covering index (INCLUDE adds columns to leaf nodes without affecting tree structure):
CREATE INDEX idx_orders_customer_covering
  ON orders (customer_id)
  INCLUDE (id, total_cents);

-- Now query can be answered from index only — "Index Only Scan"
EXPLAIN ANALYZE SELECT id, total_cents FROM orders WHERE customer_id = 'cust-123';
-- Index Only Scan using idx_orders_customer_covering on orders
--   Heap Fetches: 0  ← zero table reads!
```

`Heap Fetches: 0` is what you are aiming for with a covering index. The `INCLUDE` columns live only in the leaf nodes and are not part of the B-Tree sort key, so they do not increase index maintenance cost as much as adding them as regular index columns would.

## Partial Indexes: Index Only What You Query

```sql
-- Problem: 10M orders, but 99% are DELIVERED (rarely queried)
-- Full index on status wastes space and slows writes

-- Partial index: only index PENDING and PROCESSING orders
CREATE INDEX idx_orders_active_status
  ON orders (status, created_at)
  WHERE status IN ('PENDING', 'PROCESSING');

-- This index is tiny (~50K rows instead of 10M) and fast
-- Query:
SELECT * FROM orders WHERE status = 'PENDING' ORDER BY created_at;
-- Uses partial index — only scans the 50K active rows

-- Useful patterns:
-- WHERE deleted_at IS NULL    (soft-deleted records)
-- WHERE processed = false     (queue-like patterns)
-- WHERE status != 'COMPLETED' (active/pending states)
```

Partial indexes are one of the most underused PostgreSQL features. If you have a queue-like table where 99% of rows are in a terminal state (COMPLETED, DELIVERED, ARCHIVED) but your application only queries active rows, a full index on the status column is 99% waste. A partial index covering only the active states is smaller, faster to update, and more likely to fit in the OS page cache.

## Hash Indexes

Hash indexes are faster for equality lookups than B-Trees but support only `=` (no ranges, no ordering).

Think of a hash index as a lookup dictionary with direct addressing: given a key, compute a hash, jump directly to the bucket. This is O(1) rather than B-Tree's O(log n), making hash lookups faster for pure equality queries. The trade-off is that hash functions produce no ordering — so range queries, sorting, and prefix searches are impossible.

```sql
-- Create hash index
CREATE INDEX idx_orders_id_hash ON orders USING HASH (id);

-- Hash index uses: O(1) lookup for equality
-- B-Tree: O(log n)
-- Hash advantage: 20-40% faster for equality-only lookups

-- BUT: hash indexes don't support:
-- ORDER BY, BETWEEN, >, <, >=, <=
-- LIKE 'prefix%'
-- Multiple columns

-- Use hash indexes for: lookup tables, user ID lookups, session tokens
-- Use B-Tree indexes for: everything else
```

## Index Bloat and Maintenance

Over time, indexes accumulate dead weight. Every `UPDATE` or `DELETE` marks old index entries as dead rather than immediately removing them — PostgreSQL's MVCC model requires this so that older transactions can still use the stale entries. `VACUUM` reclaims this space automatically, but on very high-churn tables, bloat can accumulate faster than `autovacuum` clears it.

```sql
-- Check index size and bloat
SELECT
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE relname = 'orders'
ORDER BY pg_relation_size(indexrelid) DESC;

-- Find unused indexes (never scanned — wasting write overhead)
SELECT indexname, idx_scan
FROM pg_stat_user_indexes
WHERE relname = 'orders' AND idx_scan = 0;
-- These indexes are candidates for removal

-- Index bloat: happens after many updates/deletes
-- PostgreSQL marks old versions dead but doesn't immediately reclaim space
-- Fix: VACUUM ANALYZE (automatic) or REINDEX CONCURRENTLY (manual, online)

-- Reindex without locking (PostgreSQL 12+):
REINDEX INDEX CONCURRENTLY idx_orders_customer;
```

Any index with `idx_scan = 0` is a write tax with no corresponding read benefit. Drop it. Unused indexes are surprisingly common — they often accumulate from exploratory optimization attempts that were later superseded by a different index.

## Reading EXPLAIN ANALYZE Output

`EXPLAIN ANALYZE` is your most powerful tool for understanding what PostgreSQL actually does when it runs a query. The query below joins orders with customers and filters by status and date — a common pattern that exercises index selection, join strategy, and sort behavior all at once.

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT o.id, o.total_cents, c.name
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status = 'PENDING'
  AND o.created_at > NOW() - INTERVAL '7 days'
ORDER BY o.total_cents DESC
LIMIT 10;
```

```
Hash Join  (cost=1234.56..2345.67 rows=10 width=80)
           (actual time=45.234..89.123 rows=10 loops=1)
   Buffers: shared hit=1234 read=567  ← hit=cache, read=disk I/O
   ->  Limit  (cost=1000.00..1100.00 rows=10 width=60)
         (actual time=40.123..40.456 rows=10 loops=1)
       ->  Sort  (cost=1000.00..1050.00 rows=50 width=60)
                 (actual time=40.100..40.200 rows=10 loops=1)
             Sort Key: o.total_cents DESC
             Sort Method: top-N heapsort  Memory: 25kB
             ->  Index Scan using idx_orders_status_date on orders o
                           (cost=0.56..900.34 rows=50 width=60)
                           (actual time=0.100..35.234 rows=2847 loops=1)
                   Index Cond: (status = 'PENDING' AND created_at > ...)
   ->  Hash  (cost=100.00..100.00 rows=10000 width=40)
             (actual time=4.567..4.567 rows=10000 loops=1)
         ->  Seq Scan on customers c  ← WARNING: full table scan on customers
               (cost=0.00..100.00 rows=10000 width=40)
               (actual time=0.100..2.345 rows=10000 loops=1)

Planning Time: 2.345 ms
Execution Time: 89.456 ms
```

**Reading the output:**
- `cost=X..Y`: Estimated cost (X=first row, Y=all rows)
- `actual time=X..Y`: Real measured time in ms
- `rows=N`: Estimated vs actual rows (large difference = stale statistics)
- `Seq Scan`: Full table scan — usually needs an index
- `Buffers: read=567`: Disk reads — high count = slow query, consider caching
- `Sort Method: external merge`: Sorting spilled to disk — increase work_mem

In the output above, the `Seq Scan on customers` is the red flag — every query hitting this join is doing a full scan of the customers table. Adding an index on `customers.id` would likely eliminate it. Always look for `Seq Scan` on large tables as your first optimization target.

## Index Strategy for Common Patterns

Now that you understand the tools, here is how they combine for the most common query patterns you will encounter in production applications. Each pattern below pairs a real-world query type with the optimal index structure.

```sql
-- Pattern 1: User's recent orders (most common)
CREATE INDEX idx_orders_user_recent ON orders (customer_id, created_at DESC)
  WHERE status != 'CANCELLED';

-- Pattern 2: Admin dashboard — orders by status with pagination
CREATE INDEX idx_orders_status_created ON orders (status, created_at DESC);

-- Pattern 3: Slow full-text search on description
CREATE INDEX idx_products_search ON products USING GIN (
  to_tsvector('english', name || ' ' || description)
);

-- Query:
SELECT * FROM products
WHERE to_tsvector('english', name || ' ' || description) @@ plainto_tsquery('wireless headphones');

-- Pattern 4: JSON column queries
CREATE INDEX idx_events_metadata ON events USING GIN (metadata jsonb_path_ops);
-- Query: WHERE metadata @> '{"type": "PAYMENT_FAILED"}'

-- Pattern 5: UUID primary key — use BRIN for sequential UUIDs (v7)
-- UUIDv7 is monotonically increasing — use BRIN for 99% smaller index
CREATE INDEX idx_orders_id_brin ON orders USING BRIN (id)
  WHERE id::text ~ '^[0-9a-f]{8}-7';  -- Only UUIDv7 style
```

## The Index Decision Framework

```
Should I add this index?

1. Is this query in a hot path? (runs frequently or is user-facing)
   NO → probably not worth it

2. Does EXPLAIN show Seq Scan on a large table (>100K rows)?
   YES → strong signal for an index

3. What's the selectivity?
   HIGH selectivity (WHERE user_id = ?) → B-Tree index
   LOW selectivity (WHERE status = 'active', 90% rows) → partial index or no index

4. Is this a write-heavy table?
   YES → every index adds overhead to INSERT/UPDATE/DELETE
   Rule: never add an index without measuring write performance impact

5. Can a covering index eliminate heap fetches?
   YES, if query reads few columns → INCLUDE those columns

The right number of indexes for most tables: 2-5.
Every additional index costs write throughput. Choose carefully.
```

The discipline of database optimization is 90% indexing and 10% everything else. Before touching application code, schema, or hardware, run EXPLAIN ANALYZE on your slowest queries and check: Is the query planner using the right index? If not, why not? Missing index? Wrong column order? Stale statistics? Answer those questions first.
