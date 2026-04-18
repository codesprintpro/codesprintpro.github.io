---
title: "System Design: Building a Service Discovery Platform"
description: "Design a production service discovery platform with registration, health checks, heartbeats, client-side and server-side discovery, zone awareness, rollout safety, and failure isolation."
date: "2026-04-18"
category: "System Design"
tags: ["system design", "service discovery", "microservices", "distributed systems", "platform engineering", "backend engineering"]
featured: false
affiliateSection: "system-design-courses"
---

In a distributed system, naming a service is easy.

Finding a healthy instance of that service, right now, in the right zone, during a deployment, while failures are happening, is the real problem.

That problem is service discovery.

At small scale, teams hardcode hostnames or keep a static list of instances. That falls apart as soon as autoscaling, rolling deploys, container rescheduling, zone-aware routing, or dynamic failover appear. Suddenly the question "where should this request go?" becomes a control-plane problem with real operational consequences.

This guide designs a production service discovery platform.

## Problem Statement

Build a platform that lets services discover other healthy service instances dynamically.

Examples:

- `checkout-api` needs a healthy `inventory-api`
- `payment-worker` needs one `fraud-api` instance in the same region if possible
- API gateway needs all healthy instances of `orders-api`
- internal tooling wants to know which version of `search-worker` is live

The platform should:

- register service instances
- detect unhealthy instances quickly
- distribute instance lists safely
- support client-side or server-side load balancing
- support zones, regions, and rollout metadata
- remain usable during partial control-plane outages

This is not just a registry. It is a **liveness, routing, and consistency** system.

## Requirements

Functional requirements:

- register and deregister instances
- support leases or heartbeats
- perform or consume health checks
- list healthy instances for a service
- expose metadata such as zone, version, and weight
- support canary or subset discovery
- support service decommissioning during rollout

Non-functional requirements:

- low-latency lookup
- high availability
- fast removal of unhealthy instances
- bounded staleness
- no single point of failure in the request path
- operational visibility into instance state

The most important design constraint:

**traffic routing should continue safely even if the discovery control plane is temporarily unavailable.**

## Why Static Config Fails

A static list of hosts looks fine at first:

```yaml
inventory-api:
  - 10.0.1.10:8080
  - 10.0.1.11:8080
```

But real systems need:

- autoscaling
- rolling deploys
- instance replacement
- multi-zone failover
- canary versions
- node eviction or container restarts

With static config, every topology change becomes a config rollout problem. That does not scale operationally.

## High-Level Architecture

```text
Service Instance
   |
   +--> register / heartbeat
   |
   v
Discovery Control Plane
   |
   +--> instance registry
   +--> health state
   +--> watch / snapshot API
   |
   v
Discovery Client / Sidecar
   |
   +--> local cache of healthy endpoints
   |
   v
Calling Service
```

Optional server-side discovery path:

```text
Client -> discovery-aware proxy / load balancer -> backend instance
```

There are two main runtime models:

- client-side discovery
- server-side discovery

## Client-Side vs Server-Side Discovery

### Client-side discovery

The caller asks discovery for endpoints and balances traffic itself.

Pros:

- fewer network hops
- flexible routing
- good for internal service-to-service traffic

Cons:

- every client needs a good library or sidecar
- rollout bugs can spread across many services

### Server-side discovery

The client sends traffic to a proxy or load balancer, which looks up instances.

Pros:

- simpler clients
- central routing policy

Cons:

- extra hop
- proxy becomes a critical shared component

Most large systems use a mix:

- client-side inside service mesh or RPC stacks
- server-side at gateways and edge layers

## Registration Model

Each service instance needs an identity and metadata.

Example registration payload:

```json
{
  "service": "inventory-api",
  "instanceId": "inventory-api-7f9c8d4f7d-h2kgw",
  "host": "10.42.6.18",
  "port": 8080,
  "zone": "ap-south-1a",
  "region": "ap-south-1",
  "version": "2026.04.18.2",
  "weight": 100,
  "healthEndpoint": "/health/ready"
}
```

Useful metadata:

- service name
- instance id
- host and port
- zone / region
- version
- deployment group / canary marker
- protocol
- tags

## Registry Data Model

