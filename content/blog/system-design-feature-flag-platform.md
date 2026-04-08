---
title: "System Design: Building a Feature Flag Platform"
description: "Design a production feature flag platform: flag schemas, targeting rules, percentage rollouts, local SDK evaluation, streaming updates, audit logs, kill switches, experiments, consistency tradeoffs, and flag lifecycle management."
date: "2026-04-08"
category: "System Design"
tags: ["system design", "feature flags", "progressive delivery", "experimentation", "kill switches", "distributed systems"]
featured: false
affiliateSection: "system-design-courses"
---

A feature flag platform decouples deployment from release. Code can be deployed safely while the feature remains disabled, then enabled gradually for internal users, beta customers, 1% of traffic, 10% of traffic, and eventually everyone.

At small scale, feature flags are a config file. At production scale, they become release infrastructure. They need local evaluation, streaming updates, targeting rules, percentage rollouts, audit logs, approval workflows, kill switches, experiment assignment, tenant isolation, and lifecycle cleanup.

This guide designs a production feature flag platform. It focuses on the architecture behind tools like LaunchDarkly, Flagsmith, Unleash, and internal progressive delivery systems.

## Requirements

Functional requirements:

- create boolean and multivariate flags
- target users, tenants, regions, environments, and plans
- support percentage rollouts
- support kill switches
- evaluate flags from application SDKs
- update SDKs quickly when flags change
- record audit history
- support experiments
- support flag cleanup and ownership

Non-functional requirements:

- low-latency evaluation
- high availability during flag service outages
- predictable consistency
- safe defaults
- tenant isolation
- strong auditability
- protection against targeting mistakes
- scalable SDK update distribution

The most important design constraint: application code should not call a remote feature flag API for every request. Flag evaluation must happen locally in the SDK from an in-memory snapshot.

## High-Level Architecture

```text
Admin UI
  |
  v
Flag API
  |
  +-- validates changes
  +-- writes flag config
  +-- records audit event
  +-- publishes config update
        |
        v
Flag store -> update stream -> SDKs
                          |
                          v
                    local evaluation
```

The runtime path should be:

```text
application -> SDK local cache -> evaluate flag -> return variation
```

Not:

```text
application -> flag service -> database -> evaluate flag -> return variation
```

Remote evaluation on every request adds latency and creates a dependency that can break your entire application during a flag service outage.

## Flag Data Model

A flag is a versioned configuration object:

```json
{
  "key": "new-checkout-flow",
  "project": "commerce",
  "environment": "production",
  "type": "boolean",
  "enabled": true,
  "defaultVariation": false,
  "variations": [
    { "key": "off", "value": false },
    { "key": "on", "value": true }
  ],
  "rules": [
    {
      "id": "rule_enterprise_beta",
      "conditions": [
        { "attribute": "plan", "operator": "equals", "value": "enterprise" },
        { "attribute": "betaUser", "operator": "equals", "value": true }
      ],
      "serve": { "variation": "on" }
    }
  ],
  "fallthrough": {
    "rollout": [
      { "variation": "on", "weight": 1000 },
      { "variation": "off", "weight": 9000 }
    ],
    "bucketBy": "userId"
  },
  "version": 42,
  "updatedAt": "2026-04-08T10:15:30Z"
}
```

Weights use basis points: `1000` means 10%, `9000` means 90%. This avoids floating point mistakes.

## Storage Schema

```sql
CREATE TABLE feature_flags (
  flag_id UUID PRIMARY KEY,
  project TEXT NOT NULL,
  environment TEXT NOT NULL,
  flag_key TEXT NOT NULL,
  flag_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  owner_team TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project, environment, flag_key)
);

CREATE TABLE feature_flag_audit_events (
  event_id UUID PRIMARY KEY,
  flag_id UUID NOT NULL REFERENCES feature_flags(flag_id),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  old_version BIGINT,
  new_version BIGINT,
  diff JSONB NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The `config` JSON contains targeting rules and rollout configuration. The relational columns make common lookups and governance queries cheap.

Examples:

- "show all production flags owned by checkout"
- "show expired flags"
- "show all flags changed today"
- "show all disabled kill switches"

## Evaluation Context

SDKs evaluate a flag against a context:

```json
{
  "userId": "u_123",
  "tenantId": "tenant_abc",
  "email": "sachin@example.com",
  "plan": "enterprise",
  "region": "us-east-1",
  "country": "US",
  "betaUser": true,
  "appVersion": "4.12.0"
}
```

Do not require every service to send every attribute. Targeting rules must handle missing attributes.

Example rule evaluation:

```ts
type EvaluationContext = Record<string, string | number | boolean | undefined>;

