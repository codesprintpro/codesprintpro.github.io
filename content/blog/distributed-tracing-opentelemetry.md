---
title: "Distributed Tracing with OpenTelemetry: End-to-End Observability"
description: "Implement distributed tracing across microservices using OpenTelemetry, Jaeger, and Spring Boot. Learn trace context propagation, span correlation, and production observability patterns."
date: "2025-03-05"
category: "System Design"
tags: ["observability", "opentelemetry", "distributed tracing", "jaeger", "spring boot", "microservices"]
featured: false
affiliateSection: "system-design-courses"
---

A request enters your system, touches 8 services, and takes 3 seconds. Which service is slow? Without distributed tracing, you're correlating timestamps across 8 log files. With distributed tracing, you click on the trace and see the waterfall: Service A took 50ms, Service B took 2800ms. Problem found.

## How Distributed Tracing Works

Before instrumenting anything, it helps to understand the data model. The trace below shows what a real slow checkout request looks like after tracing is in place. Each indented line is a span — a named, timed operation. The tree structure shows causality: which service called which, and how long each call took. Without this structure, you would be staring at timestamps across 8 separate log streams trying to reconstruct the same picture manually.

```
Request: POST /checkout

Trace ID: abc-123 (spans entire request, crosses all services)

Span tree:
  [abc-123] API Gateway          0ms - 3100ms  ←──── Root span
    [abc-123] Order Service       5ms - 3090ms
      [abc-123] Validate Cart     5ms - 50ms
      [abc-123] Inventory Service 55ms - 300ms  ← External call
      [abc-123] Payment Service   305ms - 3085ms ← SLOW — 2780ms!
        [abc-123] Stripe API      310ms - 3080ms ← Stripe timeout

Problem: Payment Service → Stripe call took 2770ms
Fix: Implement timeout + retry for Stripe calls
```

Each **trace** represents one end-to-end request. Each **span** represents one operation within that trace. Spans have parent-child relationships forming a tree.

## OpenTelemetry: The Standard

OpenTelemetry (OTel) is the industry standard for instrumentation — vendor-neutral, CNCF project. It replaces Zipkin/Jaeger-specific SDKs.

The architecture diagram below shows the data flow from your application through the OTel Collector to your backend storage systems. The Collector is the critical piece — it acts as a buffer and router between your application's telemetry output and whichever backends you use. If you change from Jaeger to Grafana Tempo next year, you update the Collector configuration and leave your application code untouched. This vendor neutrality is the primary reason to use OTel over instrumenting directly against a backend SDK.

```
Your App
  │ OTel SDK (instrumentation)
  │
  ▼
OTel Collector (receive, process, export)
  │
  ├──► Jaeger (traces UI)
  ├──► Prometheus (metrics)
  └──► Elasticsearch (logs)
```

## Spring Boot Auto-Instrumentation

The easiest path — Spring Boot 3 has first-class OpenTelemetry support via Spring Actuator + Micrometer Tracing.

Add the following three dependencies to get automatic instrumentation of your entire Spring Boot application. The `micrometer-tracing-bridge-otel` dependency bridges Spring's internal tracing abstraction to the OTel SDK, so all Spring components (RestTemplate, JPA, Kafka) emit traces without any code changes.

```xml
<!-- pom.xml -->
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-tracing-bridge-otel</artifactId>
</dependency>
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-exporter-otlp</artifactId>
</dependency>
<dependency>
    <groupId>io.opentelemetry.instrumentation</groupId>
    <artifactId>opentelemetry-spring-boot-starter</artifactId>
    <version>2.9.0</version>
</dependency>
```

The application configuration below is where you define your service identity and connect to your OTel Collector. The `sampling.probability: 1.0` setting traces 100% of requests — appropriate for development where you want full coverage. In production, you will lower this to 0.01-0.1 to control data volume and cost, or switch to tail-based sampling entirely (covered later).

