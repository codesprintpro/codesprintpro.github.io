---
title: "System Design: Building a Workflow Orchestration Platform"
description: "Design a production workflow orchestration platform with durable workflow state, retries, compensation, timeouts, signals, timers, idempotent activities, and operational recovery."
date: "2026-04-18"
category: "System Design"
tags: ["system design", "workflow orchestration", "distributed systems", "queues", "saga", "backend engineering"]
featured: false
affiliateSection: "system-design-courses"
---

Many backend processes start life as a queue consumer and a couple of retries.

That works until the business process gets longer and stranger.

Now the flow needs:

- wait for payment confirmation
- call three downstream services
- retry one step but not another
- compensate if shipment creation fails
- pause for manual approval
- resume after a webhook arrives
- survive worker crashes without forgetting what already happened

At that point, you no longer have "a background job." You have a workflow.

This guide designs a production workflow orchestration platform.

## Problem Statement

Build a platform that executes long-running, multi-step workflows durably and safely.

Examples:

- order fulfillment workflow
- loan approval workflow
- user onboarding workflow
- payout approval and disbursement workflow
- document verification workflow
- account recovery workflow

The platform should support:

- durable workflow state
- sequential and branching steps
- retries and backoff
- timers and delays
- manual approval pauses
- external signals and callbacks
- compensation for partially completed work
- visibility into workflow progress

This is not just a scheduler and not just a queue. It is a **durable state machine for business processes**.

## Requirements

Functional requirements:

- start a workflow
- execute activities step by step
- persist workflow state
- retry failed steps
- wait on timers
- accept external signals or callbacks
- support workflow cancellation
- support manual intervention
- expose workflow history
- support replay and debugging

Non-functional requirements:

- survive process crashes
- avoid losing in-progress business state
- bound duplicate side effects
- scale to many concurrent workflows
- handle workflows that run for seconds, hours, or days
- provide clear observability

The most important constraint:

**workflow progress must not depend on the memory of one worker process.**

## Workflow vs Job Scheduler

A scheduler answers:

```text
When should this task run?
```

A workflow engine answers:

```text
What state is this long-running process in, and what should happen next?
```

Schedulers are great for:

- run a job at 9 AM
- retry a failed task later
- trigger periodic cleanup

Workflow engines are for:

- reserve inventory
- charge payment
- wait for webhook
- create shipment
- send confirmation
- compensate if shipment fails after payment succeeded

The distinction matters because workflows need durable, queryable state transitions.

## High-Level Architecture

```text
API / Starter
   |
   v
Workflow Engine
   |
   +--> workflow state store
   +--> timer queue
   +--> activity task queue
   +--> signal/event inbox
   |
   v
Workers / Activity Runners
   |
   +--> call external services
   +--> report completion / failure
   |
   v
Downstream systems
```

Supporting systems:

- workflow UI
- audit/history store
- dead-letter / stuck-workflow tooling

## Core Concepts

Separate these ideas clearly:

| Concept | Meaning |
|---|---|
| Workflow definition | The process model or code describing steps and transitions |
| Workflow execution | One running instance of that process |
| Activity | One side-effecting step, such as calling a payment API |
| Signal | External event that wakes or changes a workflow |
| Timer | Delayed wake-up for retries, waiting, or timeouts |

Example:

```text
workflow definition: order_fulfillment
workflow execution: wf_123
activities:
  - reserve_inventory
  - charge_payment
  - create_shipment
  - send_confirmation
```

## Example Workflow

Order fulfillment:

1. reserve inventory
2. charge payment
3. create order record
4. create shipment
5. send confirmation

Failure path:

- if payment fails -> release inventory
- if shipment creation fails after payment -> mark manual review or compensate

This is why orchestration exists: each step may succeed independently, but the business process still needs a coherent outcome.

## Data Model

### Workflow executions

```sql
CREATE TABLE workflow_executions (
  workflow_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workflow_type TEXT NOT NULL,
  business_key TEXT,
  status TEXT NOT NULL,             -- RUNNING, WAITING, SUCCEEDED, FAILED, CANCELLED
  current_state TEXT NOT NULL,
  input JSONB NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, workflow_type, business_key)
);
```

### Workflow history

```sql
CREATE TABLE workflow_history (
  event_id BIGSERIAL PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflow_executions(workflow_id),
  event_type TEXT NOT NULL,         -- started, activity_scheduled, activity_completed, timer_fired, signaled
  state_before TEXT,
  state_after TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_history_lookup
  ON workflow_history (workflow_id, event_id);
```

### Activity tasks

