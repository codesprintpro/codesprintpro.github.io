---
title: "Database Connection Pool Tuning: HikariCP, PostgreSQL, and Traffic Spikes"
description: "A practical guide to tuning database connection pools for Spring Boot services: pool sizing, HikariCP settings, PostgreSQL limits, slow query impact, metrics, and production failure modes."
date: "2025-07-16"
category: "Java"
tags: ["spring boot", "hikaricp", "postgresql", "database", "performance", "connection pooling"]
featured: false
affiliateSection: "java-courses"
---

Database connection pools look boring until they take production down.

Most backend services do not fail because the database has zero capacity. They fail because the application opens too many connections, holds them too long, or lets request threads pile up while waiting for a connection. The symptoms show up as API latency, thread pool exhaustion, random timeouts, and eventually a database that rejects new clients.

Connection pool tuning is capacity planning, not a magic number in `application.yml`.

## What a Connection Pool Actually Protects

A database connection is expensive. It consumes memory on the database, a backend process or worker, network buffers, authentication state, and transaction state. A connection pool keeps a small set of reusable connections so each request does not pay connection setup cost.

But the pool also acts as a gate. If the pool has 20 connections, at most 20 database operations can run concurrently from that application instance.

That means pool size controls two things:

- database concurrency
- request waiting behavior

Too small and requests wait even when the database has capacity. Too large and the application overwhelms the database.

## The Common Bad Setup

This is common:

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 100
```

Then the service is scaled to 20 pods.

```
20 pods * 100 connections = 2000 possible database connections
```

If PostgreSQL is configured for 500 connections, the cluster is already in danger. Even if PostgreSQL allows 2000, that does not mean it can efficiently run 2000 concurrent queries. More connections often increase context switching and memory pressure.

## A Better Pool Size Formula

Start from the database limit and work backward:

```
usable_db_connections = max_connections - reserved_admin_connections - other_services
connections_per_pod = usable_db_connections / number_of_pods
```

Example:

```
PostgreSQL max_connections: 500
Reserved for admin/maintenance: 50
Other services: 150
This service budget: 300
Pods: 20

Pool size per pod: 300 / 20 = 15
```

That number may look small, but it is often healthier than 100. If each query is fast, 15 connections can serve a lot of traffic. If each query is slow, adding more connections usually makes the database slower.

## HikariCP Settings That Matter

A practical baseline:

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 15
      minimum-idle: 5
      connection-timeout: 1000
      idle-timeout: 600000
      max-lifetime: 1800000
      leak-detection-threshold: 30000
```

Important settings:

- `maximum-pool-size`: hard cap on concurrent database work from this pod
- `connection-timeout`: how long a request waits for a connection before failing
- `max-lifetime`: should be lower than database/network connection lifetime
- `leak-detection-threshold`: logs when code holds a connection too long

Do not set `minimum-idle` equal to a huge pool size unless you want every pod to eagerly reserve database capacity even when idle.

## Metrics to Watch

For HikariCP, alert on:

```
hikaricp.connections.active
hikaricp.connections.idle
hikaricp.connections.pending
hikaricp.connections.timeout
hikaricp.connections.acquire
hikaricp.connections.usage
```

Interpretation:

- high `active` and high `pending`: pool is saturated
- high `pending` and slow database queries: database is the bottleneck
- high `pending` and normal database latency: pool may be too small
- rising `timeout`: users are already seeing failures
- high connection `usage`: code is holding connections too long

The key is to compare pool metrics with database metrics. A saturated pool is not always solved by increasing pool size.

## Slow Queries Make Pools Look Broken

Imagine a pool of 20 connections.

If the average query takes 10ms, the pool can handle roughly:

```
20 connections * 100 queries/sec = 2000 queries/sec
```

If a bad query starts taking 1 second:

```
20 connections * 1 query/sec = 20 queries/sec
```

The pool did not change. The query duration changed. This is why connection pool incidents often require query tuning, not pool tuning.

## The Thread Pool Interaction

Connection pool tuning cannot be isolated from request thread pools. If a service has 200 request threads and only 15 database connections, 185 request threads can wait for the pool during a database-heavy spike.

That can be good. It protects the database. But if the wait time is too long, the application becomes a thread parking lot.

Set `connection-timeout` intentionally:

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 15
      connection-timeout: 1000
```

A one-second connection timeout fails fast enough for upstream services to recover. A 30-second timeout can keep request threads stuck until load balancers and clients also time out.

Pair it with endpoint-level timeouts:

```yaml
server:
  tomcat:
    threads:
      max: 200
