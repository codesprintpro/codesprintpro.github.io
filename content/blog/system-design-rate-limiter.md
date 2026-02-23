---
title: "System Design: Distributed Rate Limiter — Token Bucket vs Sliding Window"
description: "Design a rate limiter that handles millions of requests across distributed servers. Compare token bucket, leaky bucket, fixed window, and sliding window algorithms with Redis-backed implementations."
date: "2025-01-08"
category: "System Design"
tags: ["system design", "rate limiting", "redis", "distributed systems", "api"]
featured: false
affiliateSection: "system-design-courses"
---

Rate limiting is deceptively simple in concept and surprisingly tricky in distributed systems. Every API at scale — Stripe, GitHub, Twitter — implements rate limiting. Done wrong, it allows bursts that overwhelm backends. Done right, it's invisible to legitimate users and impenetrable to abusers.

This article covers every algorithm, compares their tradeoffs, and shows production-ready Redis implementations.

## Why Rate Limiting?

- **DoS protection**: Prevent any single client from consuming all resources
- **Cost control**: Metered APIs bill per request — enforce usage quotas
- **Fairness**: Ensure no tenant starves others in a shared system
- **Backend protection**: Databases and downstream services have capacity limits

## Algorithm Comparison

Choosing the right algorithm is not about technical preference — it is about which failure mode you can tolerate. Each algorithm below trades memory, accuracy, and burst behavior in different ways. Understanding the tradeoffs lets you pick the right one for your specific workload.

### Fixed Window Counter

Divide time into fixed windows (e.g., 1-minute buckets). Count requests per window. This approach is appealing because it requires only a single integer counter per client per window, but it has a dangerous edge case that has caused real production incidents.

```
Window: 12:00:00 - 12:01:00
  Client A: 95 requests ✓
  Client A: 96th request at 12:00:59 ✗ (over limit of 95)

Problem: Boundary burst
  Client A sends 95 requests at 12:00:55 ✓
  Client A sends 95 requests at 12:01:05 ✓
  = 190 requests in 10 seconds (2x the intended rate)
```

**Verdict**: Simple, but the boundary burst is a real vulnerability.

### Sliding Window Log

Record the exact timestamp of every request. Count requests within the last N seconds. This approach is conceptually the most correct — there are no windows and no boundary artifacts — but the memory cost grows linearly with request volume.

```
Rate limit: 100 requests per minute

At 12:01:30:
  Log: [12:00:31, 12:00:45, ..., 12:01:28, 12:01:29, 12:01:30]
  Filter to last 60 seconds: count requests since 12:00:30
  If count < 100: allow, else reject
```

**Verdict**: Accurate, no boundary bursts. Memory-intensive (store all timestamps). Impractical for >10K RPS.

### Sliding Window Counter

Approximate the sliding window using two fixed window counters and a weighted average. This is the sweet spot for most production systems: it eliminates the boundary burst problem of fixed windows while using only two integers per client instead of a full timestamp log.

```
Rate limit: 100 requests/minute

At 12:01:45 (45 seconds into current window):
  Previous window (12:00 - 12:01): 80 requests
  Current window (12:01 - 12:02): 30 requests so far

  Weight of previous window = (60 - 45) / 60 = 25%
  Estimated requests in last 60s = 80 × 0.25 + 30 = 50
  Under limit → allow
```

**Verdict**: Memory-efficient, approximation error is <0.1% in practice. The best tradeoff for most systems.

### Token Bucket

Tokens accumulate at a fixed rate (refill rate). Each request consumes one token. Burst is allowed up to the bucket capacity. Think of it like a prepaid phone plan: you accumulate credit over time and can spend it in bursts, but you can never spend more than you have.

```
Bucket capacity: 10 tokens (max burst)
Refill rate: 1 token/second

Timeline:
  T=0: bucket=10 (full), 8 requests → bucket=2
  T=3: bucket=5 (3 tokens added), 3 requests → bucket=2
  T=5: bucket=4 (2 tokens added), 6 requests → REJECT (only 4 available)

Properties:
  - Allows bursting up to bucket capacity
  - Average rate controlled by refill rate
  - Intuitive for "requests per second with burst allowance"
```

