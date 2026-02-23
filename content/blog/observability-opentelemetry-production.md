---
title: "Building Production Observability with OpenTelemetry and Grafana Stack"
description: "End-to-end observability implementation: distributed tracing with OpenTelemetry, metrics with Prometheus, structured logging with Loki, and the dashboards and alerts that actually help during incidents."
date: "2025-07-03"
category: "System Design"
tags: ["observability", "opentelemetry", "prometheus", "grafana", "loki", "tracing", "spring boot", "monitoring"]
featured: false
affiliateSection: "system-design-courses"
---

Observability is not the same as monitoring. Monitoring tells you something is wrong. Observability lets you understand why — by exploring system state through metrics, traces, and logs without needing to know in advance what questions you'd ask. The three pillars are not a framework you layer on after the fact; they shape how you instrument and operate your services from the start.

## The Three Pillars and How They Relate

```
Request arrives at Service A

Metrics:
  http_requests_total{service="A", status="200"} += 1
  http_request_duration_seconds{service="A", p99} = 0.284s
  → Tell you WHAT is happening (rates, latency, error rates)

Traces:
  TraceID: abc123
  SpanID:  span001 → ServiceA.handleRequest [150ms]
    SpanID: span002 → ServiceB.getUser [80ms]
      SpanID: span003 → PostgreSQL.query [70ms]
  → Tell you WHERE time is spent in a specific request

Logs:
  {"level":"INFO","traceId":"abc123","spanId":"span002",
   "message":"getUser called","userId":"12345","latency":80}
  → Tell you WHAT happened inside a specific component

Three pillars used together:
Metrics alert (P99 > 2s) → trace the slow request (traceId from logs) → find the bottleneck span
```

## OpenTelemetry Java SDK Setup

OpenTelemetry is the vendor-neutral standard for instrumentation. Use the Java agent for automatic instrumentation of Spring Boot:

```bash
# Add Java agent to JVM startup:
-javaagent:/opt/opentelemetry-javaagent.jar
-Dotel.service.name=order-service
-Dotel.service.version=2.1.0
-Dotel.exporter.otlp.endpoint=http://otel-collector:4317
-Dotel.traces.exporter=otlp
-Dotel.metrics.exporter=otlp
-Dotel.logs.exporter=otlp
-Dotel.resource.attributes=deployment.environment=production,team=platform
```

The Java agent automatically instruments:
- Spring MVC (incoming HTTP spans)
- Spring WebFlux
- Hibernate/JDBC (database query spans)
- RestTemplate/WebClient (outgoing HTTP spans)
- Kafka producers/consumers

**Manual instrumentation for business logic:**

```java
@Service
public class OrderService {

    private final Tracer tracer = GlobalOpenTelemetry.getTracer("order-service");
    private final Meter meter = GlobalOpenTelemetry.getMeter("order-service");
    private final LongCounter ordersCreated;

    public OrderService() {
        this.ordersCreated = meter.counterBuilder("orders.created")
            .setDescription("Total orders created")
            .setUnit("orders")
            .build();
    }

    public Order createOrder(OrderRequest request) {
        Span span = tracer.spanBuilder("createOrder")
            .setAttribute("order.user_id", request.getUserId())
            .setAttribute("order.item_count", request.getItems().size())
            .startSpan();

        try (Scope scope = span.makeCurrent()) {
            validateInventory(request);    // Child span auto-created
            chargePayment(request);        // Child span auto-created
            Order order = orderRepository.save(Order.from(request));

            span.setAttribute("order.id", order.getId().toString());
            ordersCreated.add(1,
                Attributes.of(
                    AttributeKey.stringKey("channel"), request.getChannel(),
                    AttributeKey.stringKey("payment_method"), request.getPaymentMethod()
                )
            );
            return order;
        } catch (Exception e) {
            span.recordException(e);
            span.setStatus(StatusCode.ERROR, e.getMessage());
            throw e;
        } finally {
            span.end();
        }
    }
}
```

