---
title: "Feature Flags and Progressive Delivery: Safe Releases at Scale"
description: "Production feature flag implementation: flag evaluation architecture, percentage rollouts, user targeting, kill switches, flag lifecycle management, OpenFeature SDK, LaunchDarkly patterns, and how progressive delivery eliminates release fear."
date: "2025-05-19"
category: "System Design"
tags: ["feature flags", "progressive delivery", "deployment", "system design", "spring boot", "launchdarkly", "openfeature"]
featured: false
affiliateSection: "system-design-courses"
---

Feature flags — also called feature toggles or feature switches — decouple code deployment from feature release. You deploy code to production with the new feature disabled. When you're ready, you enable it for 1% of users, watch metrics, enable for 10%, verify, then 100%. If something goes wrong, you flip a switch and it's gone — no rollback deploy, no database migration, no 2am deployment.

At scale, feature flags become a core part of your deployment infrastructure. Companies like Facebook, LinkedIn, and Spotify deploy dozens of times per day, with every significant change behind a feature flag. This article covers the implementation patterns, not the philosophy.

## Flag Types and Use Cases

```
Release flags:
  → Hide incomplete features in production (trunk-based development)
  → "newCheckoutFlow": false in production, code exists but inaccessible

Kill switches:
  → Emergency disablement of a feature causing incidents
  → "paymentService": false → fallback to manual processing

Ops flags:
  → Control infrastructure behavior (circuit breakers, cache TTLs)
  → "enableRedisCaching": true/false

Experiment flags:
  → A/B testing: 50% users see variant A, 50% see variant B
  → "checkoutButtonColor": { "control": "blue", "treatment": "green" }

Permission flags:
  → Enable features for specific users (beta, premium, internal)
  → "advancedAnalytics": enabled for { tier: "enterprise" }
```

## Architecture: Evaluation and Storage

```
Flag evaluation architecture:

SDK (in application) → Local cache (in-memory)
                              ↑
                    Background polling/streaming
                              ↑
                    Flag service (LaunchDarkly / Flagsmith / internal)
                              ↑
                    Flag storage (database / config service)

Critical design constraint: Flag evaluation must be SYNCHRONOUS and LOCAL.
Calling a remote API for each flag evaluation adds latency to every request.
The SDK maintains a local in-memory copy of all flags, refreshed every 30s
or via streaming (Server-Sent Events). Evaluation is a local lookup — < 1ms.
```

## OpenFeature: Vendor-Neutral Flag SDK

