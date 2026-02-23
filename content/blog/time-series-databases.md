---
title: "Time-Series Databases: InfluxDB vs TimescaleDB vs Prometheus"
description: "Choose the right time-series database for metrics, IoT, and observability workloads. Deep comparison of InfluxDB, TimescaleDB, and Prometheus with retention policies, downsampling, and query patterns."
date: "2025-03-29"
category: "Databases"
tags: ["time-series", "influxdb", "timescaledb", "prometheus", "observability", "iot", "databases"]
featured: false
affiliateSection: "database-resources"
---

Time-series data is fundamentally different from general-purpose data: it arrives in time order, is queried by time ranges, has predictable decay in value, and has write patterns that overwhelm traditional relational databases. InfluxDB, TimescaleDB, and Prometheus each solve this problem differently. Picking the wrong one means data loss, query timeouts, or a rewrite 6 months later.

## Why Regular Databases Fail for Time-Series

Before looking at the solutions, it is worth understanding exactly why a general-purpose database like PostgreSQL struggles here. The problem is not just volume — it is the combination of write velocity, append-only patterns, and the fact that most data becomes cold and rarely queried after a short window.

```
IoT sensor data: 10,000 sensors × 1 reading/second = 10,000 inserts/second

PostgreSQL (without time-series extension):
  - B-tree index insertion: O(log n) per row
  - At 10K/sec: 1 billion rows/day = 864GB raw data
  - Index grows unbounded: 200GB+ index for 864GB data
  - Query: "average temperature last hour" → full index scan of 36M rows
  - Write amplification: each insert touches multiple B-tree pages

Vacuum and bloat:
  - Sensor readings are append-only → vacuum can't reclaim space well
  - Table bloat after months = 3× actual data size

TimescaleDB solves this by:
  - Chunking data by time window (1-day chunks by default)
  - Old chunks become immutable → no vacuum overhead
  - Query planner prunes chunks by time → only scan relevant chunks
  - Chunk-level compression: 90-95% size reduction
```

The core insight is that time-series data has a natural expiry: you care deeply about the last hour, somewhat about the last week, and almost never about data from 18 months ago. Time-series databases exploit this by automatically tiering, compressing, and eventually dropping old data — something a general-purpose database makes you implement yourself.

## InfluxDB: Purpose-Built TSDB

InfluxDB is designed exclusively for time-series data with its own query language (Flux) and data model.

InfluxDB's data model separates metadata (tags) from measurements (fields), which is a deliberate design choice: tags are indexed and meant for filtering and grouping, while fields are just stored values. If you mistakenly put a high-cardinality value (like a user ID) in a tag, InfluxDB's index grows unbounded and performance degrades dramatically. Get this distinction right and InfluxDB is extremely fast.

```
Data model:
  Measurement: cpu_usage          (like a table)
  Tags: host=web-1, region=us-east (indexed metadata — filtering)
  Fields: cpu_percent=89.2, load=1.23 (values — not indexed)
  Timestamp: 2025-03-29T10:00:00Z (nanosecond precision)

Written as line protocol:
  cpu_usage,host=web-1,region=us-east cpu_percent=89.2,load=1.23 1711699200000000000
```

The Python client below shows the two most important write patterns: single-point writes for low-frequency data, and batch writes for high-frequency sensors. Always prefer batch writes for anything above a few points per second — sending one HTTP request per data point at high volume is the fastest way to overwhelm both the client and the server.

