---
title: "Kafka Streams: Real-Time Stream Processing Without a Separate Cluster"
description: "Production Kafka Streams: KStream vs KTable semantics, stateful transformations with RocksDB state stores, windowed aggregations, stream-table joins, topology design, changelog topics, and the operational patterns for running Kafka Streams in production."
date: "2025-04-24"
category: "Data Engineering"
tags: ["kafka", "kafka streams", "stream processing", "real-time", "java", "rocksdb", "windowing", "data engineering"]
featured: false
affiliateSection: "data-engineering-resources"
---

Kafka Streams is a Java library for building real-time stream processing applications. Unlike Flink or Spark Streaming, it has no separate cluster — it runs as a library inside your Java application. Each instance of your application processes a subset of partitions. Scale by adding instances. It's operationally simple (just another Spring Boot application), yet powerful enough for complex stateful streaming computations.

## KStream vs. KTable: The Core Abstraction

Understanding the difference between KStream and KTable is fundamental to Kafka Streams:

```
KStream: an unbounded sequence of events
  → Each message represents an independent event
  → "Order placed", "Payment received", "Item shipped"
  → Records are APPENDED — every record matters
  → Like a database transaction log

KTable: a changelog stream representing state
  → Each message represents the LATEST value for a key
  → "Current inventory level for product X: 42"
  → New record with same key REPLACES old record
  → Like a database table with CDC (change data capture)

GlobalKTable: like KTable, but ALL data is loaded into every instance
  → Enables enrichment joins without repartitioning
  → Use for small, read-heavy reference data (users, products, configs)
```

```java
// Topology setup:
@Configuration
public class StreamTopologyConfig {

    @Bean
    public KafkaStreamsConfiguration kStreamsConfig(
            @Value("${spring.kafka.bootstrap-servers}") String bootstrapServers) {
        Map<String, Object> props = new HashMap<>();
        props.put(StreamsConfig.APPLICATION_ID_CONFIG, "order-processing");  // Consumer group ID
        props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(StreamsConfig.DEFAULT_KEY_SERDE_CLASS_CONFIG, Serdes.String().getClass());
        props.put(StreamsConfig.DEFAULT_VALUE_SERDE_CLASS_CONFIG, Serdes.String().getClass());
        props.put(StreamsConfig.COMMIT_INTERVAL_MS_CONFIG, 1000);  // Checkpoint every 1s
        // RocksDB state stores in persistent directory (survive restart):
        props.put(StreamsConfig.STATE_DIR_CONFIG, "/var/lib/kafka-streams");
        return new KafkaStreamsConfiguration(props);
    }

    @Bean
    public StreamsBuilder streamsBuilder() {
        return new StreamsBuilder();
    }
}
```

## Stateless Transformations

```java
@Component
public class OrderEnrichmentTopology {

    @Autowired
    private StreamsBuilder streamsBuilder;

    @PostConstruct
    public void buildTopology() {
        // Input: raw order events (JSON string)
        KStream<String, String> rawOrders = streamsBuilder.stream("orders-raw");

        // Stateless filter + map:
        KStream<String, Order> orders = rawOrders
            .filter((key, value) -> value != null && !value.isEmpty())
            .mapValues(value -> deserialize(value, Order.class))
            .filter((key, order) -> order.getTotalCents() > 0);  // Skip zero-value orders

        // Branch: route high-value orders to separate topic:
        Map<String, KStream<String, Order>> branches = orders.split(Named.as("branch-"))
            .branch((key, order) -> order.getTotalCents() >= 100_000,
                    Branched.as("high-value"))     // $1000+
            .branch((key, order) -> order.getTotalCents() >= 10_000,
                    Branched.as("medium-value"))   // $100-$999
            .defaultBranch(Branched.as("standard"));

        branches.get("branch-high-value")
            .mapValues(order -> serialize(order))
            .to("orders-high-value");

        // Rekeying: change partition key (triggers repartitioning)
        // Input: keyed by order_id → rekey by customer_id
        KStream<String, Order> byCustomer = orders
            .selectKey((orderId, order) -> order.getCustomerId());
        // After selectKey, data is repartitioned — a network shuffle happens

        byCustomer
            .mapValues(order -> serialize(order))
            .to("orders-by-customer");
    }
}
```

