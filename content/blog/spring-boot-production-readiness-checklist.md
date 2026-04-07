---
title: "Spring Boot Production Readiness Checklist: Timeouts, Pools, Health Checks, and Observability"
description: "A practical Spring Boot production checklist covering HTTP timeouts, HikariCP, thread pools, Actuator health checks, graceful shutdown, structured logging, metrics, resilience, and deployment safety."
date: "2025-07-20"
category: "Java"
tags: ["spring boot", "production readiness", "java", "observability", "resilience", "backend engineering"]
featured: false
affiliateSection: "java-courses"
---

Spring Boot makes it easy to start a service. Production makes it clear whether the service is actually ready.

A production-ready service is not just one that passes unit tests. It has bounded timeouts, sane thread pools, useful health checks, structured logs, metrics, graceful shutdown, safe configuration, and predictable behavior when dependencies fail.

This checklist focuses on the things that prevent real outages.

## 1. Set Timeouts Everywhere

The default timeout is often too high, missing, or hidden in a library. Every outbound call should have a connect timeout and a read/response timeout.

For `WebClient`:

```java
HttpClient httpClient = HttpClient.create()
    .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 1000)
    .responseTimeout(Duration.ofSeconds(2));

WebClient client = WebClient.builder()
    .clientConnector(new ReactorClientHttpConnector(httpClient))
    .baseUrl("https://payment-service")
    .build();
```

For `RestTemplate`:

```java
SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
factory.setConnectTimeout(1000);
factory.setReadTimeout(2000);
RestTemplate restTemplate = new RestTemplate(factory);
```

Timeouts should be lower than the upstream caller's timeout. If your load balancer times out at 30 seconds, your service should fail dependency calls much earlier and return a controlled error.

## 2. Tune Database Pooling

HikariCP is fast, but it cannot guess your production topology. Set pool size based on database capacity and pod count:

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 15
      minimum-idle: 5
      connection-timeout: 1000
      max-lifetime: 1800000
      leak-detection-threshold: 30000
```

Alert on:

```
hikaricp.connections.pending
hikaricp.connections.timeout
hikaricp.connections.acquire
hikaricp.connections.usage
```

If `pending` rises, do not blindly increase pool size. Check slow queries and transaction scope first.

## 3. Keep Transactions Short

Do not wrap HTTP calls inside database transactions:

```java
@Transactional
public void badCheckout(Order order) {
    orderRepository.save(order);
    paymentClient.charge(order); // holds DB transaction while waiting
}
```

Prefer:

```java
public void checkout(Order order) {
    PaymentResult payment = paymentClient.charge(order);
    persistOrder(order, payment);
}

@Transactional
public void persistOrder(Order order, PaymentResult payment) {
    orderRepository.save(order.withPayment(payment));
}
```

Transactions should protect data consistency, not the whole workflow.

## 4. Expose Useful Health Checks

Enable Actuator:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  endpoint:
    health:
      probes:
        enabled: true
```

Use separate liveness and readiness probes:

```yaml
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
```

Liveness means "restart me if I am dead." Readiness means "do not send me traffic right now." Do not make liveness depend on the database, or a database outage can cause every pod to restart repeatedly.

## 5. Graceful Shutdown

When Kubernetes terminates a pod, the service needs time to stop accepting traffic and finish in-flight requests.

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

Kubernetes:

```yaml
terminationGracePeriodSeconds: 45
```

This prevents connection resets during deployments and node drains.

## 6. Structured Logging

Logs should answer operational questions quickly. Include request ID, user/tenant where safe, route, status, duration, and error type.

```json
{
  "event": "http_request",
  "trace_id": "abc123",
  "route": "/orders",
  "status": 201,
  "duration_ms": 84,
  "tenant_id": "t_42"
}
```

Never log secrets, tokens, full card numbers, or raw PII. Add masking at the logging boundary.

## 7. Metrics That Matter

Expose Prometheus metrics with Micrometer:

```yaml
management:
  metrics:
    tags:
      application: checkout-api
```

Alert on symptoms:

- request p95/p99 latency
- error rate by route
- dependency latency
- Hikari pending connections
- JVM GC pauses
- executor queue size
- Kafka consumer lag if applicable

Avoid alerting only on CPU. CPU can be high while the service is healthy, and low while every request is stuck waiting on a dependency.

## 8. Resilience Defaults

Use circuit breakers for slow dependencies:

```yaml
resilience4j:
  circuitbreaker:
    instances:
      paymentService:
        slidingWindowSize: 50
        failureRateThreshold: 50
        slowCallDurationThreshold: 2s
        slowCallRateThreshold: 50
```

Retries should be limited and jittered:

```yaml
resilience4j:
  retry:
    instances:
      paymentService:
        maxAttempts: 2
        waitDuration: 100ms
```

Do not retry non-idempotent operations unless the downstream API supports idempotency keys.

## 9. Deployment Safety

Production deployments should have:

- readiness checks
- rolling updates
- rollback path
- feature flags for risky behavior
- database migrations compatible with old and new code
- canary metrics for error rate and latency

For database changes, follow expand-contract:

1. Add nullable column
2. Deploy code that writes both old and new
3. Backfill
4. Deploy code that reads new
5. Remove old column later

## Final Checklist

- Timeouts on every outbound call
- HikariCP sized by database capacity
- Short transactions
- Separate liveness and readiness probes
- Graceful shutdown enabled
- Structured logs with trace IDs
- Prometheus metrics exposed
- Circuit breakers and bounded retries
- Safe deployment and rollback strategy
- Alerts tied to user impact

Spring Boot gives you strong defaults for development. Production readiness comes from making every important failure mode explicit.
