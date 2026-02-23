---
title: "SQS vs Kafka vs EventBridge: Choosing the Right Messaging System on AWS"
description: "A senior engineer's guide to selecting between Amazon SQS, Apache Kafka on AWS, and EventBridge. Throughput benchmarks, cost breakdowns, ordering guarantees, and real production trade-offs."
date: "2025-04-02"
category: "Messaging"
tags: ["aws", "sqs", "kafka", "eventbridge", "distributed systems", "messaging", "msk"]
featured: false
affiliateSection: "aws-resources"
---

Every AWS backend team eventually faces the same decision: you need asynchronous messaging. SQS is right there in the console. Your architect says you need Kafka. Someone from DevOps mentions EventBridge. Each option has a vocal fan base, and they are all wrong about different things.

This article cuts through the advocacy and gives you a decision framework based on throughput characteristics, cost at scale, operational burden, and failure behavior — the things that actually matter in production.

## The Three Systems in One Paragraph Each

**Amazon SQS** is a fully managed queue service. Producers enqueue messages, consumers poll and delete them. Standard queues offer at-least-once delivery with best-effort ordering. FIFO queues offer exactly-once delivery with strict ordering within a message group, capped at 300 messages/second per queue (3000 with batching). SQS has no concept of replay — a deleted message is gone.

**Apache Kafka on AWS (Amazon MSK)** is a distributed log. Messages are appended to ordered, immutable partitions and retained for a configurable period (default 7 days). Any consumer can read from any offset at any time. Kafka decouples producer throughput from consumer lag — a slow consumer doesn't backpressure the producer. MSK Serverless removes cluster management at the cost of throughput limits and higher per-unit cost.

**Amazon EventBridge** is a serverless event bus. Producers publish events; EventBridge routes them to targets (Lambda, SQS, Kinesis, HTTP endpoints) based on content-based rules. It is optimized for event-driven architectures where routing logic is complex and throughput is modest. Maximum throughput is 10,000 events/second per bus, with no replay (unless you enable the event archive, which adds cost and latency).

## Throughput Comparison

```
System              | Sustained Throughput         | Burst Behavior
--------------------|------------------------------|---------------------------
SQS Standard        | Unlimited (AWS-managed)      | Auto-scales, no config
SQS FIFO            | 300 msg/s (3000 w/ batching) | Hard limit per queue
EventBridge         | 10,000 events/s per bus      | Soft limit, raiseable
MSK (Kafka)         | 1 GB/s+ per broker           | Add brokers/partitions
MSK Serverless      | 200 MB/s ingress             | Automatically scales
```

SQS Standard is genuinely unlimited — AWS manages the infrastructure horizontally. In practice, the bottleneck becomes your consumer fleet, not SQS itself.

Kafka throughput is bounded by broker count × partition count × disk I/O. A 3-broker MSK cluster with `r5.2xlarge` instances can sustain 500–800 MB/s. Add 3 more brokers and you scale linearly. This is the key advantage: Kafka throughput is predictable and tunable.

EventBridge's 10K events/s feels generous until you're doing analytics ingestion or log streaming — at which point it's a hard architectural wall.

## Ordering Guarantees

This is where teams make expensive mistakes.

**SQS Standard** provides best-effort ordering. Across distributed consumers, messages can arrive out of order. For fire-and-forget notifications or task queues where order is irrelevant, this is fine.

**SQS FIFO** guarantees order within a `MessageGroupId`. If you use a single group ID, you get FIFO across the entire queue — but throughput drops to 300 msg/s. The practical pattern is to partition by entity ID: use `customerId` as the group ID to get ordered processing per customer while maintaining parallelism across customers.

**Kafka** partitions are strictly ordered. Within a partition, consumers see messages in write order, guaranteed. Across partitions, there is no global ordering — this is a fundamental property of the distributed log. Design around it: put messages that must be ordered relative to each other in the same partition using the same partition key.

**EventBridge** provides no ordering guarantees. It is designed for event routing, not ordered processing.

## Cost Breakdown at Scale

Let's be concrete. Assume 100 million messages/day at 1 KB average size.

**SQS Standard:**
- 100M requests/day × $0.40 per million = **$40/day = $1,200/month**
- Add data transfer costs if consumers are outside the same region
- No infrastructure to manage

**SQS FIFO:**
- Same request pricing + $0.05 per 10K deduplication checks
- At 100M messages: $40 + $500 dedup = **~$1,500/month**

