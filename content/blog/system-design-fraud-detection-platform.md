---
title: "System Design: Building a Fraud Detection Platform"
description: "Design a production fraud detection platform with real-time scoring, rules, ML models, feature stores, case management, feedback loops, and safe decision workflows for payments and account abuse."
date: "2026-04-10"
category: "System Design"
tags: ["system design", "fraud detection", "payments", "machine learning", "risk", "distributed systems", "backend engineering"]
featured: false
affiliateSection: "system-design-courses"
---

Fraud detection is not a single model.

It is a decision system that has to operate under latency pressure, incomplete information, adversarial behavior, and messy business trade-offs.

If the system is too loose, fraud losses rise.

If the system is too aggressive, good customers get blocked, revenue drops, support queues explode, and trust erodes.

That tension is what makes fraud detection a system design problem rather than just a data science problem.

This guide designs a production fraud detection platform.

## Problem Statement

Build a platform that evaluates risky actions in real time and helps risk teams investigate suspicious activity.

Examples:

- card payment authorization
- account signup
- password reset abuse
- coupon abuse
- refund fraud
- payout fraud
- account takeover
- bot-driven checkout attempts

The platform should:

- score actions in milliseconds
- combine deterministic rules with model output
- support manual review when needed
- learn from confirmed outcomes
- keep an audit trail for decisions

## Requirements

Functional requirements:

- ingest online events in real time
- score transactions synchronously for critical flows
- support rules and ML model decisions together
- fetch historical and behavioral features
- support allow / review / deny outcomes
- support merchant or tenant-specific policies
- expose case management for analysts
- ingest feedback labels such as chargebacks and confirmed fraud
- support replay and backtesting

Non-functional requirements:

- p99 decision latency low enough for checkout or login
- high availability
- explainable decisions
- protection against duplicate event processing
- graceful degradation if some features are unavailable
- strict auditability
- low false-positive rate
- scalable feature retrieval and aggregation

The core challenge is not just "detect fraud."

It is making **fast, explainable, business-safe decisions with incomplete and adversarial data**.

## Decision Outcomes

The platform usually returns one of three results:

```text
ALLOW
REVIEW
DENY
```

Examples:

- low-risk trusted customer payment -> `ALLOW`
- first-time high-value transaction from unusual device -> `REVIEW`
- stolen card pattern or impossible geo velocity -> `DENY`

Do not reduce the system to a binary allow/deny model unless your business can tolerate blunt decisions. Review is often what keeps false positives from wrecking revenue.

## High-Level Architecture

```text
Client Action
   |
   v
Risk API
   |
   +--> Feature Fetch
   |       +--> online feature store
   |       +--> hot aggregates / counters
   |       +--> historical profile lookup
   |
   +--> Rules Engine
   |
   +--> ML Scoring Service
   |
   +--> Decision Combiner
   |
   v
ALLOW / REVIEW / DENY
   |
   +--> Event Log
   +--> Analyst Queue
   +--> Training / Feedback Pipeline
```

The request path should remain small and deterministic:

1. collect request context
2. fetch essential features
3. evaluate rules
4. score model
5. combine into final decision
6. log everything

## Example Flow: Payment Fraud Check

1. checkout service calls risk API with payment attempt
2. risk API computes derived fields such as amount bucket and local hour
3. online features are loaded:
   - card attempts in last 10 minutes
   - device velocity
   - user account age
   - historical chargeback rate
   - IP reputation
4. rules engine checks hard constraints
5. model returns fraud score, say `0.87`
6. decision combiner applies policy:
   - score > 0.95 -> deny
   - score between 0.75 and 0.95 -> review
   - high-risk rule with override -> deny
7. result returned to checkout in under 150ms

## Data Inputs

Fraud systems usually combine several data classes.

### 1. Request context

- user id
- email
- phone
- card fingerprint
- device fingerprint
- IP
- amount
- currency
- merchant
- SKU / category
- geolocation

### 2. Historical user features

- account age
- successful transaction count
- recent failed attempts
- prior refunds
- known device count

### 3. Shared risk features

- IP reputation
- BIN / issuer country
- card country mismatch
- email domain age
- device velocity across many accounts

### 4. Feedback labels