```yaml
# application.yml
spring:
  application:
    name: order-service

management:
  tracing:
    sampling:
      probability: 1.0      # 100% in dev, 0.01-0.1 in production

otel:
  exporter:
    otlp:
      endpoint: http://otel-collector:4317
  resource:
    attributes:
      service.name: order-service
      service.version: 1.0.0
      deployment.environment: production
```

With these dependencies, Spring Boot automatically instruments:
- All HTTP requests/responses (RestTemplate, WebClient, @RestController)
- All database calls (Spring Data, JDBC)
- All Kafka producer/consumer operations
- All @Scheduled and async operations

**Zero code changes required for basic tracing.**

## Manual Instrumentation: Custom Spans

For business logic you want to trace explicitly:

Auto-instrumentation captures framework-level operations but has no awareness of your business logic. When you want to understand how long inventory validation took versus payment processing within a single service, you need custom spans. The checkout example below creates a parent span for the entire operation and child spans for each sub-step — giving you granular timing data for each business decision, plus structured tags that make spans searchable by customer, order size, or failure reason.

```java
@Service
public class CheckoutService {

    private final Tracer tracer;

    public CheckoutService(Tracer tracer) {
        this.tracer = tracer;
    }

    public CheckoutResult checkout(CheckoutRequest request) {
        // Create a custom span for the entire checkout flow
        Span span = tracer.nextSpan()
            .name("checkout.process")
            .tag("customer.id", request.getCustomerId())
            .tag("cart.item_count", String.valueOf(request.getItems().size()))
            .start();

        try (Tracer.SpanInScope ws = tracer.withSpan(span)) {

            // Child span: inventory validation
            CheckoutResult inventoryResult = withSpan("checkout.validate_inventory", () -> {
                return inventoryService.validateAndReserve(request.getItems());
            });

            if (!inventoryResult.isSuccess()) {
                span.tag("checkout.failure_reason", "inventory_unavailable");
                span.event("inventory_check_failed");
                return CheckoutResult.inventoryFailed(inventoryResult.getUnavailableItems());
            }

            // Child span: payment processing
            PaymentResult paymentResult = withSpan("checkout.process_payment", () -> {
                return paymentService.charge(request.getPaymentMethod(), inventoryResult.getTotal());
            });

            span.tag("payment.provider", paymentResult.getProvider());
            span.tag("checkout.success", "true");

            return CheckoutResult.success(paymentResult.getOrderId());

        } catch (Exception e) {
            span.tag("error", "true");
            span.tag("error.message", e.getMessage());
            throw e;
        } finally {
            span.end();
        }
    }

    private <T> T withSpan(String name, Supplier<T> operation) {
        Span childSpan = tracer.nextSpan().name(name).start();
        try (Tracer.SpanInScope ws = tracer.withSpan(childSpan)) {
            return operation.get();
        } catch (Exception e) {
            childSpan.tag("error", "true");
            throw e;
        } finally {
            childSpan.end();
        }
    }
}
```

The `span.end()` call in the `finally` block is essential — an unclosed span is never exported to Jaeger. Always use try/finally or the try-with-resources pattern to guarantee spans are closed, even when exceptions propagate.

## Trace Context Propagation

Spans across services need the trace ID to be passed in HTTP headers. Spring Boot does this automatically, but for custom HTTP clients:

Trace context propagation is what makes distributed tracing distributed. Without it, each service creates its own isolated trace with no connection to the upstream caller. The W3C `traceparent` header format is now the standard way to carry trace context across process boundaries — it encodes the trace ID, parent span ID, and sampling flag in a single header that all compliant frameworks recognize automatically.

