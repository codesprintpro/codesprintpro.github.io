---
title: "System Design: Building a Session Management Platform"
description: "Design a production session management platform with login sessions, refresh tokens, revocation, multi-device control, risk signals, expiry, and safe cache-backed validation."
date: "2026-04-18"
category: "System Design"
tags: ["system design", "session management", "authentication", "security", "distributed systems", "backend engineering"]
featured: false
affiliateSection: "system-design-courses"
---

Sessions feel simple until they become a security boundary.

A user logs in. The system gives them a token or cookie. Requests work. End of story.

Then reality arrives:

- one user is logged in on five devices
- an access token leaks
- refresh tokens need rotation
- logout should invalidate active sessions quickly
- suspicious logins should trigger re-authentication
- customer support needs to see which sessions are active
- a cache outage should not turn into a global auth outage

That is when "just use JWT" stops being an architecture and starts being a slogan.

This guide designs a production session management platform.

## Problem Statement

Build a platform that manages authenticated user sessions across web and mobile clients.

The platform should support:

- login and logout
- short-lived access credentials
- refresh and session renewal
- per-device session tracking
- session revocation
- suspicious session detection
- password-change and account-lock handling
- tenant or policy-specific session rules

This is not only an authentication problem.

It is a **state, security, and invalidation** problem.

## Requirements

Functional requirements:

- create a new session after successful login
- issue access and refresh credentials
- validate active sessions
- rotate refresh tokens
- revoke a single session or all sessions for a user
- list active sessions for account settings
- expire idle and max-age sessions
- record device and IP metadata
- support forced re-authentication

Non-functional requirements:

- low validation latency
- strong revocation guarantees within a bounded window
- high availability
- safe behavior under replay attempts
- auditability
- support for millions of concurrent sessions

The most important constraint:

**the system must make it easy to invalidate trust when risk changes.**

## Access Token vs Session Record

The first design choice is whether the system is purely stateless or keeps server-side session state.

Pure stateless access tokens are attractive because they scale easily. But they make revocation, device tracking, and risk-based invalidation much harder.

For most real platforms, the practical model is:

- short-lived access token
- long-lived refresh token
- server-side session record

That gives you:

- fast request auth
- ability to revoke sessions
- device management
- safer rotation logic

## High-Level Architecture

```text
User / Client
    |
    v
Auth API
    |
    +--> credential verification
    +--> session creation
    +--> token issuance
    |
    v
Session Store
    |
    +--> active session records
    +--> refresh token family state
    +--> revocation state
    |
    v
Session Cache / Validation Layer
    |
    v
Product APIs
```

Supporting systems:

- risk signals and anomaly detection
- audit log
- device/session management UI

## Session Lifecycle

A production session typically looks like this:

1. user logs in with password / OTP / OAuth
2. auth service creates a session record
3. auth service issues:
   - short-lived access token
   - refresh token
4. client uses access token on API requests
5. when access token expires, client exchanges refresh token for a new access token
6. refresh token may rotate
7. logout or revocation invalidates the session

That sounds straightforward. The difficulty is making it safe under retries, theft, and distributed validation.

## Data Model

### Session record

```sql
CREATE TABLE user_sessions (
  session_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_status TEXT NOT NULL,         -- active, revoked, expired, locked
  device_id TEXT,
  device_name TEXT,
  client_type TEXT,                     -- web, ios, android
  ip_address INET,
  country TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  idle_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT
);

CREATE INDEX idx_user_sessions_lookup
  ON user_sessions (tenant_id, user_id, session_status);
```

### Refresh token family

