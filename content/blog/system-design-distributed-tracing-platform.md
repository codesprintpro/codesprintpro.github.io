---
title: "System Design: Building a Distributed Tracing Platform"
description: "Design a production distributed tracing platform with trace ingestion, context propagation, sampling, span storage, trace query, retention, tenant isolation, and cost controls."
date: "2026-04-18"
category: "System Design"
tags: ["system design", "distributed tracing", "observability", "opentelemetry", "jaeger", "distributed systems", "backend engineering"]
featured: false
affiliateSection: "system-design-courses"
---

Metrics tell you that latency is bad.

Logs tell you that something failed somewhere.

Traces tell you which request went where, in what order, and where the time actually disappeared.

That is why tracing becomes essential once one user request crosses many services. Without it, debugging a slow checkout or flaky order flow turns into a manual archaeology exercise across logs, timestamps, and guesses. With it, you get a request tree showing exactly which hop or dependency caused the pain.

This guide designs a production distributed tracing platform.

## Problem Statement

Build a platform that ingests, stores, and queries distributed traces from many services.

Examples:

- request path across API gateway, auth, inventory, payment, and notification services
- batch workflow trace spanning queue consumers and downstream APIs
- async event flow from producer to Kafka to consumer to database
- internal RPC trace across tens of microservices

The platform should support:

- trace and span ingestion
- trace context propagation across services
- indexing and querying by trace attributes
- retention and cost control
- sampling
- multi-tenant isolation
- operational debugging during incidents

This is not an instrumentation tutorial. It is the architecture of the platform behind those traces.

## Requirements

Functional requirements:

- accept traces from many services
- support HTTP, RPC, queue, and async span relationships
- search traces by service, operation, status, duration, tenant, and time window
- retrieve complete trace trees
- support head or tail sampling
- support trace retention policies
- expose metrics on ingestion and query performance

Non-functional requirements:

- high write throughput
- bounded query latency
- efficient storage
- protection against cardinality explosions
- resilience during partial outages
- low operational friction for onboarding services

The main design challenge:

**traces are extremely high-volume, richly structured, and often only useful when a rare interesting request can still be found quickly.**

## Core Data Model

A distributed trace consists of:

- **trace**: one end-to-end request or workflow
- **span**: one timed operation inside the trace
- **parent-child links** between spans

Example:

```text
Trace ID: t_123

Span 1: API Gateway            0ms - 1200ms
  Span 2: Order Service       20ms - 1180ms
    Span 3: Inventory Check   40ms - 120ms
    Span 4: Payment Call     130ms - 1080ms
      Span 5: PSP HTTP Call  140ms - 1070ms
```

Each span has:

- trace id
- span id
- parent span id
- service name
- operation name
- start time
- duration
- status
- attributes / tags
- events / logs

## High-Level Architecture

```text
Instrumented Services
     |
     v
Tracing SDK / Agent
     |
     v
Collector Layer
     |
     +--> validation
     +--> batching
     +--> optional tail sampling
     +--> enrichment
     |
     v
Trace Ingestion Pipeline
     |
     +--> hot trace store
     +--> searchable index
     +--> cold object storage
     |
     v
Query API / Trace UI
```

A practical system often separates:

- collection
- sampling
- storage
- search/index
- UI / query API

## Ingestion Flow

The basic flow:

1. services emit spans through OpenTelemetry or similar SDKs
2. collectors receive batches
3. collectors validate and optionally enrich spans
4. traces are sampled or filtered
5. accepted spans are written to storage
6. query indexes are updated

Important principle:

**applications should not talk directly to the storage backend if you can avoid it.**

A collector layer gives you:

- batching
- retries
- transport normalization
- sampling centralization
- vendor isolation

## Span Schema

Conceptual schema:

```sql
CREATE TABLE spans (
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  tenant_id TEXT,
  service_name TEXT NOT NULL,
  operation_name TEXT NOT NULL,
  status_code TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  duration_ms BIGINT NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trace_id, span_id)
);
```

But in practice, you usually do **not** want a giant OLTP table as the primary storage engine at scale.

Distributed tracing platforms usually need:

- append-heavy writes
- time-bucketed partitioning
- cheap retrieval by trace id
- searchable metadata index

So the real architecture is often split into:

- trace block / span store
- secondary search index

## Hot Store vs Search Index

These solve different problems.

### Hot trace store

Optimized for:

- fetching full traces by trace id
- writing spans quickly
- recent retention windows

### Search index

Optimized for:

- "show errors from `payment-service` in last 15 minutes"
- "find traces over 2 seconds involving tenant `merchant_42`"
- "find traces where route = `/checkout` and status = error"

This is why tracing platforms often store raw spans in one place and searchable metadata in another.

## Trace Assembly

Spans for one trace rarely arrive in perfect order.

Why:

- clock skew
- buffering differences
- async delivery
- queue consumers and background spans

So the platform must handle partial traces.

A trace assembler may:

1. group spans by trace id
2. wait briefly for more spans
3. mark trace complete-ish after an inactivity window

But it should also tolerate late spans arriving after the UI first shows the trace.

Do not assume "all spans arrive together."

## Context Propagation

Without propagation, there is no distributed trace.

Propagation typically carries:

- trace id
- parent span id
- sampling flag

Across:

- HTTP headers
- gRPC metadata
- message queue headers
- async job payload metadata

The platform design implication:

- all services should emit spans in a standard context format
- collectors should normalize those spans into one internal shape

The tricky case is async work:

- producer creates span
- message lands in Kafka
- consumer later continues the trace

The trace platform must support those links without assuming a single synchronous call tree.

## Sampling

Tracing everything forever is rarely affordable.

Sampling is how you control cost and noise.

### Head sampling

Decision made at trace start.

Pros:

- cheap
- easy

Cons:

- may miss the interesting traces

### Tail sampling

Decision made after seeing more of the trace.

Examples:

- keep all error traces
- keep traces slower than 1 second
- sample only 1% of healthy low-latency traffic

Pros:

- much higher value per stored trace

Cons:

- requires buffering and coordination

Tail sampling is often the better operational choice, but it makes the collector and buffering layer more complex.

## Tail Sampling Design

A tail sampler needs:

- temporary trace buffer keyed by trace id
- time window before deciding
- policies for errors, latency, tenant priority, or service importance

Example:

```text
Keep if:
  - any span has error status
  - total duration > 1000ms
  - tenant is premium and duration > 300ms
Else:
  - sample 1%
```

This means the collector layer must hold partial traces for some seconds before final write.

That is a real design trade-off:

- better signal quality
- more memory and coordination cost

## Storage Strategy

Tracing data grows fast.

Example scale:

```text
50,000 requests/sec
average 12 spans/request
= 600,000 spans/sec

At 1 KB/span:
= ~600 MB/sec raw
= ~51 TB/day raw before compression and sampling
```

This is why:

- batching matters
- sampling matters
- retention policy matters

A realistic platform uses tiers:

### Hot tier

- recent traces
- fast search and retrieval
- perhaps 1-7 days

### Warm / cold tier

- older traces in object storage
- slower search or trace-by-id restore
- cheaper retention

Not every debugging need requires 30 days of instant search.

## Partitioning

Tracing systems usually partition by:

- time bucket
- tenant
- trace id hash

You want:

- fast recent writes
- good balance across storage shards
- cheap retrieval by trace id

A common pattern:

- store trace bodies by `(date bucket, trace_id hash)`
- store search metadata by `(time bucket, indexed fields)`

## Searchable Metadata

You do not want every span attribute indexed.

That is how cardinality explosions happen.

Examples of safe-ish index fields:

- service name
- operation name
- status
- duration bucket
- environment
- tenant id
- route template

Dangerous fields:

- request id
- user id at very large scale
- raw SQL text
- arbitrary unbounded tags

The platform should enforce indexable-attribute policy instead of allowing every team to invent unbounded keys freely.

## Query API

Typical queries:

- find slow traces in `checkout-service`
- find error traces for `tenant_42`
- find traces touching `payment-service` and `fraud-service`
- fetch full trace by trace id

Example search API:

```http
GET /v1/traces/search?service=checkout-service&minDurationMs=1000&status=error&from=2026-04-18T09:00:00Z&to=2026-04-18T10:00:00Z
```

Trace fetch:

```http
GET /v1/traces/t_123
```

The search layer should return:

- matching trace ids
- summary metadata
- maybe root span and duration