```java
// W3C Trace Context standard (use this — it's the industry standard)
// Headers: traceparent: 00-traceId-spanId-flags

@Bean
public RestTemplate tracingRestTemplate(RestTemplateBuilder builder) {
    return builder
        .additionalInterceptors(new TracingClientHttpRequestInterceptor())
        .build();
}

// For Kafka: propagate trace context in message headers
@Service
public class OrderEventPublisher {

    @Autowired
    private KafkaTemplate<String, OrderEvent> kafkaTemplate;

    @Autowired
    private Tracer tracer;

    public void publish(OrderEvent event) {
        Span currentSpan = tracer.currentSpan();

        ProducerRecord<String, OrderEvent> record = new ProducerRecord<>("order-events", event);

        // Inject current trace context into Kafka headers
        if (currentSpan != null) {
            TextMapPropagator propagator = GlobalOpenTelemetry.getPropagators().getTextMapPropagator();
            propagator.inject(
                Context.current(),
                record.headers(),
                (headers, key, value) -> headers.add(key, value.getBytes())
            );
        }

        kafkaTemplate.send(record);
    }
}

// Consumer: extract trace context from Kafka headers
@KafkaListener(topics = "order-events")
public void handleOrderEvent(ConsumerRecord<String, OrderEvent> record) {
    // Extract trace context from headers
    Context extractedContext = GlobalOpenTelemetry.getPropagators()
        .getTextMapPropagator()
        .extract(Context.current(), record.headers(),
            (headers, key) -> new String(headers.lastHeader(key).value())
        );

    // Start a new span that's a child of the producer span
    Span span = tracer.nextSpan(extractedContext)
        .name("kafka.consume.order-events")
        .start();

    try (Tracer.SpanInScope ws = tracer.withSpan(span)) {
        processOrder(record.value());
    } finally {
        span.end();
    }
}
```

The Kafka propagation pattern deserves special attention: the producer injects trace context into Kafka message headers, and the consumer extracts it to create a child span. This creates a single trace that spans the publish/consume boundary — even though the consumer may run minutes or hours later on a completely different instance. Without this, your async event processing appears as disconnected, orphaned traces.

## OpenTelemetry Collector Configuration

The Collector is where you shape your telemetry data before it reaches your backends. The configuration below is a production-ready pipeline that batches spans for efficiency, samples 10% in production, enriches all spans with environment metadata, and drops health check spans that add noise without diagnostic value.

```yaml
# otel-collector.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 1s
    send_batch_size: 1024

  # Sample 10% in production (saves cost)
  probabilistic_sampler:
    sampling_percentage: 10

  # Add environment attribute to all spans
  resource:
    attributes:
      - key: deployment.environment
        value: production
        action: insert

  # Drop health check traces (noise)
  filter:
    traces:
      span:
        - 'attributes["http.route"] == "/health"'
        - 'attributes["http.route"] == "/actuator/health"'

exporters:
  jaeger:
    endpoint: http://jaeger:14250

  # Also export to Tempo (Grafana) for correlated metrics+traces
  otlp/tempo:
    endpoint: http://tempo:4317

  # Export to Elasticsearch for long-term storage
  elasticsearch:
    endpoints: [http://elasticsearch:9200]
    index: traces-{yyyy.MM.dd}

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, probabilistic_sampler, resource, filter]
      exporters: [jaeger, otlp/tempo]
```

The filter processor that drops `/health` and `/actuator/health` spans is worth calling out explicitly — at 10,000 RPS with Kubernetes liveness probes running every 10 seconds, health check spans can account for 30-40% of your total trace volume without providing any diagnostic value. Filtering them at the Collector prevents wasted storage and keeps your trace UI clean.

## Correlating Traces with Logs

Traces tell you which service is slow — logs tell you why. The connection between them is the trace ID, which needs to appear in every log line so you can pivot from a slow span in Jaeger directly to the log lines that explain what happened.

```java
// Add trace ID to all log entries — essential for correlation
// Spring Boot + Logback — automatic with micrometer-tracing

// logback-spring.xml
<configuration>
  <appender name="JSON" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LogstashEncoder">
      <!-- Automatically includes traceId and spanId from MDC -->
      <includeMdcKeyName>traceId</includeMdcKeyName>
      <includeMdcKeyName>spanId</includeMdcKeyName>
    </encoder>
  </appender>
</configuration>
```

With `micrometer-tracing` on the classpath, Spring automatically writes the current trace ID and span ID into the logging MDC (Mapped Diagnostic Context). Every log line your application writes will automatically include both fields — no manual log decoration needed. The JSON output below shows what this looks like in practice.

