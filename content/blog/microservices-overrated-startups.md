---
title: "Microservices Are Overrated for Most Startups"
description: "A contrarian but technically grounded case for starting with a well-structured monolith. Distributed transaction costs, network latency math, observability overhead, and when to actually break services apart."
date: "2025-05-16"
category: "System Design"
tags: ["microservices", "monolith", "architecture", "system design", "distributed systems", "startups"]
featured: false
affiliateSection: "system-design-courses"
---

The microservices hype peaked around 2016. In 2025, some of the most respected engineering teams in the industry are quietly talking about their microservices regret. Segment famously consolidated 130+ microservices back into a monolith. Amazon's Prime Video engineering wrote publicly about moving from a distributed architecture to a monolith, reducing infrastructure cost by 90%. Shopify still runs a Rails monolith serving billions in GMV.

If you're building a startup and you're choosing microservices because that's what Netflix does, you are making a $500K mistake. Here's why.

## The Complexity Tax Nobody Advertises

A monolith call:
```
UserController.createOrder()
    → OrderService.createOrder()         // In-process method call, ~0.1ms
        → InventoryService.reserve()     // In-process method call, ~0.1ms
            → PaymentService.charge()    // In-process method call, ~0.1ms
```

The same flow in microservices:
```
OrderService HTTP call → InventoryService (HTTP/gRPC, ~3ms)
OrderService HTTP call → PaymentService (HTTP/gRPC, ~3ms)
+ network timeout handling
+ retry logic
+ circuit breakers
+ distributed tracing correlation
+ service discovery
+ load balancing
+ separate deployments × 3
+ separate CI/CD pipelines × 3
+ separate monitoring dashboards × 3
```

Network latency math: a 3ms inter-service call replaces a 0.1ms in-process call. For a request that makes 5 downstream calls: `5 × 3ms = 15ms` added latency minimum, plus serialization/deserialization overhead. Your API that runs in 50ms locally now runs in 65ms, and that's on a good day with no retries.

Worse: services call services. If Service A calls B which calls C which calls D, you have a call chain with `O(N)` failure points and `O(N)` latency accumulation. A 1% failure rate per service compounds: `(1-0.01)^4 = 96%` success rate for a 4-hop chain. Your 99.9% SLA per service becomes 99.6% for the end-to-end flow — before you even account for timeouts.

## Distributed Transactions: A Solved Problem That Microservices Unsolved

In a monolith:
```java
@Transactional
public Order createOrder(OrderRequest request) {
    inventory.reserve(request);      // Same DB transaction
    payment.charge(request);         // Same DB transaction
    order.save(request);             // Same DB transaction
    notifications.queue(request);    // Same DB transaction
}
// If anything fails: complete rollback, ACID guaranteed
```

In microservices:
```
1. InventoryService.reserve()  ✓
2. PaymentService.charge()     ✓
3. OrderService.save()         ✗ (crashes)

State: Payment charged, inventory reserved, order not created
Recovery: ???
```

You have invented the distributed transaction problem. Now you need Saga pattern, choreography or orchestration, compensation transactions, and a distributed transaction coordinator. You've added 6 weeks of engineering work to solve a problem that didn't exist in your monolith.

To be fair: Saga is the right pattern for distributed transactions and it works well. But it requires explicit compensation logic for every failure case. Every developer touching that code needs to understand distributed consistency. Your junior engineers who could confidently write `@Transactional` now need to understand eventual consistency, idempotency, and distributed rollback. That's a knowledge tax on every person on your team, forever.

## The Observability Overhead

In a monolith, a single log line tells you:
```
ERROR [OrderController] Order creation failed for userId=123: inventory.reserve failed:
  SKU-456 out of stock
  at OrderController.createOrder(OrderController.java:87)
  at ...
```

In microservices, the same error requires:
1. Distributed trace ID to correlate across services
2. OpenTelemetry / Jaeger / Zipkin to assemble the trace
3. Centralized logging aggregator (ELK, Datadog, Splunk)
4. Service mesh for automatic trace injection
5. Engineers who understand how to query across all of this

Setting this up correctly costs 2–4 engineer-weeks and several hundred to several thousand dollars per month depending on log volume. The tooling is mature (Datadog, New Relic), but it's neither free nor zero-configuration.

```
Observability stack cost (rough):
Datadog APM for 10 services: $30/host/month × 50 hosts = $1,500/month
Log management at 50GB/day: ~$500/month
Distributed tracing: included in APM

$2,000+/month before you've shipped a single feature.
```

A monolith on a single well-configured server with structured logging to CloudWatch: $50/month.

## Deployment Overhead

A monolith deploys in one pipeline. Microservices require:
- A CI/CD pipeline per service
- Container registry management
- Kubernetes manifests (or ECS task definitions) per service
- Service dependency management during deploys
- Contract testing between services (Pact or similar)
- Versioning and backward compatibility between services

A 10-person startup with 15 microservices spends 2+ engineers maintaining deployment infrastructure — engineers who could be shipping product.

The hidden cost: deployment coordination. If Service B depends on Service A's new API, you need to deploy them in order, maintain backward compatibility during rollout, or use a feature flag. In a monolith, you rename a method and run the tests.

## When a Monolith Is Better

You should be in a monolith when:

**1. Your team is under 30 engineers.** Conway's Law says your architecture mirrors your org chart. 5 engineers building 10 microservices will produce a distributed monolith — tightly coupled services that must be deployed together. Microservices unlock value when teams own services end-to-end. At 30 engineers, you have 5–6 teams that can each own a service.

**2. You don't know your domain boundaries yet.** Getting service boundaries wrong in microservices is expensive to fix — you end up with chatty cross-service calls or data duplication. Monoliths let you refactor module boundaries without network contracts. Build in the monolith for 18–24 months; your domain model will be clearer after you've seen real usage patterns.

**3. Your product-market fit isn't established.** Microservices optimize for independent scaling and deployment of stable domains. Pre-PMF, you're iterating rapidly, changing data models weekly, and pivoting. Microservices make pivots expensive. Monoliths make pivots cheap.

**4. You can't afford distributed systems expertise.** Operating Kafka, Kubernetes, service meshes, and distributed tracing requires specialized knowledge. If your team doesn't have it, you'll build fragile systems and spend engineering cycles on infrastructure, not product.

## When to Break Into Microservices

Microservices solve real problems — just not the problems most startups have.

**Break out a service when:**

1. **Independent scaling is required.** Your image processing is CPU-intensive and needs 32 cores while the rest of your app runs fine on 4 cores. Extract it.

2. **Deployment independence becomes critical.** You have 10 teams deploying to the same codebase and stepping on each other constantly. Service boundaries become team boundaries.

3. **Technology heterogeneity is genuinely needed.** Your ML pipeline needs Python, your core business logic is Java, your mobile APIs need low-latency Go. This is a legitimate reason to separate services.

4. **Compliance isolation is required.** PCI DSS compliance for payment processing is significantly easier when the payment code is a separate service with a separate deployment environment.

5. **A specific component is a scale bottleneck.** Your search indexing is killing database performance for the entire application. Extract search as a separate service with its own Elasticsearch cluster.

**The rule:** Extract a service when you have a specific, measurable problem that service extraction solves. Not because it "feels right" architecturally.

## The Migration Path

If you've built a monolith and need to extract services, use the Strangler Fig pattern:

```
Phase 1: Modular Monolith
         Separate modules with clean internal APIs
         No direct DB calls across module boundaries

Phase 2: Extract via API Gateway
         Route /api/payments/* to the new Payment Service
         Payment Service reads from shared DB initially
         Gradually migrate payment DB tables to separate schema

Phase 3: Data separation
         Payment Service owns its tables
         Other services access payment data via Payment Service API
         Remove shared DB connections

Phase 4: Full extraction
         Payment Service has its own database instance
         Complete service isolation achieved
```

This is a 12–18 month migration for a mature codebase. Budget accordingly.

## Real Production Examples

**What Shopify does:** A Rails monolith (Storefront Renderer) serving millions of storefronts. They invest heavily in monolith performance engineering (caching, sharding, query optimization) rather than service extraction. This lets a small team maintain the codebase while supporting massive scale.

**What Segment did:** Consolidated 130+ microservices into a monolith for their data pipeline. Result: eliminated an entire category of distributed systems bugs, reduced operational burden, and shipped features faster. Their blog post is required reading for anyone arguing that microservices are the default correct architecture.

**What Amazon Prime Video did:** Moved from a serverless microservices architecture to a monolith for their video monitoring service. Infrastructure cost dropped 90%. Monitoring and debugging became dramatically simpler. The microservices architecture was processing millions of frames using Lambda and Step Functions — the per-frame invocation costs added up, and the service-to-service orchestration was slower than in-process calls.

## The Cost Implication

Let's quantify what "microservices overhead" actually costs a 20-person startup:

```
Engineering time:
- Platform/infrastructure maintenance: 2 engineers × $200K/year = $400K/year
- Increased debugging/incident time: 20% of 18 engineers = $720K/year loaded cost
- Deployment coordination overhead: 10% of engineer time = $360K/year

Infrastructure:
- Kubernetes cluster, service mesh, distributed tracing: $8K/month = $96K/year
- Additional services (Kafka, service discovery, APM): $3K/month = $36K/year

Total annual overhead: ~$1.6M for a 20-person startup

vs. modular monolith:
- No dedicated platform engineer
- Standard VMs + RDS + CloudWatch
- ~$300K/year in equivalent costs

Difference: $1.3M/year — enough to hire 4–5 engineers.
```

## The Right Starting Point

A **modular monolith** is the right starting architecture for most teams:

```
Well-structured monolith:
src/
  modules/
    orders/
      OrderController.java    ← Public API (HTTP)
      OrderService.java       ← Business logic
      OrderRepository.java    ← Data access
      OrderModule.java        ← Spring module config
    payments/
      PaymentController.java
      PaymentService.java     ← No direct DB calls from orders module
      ...
    inventory/
      ...
```

Module boundaries enforce the same discipline as service boundaries, without the network overhead. When you're ready to extract a service, the module boundary becomes the service boundary — and the extraction is a packaging exercise, not an architectural overhaul.

Microservices are a powerful tool for large organizations with scale problems and stable domain models. They are a poor fit for startups, small teams, or domains still evolving. The engineers who've operated both know this. The architects who've only designed system diagrams often don't.

Build the monolith. Do it well. Earn the right to microservices.
