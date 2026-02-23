---
title: "Kafka Exactly-Once Semantics: Myth vs Production Reality"
description: "What Kafka's exactly-once guarantee actually covers, where duplicates still happen in practice, and how to design genuinely idempotent consumers with Spring Kafka. Real production mistakes and their fixes."
date: "2025-04-20"
category: "Messaging"
tags: ["kafka", "exactly-once", "spring kafka", "distributed systems", "transactions", "java"]
featured: false
affiliateSection: "distributed-systems-books"
---

Kafka 0.11 introduced exactly-once semantics (EOS), and every architecture diagram since then has confidently placed a checkbox next to "exactly once delivery." In practice, most teams deploying Kafka with EOS still see duplicates in production. The issue is that Kafka's exactly-once guarantee is real and precise — but it covers a narrower scope than most engineers assume.

This article explains exactly what the guarantee covers, where it breaks, and what you must implement yourself to actually achieve idempotent processing at the system level.

## What Exactly-Once Really Means

Kafka's exactly-once guarantee applies specifically to the **read-process-write** loop within the Kafka ecosystem:

```
Exactly-once scope:
┌─────────────────────────────────────────────────────┐
│                                                     │
│  Consumer reads from Topic A                        │
│       │                                             │
│       ▼                                             │
│  Processes message (transforms, aggregates)         │
│       │                                             │
│       ▼                                             │
│  Writes result to Topic B + commits offset atomically│
│                                                     │
│  ← Kafka guarantees this is atomic and exactly once │
└─────────────────────────────────────────────────────┘

NOT covered:
- Writing to an external database
- Calling an external API
- Any side effect outside Kafka's transaction coordinator
```

If your processing loop writes to PostgreSQL, sends an email, or calls a payment gateway, Kafka's EOS guarantee does not extend to those operations. You must implement idempotency for those side effects yourself.

## Producer Idempotence

Producer idempotence (`enable.idempotence=true`) prevents duplicate messages caused by producer retries. Without it:

```
Producer → Broker: publish(msg1) [network timeout]
Producer → Broker: retry publish(msg1)  ← duplicate!
Broker commits both copies
```

With idempotence enabled, each producer instance gets a `ProducerID (PID)` and each message gets a monotonically increasing sequence number. The broker tracks `(PID, partition, sequence_number)` tuples and deduplicates retries:

```java
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "kafka:9092");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
// Implied by idempotence=true:
// acks=all, max.in.flight.requests.per.connection=5, retries=MAX_INT
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, 5);

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
```

**Important:** Idempotence is per-session. If the producer restarts, it gets a new PID. Messages inflight during the restart can be duplicated — there is no deduplication across producer instances.

## Transactional Producers

Transactions extend idempotence to atomic multi-partition writes and atomic offset commits:

```java
@Bean
public ProducerFactory<String, PaymentEvent> producerFactory() {
    Map<String, Object> config = new HashMap<>();
    config.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "kafka:9092");
    config.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
    config.put(ProducerConfig.TRANSACTIONAL_ID_CONFIG, "payment-processor-1");
    // transactional.id must be unique per producer instance
    // Use: service-name + partition-id for stable identity
    return new DefaultKafkaProducerFactory<>(config);
}

// Transactional send:
@Transactional
public void processAndForward(ConsumerRecord<String, PaymentEvent> record) {
    PaymentEvent event = record.value();
    PaymentResult result = paymentService.process(event);

    kafkaTemplate.executeInTransaction(ops -> {
        ops.send("payments-processed", event.getUserId(), result);
        ops.send("audit-log", event.getPaymentId(), AuditEntry.from(result));
        return true;
    });
    // Offset commit and both sends are atomic
    // Either all succeed or none are visible to consumers
}
```

The `transactional.id` must be stable across producer restarts. Kafka uses it to recover the previous producer's pending transactions. If you use random IDs, pending transactions from dead producers never resolve.

## Consumer Offset Management

Consumer offsets in Kafka are stored in an internal topic (`__consumer_offsets`). The offset represents the next message to consume, not the last processed message. The danger:

```
Consumer reads message at offset 100
Consumer processes message (writes to DB)
Consumer commits offset 101
Consumer crashes before commit → next read starts at 100 → DUPLICATE PROCESSING
Consumer crashes after commit → offset is 101, message was processed → OK
```

The window between processing and offset commit is the duplicate risk window. Making it smaller reduces exposure but never eliminates it.

With Spring Kafka's `@KafkaListener`:

```java
@KafkaListener(topics = "payments", groupId = "payment-processor")
public void processPayment(ConsumerRecord<String, PaymentEvent> record,
                           Acknowledgment ack) {
    try {
        paymentService.process(record.value());
        ack.acknowledge();  // Commit offset after successful processing
    } catch (RetryableException e) {
        // Don't ack — message will be redelivered
        throw e;
    } catch (NonRetryableException e) {
        ack.acknowledge();  // Commit offset, send to DLQ
        dlqProducer.send("payments-dlq", record);
    }
}
```

