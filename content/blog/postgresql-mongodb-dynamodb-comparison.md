---
title: "PostgreSQL vs MongoDB vs DynamoDB: When to Use Which Database"
description: "A pragmatic guide to choosing between relational, document, and key-value stores. Real trade-offs, access patterns, and decision criteria — not marketing material."
date: "2025-01-12"
category: "Databases"
tags: ["postgresql", "mongodb", "dynamodb", "nosql", "sql", "databases"]
featured: false
affiliateSection: "database-resources"
---

Every database choice is a bet on your access patterns. PostgreSQL, MongoDB, and DynamoDB are all excellent databases — for different problems. The mistake engineers make is choosing based on hype ("NoSQL scales better") or familiarity ("we've always used Postgres") rather than modeling their actual data access patterns.

This article gives you a decision framework based on concrete trade-offs, not vendor marketing.

## The Core Trade-off: Flexibility vs Predictability

Before diving into each database, it helps to understand the fundamental spectrum they sit on. As you move from PostgreSQL toward DynamoDB, you give up query flexibility in exchange for more predictable performance at scale. Neither end is universally better — the right position on the spectrum depends entirely on what your application needs to do.

```
PostgreSQL:  Schema-first, ACID, flexible queries, bounded performance at scale
MongoDB:     Schema-flexible, eventual consistency by default, rich queries, scales horizontally
DynamoDB:    Schema-minimal, predictable single-digit millisecond latency, massive scale, constrained queries
```

The more you sacrifice query flexibility (PostgreSQL → MongoDB → DynamoDB), the more predictable and scalable your read/write performance becomes. Choose the right level for your use case.

## PostgreSQL: When Your Data Is Relational

PostgreSQL excels when:
- Data has complex relationships (foreign keys, joins)
- You need ACID transactions across multiple entities
- Query patterns are varied and exploratory (reporting, analytics)
- Your dataset fits in a few TB (or you can shard)

### PostgreSQL Strengths

**MVCC and True ACID:**

Financial operations are the canonical example of why ACID transactions matter. The code below shows a bank transfer — the classic case where partial success is worse than failure. PostgreSQL's MVCC (Multi-Version Concurrency Control) ensures that other transactions reading the accounts during this transfer see a consistent snapshot, not half-transferred state.

```sql
-- Bank transfer: both operations succeed or both fail
BEGIN;
  UPDATE accounts SET balance = balance - 100 WHERE id = 1;
  UPDATE accounts SET balance = balance + 100 WHERE id = 2;
  -- If any error here, ROLLBACK; both changes undone
COMMIT;
```

**JSONB for schema flexibility within structure:**

One of PostgreSQL's underappreciated features is JSONB — it lets you store structured relational data alongside flexible document data in the same table. The `attributes` column below can hold different keys for different product types (a shirt has `color` and `size`, while a laptop has `ram` and `storage`), while the rest of the table stays strongly typed. You get schema flexibility where you need it, without giving it up everywhere.

```sql
-- Mix relational and document in one table
CREATE TABLE products (
    id         BIGSERIAL PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    price      DECIMAL(10,2) NOT NULL,
    category   VARCHAR(100) NOT NULL,
    attributes JSONB,                 -- flexible product-specific fields
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index into JSONB for performant queries
CREATE INDEX idx_products_color ON products USING gin((attributes->'color'));

-- Query JSONB fields
SELECT name, price, attributes->>'color' AS color
FROM products
WHERE category = 'shirts'
  AND (attributes->>'size')::text = 'L'
  AND price < 50;
```

**Partitioning for time-series data:**

When a table grows into the hundreds of millions of rows, even indexed queries slow down because the index itself becomes large and expensive to scan. Table partitioning solves this by splitting the data into smaller physical tables (partitions) based on a key — in this case, the month. The query planner then automatically skips partitions that can't possibly match your time range, a technique called partition pruning.

```sql
-- Monthly partitions for events table
CREATE TABLE events (
    id         UUID DEFAULT gen_random_uuid(),
    user_id    BIGINT NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    payload    JSONB
) PARTITION BY RANGE (occurred_at);

CREATE TABLE events_2025_01 PARTITION OF events
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE events_2025_02 PARTITION OF events
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

-- Queries automatically prune irrelevant partitions
SELECT * FROM events WHERE occurred_at BETWEEN '2025-01-15' AND '2025-01-20';
-- Scans only events_2025_01 partition
```

