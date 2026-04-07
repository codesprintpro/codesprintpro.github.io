---
title: "Kafka Consumer Lag: Causes, Diagnosis, and Production Fixes"
description: "A practical Kafka consumer lag playbook covering partition skew, slow processing, rebalances, max.poll settings, poison messages, autoscaling, metrics, and safe recovery strategies."
date: "2026-04-07"
category: "Messaging"
tags: ["kafka", "consumer lag", "messaging", "streaming", "distributed systems", "production debugging"]
featured: false
affiliateSection: "distributed-systems-books"
---

Kafka consumer lag is not a root cause. It is a symptom.

Lag means consumers are not keeping up with producers for one or more partitions. The fix depends on why: slow processing, too few consumers, partition skew, rebalances, downstream failures, poison messages, or broker problems.

The dangerous move is blindly adding consumers. That works only when there are enough partitions and the bottleneck is consumer parallelism.

## What Lag Actually Means

For a consumer group:

```
lag = latest_offset - committed_offset
```

If topic partition `orders-3` has latest offset 10,000 and the consumer group committed offset 9,200, lag is 800 for that partition.

Check lag:

```bash
kafka-consumer-groups.sh \
  --bootstrap-server broker:9092 \
  --describe \
  --group payment-consumer
```

Look at lag per partition, not only total lag.

## First Diagnosis

Ask:

1. Is lag on all partitions or only a few?
2. Did producer traffic increase?
3. Did consumer processing time increase?
4. Are consumers rebalancing repeatedly?
5. Is a downstream dependency slow?
6. Are poison messages causing repeated failures?
7. Are there enough partitions for the desired parallelism?

Partition-level lag tells you the shape of the problem.

```
All partitions lagging evenly -> consumers are globally too slow
One partition lagging heavily -> hot key or poison message
Lag sawtooth pattern -> rebalances or batch commits
Lag grows during dependency outage -> downstream bottleneck
```

## Slow Processing

If each message takes longer, lag grows even with the same traffic.

Instrument processing duration:

```java
@KafkaListener(topics = "orders")
public void consume(OrderEvent event, Acknowledgment ack) {
    Timer.Sample sample = Timer.start(meterRegistry);
    try {
        orderProcessor.process(event);
        ack.acknowledge();
    } finally {
        sample.stop(meterRegistry.timer("kafka.message.processing.duration"));
    }
}
```

Watch:

```
kafka.message.processing.duration p95
consumer.records.consumed.rate
consumer.records.lag.max
downstream.http.latency
db.query.duration
```

If processing time rose after a deploy, inspect code. If it rose with downstream latency, protect the consumer with timeouts, circuit breakers, or pause consumption.

## Too Few Partitions

Kafka consumer parallelism is capped by partitions.

```
Topic partitions: 6
Consumer instances: 10
Active consumers: 6
Idle consumers: 4
```

Adding more consumers than partitions does not increase parallelism. If lag is evenly distributed and each partition is busy, you may need more partitions.

But increasing partitions changes key distribution. For ordered workflows, understand the impact before changing partition count.

## Hot Partitions

If one partition has most of the lag, the producer key may be skewed.

Example bad key:

```java
producer.send(new ProducerRecord<>("orders", merchantId, event));
```

If one merchant is huge, one partition becomes hot. Better key choice depends on ordering requirements. If strict per-merchant order is not required, shard the key:

```java
String key = merchantId + ":" + (event.orderId().hashCode() % 16);
```

This spreads one large merchant across multiple partitions, but sacrifices total ordering for that merchant. That is a business decision, not only an engineering choice.

## Rebalance Storms

Frequent rebalances stop consumption and increase lag.

Common causes:

- processing takes longer than `max.poll.interval.ms`
- consumers crash and restart
- autoscaler rapidly changes replica count
- network instability
- too many partitions assigned per consumer

Key settings:

```properties
max.poll.records=100
max.poll.interval.ms=300000
session.timeout.ms=45000
heartbeat.interval.ms=15000
```

If processing a batch can take 10 minutes, but `max.poll.interval.ms` is 5 minutes, Kafka considers the consumer dead. Reduce batch size or increase the interval.

## Poison Messages

A poison message fails every time and can block progress if the consumer keeps retrying it.

Use a dead-letter topic after bounded retries:

```java
try {
    process(event);
    ack.acknowledge();
} catch (RetryableException ex) {
    throw ex; // let retry policy handle it
} catch (Exception ex) {
    deadLetterPublisher.publish(event, ex);
    ack.acknowledge(); // skip after preserving the failed message
}
```

The DLQ event should include:

```json
{
  "originalTopic": "orders",
  "partition": 3,
  "offset": 91234,
  "error": "Invalid currency code",
  "payload": { }
}
```

Never silently skip messages. Preserve them for replay.

## Autoscaling Consumers

Autoscaling on CPU is often wrong. Scale on lag and processing rate:

```
desired_consumers = lag / target_lag_per_consumer
```

But cap by partition count:

```
desired_consumers = min(topic_partitions, computed_consumers)
```

Avoid aggressive scale-in. Removing consumers causes rebalances, which can make lag worse.

## Safe Recovery

When lag is huge:

1. Stop the bleeding: fix producer spike or downstream outage
2. Increase consumers up to partition count
3. Reduce per-message processing time
4. Temporarily disable non-critical work in the consumer
5. Consider replaying to a separate catch-up consumer group
6. Do not reset offsets unless you deliberately want to skip data

Offset reset is a serious operation:

```bash
kafka-consumer-groups.sh \
  --bootstrap-server broker:9092 \
  --group payment-consumer \
  --topic orders \
  --reset-offsets \
  --to-latest \
  --execute
```

This skips unprocessed messages. Use only when the business accepts data loss or the data can be rebuilt elsewhere.

## Production Checklist

- Monitor lag per partition, not only total lag
- Track processing duration
- Alert on rebalance rate
- Use bounded retries and DLQ
- Choose producer keys deliberately
- Scale consumers only up to partition count
- Tune `max.poll.records` and `max.poll.interval.ms` together
- Protect downstream dependencies with timeouts
- Avoid offset reset as a first response
- Document replay procedures

Consumer lag is a symptom with many possible causes. The best Kafka teams do not just add consumers. They read the lag shape, identify the bottleneck, and choose a fix that preserves correctness.
