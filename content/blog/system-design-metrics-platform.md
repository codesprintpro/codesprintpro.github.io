---
title: "System Design: Building a Metrics Platform Like Prometheus"
description: "Design a production metrics platform: ingestion, scraping vs push, time-series storage, labels and cardinality, rollups, retention, alerting, query APIs, multi-tenancy, downsampling, and operational guardrails."
date: "2026-04-08"
category: "System Design"
tags: ["system design", "metrics", "observability", "time series", "prometheus", "alerting", "distributed systems"]
featured: false
affiliateSection: "system-design-courses"
---

Metrics platforms answer operational questions quickly:

- Is error rate increasing?
- Which service owns the latency spike?
- Did a deployment change request volume?
- Which tenant is causing the queue backlog?
- Are we about to run out of disk, memory, or connections?

At small scale, Prometheus plus Grafana is enough. At larger scale, the hard parts are not the line charts. The hard parts are ingestion fanout, high-cardinality labels, retention, downsampling, alert evaluation, multi-tenancy, query cost, and keeping the platform alive during the exact incidents it is supposed to debug.

This guide designs a production metrics platform inspired by Prometheus-style systems. It covers ingestion, scraping versus push, storage, label indexing, rollups, retention, alerting, multi-tenancy, query APIs, and operational guardrails.

## Requirements

Functional requirements:

- collect metrics from services and infrastructure
- support counters, gauges, and histograms
- query recent and historical metrics
- group and filter by labels
- create dashboards
- evaluate alert rules
- retain raw and downsampled data
- isolate tenants or teams

Non-functional requirements:

- high write throughput
- predictable query latency
- horizontal ingestion scaling
- protection against high-cardinality explosions
- durable storage
- efficient compression
- alerting that works during incidents
- cost-aware retention
- clear operational limits

The main trade-off is flexibility versus cost. Labels make metrics powerful, but unbounded labels can destroy storage and query performance.

## Data Model

A time series is identified by metric name plus labels:

```text
http_requests_total{
  service="checkout-api",
  method="POST",
  route="/v1/orders",
  status="200"
}
```

Each sample has a timestamp and value:

```json
{
  "metric": "http_requests_total",
  "labels": {
    "service": "checkout-api",
    "method": "POST",
    "route": "/v1/orders",
    "status": "200"
  },
  "timestamp": "2026-04-08T10:15:30Z",
  "value": 1842
}
```

The series key is:

```text
metric_name + sorted(label_key=label_value pairs)
```

This is why cardinality matters. If a label contains `user_id`, every user creates a new time series. If it contains `request_id`, every request creates a new time series. That is not observability; that is an accidental database denial-of-service.

## Pull Versus Push

There are two common collection models.

### Pull

The collector scrapes targets:

```text
collector -> GET /metrics -> service
```

Benefits:

- centralized control over scrape interval
- easy target health detection
- natural fit for service discovery
- avoids each service needing remote write logic

Problems:

- harder for short-lived jobs
- network topology can block scraping
- collector must discover targets

### Push

The service sends metrics:

```text
service -> remote write -> ingestion gateway
```

Benefits:

- works across network boundaries
- easier for short-lived jobs
- natural for mobile/edge or serverless

Problems:

- clients can overload ingestion
- harder to know whether missing data means service down or no traffic
- retry behavior must be controlled

A production platform often supports both: pull for services inside the cluster and push/remote-write for external or short-lived workloads.

## High-Level Architecture

```text
Services
  |
  +-- /metrics scrape endpoint
  +-- remote write client
        |
        v
Ingestion layer
  |
  +-- validate labels
  +-- enforce tenant limits
  +-- normalize samples
  +-- shard by series hash
        |
        v
Time-series storage
  |
  +-- recent raw blocks
  +-- long-term object storage
  +-- downsampled blocks
        |
        v
Query service
  |
  +-- dashboard queries
  +-- alert evaluator
  +-- API clients
```

Separate ingestion from querying. During an incident, dashboards may become expensive because everyone is refreshing them. That should not block ingestion of new samples.

## Ingestion API

For a push path, accept batches:

```json
{
  "tenantId": "tenant_abc",
  "samples": [
    {
      "name": "http_requests_total",
      "labels": {
        "service": "checkout-api",
        "method": "POST",
        "route": "/v1/orders",
        "status": "200"
      },
      "timestamp": 1775643330000,
      "value": 1842
    }
  ]
}
```

Validation rules:

- metric name must match a safe pattern
- label keys must match a safe pattern
- label values must have length limits
- timestamps must be within an allowed skew
- batch size must be capped
- tenant must have a sample-rate limit
- tenant must have a series-cardinality limit

