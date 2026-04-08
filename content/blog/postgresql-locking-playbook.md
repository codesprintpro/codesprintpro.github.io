---
title: "PostgreSQL Locking Playbook: Deadlocks, Blocking Queries, and Timeouts"
description: "A practical PostgreSQL locking guide for production incidents: how to find blocking queries, understand lock modes, debug deadlocks, use lock_timeout and statement_timeout, avoid idle-in-transaction sessions, and design safer migrations."
date: "2026-04-08"
category: "Databases"
tags: ["postgresql", "locking", "deadlocks", "database", "performance", "production debugging", "sql"]
featured: false
affiliateSection: "database-books"
---

PostgreSQL locking problems rarely announce themselves clearly. The application sees slow requests, connection pool exhaustion, or timeouts. The database might show normal CPU. The real problem is often one transaction waiting behind another transaction that forgot to commit, ran a slow migration, or updated rows in a different order.

This playbook is for production debugging. It shows how to find blockers, understand common lock modes, respond safely during an incident, and prevent the same problem from coming back.

PostgreSQL's official locking docs explain that table lock modes differ by which other modes they conflict with, and that `pg_locks` shows outstanding locks. They also note an important operational rule: a plain `SELECT` is blocked only by `ACCESS EXCLUSIVE` table locks. The details matter when you are trying to decide whether a migration or transaction is safe: [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html).

## The Fast Triage Query

When the app is stuck, start with blockers and waiters:

```sql
SELECT
  blocked.pid AS blocked_pid,
  blocked.usename AS blocked_user,
  blocked.application_name AS blocked_app,
  blocked.client_addr AS blocked_client,
  blocked.query AS blocked_query,
  now() - blocked.query_start AS blocked_duration,
  blocking.pid AS blocking_pid,
  blocking.usename AS blocking_user,
  blocking.application_name AS blocking_app,
  blocking.client_addr AS blocking_client,
  blocking.query AS blocking_query,
  now() - blocking.query_start AS blocking_duration,
  now() - blocking.xact_start AS blocking_transaction_age
FROM pg_stat_activity blocked
JOIN pg_locks blocked_locks
  ON blocked_locks.pid = blocked.pid
JOIN pg_locks blocking_locks
  ON blocking_locks.locktype = blocked_locks.locktype
 AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
 AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
 AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
 AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
 AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
 AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
 AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
 AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
 AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
 AND blocking_locks.pid <> blocked_locks.pid
JOIN pg_stat_activity blocking
  ON blocking.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted
  AND blocking_locks.granted
ORDER BY blocking_transaction_age DESC NULLS LAST;
```

This gives you:

- who is blocked
- who is blocking
- how long the blocker transaction has been open
- the query text for both sides
- application names and client addresses

During an incident, you usually care more about the blocker than the blocked query. Killing 200 waiters does not help if the single blocker remains open.

## Simpler Blocking Query

PostgreSQL also has `pg_blocking_pids`, which makes the query easier to read:

```sql
SELECT
  blocked.pid AS blocked_pid,
  blocked.query AS blocked_query,
  now() - blocked.query_start AS blocked_duration,
  blocking.pid AS blocking_pid,
  blocking.query AS blocking_query,
  now() - blocking.xact_start AS blocking_transaction_age
FROM pg_stat_activity blocked
JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS blocker_pid ON true
JOIN pg_stat_activity blocking ON blocking.pid = blocker_pid
ORDER BY blocking_transaction_age DESC NULLS LAST;
```

Use the simpler query first if your PostgreSQL version supports it. Keep the full `pg_locks` join around when you need lock type details.

## Find Idle Transactions

The most suspicious state in a lock incident is `idle in transaction`.

```sql
SELECT
  pid,
  usename,
  application_name,
  client_addr,
  state,
  now() - xact_start AS transaction_age,
  now() - state_change AS idle_age,
  query
FROM pg_stat_activity
WHERE state = 'idle in transaction'
ORDER BY xact_start ASC;
```

An idle transaction may still hold locks. Common causes:

- application opened a transaction and waited on network I/O
- connection was returned to the pool without commit or rollback
- ORM session scope is too broad
- migration tool paused inside a transaction
- admin opened `BEGIN` in a SQL console and forgot to close it

If the idle transaction is blocking production traffic, it is often safer to terminate that backend than to wait.

```sql
SELECT pg_terminate_backend(:pid);
```

Do not run this blindly. Check the query, application name, client address, transaction age, and business impact first. Terminating a backend rolls back its transaction.

## Lock Modes You Need To Know

For daily production work, you do not need to memorize every lock conflict. You do need to know the dangerous ones.

