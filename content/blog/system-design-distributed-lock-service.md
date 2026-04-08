---
title: "System Design: Building a Distributed Lock Service"
description: "Design a distributed lock service for production coordination: leases, fencing tokens, TTLs, renewal, Redis vs PostgreSQL vs etcd tradeoffs, failure modes, idempotency, and safe usage patterns."
date: "2026-04-08"
category: "System Design"
tags: ["system design", "distributed locks", "leases", "redis", "postgresql", "idempotency", "distributed systems"]
featured: false
affiliateSection: "system-design-courses"
---

Distributed locks are tempting because they look like a simple answer to a hard question: "How do I make sure only one worker does this?"

They are also dangerous. A lock can expire while a worker is still running. A network partition can make ownership ambiguous. A process can pause during GC and continue after its lease is gone. A lock can protect the wrong thing. A retry can run twice anyway. If the system being protected does not verify ownership, the lock is only a polite suggestion.

This guide designs a distributed lock service for production coordination. It covers leases, TTLs, renewal, fencing tokens, Redis/PostgreSQL/etcd tradeoffs, safe usage patterns, observability, and failure modes.

## When You Need A Distributed Lock

Use a distributed lock when multiple processes may coordinate the same external or shared action:

- run one scheduled job per tenant
- rebuild one search index at a time
- perform one data migration per resource
- prevent concurrent billing close for the same customer
- coordinate leader-like work across replicas
- serialize access to an external system that has no concurrency control

Do not use a distributed lock when a simpler primitive works:

- database unique constraint for one-time creation
- idempotency key for duplicate API requests
- queue partitioning for ordered processing
- row-level lock inside one database transaction
- optimistic concurrency with version columns

Distributed locks are a coordination tool, not a replacement for idempotency.

## Requirements

Functional requirements:

- acquire a lock for a resource
- release a lock
- renew a lock lease
- expire abandoned locks
- expose ownership metadata
- support fencing tokens
- support best-effort force unlock for operators

Non-functional requirements:

- high availability
- bounded lock lifetime
- safe behavior during client crashes
- clear ownership semantics
- low latency
- observability
- tenant isolation
- protection against stale lock holders

The most important requirement is stale-holder safety. If a worker continues after losing a lock, the protected system must reject its writes.

## Lock Record Model

```json
{
  "resource": "tenant_123:billing-close:2026-04",
  "ownerId": "worker-7",
  "leaseId": "lease_abc",
  "fencingToken": 1842,
  "expiresAt": "2026-04-08T10:20:30Z",
  "createdAt": "2026-04-08T10:15:30Z"
}
```

Fields:

- `resource`: the thing being protected
- `ownerId`: process or worker that acquired the lock
- `leaseId`: unique ID for this lock acquisition
- `fencingToken`: monotonically increasing ownership token
- `expiresAt`: lease expiry
- `createdAt`: acquisition time

`leaseId` prevents one worker from releasing another worker's lock. `fencingToken` protects downstream systems from stale workers.

## Basic API

```http
POST /v1/locks/acquire
```

Request:

```json
{
  "resource": "tenant_123:billing-close:2026-04",
  "ownerId": "worker-7",
  "ttlSeconds": 60
}
```

Response:

```json
{
  "acquired": true,
  "leaseId": "lease_abc",
  "fencingToken": 1842,
  "expiresAt": "2026-04-08T10:20:30Z"
}
```

Renew:

```http
POST /v1/locks/lease_abc/renew
```

Release:

```http
DELETE /v1/locks/lease_abc
```

The API should be small. Complex lock workflows belong in callers, not in the lock service.

## PostgreSQL Implementation

For moderate scale, PostgreSQL can be enough.

```sql
CREATE TABLE distributed_locks (
  resource TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  lease_id UUID NOT NULL,
  fencing_token BIGSERIAL NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Acquire:

```sql
INSERT INTO distributed_locks (
  resource,
  owner_id,
  lease_id,
  expires_at
)
VALUES (
  :resource,
  :owner_id,
  :lease_id,
  now() + (:ttl_seconds || ' seconds')::interval
)
ON CONFLICT (resource)
DO UPDATE SET
  owner_id = EXCLUDED.owner_id,
  lease_id = EXCLUDED.lease_id,
  expires_at = EXCLUDED.expires_at,
  updated_at = now()