Then the UI can fetch full trace details only when needed.

## Span Events and Logs

A span may contain events such as:

- retry scheduled
- timeout reached
- payment authorization failed

These are useful, but can explode volume if abused.

Guideline:

- use events for important trace-local milestones
- do not dump full application logs into span events blindly

Tracing systems are not full log storage systems.

## Multi-Tenancy

If the platform serves many teams or customers:

- isolate tenant writes and queries
- enforce per-tenant quotas
- allow retention policy by tenant tier
- keep one tenant’s burst from degrading everyone else

That means limits on:

- spans/sec
- indexed attribute count
- max trace size
- query concurrency

Without quotas, one noisy tenant or runaway deploy can make the tracing platform itself the incident.

## Failure Modes

### 1. Collector backlog grows during incident

Cause:

- trace burst
- storage slow

Fix:

- bounded queues
- drop low-priority traces first
- preserve error traces preferentially

### 2. Search index lags behind raw trace store

Cause:

- indexing bottleneck

Fix:

- separate raw trace ingestion from metadata indexing
- allow direct trace-id fetch even if search is lagging

### 3. Tail sampler memory pressure

Cause:

- too many open traces
- large waiting window

Fix:

- bound trace buffers
- force early decisions under pressure
- spill lower-priority traces

### 4. Cardinality explosion

Cause:

- new unbounded attribute indexed

Fix:

- index allowlist
- drop or hash unsafe attributes
- usage alerts

### 5. Missing async trace linkage

Cause:

- context not propagated through queue headers

Fix:

- standard instrumentation
- propagation tests

## Observability of the Tracing Platform

Yes, the tracing platform needs its own observability.

Track:

- spans/sec ingested
- dropped spans/sec
- collector queue depth
- tail-sampling decision delay
- trace search latency
- trace fetch latency
- storage write errors
- metadata indexing lag
- top attributes by cardinality

Useful dashboards:

- collector health by region
- search latency during incidents
- drop rate by reason
- storage utilization and retention burn rate

## Example Ingestion Worker Logic

```java
public class TraceIngestionService {

    public void ingest(SpanBatch batch) {
        for (SpanData span : batch.spans()) {
            if (!attributePolicy.isAllowed(span.attributes())) {
                span = attributePolicy.sanitize(span);
            }

            traceBuffer.append(span.traceId(), span);
        }

        for (String traceId : traceBuffer.flushableTraceIds()) {
            TraceData trace = traceBuffer.build(traceId);

            if (samplingPolicy.keep(trace)) {
                traceStore.write(trace);
                searchIndexer.index(trace.summary());
            }
        }
    }
}
```

In reality this gets more sophisticated, but the conceptual responsibilities stay the same:

- sanitize
- buffer
- sample
- store
- index

## What I Would Build First

Phase 1:

- collector layer
- basic span ingestion
- trace-by-id hot store
- simple search by service and duration

Phase 2:

- searchable metadata index
- retention tiers
- attribute allowlist and quotas
- basic tail sampling

Phase 3:

- richer query model
- advanced tenant controls
- archive restore / cold retrieval
- more sophisticated tail-sampling policies

This order matters. Teams often jump straight to fancy UIs before they have sane ingestion, sampling, and storage economics.

## Production Checklist

- context propagation standardized
- ingestion decoupled via collectors
- search and raw trace storage separated
- tail or head sampling policy explicit
- indexable attributes controlled
- trace and tenant quotas enforced
- storage tiers and retention defined
- dropped-span reasons visible
- async propagation tested
- trace-id fetch works even if search lags

## Final Takeaway

A distributed tracing platform is not just a pretty waterfall UI.

It is a high-volume observability data system that decides which traces are worth keeping, how quickly they can be found, and how safely that can happen during the exact incidents when engineers need it most.

If you design it well, traces become a practical debugging tool instead of an expensive science project.

If you design it poorly, the platform collapses under its own telemetry volume or hides the interesting traces behind noise.

## Read Next

- [System Design: Building a Metrics Platform Like Prometheus](/blog/system-design-metrics-platform/)
- [Distributed Tracing with OpenTelemetry: End-to-End Observability](/blog/distributed-tracing-opentelemetry/)
- [Observability with OpenTelemetry in Production](/blog/observability-opentelemetry-production/)