**When PostgreSQL struggles:**
- Horizontal sharding is manual and complex (CitusDB or application-level sharding)
- Connection overhead at high concurrency (use PgBouncer — connection pooling is essential)
- Full-text search is functional but not as feature-rich as Elasticsearch
- Writes slow down as table size grows without careful partition/index management

## MongoDB: When Documents Are Natural

MongoDB excels when:
- Your data is naturally document-shaped (nested objects, arrays)
- Schema evolves frequently (rapidly changing product attributes, user profiles)
- You need horizontal sharding without application-level complexity
- Read patterns favor fetching complete documents

### MongoDB Strengths

**Document model matches application objects:**

The key insight behind MongoDB's document model is that it eliminates the object-relational impedance mismatch. In a relational database, a user profile with preferences, an address, and subscription details is spread across 3-4 tables. Every read requires a join. In MongoDB, the whole user is one document — one read, no joins. This makes the most sense when you almost always need the whole object together, not fragments of it.

```javascript
// No joins needed — embed related data that's fetched together
{
  "_id": ObjectId("..."),
  "userId": "user_123",
  "name": "John Doe",
  "email": "john@example.com",
  "address": {
    "street": "123 Main St",
    "city": "San Francisco",
    "country": "US"
  },
  "preferences": {
    "theme": "dark",
    "notifications": ["email", "push"],
    "timezone": "America/New_York"
  },
  "subscription": {
    "tier": "pro",
    "expiresAt": ISODate("2025-12-31")
  },
  "createdAt": ISODate("2024-01-15")
}
```

With PostgreSQL, this requires 3-4 tables and a join query. With MongoDB, it's one document — one read.

**Aggregation pipeline for complex analytics:**

MongoDB's aggregation pipeline works like a Unix pipe: data flows through stages, each stage transforming the output of the previous one. The pipeline below unwinds order line items, joins with product data, groups by region and category, and sorts by revenue — all inside the database. For analytics that need to stay close to the document model, this is significantly more natural than translating to SQL.

```javascript
// Sales report by region and product category
db.orders.aggregate([
  { $match: { status: "completed", date: { $gte: new Date("2025-01-01") } } },
  { $unwind: "$items" },
  { $lookup: {
    from: "products",
    localField: "items.productId",
    foreignField: "_id",
    as: "product"
  }},
  { $unwind: "$product" },
  { $group: {
    _id: { region: "$region", category: "$product.category" },
    totalRevenue: { $sum: { $multiply: ["$items.quantity", "$items.price"] } },
    orderCount: { $count: {} }
  }},
  { $sort: { totalRevenue: -1 } }
]);
```

**When MongoDB struggles:**
- Multi-document transactions (added in 4.0, but have overhead — design to avoid them)
- Complex joins across collections (schema design mistake — embed more)
- Strong consistency requirements (default is eventual — use `readConcern: majority` for strong reads, at latency cost)
- Fixed-cost analytics at scale (Aggregation pipeline is powerful but slower than ClickHouse for OLAP)

## DynamoDB: When You Need Predictable Scale

DynamoDB excels when:
- You need guaranteed single-digit millisecond latency at any scale
- Access patterns are known and simple (get by key, query by partition)
- You expect massive, unpredictable traffic spikes
- Operational overhead must be near-zero (fully managed, no tuning)

### Single-Table Design: The Key Concept

DynamoDB's most unusual characteristic is that it rewards putting all your entity types into a single table. This feels wrong to SQL-trained engineers, but there's a reason: DynamoDB can only efficiently query by partition key and sort key. By encoding entity type and relationships into those keys, you make all your access patterns fast. Think of it as designing your access API first, then building the schema to serve it.

DynamoDB's data model forces you to think about access patterns first, schema second. All entity types live in one table.

```
Table: "app-table"

PK              | SK              | GSI1PK      | GSI1SK      | Data
----------------|-----------------|-------------|-------------|----------
USER#user123    | PROFILE         | EMAIL#j@e   | USER#user123| name, phone
USER#user123    | ORDER#order456  | STATUS#PAID | 2025-01-15  | total, items
USER#user123    | ORDER#order789  | STATUS#SHIP | 2025-01-20  | total, items
ORDER#order456  | ITEM#item001    |             |             | qty, price
ORDER#order456  | ITEM#item002    |             |             | qty, price
PRODUCT#prod001 | METADATA        |             |             | name, price

Access patterns satisfied by this schema:
1. GetItem: Get user profile → PK=USER#user123, SK=PROFILE
2. Query: Get all orders for user → PK=USER#user123, SK begins_with "ORDER#"
3. Query: Get all paid orders (any user) → GSI1, PK=STATUS#PAID
4. Query: Get all items in order → PK=ORDER#order456, SK begins_with "ITEM#"
```