WHERE distributed_locks.expires_at < now()
RETURNING resource, lease_id, fencing_token, expires_at;
```

If no row is returned, the lock is held by someone else and has not expired.

Release:

```sql
DELETE FROM distributed_locks
WHERE resource = :resource
  AND lease_id = :lease_id;
```

Renew:

```sql
UPDATE distributed_locks
SET expires_at = now() + (:ttl_seconds || ' seconds')::interval,
    updated_at = now()
WHERE resource = :resource
  AND lease_id = :lease_id
  AND expires_at > now()
RETURNING fencing_token, expires_at;
```

PostgreSQL gives strong transactional semantics, but every lock operation hits the database. That is fine for low/medium throughput coordination, not for millions of locks per second.

## Redis Implementation

Redis can provide fast lock acquisition with `SET key value NX PX ttl`.

```ts
async function acquireRedisLock(input: {
  resource: string;
  ownerId: string;
  ttlMs: number;
}): Promise<{ acquired: boolean; leaseId?: string }> {
  const leaseId = crypto.randomUUID();
  const value = JSON.stringify({ ownerId: input.ownerId, leaseId });

  const result = await redis.set(
    `lock:${input.resource}`,
    value,
    "NX",
    "PX",
    input.ttlMs
  );

  return result === "OK"
    ? { acquired: true, leaseId }
    : { acquired: false };
}
```

Release must compare lease ID atomically:

```lua
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
```

Redis is fast and simple, but think carefully about durability, failover, and stale holders. If the protected action is financially or operationally critical, add fencing tokens or use a coordination system with stronger semantics.

## Fencing Tokens

A fencing token is a monotonically increasing number issued on lock acquisition. Downstream systems reject operations with older tokens.

Why it matters:

```text
1. Worker A acquires lock with token 10.
2. Worker A pauses for 90 seconds.
3. Lock expires.
4. Worker B acquires lock with token 11 and starts work.
5. Worker A resumes and tries to write stale results.
6. Downstream system rejects token 10 because it has seen token 11.
```

Example protected table:

```sql
CREATE TABLE tenant_billing_close (
  tenant_id TEXT PRIMARY KEY,
  period TEXT NOT NULL,
  last_fencing_token BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL
);
```

Protected update:

```sql
UPDATE tenant_billing_close
SET status = 'CLOSED',
    last_fencing_token = :fencing_token
WHERE tenant_id = :tenant_id
  AND period = :period
  AND :fencing_token > last_fencing_token;
```

If the update affects zero rows, the worker may be stale and should stop.

Without fencing, a lock only says "I believe I own this." With fencing, the resource being modified can enforce "newer owner wins."

## Lease Renewal

Long-running tasks need renewal:

```ts
async function runWithLock(resource: string, task: (ctx: LockContext) => Promise<void>) {
  const lock = await lockClient.acquire({ resource, ttlSeconds: 60 });
  if (!lock.acquired) {
    return;
  }

  const renewal = setInterval(async () => {
    const renewed = await lockClient.renew(lock.leaseId, { ttlSeconds: 60 });
    if (!renewed) {
      process.emitWarning(`lost lock lease ${lock.leaseId}`);
    }
  }, 20_000);

  try {
    await task({
      leaseId: lock.leaseId,
      fencingToken: lock.fencingToken,
    });
  } finally {
    clearInterval(renewal);
    await lockClient.release(lock.leaseId);
  }
}
```

If renewal fails, the task should stop before doing more side effects. At minimum, every side effect must include the fencing token.

## TTL Selection

TTL is a tradeoff:

- too short: locks expire during normal work
- too long: recovery after crashes is slow

Use:

```text
ttl > p99 task pause + p99 renewal latency + safety margin
renew interval <= ttl / 3
```

If work can take hours, do not use one giant TTL. Use a shorter lease with renewal and checkpoints.

## Comparing Storage Options

| Option | Pros | Cons | Good For |
|---|---|---|---|
| PostgreSQL | transactional, simple, familiar | lower throughput, DB dependency | app-level coordination |
| Redis | fast, low latency | failover semantics need care | low-latency best-effort locks |
| etcd/ZooKeeper | built for coordination | operational overhead | leader election, critical coordination |
| Database row locks | strong within one DB transaction | not for long work | short transactional updates |

Choose based on correctness needs, not popularity.

For critical coordination, prefer systems with strong consistency and fencing. For non-critical duplicate avoidance, Redis or PostgreSQL may be enough.

## Safe Usage Pattern

Good:

```text
acquire lock -> get fencing token -> perform idempotent work -> downstream verifies fencing token
```

Risky:

```text
acquire lock -> perform irreversible side effect -> assume no duplicate is possible
```

Example:

```java
LockLease lease = lockClient.acquire("tenant:" + tenantId + ":billing-close");
if (!lease.acquired()) {
    return;
}