| Lock Mode | Common Source | Why It Matters |
|---|---|---|
| `ACCESS SHARE` | plain `SELECT` | Usually harmless; conflicts only with `ACCESS EXCLUSIVE` |
| `ROW EXCLUSIVE` | `INSERT`, `UPDATE`, `DELETE`, `MERGE` | Normal writes; conflicts with stronger table locks |
| `SHARE UPDATE EXCLUSIVE` | `VACUUM`, `ANALYZE`, `CREATE INDEX CONCURRENTLY` | Protects against schema changes and some maintenance conflicts |
| `SHARE` | `CREATE INDEX` without `CONCURRENTLY` | Blocks writes |
| `ACCESS EXCLUSIVE` | `DROP`, `TRUNCATE`, many `ALTER TABLE` forms | Blocks reads and writes |

The big warning: `ACCESS EXCLUSIVE` blocks plain reads. A migration that grabs it on a hot table can make the whole application look down even though the database is technically alive.

## Find Locks On A Specific Table

When you know the table:

```sql
SELECT
  l.pid,
  a.usename,
  a.application_name,
  a.state,
  l.locktype,
  l.mode,
  l.granted,
  now() - a.query_start AS query_age,
  now() - a.xact_start AS transaction_age,
  a.query
FROM pg_locks l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.relation = 'public.orders'::regclass
ORDER BY l.granted, transaction_age DESC NULLS LAST;
```

Look for:

- ungranted locks with many waiters
- granted `ACCESS EXCLUSIVE` locks
- old transaction age
- application names that point to migrations or batch jobs

## Deadlocks

A deadlock happens when two transactions wait on each other:

```text
Transaction A:
  UPDATE accounts SET balance = balance - 100 WHERE id = 1;
  UPDATE accounts SET balance = balance + 100 WHERE id = 2;

Transaction B:
  UPDATE accounts SET balance = balance - 50 WHERE id = 2;
  UPDATE accounts SET balance = balance + 50 WHERE id = 1;
```

Transaction A locks account 1 and waits for account 2. Transaction B locks account 2 and waits for account 1. PostgreSQL detects the deadlock and aborts one transaction.

Prevention:

- update rows in a consistent order
- keep transactions short
- avoid user/network calls inside transactions
- use retries for deadlock victims
- lock parent rows before child rows consistently

Example consistent ordering:

```java
@Transactional
public void transfer(UUID fromAccountId, UUID toAccountId, BigDecimal amount) {
    List<UUID> orderedIds = Stream.of(fromAccountId, toAccountId)
        .sorted()
        .toList();

    Account first = accountRepository.lockById(orderedIds.get(0));
    Account second = accountRepository.lockById(orderedIds.get(1));

    Account from = first.getId().equals(fromAccountId) ? first : second;
    Account to = first.getId().equals(toAccountId) ? first : second;

    from.debit(amount);
    to.credit(amount);
}
```

Repository query:

```sql
SELECT *
FROM accounts
WHERE id = :id
FOR UPDATE;
```

The order matters more than the syntax. Every code path touching the same rows must follow the same order.

## Lock Timeout And Statement Timeout

Set timeouts so requests fail instead of waiting forever.

For a migration:

```sql
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE orders ADD COLUMN fraud_score NUMERIC;
```

For an application transaction:

```sql
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
```

Difference:

- `lock_timeout` limits how long a statement waits to acquire a lock
- `statement_timeout` limits total execution time of a statement
- `idle_in_transaction_session_timeout` kills sessions that sit idle inside a transaction

Use `lock_timeout` for migrations. If the table is too busy, fail fast and retry later rather than taking production down.

## Safer Migrations

Bad migration:

```sql
ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING';
```

Depending on PostgreSQL version and table shape, this can take stronger locks or rewrite more data than you expect. A safer pattern is to split the rollout:

```sql
-- Step 1: add nullable column
SET lock_timeout = '5s';
ALTER TABLE orders ADD COLUMN status TEXT;

-- Step 2: backfill in batches outside peak traffic
UPDATE orders
SET status = 'PENDING'
WHERE status IS NULL
  AND id IN (
    SELECT id FROM orders
    WHERE status IS NULL
    ORDER BY id
    LIMIT 1000
  );

-- Step 3: add constraint after backfill
ALTER TABLE orders
  ADD CONSTRAINT orders_status_not_null CHECK (status IS NOT NULL) NOT VALID;

-- Step 4: validate separately
ALTER TABLE orders VALIDATE CONSTRAINT orders_status_not_null;
```

General migration rules:

- set `lock_timeout`
- use `CREATE INDEX CONCURRENTLY` for large hot tables
- split schema change from backfill
- backfill in small batches
- avoid long transactions
- validate constraints separately when possible
- run migrations during lower traffic windows
- test on production-sized data

## Avoid Long Transactions

This is dangerous:

```java
@Transactional
public void processOrder(String orderId) {
    Order order = orderRepository.findByIdForUpdate(orderId);

    PaymentResponse response = paymentClient.charge(order); // network call inside transaction

    order.markPaid(response.getPaymentId());
    orderRepository.save(order);
}
```

The transaction holds locks while waiting on a payment provider. Move external I/O outside the lock when possible:

```java
public void processOrder(String orderId) {
    OrderSnapshot snapshot = orderService.prepareForPayment(orderId);
    PaymentResponse response = paymentClient.charge(snapshot);
    orderService.markPaid(orderId, response.getPaymentId());
}

@Transactional
public OrderSnapshot prepareForPayment(String orderId) {
    Order order = orderRepository.findByIdForUpdate(orderId);
    order.markPaymentInProgress();
    return OrderSnapshot.from(order);
}

@Transactional
public void markPaid(String orderId, String paymentId) {
    Order order = orderRepository.findByIdForUpdate(orderId);
    order.markPaid(paymentId);
}
```

This still needs idempotency and failure handling, but it avoids holding row locks during a slow network call.

## SKIP LOCKED For Work Queues

For worker queues in PostgreSQL, use `FOR UPDATE SKIP LOCKED`:

```sql
WITH next_jobs AS (
  SELECT id
  FROM jobs
  WHERE status = 'PENDING'
    AND run_at <= now()
  ORDER BY run_at, id
  LIMIT 100
  FOR UPDATE SKIP LOCKED
)
UPDATE jobs
SET status = 'RUNNING',
    locked_at = now(),
    locked_by = :worker_id
WHERE id IN (SELECT id FROM next_jobs)
RETURNING *;
```

This lets multiple workers claim jobs without blocking each other on rows already locked by another worker.

Watch out:

- stuck `RUNNING` jobs need timeout recovery
- `SKIP LOCKED` can starve rows if workers keep skipping the same locked rows
- you still need indexes on `status` and `run_at`
- workers must update jobs in short transactions

## Advisory Locks

Advisory locks are useful when the lock target is not a single row.

Example: only one worker should rebuild a tenant search index:

```sql
SELECT pg_try_advisory_lock(hashtext(:tenant_id || ':search-rebuild'));
```

If it returns false, another worker has the lock.

Release explicitly:

```sql
SELECT pg_advisory_unlock(hashtext(:tenant_id || ':search-rebuild'));
```

Use transaction-scoped advisory locks when possible:

```sql
SELECT pg_try_advisory_xact_lock(hashtext(:tenant_id || ':billing-close'));
```

Transaction-scoped locks release automatically at commit or rollback, which is safer than relying on application code to unlock.

## What To Do During An Incident

1. Run the blocker query.
2. Identify the root blocker, not just the waiters.
3. Check transaction age and query text.
4. Identify whether it is application traffic, migration, batch job, or admin session.
5. If safe, cancel the query first:

```sql
SELECT pg_cancel_backend(:pid);
```

6. If it stays open and is still blocking production, terminate the backend:

```sql
SELECT pg_terminate_backend(:pid);
```

7. Pause the migration or batch job that caused it.
8. Watch connection pool usage recover.
9. Save the blocker query and timeline for the postmortem.

Cancel asks the backend to abort the current query. Terminate kills the session and rolls back the transaction. Prefer cancel first when the transaction is not idle and the query may respond.

## Metrics And Alerts

Track:

- lock wait time
- number of blocked sessions
- oldest transaction age
- oldest idle-in-transaction age
- deadlock count
- statement timeout count
- connection pool wait time
- migration duration

Useful alerts:

```yaml
alerts:
  - name: postgres_blocked_sessions_high
    condition: blocked_sessions > 20 for 5m
    action: run blocker query and identify root blocker

  - name: postgres_idle_transaction_old
    condition: oldest_idle_in_transaction_age > 5m
    action: inspect application/session and terminate if blocking production

  - name: postgres_deadlocks_detected
    condition: deadlocks increase over 10m
    action: inspect app logs for aborted transaction and fix lock ordering

  - name: postgres_old_transaction
    condition: oldest_transaction_age > 30m
    action: inspect vacuum impact and blocking locks
```

A database with no CPU pressure can still be effectively down if all application threads are waiting for locks.

## Production Checklist

- Keep transactions short.
- Never do network I/O inside a row-locking transaction unless unavoidable.
- Set `lock_timeout` for migrations.
- Set reasonable `statement_timeout` for app sessions.
- Use `idle_in_transaction_session_timeout`.
- Use `CREATE INDEX CONCURRENTLY` on hot large tables.
- Split schema changes from backfills.
- Backfill in small batches.
- Update related rows in a consistent order.
- Retry deadlock victims safely.
- Use `FOR UPDATE SKIP LOCKED` for worker queues.
- Use transaction-scoped advisory locks for logical mutexes.
- Monitor blockers, old transactions, idle transactions, and deadlocks.
- Give every app connection a meaningful `application_name`.

## Read Next

- [PostgreSQL Performance Tuning](/blog/postgresql-performance-tuning/)
- [Database Connection Pool Tuning](/blog/database-connection-pool-tuning/)
- [Zero-Downtime Database Migrations](/blog/zero-downtime-database-migrations/)
- [Database Indexing Deep Dive](/blog/database-indexing-deep-dive/)

## Sources

- [PostgreSQL Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html)