## Stateful Aggregations with Windowing

```java
@Component
public class RevenueAggregationTopology {

    @PostConstruct
    public void buildTopology() {
        KStream<String, Order> orders = streamsBuilder
            .stream("orders", Consumed.with(Serdes.String(), orderSerde));

        // Tumbling window: non-overlapping, fixed-size time windows
        // Count orders and sum revenue per customer per hour:
        KTable<Windowed<String>, RevenueAggregate> hourlyRevenue = orders
            .selectKey((k, order) -> order.getCustomerId())
            .groupByKey(Grouped.with(Serdes.String(), orderSerde))
            .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofHours(1)))
            .aggregate(
                RevenueAggregate::new,       // Initializer
                (customerId, order, agg) -> { // Aggregator
                    agg.addOrder(order);
                    return agg;
                },
                Materialized.<String, RevenueAggregate, WindowStore<Bytes, byte[]>>as(
                    "customer-hourly-revenue-store")  // Named state store
                    .withKeySerde(Serdes.String())
                    .withValueSerde(revenueAggregateSerde)
            );

        // Output aggregation results:
        hourlyRevenue
            .toStream()
            .map((windowedKey, aggregate) -> KeyValue.pair(
                windowedKey.key() + "@" + windowedKey.window().start(),
                serialize(aggregate)
            ))
            .to("customer-hourly-revenue");

        // Sliding window: overlapping windows for moving averages
        // Session window: variable-length windows based on activity gaps
        KTable<Windowed<String>, Long> sessionCounts = orders
            .selectKey((k, order) -> order.getCustomerId())
            .groupByKey()
            .windowedBy(SessionWindows.ofInactivityGapWithNoGrace(Duration.ofMinutes(30)))
            .count(Materialized.as("customer-sessions"));
    }
}
```

## Stream-Table Join: Enrichment Pattern

```java
@Component
public class OrderEnrichmentWithProducts {

    @PostConstruct
    public void buildTopology() {
        // Stream: order events
        KStream<String, Order> orders = streamsBuilder.stream("orders");

        // GlobalKTable: product catalog (small, reference data)
        GlobalKTable<String, Product> products = streamsBuilder.globalTable(
            "products",
            Materialized.as("products-store")  // Locally stored in RocksDB
        );

        // Enrich each order with product details (no repartitioning needed with GlobalKTable):
        KStream<String, EnrichedOrder> enriched = orders.join(
            products,
            (orderId, order) -> order.getProductId(),  // Key extractor (join key)
            (order, product) -> new EnrichedOrder(order, product)  // Value joiner
        );

        enriched.to("orders-enriched");

        // Regular KTable join (both sides can be large — requires co-partitioning):
        KTable<String, Customer> customers = streamsBuilder.table("customers");

        // Co-partitioning requirement: orders and customers must have the same
        // number of partitions and use the same key (customerId)
        KStream<String, Order> ordersByCustomer = orders
            .selectKey((k, order) -> order.getCustomerId());

        KStream<String, EnrichedOrder> withCustomer = ordersByCustomer.join(
            customers,
            (order, customer) -> enrichWithCustomer(order, customer),
            JoinWindows.ofTimeDifferenceWithNoGrace(Duration.ofMinutes(5))
            // Stream-stream join: events within 5 minutes are matched
        );
    }
}
```

## State Stores and Interactive Queries

Kafka Streams stores stateful computation results in local RocksDB instances. You can query these stores directly from your application:

