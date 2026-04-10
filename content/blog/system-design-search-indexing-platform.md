---
title: "System Design: Building a Search Indexing Platform"
description: "Design a production search indexing platform with change capture, indexing pipelines, mapping strategy, backfills, reindexing, partial updates, consistency trade-offs, and operational recovery."
date: "2026-04-10"
category: "System Design"
tags: ["system design", "search", "elasticsearch", "indexing", "cdc", "distributed systems", "backend engineering"]
featured: false
affiliateSection: "system-design-courses"
---

Search gets demoed as a search box.

Search gets operated as a distributed data synchronization problem.

The hard part is usually not querying Elasticsearch or OpenSearch. The hard part is getting the right data into the index, in the right shape, at the right time, without crushing your database or serving obviously stale results.

When search indexing is weak, users see deleted products still showing up, newly published content missing for minutes, ranking fields drifting out of date, and large reindex jobs taking down production. The search engine gets blamed, but the real problem is often the indexing platform around it.

This guide designs a production search indexing platform.

## Problem Statement

Build a platform that keeps search indexes synchronized with source-of-truth systems.

Examples:

- product catalog search
- support ticket search
- order history search
- audit log search
- knowledge base search
- merchant dashboard search

The platform should support:

- near-real-time incremental indexing
- full backfills and reindexing
- partial field updates
- deletions and tombstones
- schema evolution
- index alias cutovers
- observability and recovery

This is not just an Elasticsearch design problem. It is a **change data propagation** problem.

## Requirements

Functional requirements:

- ingest changes from source systems
- transform source records into index documents
- create, update, and delete indexed documents
- support bulk indexing
- support replays and backfills
- support blue-green reindexing
- expose indexing health and lag
- support multi-entity joins where needed

Non-functional requirements:

- indexing should not overload primary databases
- search staleness should be bounded and observable
- retries must be safe
- document shape changes should be deployable safely
- reindexing should not break live search
- pipeline failures should be diagnosable

The most important design question is:

**How do changes from source systems become indexed documents, safely and repeatedly?**

## Why Naive Indexing Fails

A very common early design looks like this:

```java
productRepository.save(product);
elasticsearchClient.index(productDocument);
```

This looks convenient and usually works in staging.

It fails in production because:

- database write can succeed while indexing fails
- process can crash between the two steps
- retries can create duplicate or stale writes
- large writes make request latency worse
- downstream search availability now affects your write path

This is the classic dual-write problem.

The indexing platform should decouple source writes from search writes.

## High-Level Architecture

```text
Source DB / Services
      |
      +--> CDC / outbox / change events
                |
                v
           Change Stream
                |
                v
         Indexing Workers
                |
                +--> transform / enrich
                +--> dedupe / ordering
                +--> bulk index
                |
                v
          Search Cluster
                |
                v
        Search API / Search UI
```

That central pipeline gives you:

- one place to manage retries
- one place to manage mappings
- one place to observe lag and failures

## Change Ingestion Options

There are three common ways to feed the indexing pipeline.

### 1. Direct application events

When product service updates a product, it publishes `ProductUpdated`.

Pros:

- simple to understand
- can include domain intent

Cons:

- easy to lose events if publishing is not transactional
- event producers must stay disciplined

### 2. Outbox pattern

Application writes domain data and outbox event in one transaction. A relay publishes the outbox to Kafka.

Pros:

- reliable
- avoids dual-write loss

Cons:

- more moving parts

### 3. CDC from database

Use Debezium or another CDC tool to stream row changes.

Pros:

- captures every DB change
- very reliable for synchronization

Cons:

- lower domain semantics
- must reconstruct document intent from row changes

For most serious systems, outbox or CDC is the right answer.

## Source-of-Truth Example

Suppose a product catalog lives in relational tables:

```sql
CREATE TABLE products (
  id BIGINT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category_id BIGINT,
  brand_id BIGINT,
  price_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE product_inventory (
  product_id BIGINT PRIMARY KEY,
  available_qty INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE brands (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL
);
```

The search document might want all of this in one document:

```json
{
  "id": "p_123",
  "tenantId": "merchant_42",
  "title": "Wireless Mechanical Keyboard",
  "description": "Low-profile keyboard with brown switches",
  "brand": "KeyNova",
  "category": "Accessories",
  "priceMinor": 7999,
  "currency": "INR",
  "availableQty": 14,
  "status": "active",
  "updatedAt": "2026-04-10T09:10:00Z"
}
```

That means the indexing platform often has to join or enrich source data before indexing.

## Indexing Pipeline Stages

A healthy pipeline usually has these stages:

1. capture change
2. determine affected document id
3. load or assemble document source
4. transform to indexable shape
5. bulk write to index
6. record success / failure

That is important because not every source change maps one-to-one with one search write.

Examples:

- brand rename may affect 2 million product documents
- inventory update may change only `availableQty`
- category deletion may require document unpublishing

## Document Assembly

There are two main patterns.

### Pattern 1: full document rebuild

On any change, load the entire source view and reindex the full document.

Pros:

- easier correctness
- fewer partial-update bugs

Cons:

- heavier read load
- more indexing bytes

### Pattern 2: partial updates

Only update changed fields.

Pros:

- cheaper for hot fields like inventory or popularity score

Cons:

- harder correctness
- more risk of drift if one field depends on another

A common hybrid:

- full rebuild for low-frequency structural changes
- partial updates for high-frequency counters

## Bulk Indexing

Do not send one indexing request per event at scale.

Use bulk writes.

Example batch:

```json
{ "index": { "_index": "products_v7", "_id": "p_123" } }
{ "id": "p_123", "title": "Keyboard", "availableQty": 14 }
{ "index": { "_index": "products_v7", "_id": "p_124" } }
{ "id": "p_124", "title": "Mouse", "availableQty": 3 }
```

Workers usually batch by:

- index name
- operation type
- byte size
- time window

Typical safety limits:

- max 5-15 MB per bulk request
- max N documents per batch
- flush every few hundred milliseconds

## Idempotency and Ordering

Indexing systems get retried. A lot.

So each indexing operation should be safe to replay.

Useful fields:

- source event id
- source updated timestamp
- source version

A practical rule:

- only apply update if incoming version >= indexed version

Example pseudo-check:

```java
if (incomingVersion < existingVersion) {
    return SkipReason.STALE_EVENT;
}
```

Without ordering discipline, a delayed old event can overwrite a newer document.

## Tombstones and Deletes

Deletions are easy to forget and painful to debug.

If a product is deleted or unpublished:

- remove document from search, or
- keep a tombstone state and exclude it from search queries

For CDC-driven systems, a delete event may not carry all fields, so the indexer needs enough context to know which document id to remove.

Example tombstone message:

```json
{
  "eventType": "product_deleted",
  "productId": "p_123",
  "tenantId": "merchant_42",
  "version": 982
}
```

## Index Mapping Strategy

Index mappings should be deliberate, not inferred casually from JSON.

You need to decide:

- `text` vs `keyword`
- analyzers per field
- numeric types
- date formats
- nested vs flattened objects

Example:

```json
{
  "mappings": {
    "properties": {
      "id": { "type": "keyword" },
      "tenantId": { "type": "keyword" },
      "title": {
        "type": "text",
        "fields": {
          "raw": { "type": "keyword" }
        }
      },
      "brand": { "type": "keyword" },
      "priceMinor": { "type": "long" },
      "availableQty": { "type": "integer" },
      "updatedAt": { "type": "date" }
    }
  }
}
```

Do not let production mappings evolve accidentally from dynamic field discovery if schema stability matters.

## Reindexing and Blue-Green Cutover

Mappings change. Ranking signals change. Document shape changes.

You should not rebuild the live index in place if you can avoid it.

Use versioned indexes:

```text
products_v6
products_v7
```

And aliases:

```text
products_current -> products_v6
```

Reindex flow:

1. create `products_v7`
2. backfill all documents
3. verify counts and sample queries
4. atomically move alias `products_current` to `products_v7`
5. keep old index temporarily for rollback

This makes schema changes survivable.

## Backfills

Backfills are required for:

- new index creation
- bug fixes in document transformation
- repairing a failed indexing window
- onboarding a new tenant

Do not backfill by hammering the primary DB with one giant query.

Preferred pattern:

