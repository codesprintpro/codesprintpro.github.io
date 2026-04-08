---
title: "System Design: Building an API Gateway Platform"
description: "Design a production API gateway platform with routing, authentication, authorization, rate limiting, request shaping, canary releases, retries, timeouts, config rollout, observability, and failure isolation."
date: "2026-04-08"
category: "System Design"
tags: ["system design", "api gateway", "rate limiting", "authentication", "routing", "observability", "backend engineering"]
featured: false
affiliateSection: "system-design-courses"
---

An API gateway is the front door to your backend. It receives traffic before your services do, which makes it powerful and dangerous. A good gateway centralizes routing, authentication, rate limiting, request shaping, observability, and rollout controls. A bad gateway becomes a giant shared bottleneck where every team ships custom logic and every incident starts at the same place.

This guide designs a production API gateway platform: route configuration, authentication, authorization, rate limiting, request validation, retries, timeouts, canary routing, config rollout, observability, and failure isolation.

## Requirements

Functional requirements:

- route requests to backend services
- authenticate callers
- enforce authorization policies
- apply rate limits and quotas
- validate request shape
- add request IDs and trace context
- support canary routing
- expose metrics and logs
- support safe config rollout

Non-functional requirements:

- low latency overhead
- high availability
- horizontal scalability
- predictable failure behavior
- safe defaults
- tenant isolation
- config consistency
- operational debuggability
- no per-team custom code in the hot path unless tightly controlled

The gateway should protect services, not become a dumping ground for business logic.

## High-Level Architecture

```text
Client
  |
  v
API Gateway
  |
  +-- TLS termination
  +-- request ID and trace context
  +-- authentication
  +-- authorization
  +-- rate limiting
  +-- request validation
  +-- routing and load balancing
  +-- retry/timeout policy
        |
        v
Backend services
```

Control plane:

```text
Admin/API config
  |
  v
Gateway control plane
  |
  +-- validates config
  +-- versions config
  +-- publishes snapshots
        |
        v
Gateway data plane instances
```

Separate control plane from data plane. The data plane serves traffic. The control plane manages configuration. If the control plane is down, gateways should keep serving with the last-known-good config.

## Route Configuration

Routes map incoming requests to upstream services.

```yaml
routes:
  - name: checkout-orders
    match:
      host: api.example.com
      pathPrefix: /v1/orders
      methods: [GET, POST]
    upstream:
      service: checkout-api
      port: 8080
    policies:
      auth: required
      rateLimit: checkout-default
      timeoutMs: 1500
      retries: 1
```

Store route config as versioned data:

```sql
CREATE TABLE gateway_config_versions (
  config_version BIGSERIAL PRIMARY KEY,
  environment TEXT NOT NULL,
  config JSONB NOT NULL,
  status TEXT NOT NULL, -- DRAFT, VALIDATED, ACTIVE, ROLLED_BACK
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ
);
```

Never mutate active config in place. Publish a new version and keep rollback easy.

## Config Validation

Validate config before it reaches the data plane:

```ts
function validateRoute(route: GatewayRoute): void {
  if (!route.name.match(/^[a-z0-9-]+$/)) {
    throw new Error("route name must be kebab-case");
  }

  if (!route.match.pathPrefix.startsWith("/")) {
    throw new Error("pathPrefix must start with /");
  }

  if (route.policies.timeoutMs > 30_000) {
    throw new Error("timeout too high for gateway route");
  }

  if (route.policies.retries > 2) {
    throw new Error("too many retries at gateway layer");
  }
}
```

Validation should catch:

- overlapping routes
- unknown upstream service
- unsafe timeout values
- too many retries
- missing auth policy
- invalid rate limit reference
- routes that expose internal services publicly

## Route Matching

Route matching order matters.

Bad:

```text
/v1/*
/v1/admin/*
```

If the generic route matches first, admin traffic may bypass stricter policies. Prefer explicit specificity rules:

1. exact host match
2. longest path prefix
3. method match
4. route priority as a final tie-breaker

```ts
function selectRoute(request: Request, routes: GatewayRoute[]): GatewayRoute | null {
  return routes
    .filter(route => route.match.host === request.host)
    .filter(route => request.path.startsWith(route.match.pathPrefix))
    .filter(route => route.match.methods.includes(request.method))
    .sort((a, b) => b.match.pathPrefix.length - a.match.pathPrefix.length)
    [0] ?? null;
}
```

Make route matching deterministic. Ambiguous routing causes security bugs.

## Authentication

The gateway is a natural place to authenticate requests.

Common approaches:

- JWT validation
- OAuth2 token introspection
- API keys
- mTLS for service-to-service traffic
- signed requests for partners

JWT validation should use cached keys:

```ts
async function authenticateJwt(token: string): Promise<Principal> {
  const header = decodeJwtHeader(token);
  const key = await jwksCache.get(header.kid);

  const claims = verifyJwt(token, key, {
    issuer: "https://auth.example.com",
    audience: "api.example.com",
    clockToleranceSeconds: 30,
  });

  return {
    subject: claims.sub,
    tenantId: claims.tenant_id,
    scopes: claims.scope?.split(" ") ?? [],
  };
}
```

Do not call the identity provider on every request if token verification can be local. That turns auth into a shared runtime dependency.

## Authorization

Authentication says who the caller is. Authorization says whether they can do the thing.

Gateway-level authorization is good for coarse checks:

- route requires authentication
- route requires scope
- tenant must be active
- API key must allow this product
- admin path requires admin scope

Example:

```yaml
policies:
  authorization:
    requiredScopes:
      - orders:write
    tenantStatus:
      - ACTIVE
```

Implementation:

```ts
function authorize(principal: Principal, policy: AuthorizationPolicy): void {
  for (const scope of policy.requiredScopes) {
    if (!principal.scopes.includes(scope)) {
      throw new HttpError(403, `missing required scope: ${scope}`);
    }
  }
}
```

Fine-grained business authorization usually belongs in the service. The gateway should not decide whether a user can modify a specific order unless it has the necessary domain context.

## Rate Limiting

Gateway rate limiting protects services before traffic reaches them.

Common dimensions:

- tenant ID
- user ID
- API key
- IP address
- route
- product tier

Example policy:

```yaml
rateLimits:
  checkout-default:
    algorithm: token_bucket
    capacity: 1000
    refillPerSecond: 100
    key:
      - tenantId
      - routeName
```

Token bucket pseudocode:

```ts
async function allowRequest(key: string, limit: TokenBucketLimit): Promise<boolean> {
  const now = Date.now();
  const bucket = await bucketStore.get(key);

  const elapsedSeconds = Math.max(0, (now - bucket.updatedAtMs) / 1000);
  const tokens = Math.min(
    limit.capacity,
    bucket.tokens + elapsedSeconds * limit.refillPerSecond
  );

  if (tokens < 1) {
    await bucketStore.put(key, { tokens, updatedAtMs: now });
    return false;
  }

  await bucketStore.put(key, { tokens: tokens - 1, updatedAtMs: now });
  return true;
}
```

Decide failure mode:

- fail open: allow traffic if rate limit store is down
- fail closed: reject traffic if rate limit store is down
- local fallback: use per-instance emergency limits

For most public APIs, local fallback is a practical compromise.

## Request Shaping

The gateway can reject bad requests early:

- max body size
- content type
- required headers
- unsupported methods
- path normalization
- header allowlist
- request timeout

Example:

```yaml
requestPolicy:
  maxBodyBytes: 1048576
  allowedContentTypes:
    - application/json
  requireHeaders:
    - x-request-id
```

Do not put complex business validation in the gateway. Keep it to protocol and safety validation.

## Timeouts And Retries

Every route needs a timeout.

```yaml
policies:
  timeoutMs: 1500
  retries: 1
  retryOn:
    - connect-failure
    - reset
    - 503
```