try {
    billingCloseService.closePeriod(
        tenantId,
        period,
        lease.fencingToken()
    );
} finally {
    lockClient.release(lease.leaseId());
}
```

Inside the service, every write checks the fencing token.

## Operational Controls

Operators need:

- list locks by resource prefix
- show lock owner and expiration
- force release expired or suspicious locks
- inspect renewal failures
- audit force unlocks
- alert on long-held locks

Force unlock must be audited:

```json
{
  "action": "FORCE_UNLOCK",
  "resource": "tenant_123:billing-close:2026-04",
  "actorId": "oncall_1",
  "reason": "worker crashed and lease did not clear",
  "createdAt": "2026-04-08T10:15:30Z"
}
```

Never make force unlock a casual button with no record.

## Observability

Metrics:

- lock acquisition attempts
- lock acquisition success rate
- lock contention rate
- lock renewal failures
- lock release failures
- expired locks reclaimed
- lock hold duration
- force unlock count
- fencing token rejection count

Structured log:

```json
{
  "event": "lock_acquired",
  "resource": "tenant_123:billing-close:2026-04",
  "ownerId": "worker-7",
  "leaseId": "lease_abc",
  "fencingToken": 1842,
  "ttlSeconds": 60
}
```

Track lock contention by resource prefix. If one resource is constantly contended, you may need queueing or partitioning rather than more locking.

## Failure Modes

**Worker pauses past TTL.** Worker resumes and writes stale data unless fencing is enforced.

**Release deletes someone else's lock.** Release operation does not compare `leaseId`.

**Renewal silently fails.** Worker keeps running after losing ownership.

**TTL too long.** Crash recovery is slow because the lock remains held.

**TTL too short.** Normal work loses the lock and creates duplicate execution.

**Lock protects the wrong resource.** Two code paths use different lock keys for the same underlying resource.

**No idempotency.** Duplicate execution causes side effects even though lock usually works.

**Coordination dependency outage.** Lock service is down and callers do not have a defined fallback.

## Production Checklist

- Prefer simpler primitives before distributed locks.
- Use leases, not infinite locks.
- Include unique lease IDs.
- Compare lease ID on release.
- Renew long-running leases.
- Stop work or use fencing if renewal fails.
- Use fencing tokens for critical side effects.
- Make handlers idempotent anyway.
- Choose TTL from real task and pause measurements.
- Keep lock keys consistent and documented.
- Add force unlock with audit logs.
- Track contention and renewal failures.
- Define behavior when lock service is unavailable.
- Test crash, pause, and network-partition scenarios.

## Read Next

- [Idempotency Keys in APIs](/blog/api-idempotency-keys/)
- [PostgreSQL Locking Playbook](/blog/postgresql-locking-playbook/)
- [Redis Beyond Cache](/blog/redis-beyond-cache/)
- [Transactional Outbox Pattern](/blog/transactional-outbox-pattern/)