**Verdict**: Best for APIs where controlled bursting is acceptable (e.g., initial page load).

### Leaky Bucket

Requests enter a queue. A worker drains the queue at a fixed rate. Overflow requests are rejected. Unlike the token bucket, which smooths the average rate but allows bursts, the leaky bucket smooths the output rate — it is useful when your downstream system needs a steady, predictable call rate rather than handling bursty traffic.

```
Queue size: 10 requests
Drain rate: 5 requests/second

  Burst of 15 requests arrives:
  → 10 queued, 5 rejected immediately
  → Queue drains at 5/s → smooth outgoing traffic
```

**Verdict**: Smoothes traffic for backends that need steady input. Adds latency (queue wait). Use for outbound call shaping, not incoming API protection.

## Redis Implementation: Token Bucket with Lua

The critical requirement for distributed rate limiting: **atomicity**. Read-modify-write must be atomic, or concurrent requests on different servers will both read "under limit" and both write "at limit+1" — a race condition. Without atomicity, a client could send 10 simultaneous requests on 10 different app servers, and all 10 would pass the rate check before any of them had a chance to decrement the counter.

Redis Lua scripts run atomically on the Redis server, solving this problem without requiring distributed locks:

```lua
-- token_bucket.lua
-- KEYS[1]: rate limit key (e.g., "rate:user:123")
-- ARGV[1]: max tokens (bucket capacity)
-- ARGV[2]: refill rate (tokens per second)
-- ARGV[3]: current timestamp (Unix seconds with milliseconds)
-- ARGV[4]: requested tokens (usually 1)

local key = KEYS[1]
local max_tokens = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

-- Get current state
local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1]) or max_tokens
local last_refill = tonumber(data[2]) or now

-- Calculate tokens to add based on elapsed time
local elapsed = math.max(0, now - last_refill)
local tokens_to_add = elapsed * refill_rate
tokens = math.min(max_tokens, tokens + tokens_to_add)

-- Check if request can be served
local allowed = 0
if tokens >= requested then
    tokens = tokens - requested
    allowed = 1
end

-- Save state with TTL (auto-cleanup for idle clients)
redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
redis.call('EXPIRE', key, math.ceil(max_tokens / refill_rate) + 1)

return {allowed, math.floor(tokens), math.floor(tokens_to_add)}
```

The `EXPIRE` call at the end is a crucial operational detail: it automatically removes rate limit state for idle clients, preventing unbounded Redis memory growth. The TTL is calculated to be just long enough that a fully drained bucket would refill to capacity.

Now that you have the Lua logic, the Java service below wires it into a callable interface. The key design choice here is passing the current timestamp from the application rather than reading it inside Lua — this keeps the script deterministic and easier to test.

```java
@Service
public class TokenBucketRateLimiter {

    @Autowired
    private StringRedisTemplate redis;

    private final DefaultRedisScript<List> luaScript;

    public TokenBucketRateLimiter() {
        this.luaScript = new DefaultRedisScript<>();
        this.luaScript.setScriptText(LUA_SCRIPT); // Load from classpath
        this.luaScript.setResultType(List.class);
    }

    public RateLimitResult checkLimit(String clientId, RateLimitConfig config) {
        String key = "rate:" + clientId;
        double now = System.currentTimeMillis() / 1000.0;

        List<Long> result = redis.execute(
            luaScript,
            List.of(key),
            String.valueOf(config.getMaxTokens()),
            String.valueOf(config.getRefillRate()),
            String.valueOf(now),
            "1"
        );

        boolean allowed = result.get(0) == 1L;
        long remainingTokens = result.get(1);

        return new RateLimitResult(allowed, remainingTokens, config.getMaxTokens());
    }
}
```

## Spring Boot Integration: Rate Limit Filter

With the core limiter in place, you need to intercept every HTTP request before it reaches your business logic. A servlet filter runs before any controller code and can short-circuit the request with a `429` response without touching your application logic at all. This separation means you can add rate limiting to any endpoint without modifying it.