- chargeback received
- analyst confirmed fraud
- customer reported unauthorized activity
- trusted order / safe event

Without labels, the system cannot improve.

## Online vs Offline Features

Some features are naturally real time:

- attempts from this IP in last 5 minutes
- number of cards seen on this device in last hour
- transaction count for this user today

Some are batch-driven:

- customer lifetime value
- chargeback rate over 90 days
- merchant-level dispute trend
- device risk profile from previous weeks

The fraud platform needs both.

Common architecture:

```text
Streaming events -> online counters / feature store
Historical warehouse -> offline features / training datasets
```

That is why feature freshness and point-in-time correctness matter.

## API Design

```http
POST /v1/risk/evaluate
Idempotency-Key: pay-attempt-ord_123
```

```json
{
  "tenantId": "merchant_42",
  "eventType": "payment_attempt",
  "eventId": "evt_991",
  "userId": "user_123",
  "amount": 12999,
  "currency": "INR",
  "paymentMethod": {
    "type": "card",
    "cardFingerprint": "cf_77",
    "bin": "411111",
    "issuerCountry": "US"
  },
  "device": {
    "deviceId": "dev_88",
    "ip": "103.44.11.19",
    "userAgent": "Mozilla/5.0"
  },
  "metadata": {
    "checkoutId": "chk_55",
    "cartValue": 12999,
    "shippingCountry": "IN",
    "billingCountry": "US"
  }
}
```

Response:

```json
{
  "decision": "REVIEW",
  "riskScore": 0.87,
  "reasonCodes": [
    "HIGH_DEVICE_VELOCITY",
    "CARD_COUNTRY_MISMATCH",
    "NEW_ACCOUNT_HIGH_VALUE"
  ],
  "reviewQueue": "payments_high_risk"
}
```

Reason codes are not decoration. They are necessary for analysts, support, backtesting, and trust.

## Event and Decision Storage

### Raw request log