```sql
CREATE TABLE workflow_activity_tasks (
  task_id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflow_executions(workflow_id),
  activity_name TEXT NOT NULL,
  status TEXT NOT NULL,             -- PENDING, RUNNING, SUCCEEDED, FAILED, CANCELLED
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by TEXT,
  locked_until TIMESTAMPTZ,
  input JSONB NOT NULL,
  result JSONB,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Timers / wakeups

```sql
CREATE TABLE workflow_timers (
  timer_id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflow_executions(workflow_id),
  timer_type TEXT NOT NULL,
  fire_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, FIRED, CANCELLED
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_timers_due
  ON workflow_timers (status, fire_at)
  WHERE status = 'PENDING';
```

### Signals / external events

```sql
CREATE TABLE workflow_signals (
  signal_id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflow_executions(workflow_id),
  signal_name TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_signals_unprocessed
  ON workflow_signals (workflow_id, processed)
  WHERE processed = false;
```

## State Machine Design

A workflow is a durable state machine.

Example order workflow states:

```text
STARTED
INVENTORY_RESERVED
PAYMENT_CHARGED
ORDER_CREATED
SHIPMENT_CREATED
COMPLETED

Failure branches:
PAYMENT_FAILED
SHIPMENT_FAILED
MANUAL_REVIEW
CANCELLED
```

Keep state names boring and explicit. If operators cannot read the workflow state and understand what happened, the system becomes an archaeology project.

## Workflow Execution Model

There are two broad implementation styles:

### Command/state-machine style

Store explicit state and let workers transition it.

Pros:

- simple mental model

Cons:

- more boilerplate
- branching logic can sprawl

### Event-history replay style

Store workflow event history and reconstruct current state by replay.

Pros:

- strong determinism
- easier debugging and replay

Cons:

- more advanced engine design

This post stays implementation-agnostic enough to fit either style, but the reliability principles are the same.

## Starting a Workflow

```http
POST /v1/workflows
```

```json
{
  "workflowType": "order_fulfillment",
  "tenantId": "merchant_42",
  "businessKey": "order_123",
  "input": {
    "orderId": "order_123",
    "paymentId": "pay_456",
    "userId": "user_77"
  }
}
```

Response:

```json
{
  "workflowId": "wf_123",
  "status": "RUNNING",
  "state": "STARTED"
}
```

`businessKey` is important. It gives you idempotency for "start workflow for this order."

## Scheduling Activities

An activity is the side-effecting part of a workflow.

Examples:

- reserve inventory
- charge payment
- call KYC provider
- create shipment

The workflow engine should schedule an activity task, not perform the side effect inline in the control transaction.

```java
public void scheduleActivity(UUID workflowId, String activityName, JsonNode input) {
    activityTaskRepository.insert(
        ActivityTask.builder()
            .taskId(UUID.randomUUID())
            .workflowId(workflowId)
            .activityName(activityName)
            .status("PENDING")
            .input(input)
            .build()
    );

    workflowHistoryRepository.append(workflowId, "activity_scheduled", activityName);
}
```

This separation helps with retries and observability.

## Claiming Activity Work With Leases

Workers must claim activity tasks safely.

```sql
UPDATE workflow_activity_tasks
SET status = 'RUNNING',
    locked_by = :worker_id,
    locked_until = now() + interval '30 seconds',
    attempt_count = attempt_count + 1,
    updated_at = now()
WHERE task_id = (
  SELECT task_id
  FROM workflow_activity_tasks
  WHERE status IN ('PENDING', 'FAILED')
    AND next_attempt_at <= now()
    AND (locked_until IS NULL OR locked_until < now())
  ORDER BY next_attempt_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

Lease-based claiming is how the system recovers if a worker crashes after taking work.

## Idempotent Activities

Workflow infrastructure can generally only give you at-least-once execution.

That means activities must be idempotent or externally deduplicated.

Example:

```java
public PaymentResult chargePayment(String paymentId, UUID workflowId, UUID taskId) {
    String idempotencyKey = "workflow:" + workflowId + ":task:" + taskId;
    return paymentGateway.charge(paymentId, idempotencyKey);
}
```

Without idempotency keys, retries turn infrastructure recovery into duplicate charges.

## Retries and Backoff

Not all failures are equal.

Retry categories:

- transient: timeout, 502, temporary network issue
- terminal: validation error, insufficient funds, invalid address
- unknown: timed out after request submission, needs care

Retry policy example:

```json
{
  "maxAttempts": 5,
  "initialDelayMs": 1000,
  "backoffMultiplier": 2.0,
  "maxDelayMs": 300000
}
```

The workflow engine should apply retry policy per activity, not globally for all steps.

## Timers and Waiting

Workflows often need to wait:

- wait 15 minutes for payment webhook
- retry shipment creation in 5 minutes
- expire an approval request in 24 hours

Instead of sleeping in a process, create a durable timer:

```java
public void waitUntil(UUID workflowId, Instant fireAt, String timerType) {
    timerRepository.insert(
        WorkflowTimer.builder()
            .timerId(UUID.randomUUID())
            .workflowId(workflowId)
            .timerType(timerType)
            .fireAt(fireAt)
            .build()
    );

    workflowRepository.moveToWaitingState(workflowId, timerType);
}
```

This is a huge difference between robust orchestration and fragile in-memory logic.

## Signals and External Events

Many workflows pause until an external event arrives.

Examples:

- payment webhook
- manual approval
- KYC vendor callback
- customer document upload

Signal API:

```http
POST /v1/workflows/wf_123/signals
```

```json
{
  "signalName": "payment_confirmed",
  "payload": {
    "paymentId": "pay_456",
    "status": "succeeded"
  }
}
```

Signals should be durable and idempotent. A signal that arrives before the workflow is ready should still be stored and processed when appropriate.

## Compensation

This is where orchestration becomes much more than task retries.

Example:

1. inventory reserved
2. payment charged
3. shipment creation fails permanently

Now you may need:

- cancel charge or issue refund
- release inventory
- mark manual review

This is compensation, not rollback. Distributed systems do not magically undo side effects.

Example compensation flow:

```text
reserve_inventory
charge_payment
create_shipment -> fails terminally
  -> compensate:
     refund_payment
     release_inventory
  -> mark workflow failed or manually resolved
```

Compensation rules should be explicit in workflow design, not improvised during incidents.

## Manual Tasks and Human-in-the-Loop

Some workflows cannot be fully automated.

Examples:

- compliance approval
- fraud review
- exception handling after repeated failures

Manual task model:

```sql
CREATE TABLE workflow_manual_tasks (
  manual_task_id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflow_executions(workflow_id),
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,          -- OPEN, COMPLETED, CANCELLED
  assigned_to TEXT,
  input JSONB NOT NULL,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

The workflow should be able to pause in `WAITING_FOR_MANUAL_ACTION` and resume later.

## Visibility and Querying

Operators need to answer:

- what state is this workflow in?
- which activity last failed?
- how long has it been waiting?
- what compensation already ran?
- did the external signal arrive?

A workflow platform without good history and introspection becomes a black box.

Useful query:

```sql
SELECT event_type, state_before, state_after, payload, created_at
FROM workflow_history
WHERE workflow_id = :workflow_id
ORDER BY event_id ASC;
```

This should be a UI, not just a SQL habit.

## Failure Modes

### 1. Worker crashes mid-activity

Fix:

- lease expires
- task becomes reclaimable
- activity idempotency protects side effects

### 2. Timer lost after restart

Fix:

- timers stored durably
- timer scanner rebuilds due work from DB

### 3. Duplicate external signal

Fix:

- signal dedupe key
- state-aware signal handling

### 4. Compensation partially succeeds

Fix:

- compensation itself must be observable and retryable
- escalate to manual recovery if needed

### 5. Workflow stuck in waiting state forever

Fix:

- waiting-state SLA monitoring
- explicit timeout timers
- dead-workflow sweeper

## Orchestrator vs Choreography

Workflows can also be built through event choreography:

```text
service A publishes event
service B reacts
service C reacts later
```

This can be fine for loosely coupled flows.

But orchestration is usually better when:

- business process has clear owner
- retries and compensation need central visibility
- humans need to inspect state
- compliance or auditability matters

Event choreography can drift into "nobody actually knows what the process is doing."

## Observability

Track:

- workflow start rate
- success / failure / cancellation rate
- activity retry counts
- timer backlog
- signal processing lag
- stuck workflow count
- manual task queue depth
- workflow latency percentiles by type

Useful dashboards:

- workflow states by type
- top failing activity names
- oldest waiting workflows
- compensation activity volume

## What I Would Build First

Phase 1:

- workflow execution store
- activity task queue
- retries with backoff
- workflow history

Phase 2:

- timers
- signals
- compensation support
- workflow UI

Phase 3:

- manual tasks
- richer replay/debug tooling
- versioned workflow definitions
- tenant-aware quotas and fairness

This order matters. Teams often rush to fancy visual workflow builders before they have durable state, retries, and observability nailed down.

## Production Checklist

- workflow execution state durable
- activities claimed with leases
- side-effecting activities idempotent
- retries classified by error type
- timers stored durably
- signals deduplicated
- compensation explicit
- stuck workflows detected
- workflow history queryable
- manual recovery path exists

## Final Takeaway

A workflow orchestration platform is how a distributed system remembers what a business process has already done and what it should do next.

If you design it well, long-running flows become understandable, recoverable, and safe.

If you design it poorly, every partial failure turns into custom repair scripts and support escalations.

## Read Next

- [System Design: Building a Distributed Job Scheduler](/blog/system-design-job-scheduler/)
- [System Design: Building a Webhook Delivery Platform](/blog/system-design-webhook-delivery-platform/)
- [Transactional Outbox Pattern: Reliable Event Publishing Without Dual Writes](/blog/transactional-outbox-pattern/)