Use `AckMode.MANUAL_IMMEDIATE` for fine-grained control over when offsets are committed.

## Failure Cases Where Duplicates Still Happen

### Case 1: Consumer Group Rebalance

During a rebalance, partitions are reassigned. A consumer processing a message when the rebalance triggers may lose its partition assignment:

```
Timeline:
T=0: Consumer A holds Partition 7, processes message offset 500
T=1: New consumer joins group → rebalance triggered
T=2: Partition 7 reassigned to Consumer B
T=3: Consumer A's processing completes, tries to commit offset 501
T=4: Commit fails (partition not owned by Consumer A)
T=5: Consumer B starts reading from last committed offset: 500
T=6: Duplicate processing of message 500
```

**Fix:** Use `CooperativeStickyAssignor` to minimize partition movement during rebalances:

```java
props.put(ConsumerConfig.PARTITION_ASSIGNMENT_STRATEGY_CONFIG,
    CooperativeStickyAssignor.class.getName());
```

And implement idempotent consumers (covered below) so duplicates are harmless.

### Case 2: ISR and Replication Factor Implications

With `acks=all` and `min.insync.replicas=2`, a message is only acknowledged when it's on at least 2 replicas. If the leader fails after acknowledging but before replicas sync, the message is lost — but the producer got an `ACK`. With retries, the producer resends, creating a different kind of inconsistency.

```
Replication factor: 3, min.insync.replicas: 2

Producer → Broker Leader (ISR: Leader, Replica1, Replica2)
Leader writes → Replica1 writes → ACK sent to producer ✓
Replica2 hasn't written yet → Leader fails
New leader elected: Replica1 has the message
Replica2 becomes leader after Replica1 also fails
Replica2 doesn't have the message → Message lost
Producer retries → Duplicate (if message was durably committed elsewhere)
```

Set `min.insync.replicas=2` with `replication.factor=3` for the right balance of durability vs availability. Never set `min.insync.replicas = replication.factor` — one broker failure makes the topic completely unavailable.

### Case 3: Long Processing + Session Timeout

If message processing takes longer than `max.poll.interval.ms` (default 5 minutes), Kafka considers the consumer dead and triggers a rebalance:

```java
// This is dangerous if processPayment() can take > 5 minutes:
@KafkaListener(topics = "payments")
public void processPayment(PaymentEvent event) {
    processPayment(event); // Could take 10 minutes for complex reconciliation
}

// Fix: Increase max.poll.interval.ms to cover realistic processing time
props.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, 600000); // 10 minutes
// Or: Move long processing to async and ack quickly
```

## Designing Idempotent Consumers

Since duplicates are unavoidable at the system level, the correct approach is idempotent consumers: processing a message twice produces the same result as processing it once.

**Pattern: Idempotency key in the message + deduplication table**

```java
// Message contains an idempotency key
public record PaymentEvent(
    String paymentId,         // Idempotency key
    String userId,
    BigDecimal amount,
    String currency
) {}

// Deduplication table in PostgreSQL
CREATE TABLE processed_payments (
    payment_id      VARCHAR(255) PRIMARY KEY,
    processed_at    TIMESTAMPTZ DEFAULT NOW(),
    result          JSONB
);

// Consumer checks before processing:
@Service
public class IdempotentPaymentConsumer {

    @Transactional
    public void processPayment(PaymentEvent event) {
        // Attempt insert — fails silently on duplicate
        int inserted = jdbcTemplate.update(
            "INSERT INTO processed_payments (payment_id) VALUES (?) ON CONFLICT DO NOTHING",
            event.paymentId()
        );

        if (inserted == 0) {
            log.info("Duplicate payment event, skipping: {}", event.paymentId());
            return;  // Already processed
        }

        // Process only if not already done
        PaymentResult result = paymentGateway.charge(event);
        jdbcTemplate.update(
            "UPDATE processed_payments SET result = ?::jsonb WHERE payment_id = ?",
            objectMapper.writeValueAsString(result), event.paymentId()
        );
    }
}
```

The `ON CONFLICT DO NOTHING` insert is atomic — concurrent duplicates resolve correctly without application-level locking.

## Retry Topics and DLQ Strategy

```
Retry topic architecture:

payments (main topic)
    │
    ▼
Consumer Group: payment-processor
    │
    ├── Success → payments-processed
    │
    ├── Retryable failure
    │       └── payments-retry-1 (delay: 30s via consumer pause)
    │               └── payments-retry-2 (delay: 5min)
    │                       └── payments-retry-3 (delay: 30min)
    │                               └── payments-dlq
    │
    └── Non-retryable failure → payments-dlq (immediately)
```

