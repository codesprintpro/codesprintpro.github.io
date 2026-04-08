---
title: "Spring Boot Timeouts: The Production Guide for HTTP, DB, Redis, and Kafka"
description: "A practical Spring Boot timeout guide covering server shutdown, RestClient/WebClient, database pools, PostgreSQL statement timeouts, Redis, Kafka producers/consumers, retries, circuit breakers, and production defaults."
date: "2026-04-08"
category: "Java"
tags: ["spring boot", "timeouts", "java", "resilience", "hikari", "redis", "kafka", "production"]
featured: false
affiliateSection: "java-resources"
---

Timeouts are one of the highest-return production settings in a Spring Boot service. Without them, slow dependencies turn into stuck threads, connection pool exhaustion, retry storms, cascading failures, and deploys that hang during shutdown.

The dangerous part is that missing timeouts often pass every test. The app works perfectly until a downstream service stalls, a database query blocks, a Redis node pauses, or a Kafka broker becomes slow. Then every thread waits politely forever.

This guide gives you a practical timeout model for Spring Boot services: server shutdown, inbound request behavior, outbound HTTP clients, database pools, PostgreSQL statements, Redis, Kafka, retries, circuit breakers, and observability.

Spring Boot supports graceful shutdown across the common embedded web servers and uses `spring.lifecycle.timeout-per-shutdown-phase` as the grace period for shutdown phases. The official docs show `server.shutdown=graceful` and `spring.lifecycle.timeout-per-shutdown-phase=20s` as the core properties: [Spring Boot graceful shutdown](https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#web.graceful-shutdown).

## Timeout Budget Thinking

Start from the user-facing SLA and work backward.

Example:

```text
API timeout budget: 2 seconds

Controller and validation:       50 ms
Auth/tenant lookup:             100 ms
Database query:                 300 ms
Inventory service call:         400 ms
Payment service call:           700 ms
Serialization and response:      50 ms
Safety buffer:                  400 ms
```

Every downstream timeout must fit inside the upstream timeout. If your gateway times out at 2 seconds but your database statement timeout is 30 seconds, the app keeps working after the client has already given up. That wastes threads and makes failures harder to debug.

Rules:

- downstream timeout should be shorter than upstream timeout
- retries must fit inside the total request budget
- connection acquisition timeout should be short
- read timeout should reflect the operation type
- long-running work should move to async jobs

## Configure Graceful Shutdown

For Kubernetes and rolling deploys:

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

This lets in-flight requests finish during shutdown while the server stops accepting new work according to the embedded server behavior.

Also configure Kubernetes:

```yaml
spec:
  terminationGracePeriodSeconds: 45
  containers:
    - name: app
      lifecycle:
        preStop:
          httpGet:
            path: /actuator/health/readiness
            port: 8080
```

The Kubernetes grace period should be longer than Spring's shutdown timeout. Otherwise the container can be killed before Spring finishes draining.

## Inbound Request Timeouts

Connection timeout is not the same as request processing timeout.

Server connection timeout controls low-level connection behavior. It does not automatically cap how long your controller method can run. For long request handling, use application-level deadlines, async processing, or gateway timeouts.

If a request should not exceed a business deadline, pass a deadline through your service layer:

```java
public record RequestDeadline(Instant expiresAt) {

    public static RequestDeadline after(Duration duration) {
        return new RequestDeadline(Instant.now().plus(duration));
    }

    public Duration remaining() {
        return Duration.between(Instant.now(), expiresAt);
    }

    public void throwIfExpired() {
        if (Instant.now().isAfter(expiresAt)) {
            throw new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT, "Request deadline exceeded");
        }
    }
}
```

Use it before expensive steps:

```java
public CheckoutResponse checkout(CheckoutRequest request) {
    RequestDeadline deadline = RequestDeadline.after(Duration.ofSeconds(2));

    deadline.throwIfExpired();
    Customer customer = customerService.load(request.customerId(), deadline);

    deadline.throwIfExpired();
    Payment payment = paymentService.charge(request.paymentMethod(), request.amount(), deadline);

    deadline.throwIfExpired();
    return orderService.createOrder(customer, payment, deadline);
}
```

Deadlines are more useful than random per-method timeouts because they preserve the total budget.

## RestClient Timeout Configuration

For Spring MVC/blocking applications, configure your HTTP client explicitly.

```java
@Configuration
public class HttpClientConfig {

    @Bean
    RestClient inventoryRestClient(RestClient.Builder builder) {
        var requestFactory = new JdkClientHttpRequestFactory(
            HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(300))
                .build()
        );

        requestFactory.setReadTimeout(Duration.ofMillis(800));

        return builder
            .baseUrl("https://inventory.internal")
            .requestFactory(requestFactory)
            .build();
    }
}
```

Use different clients for different dependencies. A payment provider, internal inventory API, and analytics API should not share the same timeout just because they all use HTTP.

## WebClient Timeout Configuration

For reactive clients using Reactor Netty:

```java
@Configuration
public class WebClientConfig {

    @Bean
    WebClient inventoryWebClient(WebClient.Builder builder) {
        HttpClient httpClient = HttpClient.create()
            .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 300)
            .responseTimeout(Duration.ofMillis(800))
            .doOnConnected(conn -> conn
                .addHandlerLast(new ReadTimeoutHandler(800, TimeUnit.MILLISECONDS))
                .addHandlerLast(new WriteTimeoutHandler(800, TimeUnit.MILLISECONDS)));

        return builder
            .baseUrl("https://inventory.internal")
            .clientConnector(new ReactorClientHttpConnector(httpClient))
            .build();
    }
}
```

For per-request deadlines:

```java
public Mono<InventoryResponse> getInventory(String sku, Duration remainingBudget) {
    Duration timeout = remainingBudget.compareTo(Duration.ofMillis(800)) < 0
        ? remainingBudget
        : Duration.ofMillis(800);

    return inventoryWebClient.get()
        .uri("/inventory/{sku}", sku)
        .retrieve()
        .bodyToMono(InventoryResponse.class)
        .timeout(timeout);
}
```

Do not use `timeout` as a substitute for connection and response timeouts. Use both: client-level timeouts for transport behavior and per-operation deadlines for business budget.

## HikariCP Connection Pool Timeouts

Database timeout problems often show up as API latency. Configure the pool:

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 30
      minimum-idle: 10
      connection-timeout: 500ms
      validation-timeout: 250ms
      idle-timeout: 10m
      max-lifetime: 30m
      leak-detection-threshold: 10s
```

Key settings:

- `connection-timeout`: how long a thread waits to borrow a connection from the pool
- `validation-timeout`: how long to wait when validating a connection
- `leak-detection-threshold`: logs if a connection is held too long
- `max-lifetime`: recycle connections before infrastructure closes them

If `connection-timeout` is 30 seconds and the API gateway timeout is 2 seconds, your request threads can pile up waiting for database connections long after clients are gone. Keep connection acquisition timeout short.

## PostgreSQL Statement Timeout

Pool timeouts control connection acquisition. They do not stop slow SQL.

Set statement timeout at the database/session level:

```yaml
spring:
  datasource:
    url: jdbc:postgresql://db.internal:5432/app?options=-c%20statement_timeout=5000
```

Or per transaction:

```java
@Transactional
public OrderSummary loadOrderSummary(UUID orderId) {
    jdbcTemplate.execute("SET LOCAL statement_timeout = '2s'");
    return orderRepository.loadSummary(orderId);
}
```

For migrations:

```sql
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE orders ADD COLUMN risk_score NUMERIC;
```

The database needs its own timeouts because application-level cancellation does not always terminate work immediately on the server side.

## Redis Timeouts

Redis is fast until it is not. A slow Redis call should not hold a request thread indefinitely.

Example Lettuce configuration:

```java
@Bean
LettuceClientConfigurationBuilderCustomizer lettuceTimeouts() {
    return builder -> builder
        .commandTimeout(Duration.ofMillis(200))
        .shutdownTimeout(Duration.ofMillis(100));
}
```

Use different timeout expectations by use case:

| Use Case | Suggested Thinking |
|---|---|
| Cache get | very short timeout; fall back to source of truth |
| Distributed lock | short timeout; fail closed or skip work |
| Rate limit | short timeout; define fail-open vs fail-closed |
| Session store | slightly longer, but still bounded |

For cache reads, timeout fallback is often better than failing the whole API:

```java
public Product getProduct(String productId) {
    try {
        Product cached = redisCache.get(productId);
        if (cached != null) {
            return cached;
        }
    } catch (RedisConnectionFailureException ex) {
        log.warn("Redis unavailable, falling back to database", ex);
    }

    return productRepository.findById(productId);
}
```

Do not silently ignore Redis failures for security-sensitive features like rate limiting or account lockout. Decide fail-open versus fail-closed intentionally.

## Kafka Producer Timeouts

Kafka producer timeout settings determine how long send attempts can hang and when callers see failures.

Example:

```yaml
spring:
  kafka:
    producer:
      properties:
        request.timeout.ms: 5000
        delivery.timeout.ms: 15000
        linger.ms: 10
        retries: 3
        retry.backoff.ms: 200
```

Important relationship:

- `request.timeout.ms` bounds individual broker request waiting
- `delivery.timeout.ms` bounds total time to deliver a record including retries
- retries must fit inside `delivery.timeout.ms`

If publishing is part of a user request, keep this budget short or use the transactional outbox pattern. Do not block checkout or signup for 30 seconds waiting for Kafka.

## Kafka Consumer Timeouts

Consumers need processing deadlines too:

```yaml
spring:
  kafka:
    consumer:
      properties:
        max.poll.interval.ms: 300000
        session.timeout.ms: 45000
        heartbeat.interval.ms: 15000
      listener:
        ack-mode: manual
```

If message processing can exceed `max.poll.interval.ms`, Kafka considers the consumer stuck and triggers a rebalance. Either shorten processing, increase the interval carefully, or move long work out of the consumer thread.

Example processing deadline:

```java
@KafkaListener(topics = "invoice-events")
public void handleInvoiceEvent(InvoiceEvent event, Acknowledgment ack) {
    RequestDeadline deadline = RequestDeadline.after(Duration.ofSeconds(20));

    try {
        invoiceProcessor.process(event, deadline);
        ack.acknowledge();
    } catch (TransientDependencyException ex) {
        throw ex; // let retry/DLQ policy handle it
    } catch (Exception ex) {
        deadLetterPublisher.publish(event, ex);
        ack.acknowledge();
    }
}
```

## Retry Budgets

Retries multiply latency.

Bad:

```text
gateway timeout: 2s
service A calls service B with timeout 2s and 3 retries
service B calls database with timeout 2s
```

This cannot work. The retry policy exceeds the upstream budget.

Better:

```yaml
resilience4j:
  retry:
    instances:
      inventory:
        max-attempts: 2
        wait-duration: 100ms
        retry-exceptions:
          - java.io.IOException
          - java.util.concurrent.TimeoutException
```

Pair with a time limiter:

```yaml
resilience4j:
  timelimiter:
    instances:
      inventory:
        timeout-duration: 800ms
        cancel-running-future: true
```

Retries should be for transient failures only. Do not retry validation errors, authorization errors, or deterministic 4xx responses.

## Circuit Breakers

Timeouts limit one request. Circuit breakers protect the system when many requests are failing.

```yaml
resilience4j:
  circuitbreaker:
    instances:
      inventory:
        sliding-window-type: count_based
        sliding-window-size: 50
        failure-rate-threshold: 50
        slow-call-rate-threshold: 50
        slow-call-duration-threshold: 700ms
        wait-duration-in-open-state: 10s
        permitted-number-of-calls-in-half-open-state: 5
```

Configure slow-call thresholds below your upstream timeout. If your API budget is 2 seconds, discovering after 2 seconds that calls are slow is too late.

## Observability

Track:

- outbound HTTP duration by dependency
- outbound HTTP timeout count
- database connection acquisition time
- database active/idle/pending connections
- SQL statement timeout count
- Redis command latency and timeout count
- Kafka send latency and delivery failures
- Kafka consumer processing duration
- retry attempts
- circuit breaker state
- request deadline exceeded count

Example log:

```json
{
  "event": "dependency_timeout",
  "dependency": "inventory-service",
  "operation": "GET /inventory/{sku}",
  "timeoutMs": 800,
  "remainingBudgetMs": 930,
  "requestId": "req_123",
  "tenantId": "tenant_abc"
}
```

Use dependency names in metrics. "Timeouts increased" is not useful unless you know which dependency timed out.

## Recommended Starting Points

These are not universal defaults. They are starting points for interactive APIs.

| Layer | Starting Point |
|---|---|
| Gateway timeout | 2-5 seconds |
| Internal HTTP connect timeout | 200-500 ms |
| Internal HTTP read/response timeout | 500-1500 ms |
| Hikari connection timeout | 250-1000 ms |
| PostgreSQL statement timeout | 2-10 seconds |
| Redis cache get timeout | 50-250 ms |
| Kafka producer delivery timeout | 5-15 seconds |
| Graceful shutdown | 20-60 seconds |

Batch jobs, reporting APIs, and async workers need different budgets. Do not copy these numbers blindly.

## Production Checklist

- Define a request timeout budget per endpoint.
- Keep downstream timeouts shorter than upstream timeouts.
- Configure graceful shutdown.
- Configure HTTP client connect and response/read timeouts.
- Configure Hikari connection acquisition timeout.
- Configure database statement timeout.
- Keep Redis cache timeouts short.
- Avoid blocking user requests on long Kafka sends.
- Ensure Kafka consumer processing fits `max.poll.interval.ms`.
- Keep retries inside the total budget.
- Use circuit breakers for failing dependencies.
- Emit metrics by dependency and operation.
- Log timeout events with request ID and remaining budget.
- Test dependency slowness, not only dependency failure.

## Read Next

- [Spring Boot Production Readiness Checklist](/blog/spring-boot-production-readiness-checklist/)
- [Database Connection Pool Tuning](/blog/database-connection-pool-tuning/)
- [Retry Storm Prevention](/blog/retry-storm-prevention/)
- [Kafka Consumer Lag Playbook](/blog/kafka-consumer-lag-playbook/)

## Sources

- [Spring Boot Graceful Shutdown](https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#web.graceful-shutdown)
