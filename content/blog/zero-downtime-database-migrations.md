---
title: "Zero-Downtime Database Migrations: Patterns for Production"
description: "How to safely migrate production databases without downtime: expand-contract pattern, backward-compatible schema changes, rolling deployments with dual-write, column renaming strategies, and the PostgreSQL-specific techniques for large table alterations."
date: "2025-06-08"
category: "Databases"
tags: ["database", "migrations", "postgresql", "zero downtime", "devops", "schema evolution", "flyway", "liquibase"]
featured: false
affiliateSection: "database-resources"
---

Database migrations are the most dangerous part of a deployment. Application code changes are stateless and reversible — rollback a bad deploy and your code is back to the previous version. Database schema changes are stateful and often irreversible — a dropped column is gone, a renamed column leaves old code broken, an index added with a table lock takes your service down.

The root cause of downtime during migrations is running application code that makes assumptions about schema that don't yet hold (or no longer hold). The solution is a pattern called **expand-contract** combined with backward-compatible intermediate states.

## The Expand-Contract Pattern

Most schema changes can be decomposed into three phases that can each be deployed independently:

```
Phase 1: EXPAND — Add new schema alongside old (both versions of app work)
Phase 2: MIGRATE — Backfill data, transition traffic to new schema
Phase 3: CONTRACT — Remove old schema (only new app version exists)
```

This works because at any moment during a rolling deployment, some pods run the old code and some run the new code. Both must work against the same database. Backward-compatible intermediate states ensure both versions work simultaneously.

## Pattern 1: Renaming a Column

**The naive approach (causes downtime):**
```sql
-- This breaks old code immediately:
ALTER TABLE orders RENAME COLUMN customer_id TO user_id;
-- Old code writing to customer_id → column not found → 500 errors
```

**The expand-contract approach:**

**Phase 1: Expand — Add new column**
```sql
-- Migration (deploy with old application code still running):
ALTER TABLE orders ADD COLUMN user_id BIGINT;

-- Application code change (deploy after migration):
-- Write to BOTH old and new column
-- Read from old column (primary), fall back to new
INSERT INTO orders (customer_id, user_id, amount) VALUES (?, ?, ?);
SELECT COALESCE(user_id, customer_id) AS user_id FROM orders WHERE ...;
```

**Phase 2: Migrate — Backfill data**
```sql
-- Run in batches (don't lock the table):
UPDATE orders SET user_id = customer_id
WHERE user_id IS NULL
AND id BETWEEN ? AND ?;  -- Process in chunks of 10,000 rows

-- Repeat until no NULL user_id remain:
-- SELECT COUNT(*) FROM orders WHERE user_id IS NULL; → 0
```

**Phase 3: Contract — Remove old column**
```sql
-- Application code: read from new column only (deployed first)
-- Then drop old column:
ALTER TABLE orders DROP COLUMN customer_id;
```

Three separate deployments, zero downtime at each step. The intermediate state (both columns exist, both written) is ugly but safe.

## Pattern 2: Adding a NOT NULL Column

