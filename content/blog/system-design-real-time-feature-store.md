---
title: "System Design: Building a Feature Store for Real-Time Machine Learning"
description: "Design a practical feature store for production ML systems: offline and online features, point-in-time correctness, streaming updates, Redis/DynamoDB serving, monitoring, and training-serving skew."
date: "2026-04-07"
category: "AI/ML"
tags: ["feature store", "machine learning", "system design", "real-time ml", "data engineering", "ml infrastructure"]
featured: false
affiliateSection: "ai-ml-books"
---

Production machine learning systems fail when the model sees different data in training than it sees in production.

A feature store helps solve that problem. It provides a consistent way to define, compute, store, and serve features for both offline training and online inference.

Think of a feature as a model input:

```
user_7d_transaction_count
merchant_chargeback_rate_30d
device_seen_before
avg_order_value_90d
```

The feature store is the system that makes those values correct, fresh, discoverable, and reusable.

## Requirements

Functional requirements:

- define feature schemas
- compute batch features
- compute streaming features
- serve low-latency online features
- retrieve historical point-in-time features for training
- monitor freshness and quality

Non-functional requirements:

- low inference latency
- high write throughput
- point-in-time correctness
- backfill support
- schema evolution
- feature ownership
- access control

## Offline vs Online Store

A feature store usually has two storage layers:

```
Offline store: S3 / data lake / warehouse
Online store: Redis / DynamoDB / Cassandra
```

The offline store is used for training and backfills. It stores historical feature values at scale.

The online store is used during inference. It serves the latest feature values with low latency.

Example:

```
Training job:
  read user_7d_transaction_count as of 2025-07-01
  read merchant_chargeback_rate_30d as of 2025-07-01

Inference API:
  read latest user_7d_transaction_count for user u123
  read latest merchant_chargeback_rate_30d for merchant m456
```

## Point-in-Time Correctness

Point-in-time correctness prevents data leakage. When training a model for a transaction that happened at 10:00, you must not use a feature value computed at 10:05.

Feature table:

```sql
CREATE TABLE user_features (
  user_id VARCHAR NOT NULL,
  feature_name VARCHAR NOT NULL,
  feature_value DOUBLE PRECISION NOT NULL,
  event_time TIMESTAMP NOT NULL,
  computed_at TIMESTAMP NOT NULL,
  PRIMARY KEY (user_id, feature_name, event_time)
);
```

Training query:

```sql
SELECT t.transaction_id, f.feature_value
FROM transactions t
JOIN user_features f
  ON f.user_id = t.user_id
 AND f.feature_name = 'user_7d_transaction_count'
 AND f.event_time <= t.transaction_time
QUALIFY row_number() OVER (
  PARTITION BY t.transaction_id
  ORDER BY f.event_time DESC
) = 1;
```

The exact syntax differs by warehouse, but the rule is universal: select the latest feature value that existed at or before the training event time.

## Streaming Feature Updates

For real-time features, compute from events:

```
transaction-events -> Kafka Streams/Flink -> online feature store
```

Example Kafka Streams logic:

```java
builder.stream("transactions", Consumed.with(Serdes.String(), transactionSerde))
    .groupBy((key, txn) -> txn.userId())
    .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofDays(7)))
    .count()
    .toStream()
    .foreach((windowedUserId, count) -> {
        onlineStore.put(
            "user:" + windowedUserId.key(),
            "txn_count_7d",
            count,
            windowedUserId.window().endTime()
        );
    });
```

In production, use event time, not processing time, when correctness matters. Late events need a policy: ignore, correct, or recompute.

## Online Store Design

Redis key example:

```
features:user:u123
```

Value:

```json
{
  "txn_count_7d": 12,
  "avg_order_value_90d": 842.4,
  "last_seen_device_risk": 0.18,
  "updated_at": "2025-07-26T10:30:00Z"
}
```

Inference flow:

```java
Map<String, Object> userFeatures = onlineStore.get("features:user:" + userId);
Map<String, Object> merchantFeatures = onlineStore.get("features:merchant:" + merchantId);

ModelInput input = ModelInput.from(request, userFeatures, merchantFeatures);
Prediction prediction = modelClient.predict(input);
```

For high-scale serving, batch reads:

```java
List<String> keys = List.of(
    "features:user:" + userId,
    "features:merchant:" + merchantId,
    "features:device:" + deviceId
);

List<Map<String, Object>> featureGroups = redis.mget(keys);
```

## Training-Serving Skew

Training-serving skew happens when the feature value used in training differs from the value computed online.

Common causes:

- different code paths for batch and streaming computation
- timezone differences
- late events handled differently
- nulls filled differently
- feature definitions changed without retraining
- online store missing values

Mitigation:

- define features once in a registry
- use the same transformation logic where possible
- log online feature vectors
- compare online features against offline recomputation
- monitor missing feature rate

## Feature Registry

A registry documents ownership and semantics:

```yaml
name: user_7d_transaction_count
owner: fraud-platform
entity: user
type: integer
freshness_sla: 5 minutes
offline_source: warehouse.transactions
online_store: redis
description: Number of successful transactions by user in the last 7 days.
```

Without ownership, feature stores turn into feature junk drawers.

## Monitoring

Feature monitoring should include:

```
feature_freshness_seconds
feature_missing_rate
feature_default_value_rate
feature_distribution_drift
online_store_latency
online_store_error_rate
training_serving_skew_score
```

Alert on freshness per feature group. A fraud model using a 6-hour-old velocity feature may be worse than no model at all.

## Production Checklist

- Separate offline training store and online serving store
- Guarantee point-in-time correctness for training data
- Use event time for streaming features
- Define late-event handling
- Add a feature registry with owners
- Monitor freshness, missing rate, and drift
- Log online feature vectors for debugging
- Version feature definitions
- Backfill safely when definitions change
- Keep inference feature fetch latency within the model SLA

A feature store is not just an ML platform component. It is a data correctness system. If features are stale, inconsistent, or leaked from the future, even the best model will behave badly in production.