```sql
CREATE TABLE fraud_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  user_id TEXT,
  device_id TEXT,
  ip INET,
  amount_minor BIGINT,
  currency TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Decision log

```sql
CREATE TABLE fraud_decisions (
  decision_id UUID PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES fraud_events(event_id),
  tenant_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  risk_score NUMERIC(5,4),
  policy_version TEXT NOT NULL,
  model_version TEXT,
  reason_codes JSONB NOT NULL,
  latency_ms INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fraud_decisions_tenant_created
  ON fraud_decisions (tenant_id, created_at DESC);
```

### Feedback table

```sql
CREATE TABLE fraud_feedback (
  feedback_id UUID PRIMARY KEY,
  event_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  label TEXT NOT NULL,            -- fraud, legitimate, chargeback, safe
  source TEXT NOT NULL,           -- analyst, chargeback_feed, customer_report
  confidence NUMERIC(5,4),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

These three tables give you:

- traceability
- replay inputs
- model training labels
- decision auditing

## Rules Engine

Fraud platforms should not be rules-only, but rules remain essential.

Why rules matter:

- immediate response to new attack patterns
- strong hard-stop protections
- deterministic explanations
- business overrides for specific merchants or flows

Examples:

- deny if IP is on explicit blocklist
- deny if device seen on >20 accounts in 10 minutes
- review if amount > threshold and account age < 1 day
- allow trusted VIP user below risk limit

Example rule model:

```json
{
  "ruleId": "new_account_high_value_review",
  "eventType": "payment_attempt",
  "priority": 200,
  "condition": {
    "all": [
      { "field": "account_age_hours", "op": "<", "value": 24 },
      { "field": "amount_minor", "op": ">", "value": 100000 }
    ]
  },
  "action": "REVIEW",
  "reasonCode": "NEW_ACCOUNT_HIGH_VALUE"
}
```

Simple rule languages are easier to operate than overly clever ones.

## Model Scoring

Rules are good for known patterns.

Models help with:

- weighted combination of many weak signals
- detecting non-obvious interactions
- adapting to evolving patterns

A typical scoring service:

```text
input features -> feature vector -> model -> fraud score between 0 and 1
```

Example Python-style scoring pseudocode:

```python
def score(features: dict) -> float:
    vector = [
        features["ip_txn_count_10m"],
        features["device_accounts_24h"],
        features["user_account_age_hours"],
        features["amount_zscore"],
        features["country_mismatch_flag"],
        features["successful_payments_30d"],
        features["chargeback_rate_90d"],
    ]
    return model.predict_proba([vector])[0][1]
```

The model is only as good as:

- feature quality
- label quality
- point-in-time correctness
- safe thresholds

## Feature Retrieval

The biggest operational risk in fraud systems is not often the model itself.

It is the feature path.

If feature retrieval is slow or inconsistent, the decision path breaks.

Typical feature sources:

- Redis for hot counters
- online feature store for materialized features
- relational DB for account profile
- external enrichment for IP reputation or BIN data

Good rule:

- external calls should be optional or precomputed
- the synchronous path should avoid long network chains

Example aggregation keys:

```text
ip:103.44.11.19:txn_count_10m
device:dev_88:distinct_accounts_24h
user:user_123:failed_payments_1d
card:cf_77:merchant_attempts_1h
```

## Real-Time Counters

Fraud systems rely heavily on short-window velocity checks.

Examples:

- 8 cards used on same device in 5 minutes
- 30 failed OTP attempts from same IP in 10 minutes
- 5 payout attempts from new bank accounts in 1 hour

These are usually tracked with Redis or streaming state stores.

Redis example:

```lua
-- increment counter with TTL
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
```

Usage:

```text
KEYS[1] = "ip:103.44.11.19:txn_count_600s"
ARGV[1] = 600
```

This gives you cheap velocity features for the scoring path.

## Decision Combiner

Do not let the model directly decide everything.

You usually want a combiner like:

1. hard rules first
2. model score second
3. business exceptions last

Example:

```java
public RiskDecision combine(RuleOutcome rules, ModelOutcome model, Policy policy) {
    if (rules.hardDeny()) {
        return RiskDecision.deny(rules.reasonCodes());
    }

    if (rules.forceAllow()) {
        return RiskDecision.allow(rules.reasonCodes());
    }

    double score = model.score();

    if (score >= policy.denyThreshold()) {
        return RiskDecision.deny(model.reasonCodes());
    }

    if (score >= policy.reviewThreshold()) {
        return RiskDecision.review(model.reasonCodes());
    }

    return RiskDecision.allow(model.reasonCodes());
}
```

This keeps business control explicit instead of buried in opaque model behavior.

## Latency Budget

For payments and login, the synchronous path must be tight.

Example budget:

```text
Request parsing              5 ms
Feature fetch               30 ms
Rules evaluation             5 ms
Model scoring               20 ms
Decision logging async       5 ms
Safety margin               15 ms
-------------------------------
Total                       80 ms
```

If your risk API depends on six downstream services, this budget will not survive real traffic.

## Degradation Strategy

What happens if some parts of the risk stack are unavailable?

Possible failures:

- Redis unavailable
- model service slow
- external enrichment down
- feature store lagging

Your policy should define fallback behavior by event type.

Examples:

- low-value signup: fail open or soft review
- card payout: fail closed or review
- password reset: maybe extra challenge instead of full denial

A fraud platform must be explicit about fail-open vs fail-closed by flow.

## Case Management

Review queues are part of the platform, not an afterthought.

Analysts need:

- event details
- feature snapshot at decision time
- decision reason codes
- linked user/device/IP history
- action tools: mark fraud, mark safe, escalate

Example case table:

```sql
CREATE TABLE fraud_cases (
  case_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL,          -- open, investigating, resolved
  queue TEXT NOT NULL,
  assignee TEXT,
  decision_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
```

Do not make analysts query five systems to understand one payment attempt.

## Feedback Loop

Fraud systems improve only if decisions are joined with outcomes later.

Examples of outcome sources:

- chargeback feed
- merchant dispute
- analyst label
- customer complaint
- manual allowlist decision

This data should feed:

- rule tuning
- threshold tuning
- model retraining
- precision / recall tracking

Without outcome joins, you are operating blind.

## Offline Training and Backtesting

Any serious fraud platform needs replay.

Questions risk teams will ask:

- what would have happened if deny threshold were 0.92 instead of 0.95?
- how many good users would have been reviewed?
- what chargeback loss would have been prevented?
- what if this new rule had been active last month?

That requires:

- stored input events
- stored feature snapshots or reproducible feature generation
- stored model and policy versions

Backtesting is how you improve without gambling on production.

## Multi-Tenant Design

If the platform serves many merchants or products:

- isolate data by tenant
- allow tenant-specific thresholds and rule overrides
- support tenant-specific feature configurations
- prevent one noisy tenant from overwhelming shared counters or review queues

Different businesses have different fraud tolerances.

A digital wallet, an airline, and a food-delivery platform should not share the exact same decision thresholds.

## Common Failure Modes

### 1. Feature leakage

Training data accidentally uses future information.

Result:

- offline metrics look amazing
- production performance is much worse

Fix:

- point-in-time correct feature generation

### 2. Duplicate event scoring

Same event is processed multiple times.

Result:

- duplicate review cases
- inflated counters

Fix:

- idempotency key and dedupe on event id

### 3. Model drift

Attack patterns evolve and model performance decays.

Fix:

- track approval rate, fraud rate, review rate, precision, recall proxies

### 4. Over-aggressive rules

A new rule blocks too many good users.

Fix:

- rule shadow mode
- staged rollout
- tenant-level blast radius control

### 5. Slow external enrichments

IP or device intelligence provider becomes slow.

Fix:

- precompute where possible
- timeout aggressively
- continue with degraded policy

## Observability

Metrics to track:

- decision latency p50 / p95 / p99
- allow / review / deny rate
- per-tenant approval rate
- model score distribution
- feature fetch timeout rate
- rule match counts
- review queue backlog
- confirmed fraud by segment
- chargeback rate over time

Important dashboards:

- decision distribution by tenant
- false-positive proxies after new rule rollout
- model score drift
- hot IP / device patterns

Fraud systems need both engineering monitoring and business monitoring.

## Example End-to-End Service

```java
@Service
public class FraudDecisionService {

    public RiskDecision evaluate(FraudRequest request) {
        FraudEvent event = rawEventStore.save(request);

        FeatureBundle features = featureService.load(event);
        RuleOutcome ruleOutcome = rulesEngine.evaluate(event, features);
        ModelOutcome modelOutcome = modelService.score(features);

        RiskDecision decision = decisionCombiner.combine(
            ruleOutcome,
            modelOutcome,
            policyService.policyFor(event.tenantId(), event.eventType())
        );

        decisionLogStore.save(event, features, ruleOutcome, modelOutcome, decision);

        if (decision.requiresReview()) {
            caseService.openCase(event, features, decision);
        }

        return decision;
    }
}
```

That is the conceptual core: event, features, rules, model, decision, logging, and case creation.

## What I Would Build First

Phase 1:

- real-time risk API
- deterministic rules engine
- hot counters in Redis
- decision log and analyst queue

Phase 2:

- model scoring service
- online feature store
- feedback ingestion
- shadow evaluation for new policies

Phase 3:

- automated retraining pipeline
- sophisticated device graph features
- merchant-specific policy customization
- replay and backtesting UI

This order matters. Teams often rush into fancy ML before they have high-quality event logs, counters, and analyst feedback.

## Production Checklist

- idempotent event ingestion
- low-latency feature path
- hard rules supported
- model version tracked
- decision reason codes stored
- analyst case tooling available
- feedback labels ingested
- shadow mode supported for rule/model rollout
- fail-open / fail-closed policy defined per event type
- replay and backtesting path exists

## Final Takeaway

A fraud detection platform is a real-time decision and learning system.

Its job is not to maximize model score accuracy in isolation.

Its job is to reduce fraud loss while protecting legitimate user experience, staying explainable, and remaining safe under constant change.

If you design it well, risk teams move fast without blind spots.

If you design it poorly, you get the worst of both worlds: fraud still gets through, and good users get blocked.

## Read Next

- [System Design: Building a Payment Reconciliation Engine](/blog/system-design-payment-reconciliation-engine/)
- [System Design: Building an Inventory Reservation System](/blog/system-design-inventory-reservation/)
- [Idempotency Keys in APIs: Retries, Duplicate Requests, and Exactly-Once Illusions](/blog/api-idempotency-keys/)