Adding a NOT NULL column with no default to an existing table fails immediately (existing rows don't satisfy the constraint). Even with a default, PostgreSQL pre-14 rewrites the entire table to set the default, causing a long lock.

**PostgreSQL 11+ approach:**
```sql
-- Step 1: Add nullable column (fast, no table rewrite):
ALTER TABLE orders ADD COLUMN shipping_address TEXT;

-- Step 2: Application starts writing to new column (deploy new code)

-- Step 3: Backfill existing rows:
UPDATE orders SET shipping_address = 'Unknown' WHERE shipping_address IS NULL;
-- (Run in batches: WHERE id BETWEEN ? AND ?)

-- Step 4: Add NOT NULL constraint (PostgreSQL validates, fast if all rows are set):
ALTER TABLE orders ALTER COLUMN shipping_address SET NOT NULL;
-- Or use a CHECK constraint validated later:
ALTER TABLE orders ADD CONSTRAINT shipping_address_not_null
    CHECK (shipping_address IS NOT NULL) NOT VALID;
-- Then validate in background (doesn't lock writes):
ALTER TABLE orders VALIDATE CONSTRAINT shipping_address_not_null;
-- Then convert to NOT NULL:
ALTER TABLE orders ALTER COLUMN shipping_address SET NOT NULL;
ALTER TABLE orders DROP CONSTRAINT shipping_address_not_null;
```

`NOT VALID` constraint + `VALIDATE CONSTRAINT` is the PostgreSQL pattern for adding constraints on large tables without locking. The `NOT VALID` constraint applies only to new rows (immediate). `VALIDATE` scans old rows using a weaker lock (ShareUpdateExclusiveLock) that allows reads and writes to continue.

## Pattern 3: Index Creation Without Locking

Standard `CREATE INDEX` acquires a lock that blocks all writes until the index is built. On a large table (100M rows), this can take minutes.

**PostgreSQL:**
```sql
-- WRONG: Blocks writes for duration of build (potentially hours):
CREATE INDEX ON orders (customer_id);

-- RIGHT: Concurrent build — reads and writes continue, 2× longer build time:
CREATE INDEX CONCURRENTLY ON orders (customer_id);

-- If CONCURRENTLY fails (crash, etc.), it leaves an INVALID index:
SELECT schemaname, tablename, indexname, indisvalid
FROM pg_indexes
WHERE indisvalid = false;
-- → Drop the invalid index and retry

DROP INDEX CONCURRENTLY orders_customer_id_idx;
```

`CREATE INDEX CONCURRENTLY` takes about 2-3× longer than regular index creation but never blocks reads or writes. Always use it in production.

**Adding a unique constraint concurrently:**
```sql
-- Unique constraint directly → table lock
-- Instead: create unique index first, then add constraint using the index
CREATE UNIQUE INDEX CONCURRENTLY orders_external_id_unique ON orders (external_id);

-- Then create constraint using the pre-built index (fast):
ALTER TABLE orders ADD CONSTRAINT orders_external_id_unique
    UNIQUE USING INDEX orders_external_id_unique;
```

## Pattern 4: Large Table Alterations

Some alterations trigger full table rewrites — `ALTER COLUMN TYPE`, adding a column with a volatile default, enabling encryption. In PostgreSQL, these block all reads and writes for the duration.

**Strategy: Shadow table swap**

```sql
-- Create new table with desired schema:
CREATE TABLE orders_new (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,         -- new: renamed from customer_id
    amount NUMERIC(10,2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',  -- new: added column
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Copy data in batches (reads from old, writes to new):
INSERT INTO orders_new (id, user_id, amount, created_at)
SELECT id, customer_id, amount, created_at
FROM orders
WHERE id BETWEEN ? AND ?;

-- Once backfill is complete, swap tables atomically:
BEGIN;
  LOCK TABLE orders IN ACCESS EXCLUSIVE MODE;  -- Brief lock — just for rename
  ALTER TABLE orders RENAME TO orders_old;
  ALTER TABLE orders_new RENAME TO orders;
  -- Update sequences, foreign keys, etc.
COMMIT;

-- Dual-write during backfill period:
-- Application writes to both orders (old) and orders_new simultaneously
-- After swap, drops orders_old
```

This pattern is what tools like pt-online-schema-change (Percona Toolkit) and gh-ost (GitHub) automate for MySQL. For PostgreSQL, pglogical-based migration tools do the same.

## Managing Migrations with Flyway/Liquibase

**Flyway versioned migration structure:**
```
db/migration/
  V1__create_orders_table.sql
  V2__add_customer_id_index.sql
  V3__add_user_id_column.sql          ← expand
  V4__backfill_user_id.sql            ← migrate (run separately or in batches)
  V5__add_user_id_not_null.sql        ← contract step 1
  V6__drop_customer_id_column.sql     ← contract step 2
```

**Critical Flyway rules for zero-downtime:**

1. **Never modify a migration after it's been applied** — Flyway checksums every migration; modification causes startup failure. Create a new migration instead.

2. **Separate schema migrations from data migrations** — Schema migrations (V3) run at deploy time. Data migrations (V4 — backfill) should run as background jobs, not blocking app startup.

3. **Idempotency for repeatable migrations** — Flyway's R__ prefix for repeatable migrations (views, stored procedures) runs them on every change. Schema migrations (V__) run once.

```java
// Spring Boot Flyway config:
@Configuration
public class FlywayConfig {

    @Bean
    public FlywayMigrationStrategy flywayMigrationStrategy() {
        return flyway -> {
            // Run baseline repair if needed
            flyway.repair();
            flyway.migrate();
        };
    }
}

// application.properties:
spring.flyway.locations=classpath:db/migration
spring.flyway.baseline-on-migrate=true
spring.flyway.out-of-order=false  // Enforce sequential migration order
spring.flyway.validate-on-migrate=true
```

**Liquibase for multi-database compatibility:**
```yaml
# liquibase/changelog/0003-add-user-id.yaml
databaseChangeLog:
  - changeSet:
      id: "0003-add-user-id-column"
      author: "engineering"
      runOnChange: false
      failOnError: true
      changes:
        - addColumn:
            tableName: orders
            columns:
              - column:
                  name: user_id
                  type: BIGINT
                  constraints:
                    nullable: true  # Start nullable — NOT NULL added later
      rollback:
        - dropColumn:
            tableName: orders
            columnName: user_id
```

## Rolling Deployments: The Application Side

During a rolling deployment, both old and new pod versions run simultaneously against the same database. Write application code to tolerate this:

```java
// Old code: reads customer_id
// New code: reads user_id (with fallback during transition)

// Repository method during Phase 1 (both columns exist, old code still deployed):
public Long getUserId(Order order) {
    // New code reads new column, falls back to old if null
    return order.getUserId() != null ? order.getUserId() : order.getCustomerId();
}

// Writes to both during transition:
@Transactional
public Order createOrder(OrderRequest request) {
    Order order = new Order();
    order.setUserId(request.getUserId());      // New column
    order.setCustomerId(request.getUserId());  // Old column (backward compat)
    order.setAmount(request.getAmount());
    return orderRepository.save(order);
}
```

This dual-write period is the most fragile moment. Keep it short — ideally one deployment cycle (hours, not days). Remove the backward-compatible code in the next deployment.

## Testing Migrations

Never run migrations only in production. Test them in staging with production-scale data:

```bash
# Clone production data (anonymized) to staging:
pg_dump --no-acl --no-owner production_db | psql staging_db

# Run migration and time it:
time psql staging_db -f V5__add_user_id_not_null.sql

# Check for locks during migration:
psql staging_db -c "
SELECT pid, wait_event_type, wait_event, state, query
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY duration DESC;"

# Verify no table rewrites (should show no sequential scans on large tables):
psql staging_db -c "EXPLAIN ANALYZE <your migration SQL>;"
```

**The pre-flight checklist:**
- Is this migration backward-compatible? (Can old app code run with the new schema?)
- Will it acquire a lock? For how long? (Check PostgreSQL lock documentation for each `ALTER TABLE` variant)
- Can it be made concurrent? (`CREATE INDEX CONCURRENTLY`, `ADD CONSTRAINT ... NOT VALID`)
- Is there a rollback path? (For each phase of expand-contract)
- Has it been tested on production-scale data?

Database migrations are the rare operations where going slow saves time. A 5-minute outage for a botched migration is worth a week's worth of careful planning. The expand-contract pattern is more work than a single ALTER statement, but it's the difference between a boring deploy and an incident postmortem.