## Prometheus Metrics Design

Good metrics answer operational questions. Design metrics around user-visible behavior:

```java
@Component
public class MetricsConfig {

    @Bean
    public MeterRegistryCustomizer<MeterRegistry> commonTags() {
        return registry -> registry.config()
            .commonTags(
                "service", "order-service",
                "version", "${spring.application.version}",
                "env", "${spring.profiles.active}"
            )
            .meterFilter(MeterFilter.deny(id ->
                id.getName().startsWith("jvm.threads") &&
                !id.getTag("state").equals("runnable") // Only track runnable threads
            ));
    }
}

// Custom business metric: track payment failure reasons
@Autowired
private MeterRegistry registry;

public void recordPaymentResult(String outcome, String reason) {
    registry.counter("payments.processed",
        "outcome", outcome,        // success, failed, declined
        "reason", reason,          // insufficient_funds, expired_card, fraud_hold
        "gateway", "stripe"
    ).increment();
}
```

**The RED method for services:**
```yaml
# Prometheus recording rules (pre-compute expensive queries):
groups:
  - name: service_red_metrics
    rules:
      - record: job:http_requests:rate5m
        expr: rate(http_server_requests_seconds_count[5m])

      - record: job:http_request_errors:rate5m
        expr: rate(http_server_requests_seconds_count{status=~"5.."}[5m])

      - record: job:http_error_ratio:rate5m
        expr: job:http_request_errors:rate5m / job:http_requests:rate5m

      - record: job:http_request_p99:rate5m
        expr: histogram_quantile(0.99, rate(http_server_requests_seconds_bucket[5m]))
```

## Structured Logging with Loki

Loki stores logs as compressed log streams (label-indexed). Unlike Elasticsearch, Loki doesn't index log content — it indexes labels. This makes it fast and cheap.

```java
// Spring Boot structured logging with Logback:
// logback-spring.xml:
<configuration>
  <appender name="JSON" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LogstashEncoder">
      <provider class="net.logstash.logback.composite.loggingevent.LoggingEventPatternJsonProvider">
        <pattern>{"timestamp":"%d{ISO8601}","level":"%level","logger":"%logger","message":"%msg"}</pattern>
      </provider>
      <!-- Include MDC fields (traceId, spanId injected by OTel agent): -->
      <includeMdcKeyName>traceId</includeMdcKeyName>
      <includeMdcKeyName>spanId</includeMdcKeyName>
      <includeMdcKeyName>userId</includeMdcKeyName>
    </encoder>
  </appender>
  <root level="INFO">
    <appender-ref ref="JSON"/>
  </root>
</configuration>
```

**Loki query examples (LogQL):**
```logql
# Error rate for order service:
rate({service="order-service", level="ERROR"}[5m])

# Slow requests (> 1s) in last 15 minutes:
{service="order-service"} |= "latency" | json | latencyMs > 1000

# Correlate trace with logs:
{service="order-service"} |= "abc123"  # Find all logs for traceId abc123

# Log volume by endpoint:
sum by (path) (rate({service="order-service"}[5m]))
```

## Grafana Dashboard: The Incident Response Dashboard

Every service should have one dashboard that tells you in 30 seconds whether the service is healthy:

```
┌─────────────────────────────────────────────────────────────────┐
│  ORDER SERVICE — Production Dashboard                           │
├──────────────┬──────────────┬──────────────┬────────────────────┤
│  RPS         │  Error Rate  │  P99 Latency │  DB Connections    │
│  1,247/s     │  0.12%       │  284ms       │  18/50             │
│  ▼ -3%       │  ▲ normal    │  ▼ healthy   │  ▲ OK              │
├──────────────┴──────────────┴──────────────┴────────────────────┤
│  Request Rate (5m)     │  Error Rate (5m)                       │
│  [graph]               │  [graph]                               │
├────────────────────────┴───────────────────────────────────────┤
│  Latency Distribution (P50/P95/P99)    │  Top Slow Endpoints    │
│  [graph]                               │  [table]               │
├────────────────────────────────────────┴───────────────────────┤
│  Recent Errors (Loki logs, last 50)                             │
│  [log panel — live tail during incidents]                       │
└─────────────────────────────────────────────────────────────────┘
```