type Condition = {
  attribute: string;
  operator: "equals" | "not_equals" | "in" | "starts_with";
  value: string | number | boolean | Array<string | number | boolean>;
};

function conditionMatches(condition: Condition, context: EvaluationContext): boolean {
  const actual = context[condition.attribute];

  switch (condition.operator) {
    case "equals":
      return actual === condition.value;
    case "not_equals":
      return actual !== condition.value;
    case "in":
      return Array.isArray(condition.value) && condition.value.includes(actual as never);
    case "starts_with":
      return typeof actual === "string"
        && typeof condition.value === "string"
        && actual.startsWith(condition.value);
  }
}
```

Keep the rule language intentionally small. A feature flag platform is not a general-purpose programming language.

## Percentage Rollouts

Percentage rollouts must be deterministic. A user should not bounce between on/off across requests.

```ts
function bucketUser(input: {
  flagKey: string;
  bucketByValue: string;
  salt: string;
}): number {
  const hashInput = `${input.flagKey}:${input.bucketByValue}:${input.salt}`;
  const hash = murmur3(hashInput);
  return Math.abs(hash) % 10000; // 0..9999
}

function evaluateRollout(
  bucket: number,
  rollout: Array<{ variation: string; weight: number }>
): string {
  let cumulative = 0;

  for (const allocation of rollout) {
    cumulative += allocation.weight;
    if (bucket < cumulative) {
      return allocation.variation;
    }
  }

  return rollout[rollout.length - 1].variation;
}
```

If 10% of users are enabled and you increase to 20%, the original 10% should remain enabled. Deterministic hashing gives you that property.

## SDK Local Evaluation

The SDK keeps an in-memory snapshot:

```ts
class FeatureFlagClient {
  private snapshot: Map<string, FlagConfig> = new Map();

  constructor(private defaults: Record<string, unknown>) {}

  updateSnapshot(flags: FlagConfig[]) {
    this.snapshot = new Map(flags.map(flag => [flag.key, flag]));
  }

  variation<T>(flagKey: string, defaultValue: T, context: EvaluationContext): T {
    const flag = this.snapshot.get(flagKey);
    if (!flag || !flag.enabled) {
      return defaultValue;
    }

    try {
      return evaluateFlag(flag, context) as T;
    } catch (error) {
      recordFlagEvaluationError(flagKey, error);
      return defaultValue;
    }
  }
}
```

Evaluation failure must return the caller-provided default. The default should be safe for the application.

For a release flag, safe default is usually old behavior. For a kill switch, safe default may be disabled. Make defaults explicit in code.

## Propagating Updates

Common update strategies:

| Strategy | Latency | Complexity | Notes |
|---|---|---|
| Polling | seconds to minutes | low | simple and robust |
| Server-Sent Events | sub-second to seconds | medium | good for server SDKs |
| WebSocket | sub-second | medium | useful for bidirectional needs |
| CDN snapshot | seconds | low/medium | good for browser/mobile SDKs |

A practical pattern:

- server-side SDKs use streaming with polling fallback
- client-side SDKs use CDN snapshots
- all SDKs persist last-known-good snapshot

If the flag service is down, applications should keep using the last-known-good snapshot. They should not suddenly forget every flag and change behavior across the fleet.

## Consistency Tradeoffs

Feature flag systems are usually eventually consistent.

That means:

- a kill switch may take a few seconds to propagate
- different app instances may briefly evaluate different versions
- SDKs need version tracking
- audit logs should show when the change was made, not when every SDK received it

For critical kill switches, add a faster emergency path:

```text
admin kill switch -> high-priority update stream -> SDK immediate refresh
```

You can also separate emergency ops flags from experiment flags. Ops flags need faster propagation and stricter approval than UI experiments.

## Audit And Approval

Every production flag change should be auditable:

```json
{
  "eventId": "evt_123",
  "flagKey": "new-checkout-flow",
  "environment": "production",
  "actorId": "u_456",
  "action": "ROLLOUT_UPDATED",
  "oldVersion": 41,
  "newVersion": 42,
  "diff": {
    "fallthrough.rollout[on].weight": { "old": 1000, "new": 2500 }
  },
  "reason": "Increase rollout after stable 1% canary",
  "createdAt": "2026-04-08T10:15:30Z"
}
```

Require approval for:

- production kill switch changes
- rollout above a threshold
- targeting all tenants
- permission or billing flags
- flags owned by another team

Do not require approval for every development flag update, or teams will route around the platform.

## Experiments

Experiments need stable assignment and analytics.

Experiment assignment:

```json
{
  "experimentKey": "checkout-button-copy",
  "userId": "u_123",
  "variation": "treatment",
  "flagVersion": 42,
  "assignedAt": "2026-04-08T10:15:30Z"
}
```

Emit exposure events only when the user actually sees the variant:

```ts
const variant = flags.variation("checkout-button-copy", "control", context);

