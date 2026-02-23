---
title: "DynamoDB Advanced Patterns: Single-Table Design and Beyond"
description: "Production DynamoDB: single-table design with access pattern mapping, GSI overloading, sparse indexes, adjacency lists for graph relationships, DynamoDB Streams for event-driven architectures, and the read/write capacity math that prevents bill shock."
date: "2025-06-13"
category: "Databases"
tags: ["dynamodb", "aws", "nosql", "single-table design", "gsi", "dynamodb streams", "serverless"]
featured: false
affiliateSection: "database-resources"
---

DynamoDB is a fully managed key-value and document database that delivers single-digit millisecond performance at any scale. It achieves this with a fundamental constraint: you must define your access patterns before you build your schema, because the schema directly encodes those patterns. The engineers who learn DynamoDB from relational habits write inefficient schemas. The engineers who internalize its data model write schemas that scale to billions of rows with consistent latency.

## DynamoDB's Data Model

Every DynamoDB table has a primary key — either a partition key (simple) or a partition key + sort key (composite). Unlike Cassandra, there's no concept of clustering order across the whole table — ordering is local to a partition key.

```
Table: Orders
┌─────────────┬──────────────────┬────────────────────┬───────────────┐
│  PK (pk)    │  SK (sk)         │  Attributes         │  Notes        │
├─────────────┼──────────────────┼────────────────────┼───────────────┤
│ ORDER#1001  │ ORDER#1001       │ status, total, date │ Order entity  │
│ ORDER#1001  │ ITEM#prod-001    │ qty, price, name    │ Order item    │
│ ORDER#1001  │ ITEM#prod-002    │ qty, price, name    │ Order item    │
│ ORDER#1001  │ STATUS#shipped   │ carrier, tracking   │ Status event  │
│ CUSTOMER#42 │ CUSTOMER#42      │ name, email, tier   │ Customer      │
│ CUSTOMER#42 │ ORDER#1001       │ date, status, total │ Cust → Order  │
│ CUSTOMER#42 │ ORDER#1005       │ date, status, total │ Cust → Order  │
└─────────────┴──────────────────┴────────────────────┴───────────────┘
```

This is single-table design — multiple entity types co-exist in one table, distinguished by the format of their PK/SK values.

## Single-Table Design: The Core Principle

In relational databases, one entity = one table. In DynamoDB, one access pattern group = one table. Single-table design collapses your entities into one table, enabling:

1. **Transactional writes** across related entities (DynamoDB transactions require items to be in the same table)
2. **Query efficiency** — fetching an order with all its items in one request using `Query`
3. **Cost efficiency** — fewer requests = fewer RCUs consumed

**Access pattern mapping (do this before writing a line of code):**

| Access Pattern | Operation | Key Condition |
|---------------|-----------|---------------|
| Get order by ID | GetItem | PK=ORDER#id, SK=ORDER#id |
| Get all items in order | Query | PK=ORDER#id, SK begins_with ITEM# |
| Get all orders for customer | Query | PK=CUSTOMER#id, SK begins_with ORDER# |
| Get customer profile | GetItem | PK=CUSTOMER#id, SK=CUSTOMER#id |
| Get order status history | Query | PK=ORDER#id, SK begins_with STATUS# |

Each row in this table drives a direct DynamoDB operation. If you can't express a query as a `GetItem` or `Query` on your primary key structure, you need a GSI.

## Global Secondary Indexes: Overloading and Sparse Indexes

**GSI basics:** A GSI is a separate index with a different partition key (and optional sort key). DynamoDB automatically maintains it. You can query on GSI keys the same way you query the main table.

**GSI overloading** — one GSI serves multiple access patterns:

```
GSI: GSI1 (gsi1pk, gsi1sk)

Item type    | gsi1pk                 | gsi1sk          | Access pattern
-------------|------------------------|-----------------|------------------------
Order        | STATUS#pending         | ORDER#2025-01-15| All pending orders by date
Customer     | TIER#gold              | CUSTOMER#name   | All gold tier customers
Product      | CATEGORY#electronics  | PRODUCT#name    | All electronics products
```

One GSI answers three different queries — "all pending orders", "gold tier customers", "electronics products" — by using a generic `gsi1pk`/`gsi1sk` attribute name that different entity types populate with different values.

```javascript
// DynamoDB SDK v3 (JavaScript/TypeScript):

// All pending orders (most recent first):
const pendingOrders = await client.send(new QueryCommand({
  TableName: 'Orders',
  IndexName: 'GSI1',
  KeyConditionExpression: 'gsi1pk = :status',
  ExpressionAttributeValues: {
    ':status': 'STATUS#pending'
  },
  ScanIndexForward: false  // DESC order
}));

// Gold tier customers:
const goldCustomers = await client.send(new QueryCommand({
  TableName: 'Orders',
  IndexName: 'GSI1',
  KeyConditionExpression: 'gsi1pk = :tier',
  ExpressionAttributeValues: {
    ':tier': 'TIER#gold'
  }
}));
```

