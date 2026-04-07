---
title: "Production Incident Playbooks: Debugging Latency, Errors, and Traffic Spikes"
description: "A practical incident response playbook for backend engineers: how to triage production latency, error-rate spikes, database issues, queue backlogs, and rollback decisions without guessing under pressure."
date: "2025-07-12"
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

## Traffic Spike Playbook

Traffic spikes are not automatically bad. The question is whether the spike is legitimate demand, retry amplification, bot traffic, or a client bug.

Start with segmentation:

```
requests_per_second by route
requests_per_second by user_agent
requests_per_second by client_version
requests_per_second by tenant_id
requests_per_second by source_ip_prefix
```

If one endpoint dominates, look for a client loop or a cache miss pattern. If one tenant dominates, apply tenant-level throttling. If retry traffic is visible, reduce retries or enable server-side rate limiting before scaling the whole system.

Scaling is useful only when the bottleneck is stateless application capacity. Scaling application pods does not fix:

- database lock contention
- exhausted database connections
- downstream dependency throttling
- hot Kafka partitions
- Redis single-key hotspots

During a spike, a quick protection layer can save the system:

```java
if (loadShedding.enabled() && systemLoad.isCritical()) {
    if (!request.isHighPriority()) {
        throw new ServiceUnavailableException("Temporarily shedding low-priority traffic");
    }
}
```

Load shedding is not pretty, but returning a controlled 503 for non-critical traffic is better than letting the entire service collapse.

## Memory and GC Playbook

Java memory incidents often look like latency incidents first. The service appears alive, but p99 latency climbs because the JVM is spending too much time in garbage collection.

Check:

```
jvm.memory.used
jvm.memory.committed
jvm.gc.pause
jvm.gc.overhead
process.cpu.usage
http.server.requests p99
```

Then correlate GC pause spikes with request latency. If both move together, inspect allocation rate and recent code changes.

Common triggers:

- loading large result sets into memory
- accidentally logging huge objects
- unbounded caches
- batch jobs running on API pods
- large JSON payload serialization
- thread pools holding many queued tasks

If the heap is climbing and never returning to baseline after GC, suspect a leak. If memory returns to baseline but GC is frequent, suspect allocation pressure.

Temporary mitigation might be increasing memory or rolling pods. Permanent mitigation is finding the allocation path:

```bash
jcmd <pid> GC.class_histogram
jcmd <pid> Thread.print
```

In Kubernetes, avoid guessing from pod restarts alone. Check whether restarts are OOM kills:

```bash
kubectl describe pod checkout-api-abc123 | grep -A5 "Last State"
```

## Communication Template

Good incident communication is short, factual, and regular. Avoid speculation in status updates.

Use a template:

```
Status: Investigating / Mitigating / Monitoring / Resolved
Impact: Checkout API p95 latency elevated for all users
Start time: 10:02 IST
Current action: Rolling back checkout-api v214 to v213
Next update: 10:30 IST
```

For internal engineering channels, add evidence:

```
Evidence:
- p95 latency rose from 280ms to 2.4s at 09:59
- Error rate remains below 1%
- Tax-service client timeout change deployed at 09:58
- DB and Redis latency normal
```

This keeps leadership informed without pulling engineers away from mitigation every two minutes.

## Postmortem Structure

The incident is not done when graphs recover. It is done when the system is less likely to fail the same way again.

A useful postmortem includes:

```markdown
# Incident: Checkout latency spike on 2025-07-12

## Impact
Who was affected, for how long, and how badly?

## Timeline
What happened, in timestamped order?

## Root Cause
What technical condition made the incident possible?

## Detection
How did we notice? Was the alert early enough?

## Resolution
What restored service?

## What Went Well
What helped?

## What Went Poorly
What slowed us down?

## Action Items
- Owner, action, due date
```

Avoid action items like "be more careful." Good action items change systems: add an alert, enforce a timeout, reduce a retry count, add a migration guardrail, or improve rollback automation.

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
- Use load shedding when low-priority traffic threatens critical flows
- Prefer rollback for recent bad deploys
- Avoid retry amplification
- Communicate status every 15-30 minutes
- Write action items with owners and due dates
- Write a blameless postmortem within 48 hours

The best incident response culture is not one where nothing fails. It is one where teams fail safely, detect quickly, restore confidently, and learn without hiding the truth.
