---
title: "System Design: Building a Distributed Job Scheduler"
description: "Design a production job scheduler like Quartz, Airflow, or Cloud Scheduler: cron parsing, durable job storage, leases, retries, idempotency, delayed execution, worker pools, multi-tenancy, observability, and failure recovery."
date: "2026-04-08"
category: "System Design"
tags: ["system design", "job scheduler", "distributed systems", "cron", "queues", "idempotency", "backend engineering"]
featured: false
affiliateSection: "system-design-courses"
---

A job scheduler sounds simple: run this task at this time.

In production, that becomes a distributed systems problem. Nodes crash after claiming work. Clocks drift. Jobs overlap. Cron expressions are ambiguous. Tenants need rate limits. Workers retry failures. Some jobs must run exactly once from a product perspective, even though the infrastructure can only provide at-least-once execution.

This guide designs a production job scheduler: durable job definitions, schedule calculation, trigger generation, leases, worker pools, retries, idempotency, delayed execution, multi-tenant fairness, observability, and failure recovery.

## Requirements

Functional requirements:

- create one-time jobs
- create recurring jobs with cron-like schedules
- pause and resume jobs
- cancel scheduled jobs
- execute jobs close to their target time
- retry failed attempts
- inspect job history
- support manual re-run
- enforce tenant limits

Non-functional requirements:

- durable job definitions
- at-least-once execution
- bounded duplicate execution
- no single scheduler node as a hard dependency
- horizontal worker scaling
- safe recovery after worker crashes
- fair execution across tenants
- clear observability
- predictable behavior during deploys

The scheduler should not promise infrastructure-level exactly-once execution. It should provide stable job IDs, attempt IDs, leases, and idempotency keys so the job handler can make side effects safe.

## Core Concepts

Separate three ideas:

| Concept | Meaning |
|---|---|
| Job definition | What should run, schedule, tenant, payload, retry policy |
| Job trigger | A specific scheduled fire time for a job |
| Job attempt | One execution attempt of one trigger |

For a recurring job, one definition creates many triggers:

```text
job: send-daily-report
cron: 0 9 * * *

trigger 1: 2026-04-08T09:00:00Z
trigger 2: 2026-04-09T09:00:00Z
trigger 3: 2026-04-10T09:00:00Z
```

Each trigger may have multiple attempts if it fails.

This model keeps history clean. You can answer:

- Which scheduled run failed?
- How many times was it attempted?
- Did the next scheduled run still happen?
- Was the failure a schedule issue or worker issue?

## High-Level Architecture

```text
API
  |
  +-- create/update/pause jobs
  |
  v
Job database
  |
  +-- job definitions
  +-- job triggers
  +-- job attempts
  |
  v
Scheduler coordinator
  |
  +-- calculates due triggers
  +-- inserts trigger rows
  |
  v
Worker pool
  |
  +-- claims due triggers with leases
  +-- executes job handlers
  +-- records attempts
  +-- schedules retries
```

For moderate scale, PostgreSQL can handle this design. For very high scale, move trigger dispatch to Kafka, SQS, or a dedicated queue while keeping job definitions and history in a database.

## Job Definition Schema

```sql
CREATE TABLE scheduled_jobs (
  job_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  job_type TEXT NOT NULL,
  schedule_type TEXT NOT NULL, -- ONCE, CRON
  cron_expression TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  run_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, PAUSED, CANCELLED
  max_attempts INT NOT NULL DEFAULT 5,
  retry_policy JSONB NOT NULL DEFAULT '{}',
  allow_overlap BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX idx_scheduled_jobs_active
  ON scheduled_jobs (status, tenant_id)
  WHERE status = 'ACTIVE';
```

One-time jobs use `run_at`. Recurring jobs use `cron_expression` and `timezone`.

Store the timezone. "Run at 9 AM" means different things depending on the tenant's business timezone, daylight saving rules, and reporting expectations.

## Trigger Schema

```sql
CREATE TABLE job_triggers (
  trigger_id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES scheduled_jobs(job_id),
  tenant_id TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, RUNNING, SUCCEEDED, FAILED, CANCELLED
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  locked_by TEXT,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, scheduled_for)
);

CREATE INDEX idx_job_triggers_due
  ON job_triggers (status, next_attempt_at)
  WHERE status IN ('PENDING', 'FAILED');

CREATE INDEX idx_job_triggers_tenant_time
  ON job_triggers (tenant_id, scheduled_for DESC);
```

The unique constraint prevents duplicate triggers for the same job and scheduled time if scheduler nodes race.

## Attempt Schema

```sql
CREATE TABLE job_attempts (
  attempt_id UUID PRIMARY KEY,
  trigger_id UUID NOT NULL REFERENCES job_triggers(trigger_id),
  job_id UUID NOT NULL,
  tenant_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  status TEXT NOT NULL, -- STARTED, SUCCEEDED, FAILED
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INT,
  error_code TEXT,
  error_message TEXT,
  idempotency_key TEXT NOT NULL
);

CREATE INDEX idx_job_attempts_trigger
  ON job_attempts (trigger_id, started_at DESC);
```