```

If your API has one endpoint that runs expensive reports, do not let it share the same pool and thread budget as checkout or login. Put it behind a separate worker, queue, or dedicated read replica.

## PgBouncer: Useful, But Not Magic

PgBouncer can reduce the number of backend PostgreSQL connections by multiplexing clients. It is especially useful when many application pods maintain mostly idle connections.

But PgBouncer does not fix slow queries. It also introduces behavior differences depending on pooling mode:

| Mode | Behavior | Risk |
|---|---|---|
| Session pooling | One server connection per client session | Less multiplexing |
| Transaction pooling | Server connection returned after transaction | Breaks session-level state |
| Statement pooling | Server connection returned after each statement | Rarely safe for apps |

Transaction pooling can break features that rely on session state:

- temporary tables
- session variables
- prepared statements in some driver modes
- advisory locks held beyond a transaction
- `LISTEN/NOTIFY`

If you use PgBouncer with Spring Boot and PostgreSQL, test it with the same driver settings as production. Do not add it during an incident unless you already know how your app behaves behind it.

## Read vs Write Pools

Some services benefit from separate pools:

```yaml
datasource:
  writer:
    hikari:
      maximum-pool-size: 10
  reader:
    hikari:
      maximum-pool-size: 20
```

Use this when:

- reads can go to replicas
- analytics/list endpoints should not starve writes
- slow reporting queries are isolated from transactional traffic

But separation adds complexity. You must understand replication lag. A write followed immediately by a read from a replica may not see the new data.

For user-facing flows that require read-your-writes consistency, route the follow-up read to the writer or use a consistency token.

## Transaction Scope Matters

This is risky:

```java
@Transactional
public OrderResponse checkout(CheckoutRequest request) {
    Order order = orderRepository.save(request.toOrder());
    Tax tax = taxClient.calculate(order);      // HTTP call inside transaction
    paymentClient.charge(order, tax);          // Another HTTP call
    return mapper.toResponse(order);
}
```

The database connection can be held while waiting for HTTP calls. Under dependency latency, the pool saturates.

Prefer keeping transactions short:

```java
public OrderResponse checkout(CheckoutRequest request) {
    Tax tax = taxClient.calculate(request);
    Payment payment = paymentClient.authorize(request, tax);
    return orderService.persistOrder(request, tax, payment);
}

@Transactional
public OrderResponse persistOrder(...) {
    Order order = orderRepository.save(...);
    return mapper.toResponse(order);
}
```

Transactions should wrap database consistency, not the entire business workflow.

## Load Testing Pool Settings

Test pool settings with the same number of pods you expect in production. A single local instance with `maximum-pool-size: 30` tells you almost nothing about 30 pods with the same setting.

A useful test matrix:

```
Pods: 5, 10, 20
Pool size: 10, 15, 25
Traffic: normal, 2x, 5x
Database: primary only, primary + read replica
```

Watch:

- p95 and p99 API latency
- database CPU and IO
- active database connections
- Hikari pending connections
- Hikari connection timeout count
- slow query count

The best setting is not the one with the highest throughput in a short test. It is the one that keeps latency stable without pushing the database into saturation.

## Incident Example

Consider this failure:

1. A new endpoint is deployed for exporting customer transactions
2. The endpoint runs a query that takes 4 seconds
3. Users start exporting during business hours
4. The service has a pool of 20 connections
5. Export requests occupy all 20 connections
6. Checkout requests wait for connections and time out

The naive fix is increasing the pool to 100. That may make the database slower for everyone.

Better fixes:

- move export to an async job
- use a read replica
- add pagination or streaming
- create a dedicated pool for reports
- add a timeout and row limit
- optimize the query plan

Pool tuning is often about protecting critical paths from less critical work.

## Production Checklist

- Budget total database connections across all services
- Set pool size per pod, not just per service
- Alert on pending connections and acquisition time
- Keep transaction scopes short
- Never do slow HTTP calls inside database transactions
- Tune slow queries before increasing pool size
- Separate critical write traffic from heavy reporting when needed
- Test PgBouncer before production rollout
- Use PgBouncer only after understanding the application behavior
- Load test with realistic pod counts, not one local instance

Connection pools are backpressure. Treat them as a deliberate concurrency limit and they will protect your database. Treat them as an arbitrary large number and they will turn traffic spikes into cascading failures.