```python
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS
from datetime import datetime, timedelta

client = InfluxDBClient(
    url="http://localhost:8086",
    token="your-admin-token",
    org="your-org"
)

write_api = client.write_api(write_options=SYNCHRONOUS)

# Write a point
point = (
    Point("cpu_usage")
    .tag("host", "web-1")
    .tag("region", "us-east")
    .field("cpu_percent", 89.2)
    .field("load_1m", 1.23)
    .time(datetime.utcnow())
)
write_api.write(bucket="metrics", record=point)

# Batch write (efficient for high-frequency data)
points = [
    Point("cpu_usage")
        .tag("host", f"web-{i}")
        .field("cpu_percent", 40 + i * 2.5)
        .time(datetime.utcnow())
    for i in range(100)
]
write_api.write(bucket="metrics", record=points)

# Query with Flux
query_api = client.query_api()

# Average CPU per host, last 1 hour
query = '''
from(bucket: "metrics")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "cpu_usage")
  |> filter(fn: (r) => r._field == "cpu_percent")
  |> group(columns: ["host"])
  |> mean()
  |> sort(columns: ["_value"], desc: true)
'''

result = query_api.query(query=query, org="your-org")
for table in result:
    for record in table.records:
        print(f"Host: {record['host']}, Avg CPU: {record['_value']:.1f}%")

# Downsampled aggregation: 5-minute averages over last 7 days
query = '''
from(bucket: "metrics")
  |> range(start: -7d)
  |> filter(fn: (r) => r._measurement == "cpu_usage")
  |> filter(fn: (r) => r._field == "cpu_percent")
  |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)
'''
```

Retention policies and automatic downsampling are where InfluxDB really shines for IoT workloads. The tier structure below keeps raw data for just 7 days, then retains progressively coarser aggregates for months or years. This gives you fast recent queries on raw data and affordable long-term trend analysis on pre-aggregated data — without any manual data management.

```
InfluxDB Retention Policies:
  Bucket: metrics_raw        → retention: 7 days   (high resolution)
  Bucket: metrics_hourly     → retention: 90 days  (1-hour aggregates)
  Bucket: metrics_daily      → retention: 2 years  (daily aggregates)

InfluxDB Task (continuous downsampling):
  option task = {name: "Downsample to hourly", every: 1h}

  from(bucket: "metrics_raw")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "cpu_usage")
    |> aggregateWindow(every: 1h, fn: mean)
    |> to(bucket: "metrics_hourly")
```

## TimescaleDB: PostgreSQL for Time-Series

TimescaleDB extends PostgreSQL with time-series superpowers while remaining fully PostgreSQL-compatible.

The biggest advantage of TimescaleDB is not performance — it is familiarity. If your team already knows SQL, already operates PostgreSQL, and already has tooling around it, TimescaleDB adds time-series capability without introducing a new database engine to learn, operate, and monitor.

The setup process below is intentionally familiar: you create a normal PostgreSQL table, then call `create_hypertable` to activate TimescaleDB's automatic partitioning. Existing applications that query this table via standard SQL continue to work unchanged — TimescaleDB is transparent to the query layer.

```sql
-- Enable extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Create a regular table first
CREATE TABLE sensor_data (
    time        TIMESTAMPTZ NOT NULL,
    sensor_id   VARCHAR(50) NOT NULL,
    location    VARCHAR(100),
    temperature DOUBLE PRECISION,
    humidity    DOUBLE PRECISION,
    pressure    DOUBLE PRECISION
);

-- Convert to hypertable (TimescaleDB magic)
-- Creates automatic partitioning by time (7-day chunks by default)
SELECT create_hypertable('sensor_data', 'time');

-- Optional: partition by space dimension too (for IoT: partition by sensor_id)
SELECT create_hypertable('sensor_data', 'time',
    partitioning_column => 'sensor_id',
    number_partitions => 8
);

-- Indexes (TimescaleDB creates them per chunk → much more efficient)
CREATE INDEX idx_sensor_data_sensor_time ON sensor_data (sensor_id, time DESC);
```

TimescaleDB's `time_bucket` function is the key abstraction for time-series aggregation. It divides the time axis into equal windows (5 minutes, 1 hour, 1 day) and lets you aggregate within each window using standard SQL aggregates. Gap filling is equally valuable — real sensor networks have missing data, and `LOCF` (Last Observation Carry Forward) lets you produce clean, uniform time series for dashboards without preprocessing the data in your application.