Gateway retries are dangerous for non-idempotent requests. Retrying `GET` is usually safe. Retrying `POST /orders` may create duplicates unless the API uses idempotency keys.

Rules:

- retry only idempotent methods by default
- require idempotency key for retrying writes
- keep retries inside the client timeout budget
- add jittered backoff
- never retry forever

## Canary Routing

The gateway can route a small percentage of traffic to a new backend version.

```yaml
upstream:
  service: checkout-api
  splits:
    - version: stable
      weight: 9500
    - version: canary
      weight: 500
```

Deterministic split:

```ts
function chooseUpstream(request: Request, splits: TrafficSplit[]): string {
  const key = request.headers["x-user-id"] ?? request.headers["x-request-id"];
  const bucket = Math.abs(murmur3(String(key))) % 10000;

  let cumulative = 0;
  for (const split of splits) {
    cumulative += split.weight;
    if (bucket < cumulative) {
      return split.version;
    }
  }

  return splits[splits.length - 1].version;
}
```

Use a stable key when you want sticky behavior. Use request ID when you want pure traffic distribution.

## Observability

Gateway metrics:

- requests by route, status, tenant
- p50/p95/p99 latency by route
- upstream latency
- auth failures
- authorization denials
- rate limit rejections
- request size rejections
- retry attempts
- upstream connection failures
- config version by instance

Structured access log:

```json
{
  "requestId": "req_123",
  "traceId": "4f7a...",
  "route": "checkout-orders",
  "tenantId": "tenant_abc",
  "method": "POST",
  "path": "/v1/orders",
  "status": 201,
  "upstream": "checkout-api",
  "upstreamVersion": "stable",
  "latencyMs": 84,
  "rateLimited": false,
  "configVersion": 42
}
```

Every gateway log should include route and config version. When a config rollout breaks traffic, you need to know which instances had which config.

## Config Rollout

Roll out gateway config like code:

1. validate
2. publish as candidate version
3. load on a small canary gateway pool
4. run synthetic checks
5. roll out to all gateway instances
6. monitor route errors and latency
7. keep rollback version ready

Data plane instances should expose current config:

```http
GET /admin/config-version
```

Response:

```json
{
  "configVersion": 42,
  "loadedAt": "2026-04-08T10:15:30Z",
  "checksum": "sha256:9f2..."
}
```

This makes split-brain config issues visible.

## Failure Modes

**Control plane outage.** Gateways must continue serving with last-known-good config.

**Bad config rollout.** Route points to the wrong upstream or missing auth policy.

**Identity provider latency.** Gateway calls auth service on every request and becomes slow.

**Rate limiter dependency outage.** Gateway either blocks all traffic or allows too much traffic.

**Retry amplification.** Gateway retries every request and overloads a struggling backend.

**Route shadowing.** Generic path route matches before a specific admin route.

**Logging overload.** Access logs become too expensive during traffic spikes.

**Business logic creep.** Gateway accumulates per-team custom transformations and becomes impossible to change safely.

## Production Checklist

- Separate data plane from control plane.
- Keep serving last-known-good config during control plane outages.
- Version every config rollout.
- Validate routes before publishing.
- Use deterministic route matching.
- Authenticate locally when possible.
- Keep authorization coarse-grained at the gateway.
- Enforce rate limits by tenant/API key/route.
- Define rate limiter failure behavior.
- Set route-level timeouts.
- Retry only safe operations by default.
- Require idempotency keys for write retries.
- Include route and config version in logs.
- Canary gateway config changes.
- Keep business logic out of the gateway hot path.

## Read Next

- [System Design: Rate Limiter](/blog/system-design-rate-limiter/)
- [API Design: REST vs GraphQL vs gRPC](/blog/api-design-rest-graphql-grpc/)
- [Spring Security OAuth2 JWT](/blog/spring-security-oauth2-jwt/)
- [Retry Storm Prevention](/blog/retry-storm-prevention/)