Spring Kafka's `@RetryableTopic`:

```java
@RetryableTopic(
    attempts = "4",
    backoff = @Backoff(delay = 30000, multiplier = 5, maxDelay = 1800000),
    dltStrategy = DltStrategy.FAIL_ON_ERROR,
    autoCreateTopics = "false",
    include = {RetryablePaymentException.class}
)
@KafkaListener(topics = "payments", groupId = "payment-processor")
public void processPayment(PaymentEvent event) {
    paymentService.process(event);
}

@DltHandler
public void handleDlt(PaymentEvent event, @Header(KafkaHeaders.RECEIVED_TOPIC) String topic) {
    log.error("Message sent to DLT: topic={}, paymentId={}", topic, event.paymentId());
    alertingService.sendDltAlert(event);
    deadLetterRepository.save(DeadLetterRecord.from(event, topic));
}
```

## Handling Poison Messages

A poison message is a message that consistently fails processing — malformed data, schema mismatch, or an edge case that triggers a bug. Without DLQ handling, poison messages block a partition indefinitely.

Indicators:
- Consumer lag growing on one partition while others are healthy
- Same offset appearing repeatedly in error logs
- Consumer processing rate drops to 0 on specific partitions

Always configure a DLQ (`dlt-strategy=FAIL_ON_ERROR`) with an alert on DLQ topic lag growth. Poison messages in the DLQ should trigger an on-call page and manual investigation.

## Performance Trade-offs of EOS

Transactions add overhead:

| Mode | Throughput (approx) | Latency |
|------|--------------------|----|
| No idempotence, acks=1 | Baseline 100% | Baseline |
| Idempotence only, acks=all | ~80% | +10ms |
| Transactions (EOS) | ~40–60% | +20–50ms |

The overhead comes from:
- `beginTransaction()`/`commitTransaction()` calls to the transaction coordinator
- Waiting for all ISR replicas to acknowledge (`acks=all`)
- Fencing previous transactions from zombie producers

For high-throughput pipelines where the downstream consumer is idempotent anyway, EOS's performance cost often isn't justified. Use idempotent producers + idempotent consumers instead of full EOS transactions.

## Real Production Mistakes

**Mistake 1: Sharing a transactional.id across multiple producer instances.** When two pods start with `transactional.id=payment-processor`, Kafka fences the older one. Your second pod's transactions are rejected. Use `payment-processor-${pod.ip}` or `payment-processor-${partition.id}`.

**Mistake 2: Using EOS for Kafka → Database writes and assuming no duplicates.** EOS is Kafka-to-Kafka. The database write is outside the transaction boundary. Always implement idempotency at the database layer regardless of Kafka configuration.

**Mistake 3: Not handling `ProducerFencedException`.** When a producer is fenced by a newer instance with the same `transactional.id`, it throws `ProducerFencedException`. This is not retryable — the producer must be shut down and restarted. Handling this as a generic exception causes infinite retry loops.

```java
try {
    kafkaTemplate.executeInTransaction(ops -> {
        ops.send("topic", record);
        return true;
    });
} catch (ProducerFencedException e) {
    // DO NOT retry — shut down and restart the producer
    log.error("Producer fenced, restarting: {}", e.getMessage());
    producerFactory.reset();
}
```

**Mistake 4: Ignoring rebalance-induced duplicates under load.** Teams test EOS with low throughput where rebalances are rare. Under production load with frequent membership changes (rolling deploys, autoscaling), rebalances happen constantly. Load test with rolling restarts to expose rebalance-induced duplicates.

## Architecture Diagram

```
Payments EOS Pipeline:

┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Payment API │────►│  payments topic  │────►│  EOS Consumer    │
│  (Producer)  │     │  64 partitions   │     │  Group           │
│  idempotent  │     │  RF=3, ISR=2     │     │  Transactional   │
│  acks=all    │     └──────────────────┘     │  writes          │
└──────────────┘                              └──────┬───────────┘
                                                     │
                    ┌────────────────────────────────┼─────────────┐
                    │                                │             │
                    ▼                                ▼             ▼
         ┌──────────────────┐           ┌──────────────┐  ┌──────────────┐
         │ payments-processed│           │  PostgreSQL  │  │ payments-dlq │
         │ topic             │           │  (idempotent │  │ (DLQ topic)  │
         │ (Kafka-to-Kafka   │           │  insert)     │  │              │
         │  EOS covered)     │           └──────────────┘  └──────────────┘
         └──────────────────┘           (NOT EOS covered — must be idempotent)
```

Kafka's exactly-once guarantee is genuine and valuable — for Kafka-to-Kafka pipelines. For everything beyond that, the responsibility shifts to you. The engineers who understand this distinction build reliable systems; the ones who don't spend weekends investigating duplicate payments.