**EventBridge:**
- $1.00 per million custom events = **$100/day = $3,000/month**
- Plus $0.10 per GB for event archive if replay is needed
- Expensive at volume — EventBridge is not designed for high-throughput streaming

**MSK (Amazon Managed Kafka):**
- 3× `kafka.m5.large` brokers: ~$0.21/hr each = **$450/month** cluster cost
- EBS storage: 100M × 1KB × 7-day retention = 700 GB × $0.10/GB = **$70/month**
- MSK data transfer + data out costs
- Total: **~$600–900/month** for this workload, but flat-rate regardless of message volume
- Operational cost: cluster monitoring, lag alerting, schema registry, Kafka client config

The crossover point is typically around 50–100 million messages/day where MSK becomes cheaper than SQS, assuming you have the engineering capacity to operate it.

**MSK Serverless:**
- $0.75/VCU-hour + $0.10/GB-hour storage — often 2–3× the cost of provisioned MSK at sustained throughput, but zero operational overhead.

## Multi-Region Support

**SQS:** Single-region by default. For multi-region, you replicate at the application layer — consumer reads from us-east-1 queue, writes to eu-west-1 queue. No native cross-region replication.

**EventBridge:** Global buses support cross-account event routing. EventBridge Event Bus can forward events to buses in other regions via rules. This is the simplest cross-region event routing available in AWS, and it's first-class.

**Kafka/MSK:** MSK Replication (MirrorMaker 2) replicates topics across clusters in different regions with configurable lag. Active-active multi-region Kafka is operationally complex — topic offsets diverge and merging is non-trivial. Most teams do active-passive: one region produces, MirrorMaker2 replicates to the DR region, consumers fail over to the replica cluster manually.

```
Multi-Region Kafka Architecture (Active-Passive):

us-east-1                          eu-west-1
┌─────────────────┐               ┌─────────────────┐
│  MSK Cluster A  │──MirrorMaker──│  MSK Cluster B  │
│  (Primary)      │               │  (Replica)       │
│                 │               │                  │
│  Producers ──►  │               │  ◄── Failover    │
│  Consumers ──►  │               │      Consumers   │
└─────────────────┘               └─────────────────┘
```

## Retry Behavior and Dead Letter Queues

**SQS:** Messages have a configurable `VisibilityTimeout`. When a consumer reads a message, it becomes invisible to other consumers. If the consumer doesn't delete it before the timeout, it becomes visible again and another consumer picks it up. After `maxReceiveCount` failures, SQS moves the message to a Dead Letter Queue (DLQ). This is fully managed and requires zero code.

```
SQS Retry Flow:
Message → Consumer → (processing fails) → Visibility timeout expires
→ Message re-visible → Re-consumed → ... → maxReceiveCount reached
→ Message moved to DLQ
```

**EventBridge:** Failed deliveries are retried with exponential backoff for up to 24 hours. If all retries fail, the event is sent to a DLQ (SQS) or dropped. The retry window is configurable but you have limited visibility into retry state.

**Kafka:** Kafka has no built-in retry concept at the broker level. Retry is the consumer's responsibility. The production pattern is retry topics:

```
Retry Topic Pattern:
orders-topic → Consumer (fails) → orders-retry-1 (wait 30s)
→ Consumer (fails) → orders-retry-2 (wait 5min)
→ Consumer (fails) → orders-retry-3 (wait 30min)
→ Consumer (fails) → orders-dlq
```

This requires explicit implementation but gives you complete control over retry semantics, delay scheduling, and DLQ routing.

## Scaling Strategy

**SQS:** Consumer scaling is driven by queue depth. AWS SQS → CloudWatch → Auto Scaling Group scales consumer EC2 instances or Lambda concurrency based on `ApproximateNumberOfMessagesVisible`. This is mature and well-understood.

**EventBridge:** Targets scale automatically (Lambda, Fargate). You don't manage consumers. This is the point — EventBridge handles fan-out and routing so you don't have to.

**Kafka:** Consumer scaling is partition-bound. You cannot have more active consumers in a consumer group than partitions in a topic. Plan partition count at topic creation: `partitions = max_expected_consumers × headroom_factor`. Kafka's `kafka.admin.client` lets you expand partition count after creation, but redistributing partitions causes a brief rebalance. Pre-partition aggressively.

## Operational Overhead