```json
// Grafana panel JSON for error rate alert indicator:
{
  "type": "stat",
  "title": "Error Rate",
  "targets": [{
    "expr": "sum(rate(http_server_requests_seconds_count{service=\"order-service\",status=~\"5..\"}[5m])) / sum(rate(http_server_requests_seconds_count{service=\"order-service\"}[5m]))",
    "legendFormat": "Error %"
  }],
  "options": {
    "colorMode": "background",
    "thresholds": {
      "steps": [
        {"value": 0, "color": "green"},
        {"value": 0.01, "color": "yellow"},
        {"value": 0.05, "color": "red"}
      ]
    }
  }
}
```

## Alerting That Doesn't Create Alert Fatigue

Alert on symptoms, not causes:

```yaml
# Prometheus alerting rules:
groups:
  - name: service_slos
    rules:
      # Alert on user-visible symptoms:
      - alert: HighErrorRate
        expr: job:http_error_ratio:rate5m{service="order-service"} > 0.05
        for: 2m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "Order service error rate {{ $value | humanizePercentage }}"
          runbook: "https://wiki/runbooks/order-service-errors"

      - alert: HighP99Latency
        expr: job:http_request_p99:rate5m{service="order-service"} > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Order service P99 latency is {{ $value }}s"
          dashboard: "https://grafana/d/order-service"

      # Infrastructure alerts (lower priority):
      - alert: HighDatabaseConnections
        expr: hikaricp_connections_active / hikaricp_connections_max > 0.9
        for: 3m
        labels:
          severity: warning
```

**What NOT to alert on:**
- CPU utilization (symptom: latency or errors, not CPU itself)
- Memory usage below limit (only alert near OOM)
- Individual host metrics (alert on aggregate service behavior)

## Distributed Trace Analysis During Incidents

When P99 latency is high, use Jaeger/Tempo to find the slow spans:

```
Incident investigation workflow:

1. Grafana alerts: P99 > 2s on order-service
2. Open Tempo trace search:
   service=order-service, duration>2000ms, last 15 minutes
3. Sort by duration, examine top 5 slow traces
4. Identify common slow span:
   → PostgreSQL.query on orders table: 1.8s
   → SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC
5. Open query in pg_stat_statements:
   → Missing index on (user_id, created_at)
6. Create index CONCURRENTLY (online, no table lock)
7. P99 drops to 180ms within 2 minutes

Total time from alert to fix: 15 minutes.
Without traces: hours of grep-based log analysis.
```

## Sampling Strategy

100% trace sampling at high throughput is expensive. Use tail-based sampling:

```yaml
# OpenTelemetry Collector config with tail-based sampling:
processors:
  tail_sampling:
    decision_wait: 10s
    num_traces: 100000
    expected_new_traces_per_sec: 10000
    policies:
      - name: errors-policy
        type: status_code
        status_code: {status_codes: [ERROR]}
        # Always sample errors
      - name: slow-traces-policy
        type: latency
        latency: {threshold_ms: 1000}
        # Sample traces > 1 second
      - name: probabilistic-policy
        type: probabilistic
        probabilistic: {sampling_percentage: 1}
        # Sample 1% of everything else
```

This captures 100% of errors and slow requests (the ones you care about) while sampling only 1% of healthy fast requests (the ones you don't need to analyze).

Observability is an investment with compounding returns. Every hour spent on instrumentation now saves 10 hours of incident investigation later. The teams that build it in from day one navigate incidents in minutes. The teams that add it after a major outage spend the outage blind.