- read in primary-key ranges or time windows
- paginate carefully
- stream through workers
- throttle

Example:

```sql
SELECT id
FROM products
WHERE tenant_id = :tenant_id
  AND id > :last_id
ORDER BY id
LIMIT 5000;
```

Then load and index those documents in chunks.

## Joining Related Changes

Some updates affect many documents.

Examples:

- brand rename -> all brand's products
- merchant status change -> all merchant's listings
- seller suspension -> all listings hidden

You need fanout jobs for these secondary changes.

Pattern:

```text
BrandUpdated
  -> find affected product ids
  -> enqueue document rebuild jobs
```

Do not try to do huge fanout synchronously in the admin request.

## Incremental Lag and Staleness

Search is usually eventually consistent.

That is fine if:

- staleness is bounded
- teams understand the trade-off
- lag is visible

Track:

- event lag to index
- oldest unprocessed change
- failed document count
- retry backlog

A system with 3 seconds of lag is very different from one silently stuck for 45 minutes.

## Failure Modes

### 1. Source write succeeds, index update lost

Fix:

- outbox or CDC
- replay capability

### 2. Bulk indexing partially fails

Fix:

- inspect per-document bulk response
- retry only failed items

### 3. Old event overwrites newer doc

Fix:

- source version ordering
- stale event skip

### 4. Mapping change breaks indexing

Fix:

- versioned indexes
- canary indexing before cutover

### 5. Reindex overloads databases

Fix:

- throttled range scans
- replicas or snapshot exports where appropriate

### 6. Search results show deleted content

Fix:

- reliable tombstones
- delete replay tooling

## Observability

Metrics that matter:

- indexing throughput docs/sec
- event-to-index lag
- per-index bulk failure rate
- transformation error rate
- retry queue depth
- backfill progress
- alias cutover success
- stale event discard count

Useful dashboards:

- search lag by tenant
- failed documents by reason
- top fanout jobs by size
- reindex progress by index version

## Example Worker

```java
@Service
public class ProductIndexingWorker {

    public void process(ChangeEvent event) {
        ProductDocumentSource source = documentAssembler.load(event);
        if (source == null) {
            searchClient.delete("products_current", event.documentId());
            return;
        }

        ProductSearchDocument doc = transformer.transform(source);

        searchClient.index(
            "products_current",
            event.documentId(),
            doc,
            event.version()
        );
    }
}
```

In production, this would usually be batched and bulked, but the conceptual flow stays the same: assemble, transform, index.

## Search Cluster Isolation

Do not let search indexing share too much fate with transactional services.

Good isolation:

- separate worker fleet
- bounded queues
- index cluster scaling independent of application API

Bad isolation:

- write requests block on indexing
- admin reindex jobs run inside web processes
- search incidents directly break source writes

Search should degrade search freshness, not core writes.

## What I Would Build First

Phase 1:

- outbox or CDC change feed
- transformation workers
- bulk indexing
- failure logging and retry

Phase 2:

- reindex jobs with versioned indexes
- alias cutover tooling
- lag dashboards
- partial updates for hot fields

Phase 3:

- fanout rebuild jobs for related-entity changes
- tenant-scoped reindex controls
- richer observability and backfill scheduling

This order matters. Teams often obsess over analyzers and ranking before they have a reliable indexing pipeline.

## Production Checklist

- source changes captured reliably
- per-document indexing idempotent
- bulk responses inspected for partial failure
- deletes handled explicitly
- versioned indexes used for schema changes
- alias cutover tested
- backfill jobs throttled
- lag observable
- replay tooling available
- search freshness SLO defined

## Final Takeaway

A search indexing platform is a synchronization engine with search as the destination.

If you design it well, search feels fresh, reindexes become routine, and source systems stay stable.

If you design it poorly, search becomes a graveyard of stale documents and heroic recovery scripts.

## Read Next

- [CDC with Debezium and Kafka: Production Patterns and Failure Modes](/blog/cdc-debezium-kafka-patterns/)
- [Elasticsearch Query Optimization: How to Cut Latency by 10x](/blog/elasticsearch-query-optimization/)
- [Transactional Outbox Pattern: Reliable Event Publishing Without Dual Writes](/blog/transactional-outbox-pattern/)