```sql
-- Queries: full PostgreSQL SQL + time-series functions
-- Last hour of readings for a sensor
SELECT time, temperature, humidity
FROM sensor_data
WHERE sensor_id = 'sensor-42'
  AND time > NOW() - INTERVAL '1 hour'
ORDER BY time DESC;

-- TimescaleDB time_bucket: aggregate by time window
SELECT
    time_bucket('5 minutes', time) AS bucket,
    sensor_id,
    AVG(temperature)   AS avg_temp,
    MIN(temperature)   AS min_temp,
    MAX(temperature)   AS max_temp,
    COUNT(*)           AS readings
FROM sensor_data
WHERE time > NOW() - INTERVAL '24 hours'
GROUP BY bucket, sensor_id
ORDER BY bucket DESC, sensor_id;

-- Gap filling: fill missing intervals with NULL or forward-fill
SELECT
    time_bucket_gapfill('5 minutes', time) AS bucket,
    sensor_id,
    LOCF(AVG(temperature)) AS temperature  -- Last observation carry forward
FROM sensor_data
WHERE time BETWEEN NOW() - INTERVAL '24h' AND NOW()
GROUP BY bucket, sensor_id
ORDER BY bucket;
```

Compression and continuous aggregates are the features that make TimescaleDB viable for long-running IoT deployments. The SQL below enables columnar compression on chunks older than 7 days — yielding 90%+ storage reduction for typical sensor data — and creates a materialized view that is automatically refreshed. Queries against `sensor_hourly` return pre-aggregated data instantly, rather than scanning millions of raw readings.

```sql
-- Compression (90%+ reduction for IoT data)
-- Enable compression with 7-day delay (keep last 7 days uncompressed for fast inserts)
ALTER TABLE sensor_data SET (
    timescaledb.compress,
    timescaledb.compress_orderby = 'time DESC',
    timescaledb.compress_segmentby = 'sensor_id'
);

SELECT add_compression_policy('sensor_data', INTERVAL '7 days');

-- Automatic retention policy
SELECT add_retention_policy('sensor_data', INTERVAL '1 year');

-- Continuous aggregates (materialized, automatically updated)
CREATE MATERIALIZED VIEW sensor_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS hour,
    sensor_id,
    AVG(temperature) AS avg_temp,
    MIN(temperature) AS min_temp,
    MAX(temperature) AS max_temp
FROM sensor_data
GROUP BY hour, sensor_id
WITH NO DATA;

-- Policy: refresh aggregate every hour for last 3 hours
SELECT add_continuous_aggregate_policy('sensor_hourly',
    start_offset => INTERVAL '3 hours',
    end_offset   => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour'
);

-- Query the materialized aggregate (fast, pre-computed)
SELECT * FROM sensor_hourly
WHERE sensor_id = 'sensor-42'
  AND hour > NOW() - INTERVAL '7 days'
ORDER BY hour DESC;
```

## Prometheus: Metrics-First

Prometheus is a pull-based metrics system — services expose metrics, Prometheus scrapes them.

Prometheus works on an inverted model from the other two databases: instead of your application pushing data to Prometheus, Prometheus reaches out and pulls from your services on a schedule. This pull model makes it easy to see when a service is down (it stops being scrapeable), and it keeps the metrics pipeline decoupled from application code — your service just needs to expose an HTTP endpoint.

The configuration below sets up Prometheus to scrape three Spring Boot microservices and a node exporter for server-level metrics. Services must expose a `/actuator/prometheus` endpoint, which Spring Boot's Micrometer integration provides automatically when you add the `micrometer-registry-prometheus` dependency.

```yaml
# prometheus.yml
global:
  scrape_interval: 15s      # How often to scrape

scrape_configs:
  - job_name: spring-boot-services
    metrics_path: /actuator/prometheus
    static_configs:
      - targets:
        - order-service:8080
        - payment-service:8080
        - inventory-service:8080

  - job_name: node-exporter    # Server metrics (CPU, memory, disk)
    static_configs:
      - targets: ['node-exporter:9100']

# Retention
storage:
  tsdb:
    retention.time: 15d
    retention.size: 50GB

# For long-term storage: Thanos or VictoriaMetrics sidecar
```

