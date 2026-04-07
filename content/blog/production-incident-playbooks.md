---
title: "Production Incident Playbooks: Debugging Latency, Errors, and Traffic Spikes"
description: "A practical incident response playbook for backend engineers: how to triage production latency, error-rate spikes, database issues, queue backlogs, and rollback decisions without guessing under pressure."
date: "2026-04-07"
category: "System Design"
tags: ["incident response", "production debugging", "observability", "sre", "backend engineering", "playbooks"]
featured: false
affiliateSection: "distributed-systems-books"
---

Production incidents are not solved by heroics. They are solved by reducing uncertainty quickly. When latency jumps, errors spike, or a queue backlog grows, the worst thing a team can do is randomly restart services, add instances, or stare at dashboards without a hypothesis.

A good playbook gives you a repeatable path: confirm impact, isolate the layer, protect users, restore service, and only then dig into root cause.

## The First Five Minutes

Start with four questions:

1. **What changed?** Deployment, config, traffic pattern, dependency, schema migration, feature flag, certificate, quota, or infrastructure event.
2. **Who is affected?** All users, one region, one tenant, one endpoint, one mobile app version, one payment method, or one background job.
3. **What is failing?** Latency, HTTP 5xx, HTTP 4xx, timeouts, queue lag, CPU, memory, database connections, or downstream dependency calls.
4. **Can we reduce blast radius now?** Roll back, disable a feature flag, shed traffic, scale consumers, pause a job, or route around a dependency.

Write the timeline in the incident channel as you learn. Even short notes help:

```
10:02 - Alert fired: checkout p95 latency > 2s
10:04 - Impact confirmed: checkout API only, all regions
10:06 - Last deploy at 09:58 included tax-service client timeout change
10:08 - Rolling back checkout-api v214 -> v213
```

## Latency Spike Playbook

Latency has two broad causes: work takes longer, or work waits longer.

Check these in order:

- Request rate: did traffic suddenly increase?
- Error rate: are retries multiplying traffic?
- Downstream latency: which dependency got slow?
- Database query time: did a new query plan or lock appear?
- Thread pool saturation: are requests waiting for workers?
- Connection pool saturation: are requests waiting for database connections?
- GC pauses: are Java services stopping the world?

For a Spring Boot service, the fastest signal usually comes from latency broken down by dependency:

```
checkout.request.duration p95
checkout.db.query.duration p95
checkout.redis.duration p95
checkout.http.tax-service.duration p95
hikaricp.connections.pending
jvm.gc.pause
executor.active_threads
```

If total request latency is high but dependency latency is normal, suspect local saturation: CPU, GC, locks, thread pools, serialization, or log volume. If one dependency latency matches the request spike, isolate that dependency first.

## Error Spike Playbook

Do not start with aggregate 5xx. Split by endpoint, exception, dependency, and version.

Useful queries:

```
status >= 500 by route
exception_type by service_version
downstream_status by dependency
timeout_count by dependency
```

If only one version is failing, roll it back. If all versions fail after a config rollout, revert config. If failures are dependency-specific, add a circuit breaker, increase timeout only if the dependency is healthy but slow, or degrade the feature.

A simple rule: **never increase retries during an incident unless you have proven the dependency has spare capacity**. Retries can turn a small outage into a retry storm.

## Database Incident Playbook

Database incidents often present as application latency, not database alerts.

Check:

- Active queries and slow queries
- Locks and blocked sessions
- Connection count and pool waiters
- CPU and IO saturation
- Replication lag
- Recent migrations or index changes
- Autovacuum or table bloat for PostgreSQL

For PostgreSQL, start with blockers:

```sql
SELECT
  blocked.pid AS blocked_pid,
  blocked.query AS blocked_query,
  blocking.pid AS blocking_pid,
  blocking.query AS blocking_query
FROM pg_stat_activity blocked
JOIN pg_locks blocked_locks ON blocked_locks.pid = blocked.pid
JOIN pg_locks blocking_locks
  ON blocking_locks.locktype = blocked_locks.locktype
 AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
 AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
 AND blocking_locks.granted
JOIN pg_stat_activity blocking ON blocking.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

If a migration is blocking writes, stop the migration first. If a query plan changed, add the missing index or temporarily disable the feature path. If the app is exhausting connections, scaling application pods can make the outage worse by opening even more connections.

## Queue Backlog Playbook

Queue lag means producers are faster than consumers, consumers are unhealthy, or one partition is hot.

Check:

- Producer rate vs consumer rate
- Consumer error rate
- Partition-level lag
- Rebalance frequency
- Processing duration per message
- Dead-letter queue growth

If every partition is lagging evenly, add consumers up to the partition count. If one partition is hot, scaling will not help much. You need to fix the partition key, split the hot tenant, or add special handling for the hot key.

## Rollback vs Fix Forward

Rollback when:

- The issue started immediately after deploy
- The old version is known safe
- The database schema is backward-compatible
- The bug affects a critical path

Fix forward when:

- Rollback would corrupt data
- The issue is a dependency/config change outside the deployed service
- The patch is tiny, obvious, and faster than a rollback

Do not debate this endlessly. If rollback is safe and impact is high, roll back first. Root cause analysis can wait.

## A Practical Incident Checklist

- Confirm impact with user-facing metrics, not only internal alerts
- Assign one incident commander
- Freeze non-incident deploys
- Record a timeline
- Check recent changes
- Split metrics by route, version, region, tenant, and dependency
- Prefer rollback for recent bad deploys
- Avoid retry amplification
- Communicate status every 15-30 minutes
- Write a blameless postmortem within 48 hours

The best incident response culture is not one where nothing fails. It is one where teams fail safely, detect quickly, restore confidently, and learn without hiding the truth.

## Read Next

- [Designing a Retry System Without Causing a Retry Storm](/blog/retry-storm-prevention/)
- [Building Production Observability with OpenTelemetry and Grafana Stack](/blog/observability-opentelemetry-production/)
- [Feature Flags and Progressive Delivery: Safe Releases at Scale](/blog/feature-flags-progressive-delivery/)