```sql
CREATE TABLE service_instances (
  service_name TEXT NOT NULL,
  instance_id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INT NOT NULL,
  zone TEXT NOT NULL,
  region TEXT NOT NULL,
  version TEXT NOT NULL,
  weight INT NOT NULL DEFAULT 100,
  status TEXT NOT NULL,          -- starting, healthy, draining, unhealthy, gone
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_service_instances_lookup
  ON service_instances (service_name, status, zone);
```

This table is conceptual. At scale, many discovery systems use strongly-consistent key-value stores or in-memory state machines rather than a generic SQL path in the hot control loop.

## Heartbeats and Leases

The platform needs a way to decide whether an instance is still alive.

Common model:

- instance registers with a lease
- instance renews lease every N seconds
- if lease expires, instance becomes unavailable

Example:

```text
heartbeat interval: 10 seconds
lease expiry: 30 seconds
```

This prevents dead instances from staying discoverable forever.

Simple flow:

1. instance registers
2. registry stores `lease_expires_at = now + 30s`
3. instance heartbeats every 10s
4. registry extends lease
5. if heartbeat stops, instance expires after 30s

## Health Checks

Heartbeat is not enough.

A process can still heartbeat while being unable to serve traffic correctly.

Typical health types:

- process alive
- app ready
- dependency degraded
- draining for shutdown

Useful distinction:

- **liveness**: should the process be restarted?
- **readiness**: should traffic be sent to it?

The discovery platform should route based on readiness, not just process liveness.

## Status Lifecycle

Instances should move through clear states:

```text
STARTING
HEALTHY
DRAINING
UNHEALTHY
EXPIRED
REMOVED
```

Why `DRAINING` matters:

- rollout starts
- instance should stop receiving new traffic
- in-flight requests can finish

This reduces abrupt failures during deploys and autoscaling down.

## Watch API vs Polling

Clients need updates when topology changes.

### Polling

Client asks every few seconds for latest instance list.

Pros:

- simple

Cons:

- more stale
- higher control-plane load

### Watch / streaming updates

Registry pushes changes or lets clients maintain a long-lived watch.

Pros:

- faster updates
- lower steady-state control-plane load

Cons:

- more implementation complexity

A common hybrid:

- full snapshot on startup
- watch for updates afterward
- fallback to periodic full refresh

## Client Cache

Never make every service call block on a control-plane round trip.

Client library or sidecar should maintain:

- current healthy instance list
- metadata
- last update version
- last-known-good snapshot

That gives safe behavior if discovery briefly fails.

Example local state:

```json
{
  "service": "inventory-api",
  "version": 2881,
  "instances": [
    { "host": "10.42.6.18", "port": 8080, "zone": "ap-south-1a", "weight": 100 },
    { "host": "10.42.7.22", "port": 8080, "zone": "ap-south-1b", "weight": 100 }
  ]
}
```

## Selection Strategy

Once the client has a healthy list, it still needs to choose an instance.

Common strategies:

- round robin
- weighted round robin
- least requests
- random with power of two choices
- consistent hashing for sticky traffic

For internal RPC, a great default is:

- prefer same-zone endpoints
- use weighted random or least requests
- fallback cross-zone only if needed

## Zone Awareness

Cross-zone traffic adds cost and latency.

So if a service has instances in:

- `ap-south-1a`
- `ap-south-1b`
- `ap-south-1c`

and the caller is in `ap-south-1a`, the discovery client should prefer that zone first.

Fallback order:

1. same zone healthy endpoints
2. same region other zones
3. remote region only if policy allows

That policy should be configurable, not hidden inside a client library with no visibility.

## Rollouts and Canary Support

Discovery metadata is useful during deployments.

For example:

- stable version has weight 100
- canary version has weight 5

Or:

- only clients with canary tag should see canary instances

Discovery record can include:

```json
{
  "version": "2026.04.18.2",
  "deploymentGroup": "canary"
}
```

This lets routing systems make rollout decisions without every client learning deployment internals.

## Failure Modes

### 1. Dead instance still receives traffic

Cause:

- lease expiry too long
- readiness not checked
- stale client cache

Fix:

- shorter leases
- readiness-aware status
- faster watch propagation

### 2. Flapping instance churns in and out

Cause:

- noisy health checks

Fix:

- hysteresis
- consecutive-failure thresholds
- cool-down period before reentry

### 3. Discovery control plane outage

Cause:

- registry cluster issue

Fix:

- clients continue with last-known-good cache
- do not clear endpoint cache immediately

### 4. Full stale endpoint set after partition

Cause:

- watch stream broken silently

Fix:

- periodic full refresh
- endpoint version monotonicity
- freshness alarms

### 5. Rolling deployment sends traffic too early

Cause:

- instance marked discoverable before ready

Fix:

- explicit startup state
- only publish once readiness is true

## Consistency Trade-Offs

Discovery is usually eventually consistent at the fleet level.

That is acceptable if:

- bad endpoints are removed fast enough
- stale topology windows are short
- clients retry safely

Trying to make every discovery read globally strongly consistent often adds more pain than value in the request path.

The better model is:

- strong enough control-plane state
- local cached runtime view
- retries and circuit breaking in callers

## Integration With Load Balancing

Discovery alone is not enough.

Calling clients still need:

- connection pooling
- timeouts
- retries
- circuit breakers
- outlier detection

A discovery system that returns endpoints but ignores real-time failure behavior leaves too much burden on every service team.

## Example Client-Side Selector

```java
public class DiscoveryClient {

    private final EndpointCache endpointCache;

    public Endpoint select(String service, String callerZone) {
        List<Endpoint> endpoints = endpointCache.healthyEndpoints(service);

        List<Endpoint> sameZone = endpoints.stream()
            .filter(e -> e.zone().equals(callerZone))
            .toList();

        List<Endpoint> pool = sameZone.isEmpty() ? endpoints : sameZone;
        if (pool.isEmpty()) {
            throw new NoHealthyEndpointsException(service);
        }

        return weightedRandom(pool);
    }
}
```

That’s intentionally boring. Discovery logic should be predictable, not clever.

## Server-Side Alternative

In some systems, a local sidecar or proxy handles discovery:

```text
app -> local proxy -> healthy upstream
```

This centralizes:

- retries
- timeouts
- endpoint selection
- circuit breaking

This is attractive when you do not want every application language runtime to implement discovery logic differently.

## Security and Trust

Who is allowed to register instances?

Important protections:

- only trusted workloads can register
- instance identity tied to workload identity, not arbitrary hostname claims
- metadata changes audited
- discovery records cannot be spoofed casually

Otherwise, your routing layer becomes a place where malicious or broken workloads can poison service resolution.

## Observability

Track:

- total registered instances by service
- healthy vs unhealthy count
- lease expiry count
- registration errors
- watch propagation latency
- stale cache age
- zone skew
- endpoint selection failures

Useful dashboards:

- service endpoint count over time
- discovery lag during deployments
- flapping instances
- most common no-healthy-endpoints errors

If discovery is failing, service owners should know whether the issue is:

- no healthy instances
- stale client cache
- control-plane lag
- wrong metadata or policy

## What I Would Build First

Phase 1:

- service registry
- lease-based registration
- healthy instance lookup
- simple client cache with periodic polling

Phase 2:

- watch API
- zone-aware selection
- draining state and rollout metadata
- observability dashboards

Phase 3:

- sidecar/proxy integration
- canary-aware discovery
- stronger workload identity integration
- richer outlier and traffic policy hooks

This order matters. Teams often leap into elaborate mesh features before they have solid registration and liveness semantics.

## Production Checklist

- service instances have stable identity
- readiness affects discoverability
- leases expire automatically
- clients cache last-known-good endpoint set
- periodic refresh exists even with watches
- zone-aware routing supported
- draining state used in deploys
- no request path depends on control-plane round trip
- discovery metadata audited
- stale endpoint age monitored

## Final Takeaway

Service discovery is how a distributed system learns where it can safely send traffic right now.

If you design it well, deployments, autoscaling, and failures become routine infrastructure behavior.

If you design it poorly, every topology change turns into random connection errors and ghost outages.

## Read Next

- [System Design: Building an API Gateway Platform](/blog/system-design-api-gateway-platform/)
- [System Design: Building a Distributed Cache](/blog/system-design-distributed-cache/)
- [System Design: Building a Distributed Configuration Platform](/blog/system-design-distributed-configuration-platform/)