Example validation:

```ts
const RESERVED_LABELS = new Set(["tenant_id", "__name__"]);

function validateSample(sample: MetricSample): void {
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(sample.name)) {
    throw new Error("invalid metric name");
  }

  for (const [key, value] of Object.entries(sample.labels)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      throw new Error(`invalid label key: ${key}`);
    }

    if (RESERVED_LABELS.has(key)) {
      throw new Error(`reserved label key: ${key}`);
    }

    if (String(value).length > 200) {
      throw new Error(`label value too long: ${key}`);
    }
  }
}
```

Reject bad metrics at ingestion. Do not wait for storage to melt.

## Sharding By Series

Shard samples by series hash:

```ts
function seriesKey(name: string, labels: Record<string, string>): string {
  const labelString = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");

  return `${name}{${labelString}}`;
}

function shardForSeries(series: string, shardCount: number): number {
  return murmur3(series) % shardCount;
}
```

Why shard by series, not by timestamp? Because samples for the same series should land together for compression and query efficiency.

This also makes ingestion state easier. Each shard owns a subset of series and can buffer samples before writing compressed blocks.

## Storage Layout

Time-series stores usually organize data into blocks:

```text
block/
  meta.json
  chunks/
    000001
    000002
  index
```

The chunks store compressed sample data. The index maps metric and labels to series IDs and chunk locations.

A simplified relational view:

```sql
CREATE TABLE metric_series (
  series_id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  labels_hash TEXT NOT NULL,
  labels JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, metric_name, labels_hash)
);

CREATE TABLE metric_samples (
  tenant_id TEXT NOT NULL,
  series_id BIGINT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (tenant_id, series_id, ts)
);
```

This SQL schema is useful for understanding, but a high-volume metrics platform usually needs a purpose-built time-series format, columnar storage, or block files in object storage. The key concept is the same: series metadata and samples are stored separately.

## Label Index

Queries like this need a label index:

```text
rate(http_requests_total{service="checkout-api", status=~"5.."}[5m])
```

The query engine must find series where:

- metric name is `http_requests_total`
- label `service` is `checkout-api`
- label `status` matches `5..`

Index shape:

```text
tenant_id + metric_name -> series IDs
tenant_id + label_key + label_value -> series IDs
```

For regex matchers, the engine may need to scan label values. This is why unbounded label values are dangerous. A regex over millions of unique paths, user IDs, or request IDs becomes expensive fast.

## Cardinality Guardrails

Cardinality is the number of unique time series.

Bad:

```text
http_requests_total{user_id="u_123", request_id="req_456"}
```

Better:

```text
http_requests_total{service="checkout-api", route="/v1/orders", status="200"}
```

Guardrails:

- reject labels named `user_id`, `email`, `request_id`, `session_id`
- limit new series per tenant per minute
- limit total active series per tenant
- alert on cardinality spikes
- expose top label cardinality reports
- require approval for new high-cardinality metrics

Example:

```ts
const BLOCKED_LABELS = new Set(["user_id", "email", "request_id", "session_id"]);

async function enforceCardinalityBudget(input: {
  tenantId: string;
  seriesKey: string;
  labels: Record<string, string>;
}): Promise<void> {
  for (const label of Object.keys(input.labels)) {
    if (BLOCKED_LABELS.has(label)) {
      throw new Error(`blocked high-cardinality label: ${label}`);
    }
  }

  const isNewSeries = await seriesRegistry.isNew(input.tenantId, input.seriesKey);
  if (!isNewSeries) {
    return;
  }

  const allowed = await rateLimiter.allow(`new-series:${input.tenantId}`, 1000, "1m");
  if (!allowed) {
    throw new Error("new series rate limit exceeded");
  }
}
```

The correct response to cardinality problems is not "buy more storage" forever. It is label discipline.

## Rollups And Downsampling

Raw metrics are expensive to keep forever. Use retention tiers:

| Tier | Resolution | Retention |
|---|---|---|
| Raw | 10-30 seconds | 7-30 days |
| 5 minute rollup | 5 minutes | 90-180 days |
| 1 hour rollup | 1 hour | 1-2 years |

Rollup job:

```sql
INSERT INTO metric_rollups_5m (
  tenant_id,
  series_id,
  bucket_start,
  min_value,
  max_value,
  avg_value,
  sum_value,
  sample_count
)
SELECT
  tenant_id,
  series_id,
  date_trunc('minute', ts) - ((extract(minute from ts)::int % 5) * interval '1 minute') AS bucket_start,
  min(value),
  max(value),
  avg(value),
  sum(value),
  count(*)
FROM metric_samples
WHERE ts >= :window_start
  AND ts < :window_end
GROUP BY tenant_id, series_id, bucket_start;
```