```json
// Log output — every log line has traceId
{
  "timestamp": "2025-03-05T10:15:32.045Z",
  "level": "INFO",
  "logger": "CheckoutService",
  "message": "Processing payment for order abc-123",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7",
  "service": "order-service"
}
```

Now in Jaeger, you click a slow span, copy the traceId, and search Elasticsearch for all logs with that traceId. You go from trace → exact log lines that caused the failure.

## Production Sampling Strategies

Sampling is the most consequential operational decision in your tracing setup. At 10,000 RPS with 100% sampling, you are exporting 10,000 traces per second — roughly 864 million traces per day. The cost and storage implications make 100% sampling infeasible in production, but naive random sampling means you are likely to miss the exact traces you need most (errors and slow requests).

```java
// Don't trace 100% in production — at 10,000 RPS, that's enormous data
// Strategies:

// 1. Head-based sampling (decide at trace start)
// Simple: sample 1% of all traces
// Problem: you miss rare slow/error traces

// 2. Tail-based sampling (decide after trace completes) — better
// Always sample:
//   - Errors (status >= 400)
//   - Slow traces (duration > 2 seconds)
//   - Low-traffic traces
// Sample 1% of fast/successful traces

// In OTel Collector (tail-based sampling):
processors:
  tail_sampling:
    decision_wait: 10s      # Wait 10s after trace start to decide
    policies:
      - name: errors
        type: status_code
        status_code: {status_codes: [ERROR]}
      - name: slow-traces
        type: latency
        latency: {threshold_ms: 2000}
      - name: probabilistic-1-percent
        type: probabilistic
        probabilistic: {sampling_percentage: 1}
    operator: or            # Include if ANY policy matches
```

The tail-based sampler above is the recommended production configuration: it guarantees you always capture error traces and slow traces (the ones you actually need for debugging), while sampling only 1% of the fast/successful traces (which are useful for baseline statistics but not individual analysis). The `decision_wait: 10s` delay means the Collector buffers span data for 10 seconds before deciding — long enough to see whether the full trace completed with errors.

## Observability Dashboard: The Three Pillars

With traces, logs, and metrics all in place, the workflow for debugging a production incident becomes deterministic. The three-step investigation pattern below shows how each telemetry type builds on the last to identify root cause without guesswork.

```
Metrics (Prometheus/Grafana): WHAT is broken
  - p99 latency: 3.2s ← abnormal
  - Error rate: 12% ← abnormal
  - Throughput: 800 RPS ← normal

Traces (Jaeger): WHERE it's broken
  - Click slow trace → waterfall
  - Payment Service: 2800ms of 3200ms total
  - Span: "stripe.charge" — status=ERROR

Logs (Elasticsearch): WHY it's broken
  - Filter by traceId
  - "Connection timeout after 2000ms: https://api.stripe.com"
  - Log 12 seconds earlier: "Stripe circuit breaker opened"
```

Distributed tracing without logs and metrics is incomplete. The full observability picture requires all three: metrics tell you something is wrong, traces tell you where, logs tell you why. OpenTelemetry gives you a unified way to instrument all three from the same codebase.

## Quick Start: Local Development

The fastest way to validate your instrumentation is working is to run Jaeger and the OTel Collector locally. The docker-compose configuration below gives you a complete observability stack in two containers — no cloud accounts, no billing, no configuration beyond a single YAML file.

```yaml
# docker-compose.yml
version: '3.8'
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"   # Jaeger UI
      - "14250:14250"   # gRPC
    environment:
      - COLLECTOR_OTLP_ENABLED=true

  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    volumes:
      - ./otel-collector.yaml:/etc/otel-collector.yaml
    command: ["--config=/etc/otel-collector.yaml"]
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
    depends_on:
      - jaeger
```

Navigate to `localhost:16686` after running your app — you'll see traces. Click any trace to see the full waterfall. Click any span to see attributes, logs, and events.

The shift from "check logs on 8 servers" to "click on the trace" is one of the largest productivity improvements in microservices operations. Instrument once, debug forever.