```java
@RestController
@RequestMapping("/api/analytics")
public class StreamAnalyticsController {

    @Autowired
    private KafkaStreams kafkaStreams;

    // Query the hourly revenue aggregation state store:
    @GetMapping("/revenue/{customerId}")
    public ResponseEntity<List<RevenueAggregate>> getCustomerRevenue(
            @PathVariable String customerId) {

        ReadOnlyWindowStore<String, RevenueAggregate> store = kafkaStreams.store(
            StoreQueryParameters.fromNameAndType(
                "customer-hourly-revenue-store",
                QueryableStoreTypes.windowStore()
            )
        );

        long now = System.currentTimeMillis();
        long oneDayAgo = now - Duration.ofDays(1).toMillis();

        WindowStoreIterator<RevenueAggregate> iterator =
            store.fetch(customerId, oneDayAgo, now);

        List<RevenueAggregate> results = new ArrayList<>();
        while (iterator.hasNext()) {
            KeyValue<Long, RevenueAggregate> entry = iterator.next();
            results.add(entry.value);
        }
        iterator.close();

        return ResponseEntity.ok(results);
    }
}
```

**For queries across all instances (distributed state):** Kafka Streams assigns partitions to instances. Customer X's state may be on instance 2, but the request hits instance 1. Use Kafka Streams' `queryMetadataForKey()` to find which instance owns the data, then make an HTTP call to that instance:

```java
KeyQueryMetadata metadata = kafkaStreams.queryMetadataForKey(
    "customer-hourly-revenue-store",
    customerId,
    Serdes.String().serializer()
);
HostInfo activeHost = metadata.activeHost();
// If activeHost is this instance: query local store
// If not: HTTP call to activeHost.host():activeHost.port()
```

## Changelog Topics and Fault Tolerance

Every state store has a corresponding changelog topic in Kafka (e.g., `order-processing-customer-hourly-revenue-store-changelog`). On failure and restart, Kafka Streams replays the changelog to rebuild the state store:

```
State restoration on restart:
1. Application starts, reads its partition assignments
2. For each partition: find latest offset in changelog topic
3. Replay changelog records from last checkpoint to latest offset
4. State store is restored — then normal processing resumes

Restoration time: proportional to changelog size since last checkpoint
At 1000 records/second for 10 minutes = 600,000 records to replay
At 100,000 records/second replay speed = ~6 seconds restoration

Optimization: use standby replicas (process on 2 instances, 0 restoration time on failover)
props.put(StreamsConfig.NUM_STANDBY_REPLICAS_CONFIG, 1);
```

## Production Configuration

```java
// Essential production settings:
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "order-processing-v2");
props.put(StreamsConfig.REPLICATION_FACTOR_CONFIG, 3);  // Changelog topic replication
props.put(StreamsConfig.NUM_STANDBY_REPLICAS_CONFIG, 1);  // Standby for fast failover
props.put(StreamsConfig.COMMIT_INTERVAL_MS_CONFIG, 1000);  // Checkpoint every 1s
props.put(StreamsConfig.CACHE_MAX_BYTES_BUFFERING_CONFIG, 10 * 1024 * 1024L);  // 10MB in-memory buffer

// Consumer settings:
props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");  // Start from beginning
props.put(ConsumerConfig.SESSION_TIMEOUT_MS_CONFIG, 30000);  // 30s timeout

// Producer settings (for output topics):
props.put(ProducerConfig.ACKS_CONFIG, "all");  // All replicas must acknowledge
props.put(ProducerConfig.RETRIES_CONFIG, Integer.MAX_VALUE);
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);  // Exactly-once semantics

// Exactly-once processing (requires Kafka >= 2.5):
props.put(StreamsConfig.PROCESSING_GUARANTEE_CONFIG, StreamsConfig.EXACTLY_ONCE_V2);
```

Exactly-once semantics (`EXACTLY_ONCE_V2`) means state store updates and output topic writes are committed atomically — no duplicates even on failure. The cost: ~20% latency overhead from transactional producer coordination.

Kafka Streams' architecture — library embedded in your application, state in local RocksDB, fault tolerance via changelog topics — is the right abstraction for stream processing when your team already runs Kafka and doesn't want to operate a separate cluster. The learning curve is the topology DSL and the KStream/KTable semantics. Once those click, building complex stateful streaming pipelines becomes straightforward Java development.