```java
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RateLimitFilter extends OncePerRequestFilter {

    @Autowired
    private TokenBucketRateLimiter rateLimiter;

    private static final Map<String, RateLimitConfig> TIER_CONFIGS = Map.of(
        "free",       new RateLimitConfig(60, 1.0),   // 60 burst, 1 RPS sustained
        "pro",        new RateLimitConfig(600, 10.0),  // 600 burst, 10 RPS sustained
        "enterprise", new RateLimitConfig(6000, 100.0) // 6000 burst, 100 RPS
    );

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {

        String clientId = extractClientId(request); // From API key or JWT
        String tier = extractTier(clientId);
        RateLimitConfig config = TIER_CONFIGS.getOrDefault(tier, TIER_CONFIGS.get("free"));

        RateLimitResult result = rateLimiter.checkLimit(clientId, config);

        // Always set rate limit headers (RFC 6585)
        response.setHeader("X-RateLimit-Limit", String.valueOf(config.getMaxTokens()));
        response.setHeader("X-RateLimit-Remaining", String.valueOf(result.getRemainingTokens()));
        response.setHeader("X-RateLimit-Reset", String.valueOf(System.currentTimeMillis() / 1000 + 1));

        if (!result.isAllowed()) {
            response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
            response.setHeader("Retry-After", "1");
            response.getWriter().write("{\"error\": \"Rate limit exceeded\", \"tier\": \"" + tier + "\"}");
            return;
        }

        chain.doFilter(request, response);
    }

    private String extractClientId(HttpServletRequest request) {
        String apiKey = request.getHeader("X-API-Key");
        if (apiKey != null) return "api:" + apiKey;

        // Fall back to IP-based limiting for unauthenticated requests
        return "ip:" + request.getRemoteAddr();
    }
}
```

Always setting the rate limit headers — even for successful requests — is important because clients use `X-RateLimit-Remaining` to implement self-throttling. A well-behaved SDK will slow down proactively when remaining tokens run low, reducing the number of rejected requests and improving the overall user experience.

## Distributed Challenges

The single-server implementation above is correct, but distributed systems introduce new problems. The following two challenges are the ones interviewers most commonly expect you to address.

### Redis Cluster Consistency

In a Redis cluster, rate limit keys can sit on different shards. Ensure the key lands on the same shard using hash tags:

```java
// Without hash tag: different shards for different clients (fine)
String key = "rate:" + clientId;

// With hash tag: force all rate limit keys to same shard (avoid for large deployments)
String key = "{rate}:" + clientId;

// Better: use consistent hashing at the application level
// Partition clients by modulo and direct to specific Redis nodes
```

### Multi-Region Rate Limiting

Strict global rate limiting requires cross-region coordination — expensive. In practice, use **local + global** hybrid. Think of it like allocating traffic quotas across airport terminals: each terminal enforces its own cap, and the central authority adjusts allocations periodically rather than approving every single passenger.

```
Approach: Divide global limit across regions proportionally

Global limit: 1000 requests/minute
  Region us-east-1: 500 req/min (50% of traffic)
  Region eu-west-1: 300 req/min (30%)
  Region ap-south-1: 200 req/min (20%)

Each region enforces its limit independently.
Sync global counters asynchronously every 10 seconds.
A client can exceed global limit by up to 10 seconds × regional rate — acceptable for most use cases.
```

The 10-second sync window means a determined attacker can exceed the global limit by at most 10 seconds worth of regional traffic — a bounded and acceptable overshoot for most business requirements.

## Where to Apply Rate Limiting

Rate limiting is most effective when applied at multiple layers simultaneously, creating defense in depth. Each layer handles a different threat model, and together they prevent both accidental and intentional overload.

```
Request path:
  Client → CDN → API Gateway → Load Balancer → Service → Database

Rate limiting layers:
  CDN:         IP-based blocking for known abusers (bot traffic)
  API Gateway: Per-client limits (recommended primary enforcement point)
  Service:     Per-endpoint limits (e.g., expensive endpoints get stricter limits)
  Database:    Connection pool limits (implicit rate limiting)

Recommendation:
  - API Gateway for business rate limits (per API key, per tier)
  - Service layer for resource protection (expensive endpoints)
  - Both together for defense in depth
```

Rate limiting is a foundational API design concern. The token bucket algorithm with Redis Lua provides the best combination of correctness, performance, and operational simplicity. The boundary burst of fixed window algorithms has caused real production incidents — don't ship that in critical systems.