Attempt history is essential for debugging. Without it, "the job failed" becomes a vague complaint instead of an actionable event.

## Generating Triggers

A scheduler coordinator periodically creates triggers for jobs whose next fire time is within a lookahead window.

```java
public void generateTriggers(Duration lookahead) {
    Instant windowEnd = Instant.now().plus(lookahead);

    List<ScheduledJob> jobs = jobRepository.findActiveJobs();

    for (ScheduledJob job : jobs) {
        List<Instant> fireTimes = scheduleCalculator.fireTimesBetween(
            job,
            Instant.now(),
            windowEnd
        );

        for (Instant fireTime : fireTimes) {
            triggerRepository.insertIfAbsent(job.jobId(), fireTime);
        }
    }
}
```

The database `UNIQUE (job_id, scheduled_for)` constraint makes this safe even if two scheduler nodes generate the same trigger.

Use a lookahead window, such as 5 or 15 minutes, not "generate all future triggers forever." Infinite future trigger rows make schedule edits and cancellations painful.

## Claiming Work With Leases

Workers should claim due triggers atomically.

PostgreSQL pattern:

```sql
WITH due AS (
  SELECT trigger_id
  FROM job_triggers
  WHERE status IN ('PENDING', 'FAILED')
    AND next_attempt_at <= now()
    AND (locked_until IS NULL OR locked_until < now())
  ORDER BY next_attempt_at, trigger_id
  LIMIT 50
  FOR UPDATE SKIP LOCKED
)
UPDATE job_triggers
SET status = 'RUNNING',
    locked_by = :worker_id,
    locked_until = now() + interval '5 minutes',
    attempt_count = attempt_count + 1,
    updated_at = now()
WHERE trigger_id IN (SELECT trigger_id FROM due)
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` lets multiple workers claim jobs without blocking each other on the same rows.

The lease protects against worker crashes. If a worker dies after claiming a trigger, `locked_until` eventually expires and another worker can retry it.

## Lease Renewal

Long-running jobs need lease renewal.

```java
public void runWithLease(JobTrigger trigger, JobHandler handler) {
    ScheduledFuture<?> renewal = leaseRenewer.renewEvery(
        trigger.triggerId(),
        Duration.ofMinutes(1),
        Duration.ofMinutes(5)
    );

    try {
        handler.execute(trigger);
        triggerRepository.markSucceeded(trigger.triggerId());
    } catch (Exception e) {
        triggerRepository.markFailedOrRetry(trigger.triggerId(), e);
    } finally {
        renewal.cancel(false);
        triggerRepository.clearLease(trigger.triggerId());
    }
}
```

If renewal fails, the worker should stop or finish carefully. Otherwise another worker may claim the same trigger after the lease expires, causing duplicate execution.

## Retries And Backoff

Retry only failures that are likely transient.

```java
public Instant nextRetryAt(int attemptCount) {
    long[] delaysSeconds = {30, 120, 600, 1800, 7200};

    if (attemptCount > delaysSeconds.length) {
        return null;
    }

    long baseDelay = delaysSeconds[attemptCount - 1];
    long jitter = ThreadLocalRandom.current().nextLong(0, Math.min(baseDelay / 5, 300));
    return Instant.now().plusSeconds(baseDelay + jitter);
}
```

When a job fails:

```sql
UPDATE job_triggers
SET status = CASE
      WHEN attempt_count >= :max_attempts THEN 'FAILED'
      ELSE 'PENDING'
    END,
    next_attempt_at = :next_retry_at,
    locked_by = NULL,
    locked_until = NULL,
    updated_at = now()
WHERE trigger_id = :trigger_id;
```

Use jitter. If a dependency outage causes thousands of jobs to fail at once, synchronized retries can overload it again during recovery.

## Idempotency

A scheduler provides at-least-once execution. Job handlers must handle duplicates.

Use a stable idempotency key:

```text
job:{job_id}:scheduled_for:{scheduled_for}
```

For a billing job:

```sql
CREATE TABLE invoice_generation_keys (
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  invoice_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key)
);
```

Handler:

```java
@Transactional
public void generateInvoice(JobContext context) {
    String key = context.idempotencyKey();

    if (invoiceKeyRepository.exists(context.tenantId(), key)) {
        return;
    }

    Invoice invoice = invoiceRepository.createForPeriod(
        context.tenantId(),
        context.scheduledFor()
    );

    invoiceKeyRepository.save(context.tenantId(), key, invoice.getId());
}
```

The scheduler can reduce duplicates. The handler must make duplicates safe.

## Preventing Overlap

Some jobs should not overlap. A daily report can probably overlap safely. A billing close job probably cannot.

If `allow_overlap = false`, claim only if no other trigger for the same job is running:

```sql
AND NOT EXISTS (
  SELECT 1
  FROM job_triggers running
  WHERE running.job_id = job_triggers.job_id
    AND running.status = 'RUNNING'
    AND running.locked_until > now()
)
```

This is a policy decision. If a job scheduled every minute takes five minutes, you need to decide whether to skip, queue, overlap, or collapse triggers.

Common policies:

| Policy | Behavior |
|---|---|
| Queue | Run every missed trigger eventually |
| Skip | Skip trigger if previous run is still active |
| Collapse | Run one catch-up trigger after previous run finishes |
| Overlap | Allow concurrent runs |

Make the policy explicit per job type.

## Handling Misfires

A misfire happens when a trigger should have run but did not run on time. Causes include scheduler downtime, worker overload, paused jobs, or database outages.

Misfire policy:

| Policy | Example Use |
|---|---|
| Fire immediately | Important billing or compliance jobs |
| Skip missed runs | High-frequency cache refresh |
| Fire once for latest | Report generation where only latest matters |
| Backfill all | Data pipeline where every interval matters |

Store it in the job definition:

```sql
ALTER TABLE scheduled_jobs
ADD COLUMN misfire_policy TEXT NOT NULL DEFAULT 'FIRE_ONCE';
```

If you do not define misfire behavior, every outage becomes an argument during recovery.

## Multi-Tenant Fairness

Without fairness, one tenant can fill the queue and starve everyone else.

Controls:

- max active jobs per tenant
- max in-flight triggers per tenant
- per-tenant rate limits
- worker pool quotas by job type
- priority queues for critical jobs
- payload size limits

Example claim query with per-tenant cap is harder in pure SQL, so many systems use a two-step approach:

1. Pick tenants with available capacity.
2. Claim due triggers for those tenants.

```sql
SELECT tenant_id
FROM tenant_scheduler_capacity
WHERE in_flight_count < max_in_flight
ORDER BY last_scheduled_at NULLS FIRST
LIMIT 100;
```

Then claim triggers for those tenants. This gives you a place to enforce fairness without overcomplicating the base job table.

## Worker Pool Design

Separate worker pools by job type when job profiles differ.

Examples:

- email workers
- report generation workers
- billing workers
- data export workers
- webhook retry workers

Why:

- different timeouts
- different concurrency limits
- different retry policies
- different dependencies
- different blast radius

A slow data export should not starve billing jobs.

## Observability

Metrics:

- triggers created per minute
- triggers due now
- trigger lag seconds
- claim rate
- job success rate
- job failure rate
- retry count
- dead-lettered job count
- worker execution duration
- lease renewal failures
- scheduler coordinator errors
- tenant queue depth

Structured log:

```json
{
  "event": "job_attempt_finished",
  "jobId": "job_123",
  "triggerId": "trg_456",
  "attemptId": "att_789",
  "tenantId": "tenant_abc",
  "jobType": "daily_report",
  "scheduledFor": "2026-04-08T09:00:00Z",
  "status": "SUCCEEDED",
  "durationMs": 8420,
  "workerId": "worker-7"
}
```

Useful dashboard sections:

- due triggers by job type
- oldest trigger lag
- failures by job type
- retries by tenant
- worker pool saturation
- lease expirations
- dead-lettered triggers

## Incident Playbook

If jobs are not running:

1. Check trigger lag.
2. Check whether triggers are being generated.
3. Check worker pool health.
4. Check claim query latency.
5. Check database locks on `job_triggers`.
6. Check tenant caps and queue depth.
7. Check lease expiration and retry volume.

If jobs are running twice:

1. Check lease duration versus job duration.
2. Check lease renewal failures.
3. Check whether workers continue after losing a lease.
4. Check handler idempotency.
5. Check whether manual replay reused the original trigger ID.

If retries are exploding:

1. Check top failure reason.
2. Pause affected job type or tenant.
3. Increase backoff or cap retries temporarily.
4. Fix dependency.
5. Resume gradually.

## Production Checklist

- Separate job definitions, triggers, and attempts.
- Use database uniqueness to prevent duplicate triggers.
- Claim work atomically.
- Use leases with expiration.
- Renew leases for long-running jobs.
- Make handlers idempotent.
- Define overlap policy per job.
- Define misfire policy per job.
- Add retry backoff with jitter.
- Use dead-letter state after max attempts.
- Enforce tenant and job-type limits.
- Separate worker pools for different job profiles.
- Track trigger lag and worker saturation.
- Store attempt history.
- Support pause, resume, cancel, and replay.
- Test worker crash recovery.

## Read Next

- [Transactional Outbox Pattern](/blog/transactional-outbox-pattern/)
- [PostgreSQL Locking Playbook](/blog/postgresql-locking-playbook/)
- [Retry Storm Prevention](/blog/retry-storm-prevention/)
- [System Design: Building a Webhook Delivery Platform](/blog/system-design-webhook-delivery-platform/)