The Java code below shows how to talk to this table using the DynamoDB Enhanced Client, which maps your annotated Java classes to DynamoDB items. Notice that the `pk` field holds compound keys like `USER#user123` — the `#` separator is a convention that keeps different entity types from accidentally colliding while still letting you query all entities of a type by prefix.

```java
// DynamoDB single-table access with DynamoDB Enhanced Client
@DynamoDbBean
public class UserProfile {
    private String pk;  // "USER#user123"
    private String sk;  // "PROFILE"
    private String name;
    private String email;
    // ...

    @DynamoDbPartitionKey
    public String getPk() { return pk; }

    @DynamoDbSortKey
    public String getSk() { return sk; }
}

DynamoDbEnhancedClient client = DynamoDbEnhancedClient.builder()
    .dynamoDbClient(DynamoDbClient.create())
    .build();

DynamoDbTable<UserProfile> table = client.table("app-table", TableSchema.fromBean(UserProfile.class));

// Put
table.putItem(userProfile);

// Get
UserProfile profile = table.getItem(Key.builder()
    .partitionValue("USER#user123")
    .sortValue("PROFILE")
    .build());

// Query all orders for user
PageIterable<UserProfile> orders = table.query(
    QueryConditional.sortBeginsWith(Key.builder()
        .partitionValue("USER#user123")
        .sortValue("ORDER#")
        .build())
);
```

**DynamoDB Streams for event-driven architecture:**

DynamoDB Streams captures a time-ordered log of every write to your table, which you can process with a Lambda function. This turns your database into an event bus: a new order row appears, Streams fires an event, Lambda processes it. This pattern is how you build event-driven microservices without adding a separate message broker.

```java
// DynamoDB Streams captures every write as an event
// Lambda trigger: process changes in real-time

@Override
public void handleRequest(DynamodbEvent event, Context context) {
    for (DynamodbStreamRecord record : event.getRecords()) {
        if ("INSERT".equals(record.getEventName())) {
            Map<String, AttributeValue> newItem = record.getDynamodb().getNewImage();
            String pk = newItem.get("pk").getS();

            if (pk.startsWith("ORDER#")) {
                // New order created — trigger fulfillment workflow
                fulfillmentService.processOrder(pk.replace("ORDER#", ""));
            }
        }
    }
}
```

**When DynamoDB struggles:**
- Ad-hoc queries (you don't know your access patterns upfront)
- Complex joins across entity types (impossible without multiple round-trips)
- Large item sizes (400KB item limit)
- ACID transactions (supported but limited to 25 items, higher cost)
- Migrations (no schema = no migration tooling, managing attribute evolution is manual)

## Decision Framework

Use this flow when you are evaluating which database to pick for a new service or feature. The questions are ordered by the factors that most strongly constrain your choice — start at the top and stop when you have a clear answer.

```
Question 1: Do you have complex relationships and varied query patterns?
  YES → PostgreSQL

Question 2: Is your data naturally document-shaped with evolving schema?
  YES → MongoDB

Question 3: Do you need guaranteed < 10ms latency at 100K+ RPS with zero ops burden?
  YES → DynamoDB

Question 4: Do you need ACID across multiple entities?
  YES → PostgreSQL (or MongoDB 4.0+ with caveats)

Question 5: Do you expect 10x traffic spikes without pre-scaling?
  YES → DynamoDB (serverless on-demand mode handles this automatically)
```

## The Hybrid Architecture (Real World)

In practice, the most robust production systems don't pick one database and force everything through it. They use each database for what it does best, accepting the operational cost of running multiple systems in exchange for the performance and scalability benefits. Here is a realistic example of how these databases coexist in a mature e-commerce platform.

Most production systems use multiple databases:

```
E-commerce platform:

  PostgreSQL:
    - User accounts, authentication
    - Products, inventory (complex relationships)
    - Orders (ACID transactions for payment)

  DynamoDB:
    - Session storage (high throughput, simple key-value)
    - Shopping cart (real-time, per-user state)
    - Search history (write-heavy, simple structure)

  Redis:
    - Product catalog cache (hot reads)
    - Rate limiting
    - Real-time inventory counters

  Elasticsearch:
    - Product search with full-text + facets

  ClickHouse:
    - Analytics (revenue reports, funnel analysis)
```

No single database is the right answer. The polyglot persistence approach — using each database for what it does best — is the production-grade solution.

The interview trap is picking one and defending it universally. The production mindset is asking: "What are the actual access patterns?" and then matching the tool to the requirement.