**Sparse indexes** — GSIs only include items that have the GSI key attribute. This creates naturally filtered indexes:

```javascript
// Only active sessions have a TTL and gsi1pk='SESSION#active'
// Expired sessions have no gsi1pk → not in GSI
// Result: GSI contains only active sessions — no filter needed

const activeSessions = await client.send(new QueryCommand({
  TableName: 'Table',
  IndexName: 'GSI1',
  KeyConditionExpression: 'gsi1pk = :active',
  ExpressionAttributeValues: { ':active': 'SESSION#active' }
}));
```

## Adjacency List Pattern: Graph Relationships

For many-to-many relationships (e.g., users follow other users, products in multiple categories):

```
Following relationship (Twitter-like):
PK              | SK              | type     | gsi1pk          | gsi1sk
----------------|-----------------|----------|-----------------|----------------
USER#alice      | USER#alice      | USER     | —               | —
USER#alice      | FOLLOWS#bob     | FOLLOW   | FOLLOWED_BY#bob | USER#alice
USER#alice      | FOLLOWS#carol   | FOLLOW   | FOLLOWED_BY#carol| USER#alice
USER#bob        | USER#bob        | USER     | —               | —
USER#bob        | FOLLOWS#alice   | FOLLOW   | FOLLOWED_BY#alice| USER#bob

Access patterns:
1. "Who does Alice follow?"     → Query PK=USER#alice, SK begins_with FOLLOWS#
2. "Who follows Bob?"          → Query GSI1 gsi1pk=FOLLOWED_BY#bob
3. "Does Alice follow Bob?"    → GetItem PK=USER#alice, SK=FOLLOWS#bob
```

The adjacency list stores the relationship in both directions — direct on the main table (PK of follower), inverted via GSI (queried by followee). No join table needed.

## DynamoDB Streams and Event-Driven Patterns

DynamoDB Streams capture every write (INSERT, MODIFY, REMOVE) as an ordered record per partition. Combine with Lambda for event-driven architectures:

```
DynamoDB Streams Architecture:

Write → DynamoDB Table → Stream (ordered per partition)
                              ↓
                         Lambda trigger
                         (128 shards max)
                              ↓
                    Event processing:
                    - Fan-out notifications
                    - Update search index (Elasticsearch)
                    - Replicate to analytics (Kinesis → S3)
                    - Invalidate cache (ElastiCache)
                    - Cross-region replication
```

```javascript
// Lambda handler for DynamoDB Stream:
export const handler = async (event: DynamoDBStreamEvent) => {
  for (const record of event.Records) {
    if (record.eventName === 'INSERT') {
      const newItem = unmarshall(record.dynamodb!.NewImage!);

      if (newItem.pk?.startsWith('ORDER#')) {
        // New order created — send confirmation email
        await emailService.sendOrderConfirmation(newItem);
        // Update search index
        await searchService.indexOrder(newItem);
      }
    }

    if (record.eventName === 'MODIFY') {
      const oldItem = unmarshall(record.dynamodb!.OldImage!);
      const newItem = unmarshall(record.dynamodb!.NewImage!);

      if (oldItem.status !== newItem.status) {
        // Status changed — trigger downstream workflow
        await workflowService.onStatusChange(newItem.pk, oldItem.status, newItem.status);
      }
    }
  }
};
```

**Stream delivery guarantees:**
- Each record delivered at least once (exactly-once semantics not guaranteed)
- Records delivered in order per partition key
- Lambda processes shards concurrently — different partition keys may process in parallel

Design your handlers to be idempotent (safe to call multiple times with the same record).

## Transactions: ACID Across Multiple Items

DynamoDB supports ACID transactions for up to 100 items per transaction:

```javascript
// Transfer funds between accounts (atomic debit + credit):
const transferFunds = async (fromAccountId: string, toAccountId: string, amount: number) => {
  await client.send(new TransactWriteCommand({
    TransactItems: [
      {
        // Debit source account (with condition: sufficient funds)
        Update: {
          TableName: 'Accounts',
          Key: { pk: `ACCOUNT#${fromAccountId}`, sk: `ACCOUNT#${fromAccountId}` },
          UpdateExpression: 'SET balance = balance - :amount',
          ConditionExpression: 'balance >= :amount',
          ExpressionAttributeValues: { ':amount': amount }
        }
      },
      {
        // Credit destination account
        Update: {
          TableName: 'Accounts',
          Key: { pk: `ACCOUNT#${toAccountId}`, sk: `ACCOUNT#${toAccountId}` },
          UpdateExpression: 'SET balance = balance + :amount',
          ExpressionAttributeValues: { ':amount': amount }
        }
      },
      {
        // Write transaction record
        Put: {
          TableName: 'Accounts',
          Item: {
            pk: `TRANSFER#${uuid()}`,
            sk: `TRANSFER#${uuid()}`,
            fromAccount: fromAccountId,
            toAccount: toAccountId,
            amount,
            createdAt: new Date().toISOString()
          }
        }
      }
    ]
  }));
};
```

Transactions use OCC (optimistic concurrency control). If any condition fails, the entire transaction is rolled back. Cost: 2× read/write capacity units compared to non-transactional operations.

## Capacity Planning: Avoiding Bill Shock

DynamoDB pricing is based on Read Capacity Units (RCUs) and Write Capacity Units (WCUs):

```
1 RCU = 1 strongly consistent read of up to 4KB
      = 2 eventually consistent reads of up to 4KB
      = 0.5 transactional reads of up to 4KB

1 WCU = 1 write of up to 1KB
      = 0.5 transactional writes of up to 1KB

On-demand pricing (us-east-1):
$0.25 per million read request units
$1.25 per million write request units

Provisioned capacity pricing:
$0.00013 per RCU-hour ($0.0065 per RCU-day)
$0.00065 per WCU-hour ($0.0325 per WCU-day)
```

**Example calculation:**

E-commerce site: 1,000 orders/hour, each order writes 5 items (order + 3 items + customer update) of ~500 bytes each.

```
Writes:
1,000 orders/hour × 5 items × 1 WCU (500 bytes < 1KB)
= 5,000 WCUs/hour for orders

If using transactions (2× cost):
= 10,000 WCUs/hour

Monthly cost (on-demand):
10,000 WCUs/hour × 720 hours × $1.25/million
= 7.2M WCUs × $1.25/million = $9/month for writes

Reads (query order + items = 1 RCU per request):
Assume 5× read:write ratio = 25,000 RCUs/hour
Monthly cost: 18M RCUs × $0.25/million = $4.50/month

Total: ~$13.50/month for 720,000 orders
```

At this scale, on-demand is fine. At 10M orders/month, provisioned capacity with auto-scaling is 70-80% cheaper.

**Hot partition detection:**

```
CloudWatch metric to monitor:
- ConsumedWriteCapacityUnits (per-partition) — not exposed directly
- ThrottledRequests > 0 — always indicates a problem
- SystemErrors — usually indicates hot partitions causing timeouts

In AWS Console: DynamoDB → Metrics → ConsumedWriteCapacityUnits
Look for spikes indicating one partition getting disproportionate traffic
```

Signs of a hot partition:
- Throttling on specific items even though provisioned capacity isn't exhausted globally
- One product/user getting orders of magnitude more traffic than others

Fix: Add jitter to partition keys (e.g., append a random 0-9 suffix, query all 10 suffixes and merge client-side).

## TTL: Automatic Data Expiration

DynamoDB TTL automatically deletes items past their expiration timestamp — at no cost:

```javascript
// Setting TTL:
const expirationTime = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days

await client.send(new PutItemCommand({
  TableName: 'Sessions',
  Item: {
    pk: { S: `SESSION#${sessionId}` },
    sk: { S: `SESSION#${sessionId}` },
    userId: { S: userId },
    ttl: { N: expirationTime.toString() }  // Unix epoch seconds
  }
}));

// DynamoDB automatically deletes items when ttl < current epoch
// Deletion happens within 48 hours of expiration
// Deleted items appear in DynamoDB Streams as REMOVE events (useful for audit)
```

TTL is the correct pattern for session data, temporary caches, and compliance-driven data retention. Never run a Lambda to purge old data — TTL does it free.

## When DynamoDB Is Wrong

DynamoDB excels at:
- Known, stable access patterns (OLTP workloads)
- Key-value lookups at massive scale
- Event sourcing and time-series data
- Serverless architectures (pay-per-request, zero management)

DynamoDB is the wrong choice for:
- Ad-hoc analytics (use Athena on S3 exports or Redshift)
- Complex queries with multiple filter conditions on non-indexed attributes
- Flexible schema requirements that change frequently (schema changes in single-table design are painful)
- Teams without DynamoDB expertise (the learning curve is steep and mistakes are expensive)

The difference between DynamoDB experts and beginners: experts define all access patterns on a whiteboard before writing any code. Every GSI, every overloaded attribute, every entity prefix is a deliberate decision made against a list of queries the application must support. The schema follows the queries — not the other way around.