[OpenFeature](https://openfeature.dev) is a CNCF standard for feature flag evaluation. Use it to avoid vendor lock-in:

```java
// Maven:
// openfeature-java-sdk + provider (LaunchDarkly, Flagsmith, etc.)

@Configuration
public class FeatureFlagConfig {

    @Bean
    public OpenFeatureAPI openFeatureAPI() {
        // Provider can be swapped without changing application code:
        FeatureProvider provider = new LaunchDarklyProvider(
            new LDConfig.Builder()
                .offline(false)
                .build(),
            new LDClient(System.getenv("LAUNCHDARKLY_SDK_KEY"))
        );

        OpenFeatureAPI api = OpenFeatureAPI.getInstance();
        api.setProvider(provider);
        return api;
    }

    @Bean
    public Client featureFlagClient(OpenFeatureAPI api) {
        return api.getClient("order-service");
    }
}

// Flag evaluation in services:
@Service
public class CheckoutService {

    @Autowired
    private Client featureFlags;

    public CheckoutResult checkout(CartRequest cart, User user) {
        // Create evaluation context from the user:
        EvaluationContext context = new ImmutableContext(user.getId(), Map.of(
            "email", Value.objectToValue(user.getEmail()),
            "tier", Value.objectToValue(user.getTier()),
            "region", Value.objectToValue(user.getRegion()),
            "betaUser", Value.objectToValue(user.isBetaOptIn())
        ));

        // Boolean flag evaluation (with default):
        boolean useNewCheckoutFlow = featureFlags.getBooleanValue(
            "new-checkout-flow",
            false,  // Default: old flow (fail-safe)
            context
        );

        if (useNewCheckoutFlow) {
            return newCheckoutService.process(cart);
        } else {
            return legacyCheckoutService.process(cart);
        }
    }

    // Multivariate flag (A/B/C testing):
    public String getRecommendationAlgorithm(User user) {
        EvaluationContext ctx = buildContext(user);
        return featureFlags.getStringValue(
            "recommendation-algorithm",
            "collaborative-filtering",  // Default
            ctx
        );
        // Returns: "collaborative-filtering", "content-based", or "hybrid"
        // based on targeting rules configured in the flag service
    }
}
```

## Percentage Rollouts

```
Percentage rollout implementation:

User ID: "user-12345"
Flag name: "new-checkout-flow"
Target percentage: 10%

Hash: SHA256("user-12345" + "new-checkout-flow")
    = a1b2c3d4e5... (deterministic)

Bucket: parseInt(hash[0:4], 16) % 10000 = 6521

6521 / 10000 = 65.21% → User is NOT in 10% rollout (65% > 10%)

Properties:
- Same user always gets same result (consistent experience)
- Increasing percentage from 10% → 20% adds new users, keeps existing 10% in
- No server-side state needed — pure function of userId + flagName + percentage
```

```java
// Simple percentage rollout without external flag service:
@Component
public class FeatureFlagEvaluator {

    public boolean isEnabled(String flagName, String userId, int targetPercent) {
        String input = userId + ":" + flagName;
        int hash = Math.abs(MurmurHash3.hash32(input.getBytes())) % 10000;
        return hash < targetPercent * 100;
    }
}

// Usage:
boolean showNewUI = flagEvaluator.isEnabled("new-ui", user.getId(), 15);
// 15% of users deterministically get the new UI
```

## Flag Lifecycle: Avoiding "Flag Debt"

Feature flags accumulate. A codebase with 200 flags — half of which are fully rolled out and forgotten — becomes unmaintainable. Each flag adds a branch in your code; 200 flags means thousands of untested combinations.

```
Flag lifecycle stages:
1. Created     → default false, no targeting
2. Testing     → enabled for QA/internal users only
3. Canary      → 1-5% production users
4. Rollout     → gradual increase: 10% → 25% → 50% → 100%
5. Cleanup     → flag removed from code, flag config deleted
```

**When a flag reaches 100% rollout (or 0% = permanently disabled), it must be cleaned up.** This means:
1. Delete the flag from the flag service
2. Remove the flag evaluation from code
3. Delete the unused code path

```java
// Code BEFORE cleanup (flag at 100%):
if (featureFlags.getBooleanValue("new-checkout-flow", false, context)) {
    return newCheckoutService.process(cart);
} else {
    return legacyCheckoutService.process(cart);  // Dead code
}

// Code AFTER cleanup:
return newCheckoutService.process(cart);  // Permanent — no flag check
```

Track flag cleanup as a first-class engineering task. Some teams use automatic expiry dates — flags that aren't cleaned up by their expiry date trigger alerts.

## Kill Switches: Emergency Degradation

Kill switches are flags designed for emergency use — they should be evaluated extremely quickly and fail safe:

```java
@Service
public class PaymentService {

    @Autowired
    private Client featureFlags;

    @Autowired
    private ManualPaymentService manualPaymentService;

    public PaymentResult processPayment(PaymentRequest request) {
        // Kill switch: if payment service is having issues, use manual fallback
        boolean paymentServiceEnabled = featureFlags.getBooleanValue(
            "payment-service-enabled",
            true,   // Default TRUE — service is enabled by default
            EvaluationContext.EMPTY  // No user context needed for kill switches
        );

        if (!paymentServiceEnabled) {
            log.warn("Payment service kill switch active — using manual fallback");
            return manualPaymentService.queue(request);
        }

        return stripeService.charge(request);
    }
}
```

Kill switch defaults must be **safe state** (what behavior is acceptable during an incident):
- `payment-service-enabled`: default `true` (payments work normally)
- `new-search-algorithm`: default `false` (new algorithm is disabled by default)

If the flag service itself is unavailable (network partition, outage), the SDK uses cached values. If no cache exists, it uses the SDK default. Design your defaults for the worst case.

## Metrics and Flag Evaluation Tracking

```java
// Track flag evaluations for analysis:
@Aspect
@Component
public class FeatureFlagMetricsAspect {

    @Autowired
    private MeterRegistry meterRegistry;

    @Around("@annotation(featureFlagCheck)")
    public Object trackFlagEvaluation(ProceedingJoinPoint joinPoint,
                                       FeatureFlagCheck featureFlagCheck) throws Throwable {
        String flagName = featureFlagCheck.flag();
        Object result = joinPoint.proceed();

        meterRegistry.counter("feature_flag.evaluation",
            "flag", flagName,
            "value", result.toString()
        ).increment();

        return result;
    }
}

// Use in OpenFeature hooks:
public class MetricsHook implements Hook {
    @Override
    public void after(HookContext ctx, FlagEvaluationDetails details, Map<String, Object> hints) {
        // Record every flag evaluation with its result and variant
        metrics.record("feature_flag.evaluation", 1,
            "flag", details.getFlagKey(),
            "value", details.getValue().toString(),
            "reason", details.getReason()
        );
    }
}
```

Track flag evaluations in Grafana/Datadog, correlated with:
- Error rate (did enabling this flag increase errors?)
- Latency (did the new code path change P99?)
- Business metrics (did the A/B test variant convert better?)

This telemetry turns flag evaluation into a decision-making tool, not just a deployment switch.

## Self-Hosted vs. Managed Flag Service

| Factor | Self-Hosted (Flagsmith, Unleash) | Managed (LaunchDarkly, Split.io) |
|--------|----------------------------------|----------------------------------|
| Cost | Infrastructure only ($0-$200/mo) | $0-$50k/year depending on tier |
| Setup | Moderate (deploy + maintain) | None (SaaS) |
| Data privacy | All data stays in your infra | Data sent to vendor |
| Reliability | Your responsibility | Vendor SLA (99.99%+) |
| Features | Core + open source ecosystem | Full-featured (A/B stats, etc.) |

Self-host Flagsmith or Unleash if: data residency requirements, budget constraints, or < 50 flags. Use LaunchDarkly if: large A/B testing programs, many flags, and the engineering time cost of maintaining self-hosted outweighs the subscription cost.

Feature flags are an investment in deployment safety. The teams that implement them stop having "all hands on deck" deployment nights. When something goes wrong, they turn a flag off instead of rolling back a deployment. The operational maturity that comes with progressive delivery — canary deployments, A/B testing, kill switches — is only possible when code changes can be separated from feature releases.