This is where honest conversations get uncomfortable.

| Task | SQS | EventBridge | MSK |
|------|-----|-------------|-----|
| Cluster provisioning | None | None | Broker sizing, AZ config |
| Schema management | None | JSON schema registry (optional) | Confluent Schema Registry or Glue |
| Monitoring | Basic CloudWatch | Basic CloudWatch | Custom dashboards, consumer lag |
| Security | IAM, VPC | IAM, resource policies | mTLS, SASL, ACLs |
| Upgrade management | Automatic | Automatic | MSK broker version upgrades |
| Consumer lag tracking | Queue depth metrics | None | Kafka consumer group offsets |

MSK is the Kafka product of choice on AWS, but "managed" is relative. You still provision brokers, choose instance types, manage broker storage, configure retention, set up Schema Registry, build consumer lag dashboards, and handle rebalance storms.

MSK Serverless offloads most of this at a cost premium. For teams without dedicated platform engineering, MSK Serverless or Confluent Cloud are worth the price.

## Latency Characteristics

**SQS** short-polling returns immediately (empty or not). Long-polling waits up to 20 seconds, which reduces empty receives and cost. End-to-end latency (produce → consume) is typically 50–200ms under normal load, with occasional spikes to seconds under high retry load.

**EventBridge** typically delivers in under 500ms. For Lambda targets, add cold start time. Not appropriate for sub-100ms requirements.

**Kafka** end-to-end latency depends on producer acknowledgment settings:
- `acks=0`: fire and forget, ~5ms produce latency, data loss risk
- `acks=1`: leader acknowledges, ~10–20ms
- `acks=all`: all ISR replicas acknowledge, 20–50ms typically

Consumer-side, with `fetch.min.bytes=1` and `fetch.max.wait.ms=500` defaults, a new message is consumed within 1–500ms after it's committed. For low-latency streaming (< 100ms end-to-end), tune `fetch.max.wait.ms=0`.

## When Kafka is Overkill

Use SQS when:
- You need a simple task queue with retry and DLQ
- Throughput is under 10K messages/second
- You don't need message replay
- Your team has no Kafka operational experience
- You're a startup without a platform team

Kafka's power comes from replayability, strict ordering, and high throughput. If your use case doesn't need these properties, you're paying operational overhead for nothing.

## When SQS Fails at Scale

SQS FIFO breaks at ordering + throughput intersection. At 300 msg/s per queue (3,000 with batching), you hit the hard limit. The workaround is sharding: deploy 10 FIFO queues, partition by entity ID, route producers accordingly. This works, but you've now built a partition routing layer — which is exactly what Kafka does natively.

SQS Standard's lack of replay means you cannot re-process a stream of events. If your downstream system has a bug that corrupts two hours of data, you cannot replay from two hours ago. You need a separate audit log — at which point, you should have just used Kafka.

## Real Production Case Study

At a fintech company processing 5 million payment events per day, the team started with SQS FIFO for per-customer ordered processing. After 18 months:

- FIFO throughput limit triggered scaling issues during month-end batch processing
- Zero replay capability meant a buggy consumer silently dropped 30,000 events before detection — requiring a full re-run from an S3 audit backup
- Adding a new downstream consumer required modifying the producer to enqueue to a second queue

Migration to MSK:
- Topic: `payment-events` with 48 partitions (keyed by `customerId`)
- Consumer groups per downstream system — each independently maintains its offset
- 7-day retention enabled replay of any incident window
- MirrorMaker2 replicates to a DR region

Operational cost increased by $800/month. Engineering productivity increased significantly — onboarding new consumers went from code changes to a new consumer group.

## Decision Framework

```
START
│
├── Do you need message replay?
│   └── YES → Kafka (MSK)
│
├── Do you need cross-service event routing with content-based rules?
│   └── YES → EventBridge
│
├── Do you need strict ordering + throughput > 3000 msg/s?
│   └── YES → Kafka (MSK)
│
├── Do you have a platform team to operate Kafka?
│   └── NO + need Kafka features → MSK Serverless or Confluent Cloud
│
└── Simple task queue, retry + DLQ, < 3000 ordered msg/s?
    └── YES → SQS (FIFO if ordering matters, Standard otherwise)
```

The default should be SQS. Introduce Kafka when you hit the specific limitations that Kafka solves. EventBridge shines in event-driven microservice architectures where routing logic is the primary challenge.