Counters, gauges, and histograms need different rollup logic. Do not blindly average everything.

## Histograms

Latency averages hide tail pain. Use histograms.

Example buckets:

```text
http_request_duration_seconds_bucket{le="0.05"} 120
http_request_duration_seconds_bucket{le="0.1"}  340
http_request_duration_seconds_bucket{le="0.5"}  900
http_request_duration_seconds_bucket{le="1.0"}  980
http_request_duration_seconds_bucket{le="+Inf"} 1000
```

Histograms increase series count because each bucket is a series. That is worth it for important paths, but not every metric needs many buckets.

Guidelines:

- define standard latency buckets per platform
- keep route labels normalized
- avoid per-user labels
- use fewer buckets for low-value metrics
- track p95 and p99 from histograms, not averages

## Query API

The query service should enforce cost controls:

```ts
type QueryLimits = {
  maxRangeDays: number;
  maxSeries: number;
  maxSamples: number;
  timeoutMs: number;
};

function validateQuery(query: MetricsQuery, limits: QueryLimits): void {
  if (query.rangeDays > limits.maxRangeDays) {
    throw new Error("query range too large");
  }

  if (query.estimatedSeries > limits.maxSeries) {
    throw new Error("query matches too many series");
  }

  if (query.estimatedSamples > limits.maxSamples) {
    throw new Error("query scans too many samples");
  }
}
```

Dashboards can create accidental query storms. A dashboard with 30 panels refreshing every 5 seconds is a load test. Cache query results, cap refresh rates, and add per-tenant query limits.

## Alert Evaluation

Alerts are scheduled queries with state.

Example alert:

```yaml
name: checkout_error_rate_high
expr: rate(http_requests_total{service="checkout-api",status=~"5.."}[5m]) > 0.05
for: 10m
labels:
  severity: page
annotations:
  summary: Checkout API 5xx rate is high
```

Alert evaluator state:

```sql
CREATE TABLE alert_rule_state (
  rule_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  state TEXT NOT NULL, -- OK, PENDING, FIRING, NO_DATA, ERROR
  first_pending_at TIMESTAMPTZ,
  last_evaluated_at TIMESTAMPTZ NOT NULL,
  last_value DOUBLE PRECISION,
  last_error TEXT
);
```

The `for` duration prevents flapping. The alert fires only if the expression remains true for the configured duration.

Alerting must be isolated from dashboard traffic. During incidents, dashboard usage increases. Alerts should keep evaluating even when ad hoc queries are heavy.

## Multi-Tenancy

A metrics platform often serves many teams or customers.

Tenant controls:

- active series limit
- samples per second limit
- ingestion burst limit
- query concurrency limit
- query range limit
- retention policy
- dashboard refresh limits
- alert rule count limit

Every sample should carry a tenant ID internally, even if users do not provide it. Do not trust client-provided tenant labels for authorization.

## Failure Modes

**Cardinality explosion.** A deploy adds `request_id` as a label and creates millions of series.

**Query storm.** A dashboard or user runs wide regex queries over long ranges.

**Alert evaluator starvation.** Dashboard queries consume shared query capacity and delay alert evaluation.

**Ingestion backpressure.** Services retry remote writes aggressively and overload the ingestion layer.

**Late samples.** Network delays deliver samples outside the expected time window.

**Clock skew.** Bad host time produces samples in the future or past.

**No data confusion.** Missing metrics can mean service down, scrape broken, or genuinely zero traffic.

**Retention surprise.** Raw data expired, but an incident investigation needs high-resolution history.

## Production Checklist

- Define allowed metric and label naming rules.
- Block obvious high-cardinality labels.
- Enforce new-series limits.
- Enforce per-tenant sample limits.
- Separate ingestion from query workloads.
- Use series-hash sharding.
- Store series metadata separately from samples.
- Add retention tiers and downsampling.
- Treat histograms as valuable but cardinality-expensive.
- Cache dashboard queries.
- Isolate alert evaluation from dashboard traffic.
- Track ingestion lag and dropped samples.
- Track top tenants by active series and sample rate.
- Add no-data handling for critical alerts.
- Document metric ownership by service/team.

## Read Next

- [Building Production Observability with OpenTelemetry and Grafana Stack](/blog/observability-opentelemetry-production/)
- [Time-Series Databases: InfluxDB, TimescaleDB, and Prometheus](/blog/time-series-databases/)
- [Production Incident Playbooks](/blog/production-incident-playbooks/)
- [System Design: Rate Limiter](/blog/system-design-rate-limiter/)