```sql
CREATE TABLE refresh_token_families (
  family_id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES user_sessions(session_id),
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  current_token_hash TEXT NOT NULL,
  previous_token_hash TEXT,
  rotation_counter BIGINT NOT NULL DEFAULT 0,
  compromised BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Audit log

```sql
CREATE TABLE session_audit_events (
  event_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id UUID,
  event_type TEXT NOT NULL,             -- login, refresh, revoke, password_reset, suspicious_activity
  actor_type TEXT NOT NULL,             -- user, system, support
  actor_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Access Token Design

Access tokens are usually:

- signed JWTs, or
- opaque tokens backed by lookup

For most high-scale application APIs, signed JWT access tokens are fine when:

- they are short-lived
- they contain minimal claims
- revocation is handled through session state checks or bounded expiry

Typical claims:

```json
{
  "sub": "user_123",
  "sid": "sess_456",
  "tenant": "tenant_42",
  "iat": 1775800000,
  "exp": 1775800900,
  "scope": ["orders:read", "orders:create"]
}
```

Keep the access token small. It is not a session database.

## Refresh Token Design

Refresh tokens should be:

- longer lived
- securely random
- stored hashed server-side
- rotated on use

Do not store them in plaintext in your database if you can avoid it.

Think of refresh tokens like passwords for session renewal.

## Login Flow

```text
User credentials verified
   -> create session record
   -> create refresh token family
   -> issue access token
   -> issue refresh token
   -> write audit event
```

Example pseudo-service:

```java
public LoginResponse login(LoginRequest request) {
    User user = credentialService.verify(request.email(), request.password());

    Session session = sessionRepository.create(
        user.tenantId(),
        user.id(),
        request.deviceId(),
        request.deviceName(),
        request.clientType(),
        request.ipAddress(),
        request.userAgent()
    );

    RefreshToken issuedRefreshToken = refreshTokenService.createFamily(session);
    String accessToken = accessTokenService.issue(user, session);

    auditLog.recordLogin(user.id(), session.id(), request.ipAddress());

    return new LoginResponse(accessToken, issuedRefreshToken.value(), session.id());
}
```

## Validation Path

Product APIs should not do a heavy database query on every request if that can be avoided.

A common pattern:

1. validate JWT signature locally
2. check basic claims
3. verify session state from cache
4. fall back to session store if cache misses

That gives low latency while still allowing revocation.

Example cache entry:

```json
{
  "sessionId": "sess_456",
  "status": "active",
  "userId": "user_123",
  "tenantId": "tenant_42",
  "expiresAt": "2026-04-18T15:00:00Z",
  "idleExpiresAt": "2026-04-18T11:30:00Z"
}
```

Cache key:

```text
session:sess_456
```

The request path should remain cheap, but never assume cache is the only truth.

## Refresh Flow and Rotation

Refresh rotation is one of the most important safety features.

Goal:

- each refresh token is single-use
- when used, a new refresh token is issued
- reuse of an old refresh token indicates theft or replay

Flow:

1. client sends refresh token
2. server hashes it and compares with current family token
3. if match, rotate:
   - move current to previous
   - store new current token hash
   - increment rotation counter
4. issue new access token and refresh token

If an old refresh token gets reused after rotation:

- mark token family as compromised
- revoke the session
- force re-login

Example:

```java
public RefreshResponse refresh(String presentedToken) {
    HashedToken tokenHash = tokenHasher.hash(presentedToken);
    RefreshTokenFamily family = refreshFamilyRepository.findByTokenHash(tokenHash);

    if (family == null || family.isCompromised()) {
        throw new UnauthorizedException();
    }

    if (family.previousTokenMatches(tokenHash)) {
        refreshFamilyRepository.markCompromised(family.id());
        sessionRepository.revoke(family.sessionId(), "refresh_token_reuse");
        throw new UnauthorizedException();
    }

    if (!family.currentTokenMatches(tokenHash)) {
        throw new UnauthorizedException();
    }

    RotatedRefreshToken next = refreshFamilyRepository.rotate(family.id());
    String accessToken = accessTokenService.issueForSession(family.sessionId());
    return new RefreshResponse(accessToken, next.rawValue());
}
```

## Logout and Revocation

Logout should invalidate trust quickly.

Common operations:

- revoke current session
- revoke all sessions for user
- revoke all sessions except current
- revoke sessions due to password reset or admin action

Example API:

```http
POST /v1/sessions/current/revoke
POST /v1/sessions/revoke-all
POST /v1/sessions/{sessionId}/revoke
```

Revocation path:

1. mark session `revoked` in store
2. invalidate session cache entry
3. mark refresh family compromised or inactive
4. emit revocation event

## Immediate vs Bounded Revocation

Here is the hard trade-off:

- if access tokens are self-contained and valid for 15 minutes, a revoked session may still work until access token expiry unless you check server-side session state

There are a few models:

### Model 1: rely only on short access token expiry

Pros:

- very scalable

Cons:

- revocation is delayed

### Model 2: validate session status on every request through cache

Pros:

- near-immediate revocation

Cons:

- extra dependency on session state service/cache

Most serious applications choose model 2 for sensitive APIs.

## Idle Timeout vs Absolute Timeout

Sessions usually need both:

- **idle timeout**: expires if unused for some period
- **absolute timeout**: max session lifetime regardless of activity

Example:

```text
idle timeout: 30 minutes
absolute timeout: 14 days
```

That prevents "forever sessions" while still allowing active users to stay logged in reasonably.

## Multi-Device Session Control

Users increasingly expect:

- "show me all devices where I’m logged in"
- "log out this old phone"
- "alert me about new sessions"

That means device-aware session metadata:

- device id
- approximate location
- first seen / last seen
- client type
- trust state

Example user-facing response:

```json
[
  {
    "sessionId": "sess_1",
    "deviceName": "Chrome on Mac",
    "location": "Bengaluru, IN",
    "lastSeenAt": "2026-04-18T10:10:00Z",
    "current": true
  },
  {
    "sessionId": "sess_2",
    "deviceName": "iPhone 14",
    "location": "Mumbai, IN",
    "lastSeenAt": "2026-04-17T22:40:00Z",
    "current": false
  }
]
```

## Risk Signals

Not all sessions should be treated equally.

Useful risk signals:

- new device
- impossible travel
- IP reputation
- TOR or proxy detection
- multiple failed refresh attempts
- refresh token reuse
- sudden privilege elevation

Actions:

- allow silently
- require MFA
- restrict sensitive operations
- revoke and force re-auth

This is where session management starts overlapping with fraud and auth risk.

## Password Reset and Account Lock

Some security events should trigger broad invalidation:

- password changed
- account locked
- MFA reset
- user disabled by admin

Common choice:

- revoke all active sessions
- invalidate refresh token families
- optionally let current session survive only after step-up verification

Do not leave old sessions alive casually after major auth state changes.

## Storage Choices

### Database

Good for:

- durable session history
- audit queries
- support and admin tooling

### Redis / cache

Good for:

- low-latency session validation
- revocation lookups
- idle timeout updates

Hybrid approach:

- database for durable state
- Redis for active-session cache

This is usually the practical production choice.

## Failure Modes

### 1. Cache outage

If request auth depends entirely on cache, a Redis outage becomes an auth outage.

Fix:

- DB fallback for sensitive paths
- bounded degrade behavior
- local short-lived memoization where safe

### 2. Refresh token replay

Attacker reuses a stolen old refresh token.

Fix:

- rotation with reuse detection
- revoke token family on reuse

### 3. Revoked session still works

Cause:

- only JWT expiry used, no session-state check

Fix:

- cache-backed revocation validation
- shorter access token TTL if needed

### 4. Session storm after deploy or outage

Many clients refresh at once.

Fix:

- jitter access token renewal
- backpressure on refresh endpoints
- lightweight token rotation path

### 5. Device metadata lies

User-agent-based device names are approximate.

Fix:

- treat device identity as advisory
- use client device ids carefully, with rotation rules

## Observability

Track:

- active sessions count
- login success/failure rate
- refresh success/failure rate
- revoked sessions per minute
- token reuse detections
- session cache hit rate
- validation latency p95 / p99
- session skew by tenant / client type

Useful dashboards:

- login spikes
- suspicious refresh failures
- global revoke events
- unusual geo changes

Security systems need operational telemetry, not only business metrics.

## Example Session API

Create session:

```http
POST /v1/sessions/login
```

Refresh:

```http
POST /v1/sessions/refresh
```

List sessions:

```http
GET /v1/sessions
```

Revoke one:

```http
POST /v1/sessions/{sessionId}/revoke
```

Revoke all:

```http
POST /v1/sessions/revoke-all
```

## What I Would Build First

Phase 1:

- session record store
- access + refresh token issuance
- refresh rotation
- session revocation
- list active sessions

Phase 2:

- Redis validation cache
- risk-based revocation
- idle and absolute timeout enforcement
- account-wide revoke on password change

Phase 3:

- reuse detection with family compromise handling
- geo/device anomaly scoring
- tenant-specific session policies
- support tooling and analytics

This order matters. Teams often debate JWT philosophy before they have a reliable revoke, rotate, and observe loop.

## Production Checklist

- short-lived access tokens
- refresh tokens hashed at rest
- refresh rotation enabled
- reuse detection handled
- session record exists server-side
- revoke single and all sessions supported
- cache is not sole source of truth
- password reset revokes trust appropriately
- idle and absolute timeout enforced
- session version / audit trail visible to operators

## Final Takeaway

A session management platform is how an authenticated system remembers trust and takes it back.

If you design it well, users stay logged in smoothly, attackers get shut down quickly, and operators can explain exactly what happened.

If you design it poorly, you either annoy every legitimate user or leave stolen sessions alive far too long.

## Read Next

- [System Design: Building an Authorization Service](/blog/system-design-authorization-service/)
- [System Design: Building a Fraud Detection Platform](/blog/system-design-fraud-detection-platform/)
- [Idempotency Keys in APIs: Retries, Duplicate Requests, and Exactly-Once Illusions](/blog/api-idempotency-keys/)