Beyond the built-in HTTP metrics that Micrometer auto-instruments (request rate, latency histograms, JVM stats), you often want custom business metrics. The three metric types below cover the most common use cases: counters for things that only go up (orders created), histograms for distributions (order value), and gauges for current state (pending order count). Defining these in a dedicated metrics class keeps instrumentation organized and testable.

```java
// Spring Boot Prometheus metrics (auto-instrumented)
// Add dependency: micrometer-registry-prometheus

// Custom business metrics
@Service
public class OrderMetrics {

    @Autowired
    private MeterRegistry registry;

    // Counter: total orders created
    private Counter ordersCreated = Counter.builder("orders.created.total")
        .tag("payment_method", "credit_card")
        .description("Total orders created")
        .register(registry);

    // Histogram: order value distribution
    private DistributionSummary orderValue = DistributionSummary
        .builder("orders.value.cents")
        .scale(0.01)  // Convert cents to dollars for display
        .publishPercentiles(0.5, 0.95, 0.99)
        .register(registry);

    // Gauge: current pending orders
    private AtomicInteger pendingOrders = registry.gauge(
        "orders.pending.current", new AtomicInteger(0)
    );
}
```

PromQL is the query language you use to turn raw metric samples into actionable signals in Grafana dashboards and alerting rules. The three queries below cover the most important patterns: computing a rate from a counter, calculating a high-percentile latency from a histogram, and expressing an alert threshold as a ratio. The `rate()` function is the workhorse of PromQL — it handles counter resets (service restarts) automatically and computes a per-second rate over the specified window.

```promql
# PromQL queries (used in Grafana dashboards)

# Request rate per second (5-minute window)
rate(http_server_requests_seconds_count[5m])

# P99 latency by service
histogram_quantile(0.99,
  sum by (service, le) (
    rate(http_server_requests_seconds_bucket[5m])
  )
)

# Alert: error rate > 5%
(
  sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m]))
  /
  sum(rate(http_server_requests_seconds_count[5m]))
) > 0.05
```

## Comparison and Decision Guide

| Factor | InfluxDB | TimescaleDB | Prometheus |
|---|---|---|---|
| **Query language** | Flux (custom) | SQL | PromQL |
| **Write throughput** | Very high (500K/sec) | High (100K/sec) | Low (pull-based) |
| **Cardinality limit** | Medium (millions) | High (billions) | Low (millions) |
| **Long-term storage** | Native buckets | Native + compression | Needs Thanos/VictoriaMetrics |
| **Joins/analytics** | Limited | Full SQL | No |
| **Use case** | IoT, telemetry | General time-series | Service metrics |
| **Operational complexity** | Medium | Low (just PostgreSQL) | Low |

The comparison above shows that no single tool is best across all dimensions. Use the decision guide below to match your specific requirements to the right choice, keeping in mind that many production setups combine two of these tools — typically Prometheus for short-term alerting and TimescaleDB or InfluxDB for long-term trend analysis.

```
Choose InfluxDB when:
  - IoT data at high velocity (100K+ writes/sec)
  - Need built-in downsampling and retention policies
  - Time-series is your only data model

Choose TimescaleDB when:
  - Already using PostgreSQL (zero new infrastructure)
  - Need SQL joins (time-series + relational data together)
  - Want compression + retention + SQL in one system
  - Application data and metrics in same database

Choose Prometheus when:
  - Monitoring and alerting is the primary use case
  - Service metrics (latency, error rate, saturation)
  - Grafana dashboards
  - Already in Kubernetes ecosystem
  - Short retention (15-30 days) is acceptable

Common architecture:
  Prometheus (short-term metrics) + Thanos (long-term storage)
  OR
  Prometheus (alerting/dashboards) + TimescaleDB (long-term analytics)
```

TimescaleDB is the pragmatic choice for most teams: if you already have PostgreSQL, it's zero additional infrastructure, the SQL compatibility means no new query language to learn, and the performance improvements over vanilla PostgreSQL are substantial. For high-velocity IoT data or when you need a purpose-built TSDB, InfluxDB shines. For monitoring and alerting in a Kubernetes environment, Prometheus is the de facto standard.