renderButton(variant);

analytics.track("experiment_exposure", {
  experimentKey: "checkout-button-copy",
  variant,
  userId: context.userId,
  flagVersion: flags.version("checkout-button-copy"),
});
```

Do not count exposure just because a backend evaluated a flag if the user never saw the UI.

## Kill Switches

Kill switches should be designed differently from ordinary release flags.

Properties:

- safe default is usually disabled behavior
- fast propagation
- clear owner
- clear runbook
- prominent UI placement
- audit event with incident reference

Example:

```java
if (!featureFlags.getBooleanValue("payments.card-processing.enabled", true, context)) {
    return paymentFallbackService.queueForManualReview(request);
}

return cardProcessor.charge(request);
```

The fallback path must be tested. A kill switch that flips to broken code is theater.

## Multi-Tenancy

Feature flag platforms need tenant isolation:

- project-level access controls
- environment-level access controls
- tenant targeting limits
- audit events per tenant-affecting change
- rate limits on SDK polling/streaming
- snapshot size limits

If you support customer-specific flags, avoid creating one-off flags for every customer forever. Prefer targeting rules with tenant attributes and expiration dates.

## Flag Lifecycle

Flag debt is real. Every flag adds branches and test combinations.

Lifecycle:

1. created
2. internal testing
3. beta rollout
4. percentage rollout
5. fully enabled
6. code cleanup required
7. archived

Add lifecycle fields:

```sql
ALTER TABLE feature_flags
ADD COLUMN lifecycle_stage TEXT NOT NULL DEFAULT 'CREATED',
ADD COLUMN cleanup_owner TEXT,
ADD COLUMN cleanup_due_at TIMESTAMPTZ;
```

Weekly cleanup query:

```sql
SELECT flag_key, owner_team, cleanup_due_at
FROM feature_flags
WHERE environment = 'production'
  AND lifecycle_stage = 'CLEANUP_REQUIRED'
  AND cleanup_due_at < now()
ORDER BY cleanup_due_at ASC;
```

If a release flag is fully enabled for weeks, remove the old code path and archive the flag.

## Failure Modes

**Remote evaluation in request path.** Every request depends on the flag service and latency grows.

**Bad default value.** Flag service outage changes application behavior because defaults were unsafe.

**Stale SDK snapshot.** An instance misses updates and keeps evaluating an old version.

**Targeting typo.** A rule targets all users instead of beta users.

**Cardinality explosion.** Experiment exposure events include high-cardinality or sensitive attributes.

**Flag debt.** Old flags stay in code forever and create untested combinations.

**Kill switch not tested.** The emergency path fails when it is finally needed.

**Client-side secret leakage.** Browser/mobile SDK gets rules or attributes that should only be server-side.

## Production Checklist

- Evaluate flags locally in SDKs.
- Use last-known-good snapshots.
- Provide polling fallback for streaming.
- Make defaults explicit and safe.
- Use deterministic hashing for rollouts.
- Keep the targeting language small.
- Audit every production flag change.
- Require approval for high-risk changes.
- Separate kill switches from experiments.
- Emit experiment exposure only when actually shown.
- Track SDK snapshot version and staleness.
- Add expiration and owner metadata.
- Review stale flags weekly.
- Protect server-only targeting rules from client SDKs.
- Test fallback paths for kill switches.

## Read Next

- [Feature Flags and Progressive Delivery](/blog/feature-flags-progressive-delivery/)
- [System Design: Building an Audit Log System](/blog/system-design-audit-log-system/)
- [Production Incident Playbooks](/blog/production-incident-playbooks/)
- [Spring Boot Production Readiness Checklist](/blog/spring-boot-production-readiness-checklist/)
