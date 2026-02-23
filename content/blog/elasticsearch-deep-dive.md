---
title: "Elasticsearch Deep Dive: Inverted Index, Mappings, and Query DSL"
description: "Understand how Elasticsearch stores and retrieves data using inverted indexes. Learn mapping design, query DSL patterns, aggregations, and production tuning for search-heavy applications."
date: "2025-02-24"
category: "Databases"
tags: ["elasticsearch", "search", "inverted index", "java", "databases"]
featured: false
affiliateSection: "database-resources"
---

Most engineers use Elasticsearch as a black box: index some JSON, run a search, get results. When search quality is poor or performance degrades at scale, they reach for random settings without understanding why. This article explains the internals that make Elasticsearch work — and why your index design decisions matter enormously.

## How Elasticsearch Stores Data

Elasticsearch is built on Apache Lucene. The core data structure is the **inverted index** — a mapping from terms to the documents containing them.

Think of an inverted index like the index at the back of a textbook. Instead of reading every page to find where "Kafka" is mentioned, you look up "Kafka" in the index and get a list of page numbers. Elasticsearch builds this structure automatically when you index a document, analyzing text into individual terms and recording which documents contain each term. This is why full-text search in Elasticsearch is so fast — it never has to scan document content at query time.

```
Documents:
  Doc 1: "Kafka is a distributed streaming platform"
  Doc 2: "Redis is an in-memory data structure store"
  Doc 3: "Kafka and Redis are both used in distributed systems"

Inverted Index (simplified):
  Term        → Document IDs (posting list)
  "kafka"     → [1, 3]
  "redis"     → [2, 3]
  "distributed" → [1, 3]
  "streaming" → [1]
  "memory"    → [2]
  "systems"   → [3]

Query: "kafka distributed"
  → Find docs with "kafka": {1, 3}
  → Find docs with "distributed": {1, 3}
  → Intersection: {1, 3}
  → Score by BM25 relevance (term frequency, inverse document frequency)
  → Return Doc 1 (more relevant: both terms in shorter text)
```

Each posting list also stores:
- Term frequency in each document (for relevance scoring)
- Position of each term (for phrase queries)
- Offsets (for highlighting)

## Index Architecture

Understanding how Elasticsearch distributes data across a cluster is essential before you make sizing decisions. Each index is split into shards — independent Lucene indexes that can live on different nodes. Replicas provide both redundancy and read throughput, since any replica can serve search requests. The diagram below shows a 3-shard index with one replica each, spread across 3 nodes so that every node holds one primary and one replica — no single node failure takes down any shard.

```
Elasticsearch Cluster:
  ┌─────────────────────────────────────────────────────┐
  │                    Cluster                           │
  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │  │   Node 1     │  │   Node 2     │  │   Node 3     │
  │  │  (Master)    │  │              │  │              │
  │  │              │  │              │  │              │
  │  │  Shard 0 (P) │  │  Shard 1 (P) │  │  Shard 2 (P) │
  │  │  Shard 1 (R) │  │  Shard 2 (R) │  │  Shard 0 (R) │
  │  └──────────────┘  └──────────────┘  └──────────────┘
  └─────────────────────────────────────────────────────┘

  Index "products": 3 primary shards, 1 replica each
  P = Primary, R = Replica
  Total shards: 6 (3 primary + 3 replica)
```

Each **shard** is a complete Lucene index. Documents are routed to shards by:
```
shard_id = hash(document_id) % number_of_primary_shards
```

**Shard sizing guidelines:**
- Target 20-50 GB per shard (larger = slower GC and recovery)
- Number of shards = expected total data / 30 GB (rounded up)
- Don't over-shard: each shard has overhead (~few MB), and more shards = more coordination cost

## Mapping Design: The Most Important Decision

Mappings define how documents and their fields are stored and indexed. Poor mapping design is the #1 cause of Elasticsearch performance problems.

Mappings are to Elasticsearch what a schema is to a relational database — but with higher stakes. You cannot change a field's type after indexing data without reindexing everything. Choosing `text` instead of `keyword` for a category field means you can't aggregate by category. Getting this right upfront saves you from expensive reindexing operations in production.

```json
// Product catalog mapping
PUT /products
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "refresh_interval": "5s",          // How often new docs become searchable
    "analysis": {
      "analyzer": {
        "product_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "stop", "snowball"]  // Stemming: "running" → "run"
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "id":          { "type": "keyword" },           // Exact match only
      "name":        {
        "type": "text",
        "analyzer": "product_analyzer",
        "fields": {
          "raw": { "type": "keyword" },               // For sorting and aggregations
          "suggest": { "type": "completion" }         // For autocomplete
        }
      },
      "description": { "type": "text", "analyzer": "product_analyzer" },
      "price":       { "type": "scaled_float", "scaling_factor": 100 },
      "category":    { "type": "keyword" },           // For filtering and facets
      "tags":        { "type": "keyword" },
      "in_stock":    { "type": "boolean" },
      "rating":      { "type": "half_float" },
      "created_at":  { "type": "date" },

      // Nested: preserve object identity for inner hits
      "variants": {
        "type": "nested",
        "properties": {
          "color": { "type": "keyword" },
          "size":  { "type": "keyword" },
          "stock": { "type": "integer" }
        }
      }
    }
  }
}
```

Notice that `name` is mapped as both `text` (for full-text search) and `keyword` (for sorting and faceting) using the `fields` feature. This is a common pattern — you want to search within the name using analyzed text, but you also want to sort results alphabetically, which requires the unanalyzed keyword version.

**Critical mapping decisions:**

| Field Type | Use When |
|---|---|
| `keyword` | Exact match, sorting, aggregations (category, ID, status) |
| `text` | Full-text search (descriptions, names) — analyzed and tokenized |
| `nested` | Arrays of objects where you need to query inner fields independently |
| `object` | Simple nested objects without cross-field query requirements |
| `date` | Timestamps — store as ISO 8601, query with date math |
| `scaled_float` | Prices, percentages (avoids float precision issues) |

**Avoid:**
- `dynamic: true` in production — unknown fields get auto-mapped, causing mapping explosions
- Storing large binary data (use S3 + store URL)
- Deep nesting (Elasticsearch flattens it, but queries get complex)

## Query DSL: From Simple to Complex

With mappings in place, you are ready to build queries. Elasticsearch's Query DSL is a JSON-based language that composes simple building blocks into arbitrarily complex search logic. The progression below goes from a basic match query to a full bool query with filters and aggregations — the same pattern you will use in most real-world search features.

### Full-Text Search

The `match` query is the workhorse of Elasticsearch — it analyzes your search string using the same analyzer as the indexed field, then finds documents containing the resulting terms. The `fuzziness: AUTO` option adds typo tolerance by allowing small edit-distance variations, so "headpones" still finds "headphones".

```json
// Match query: analyzes query string, standard choice for full-text
GET /products/_search
{
  "query": {
    "match": {
      "name": {
        "query": "wireless bluetooth headphones",
        "operator": "and",        // All terms must match (default: "or")
        "fuzziness": "AUTO"       // Typo tolerance
      }
    }
  }
}

// Multi-match: search across multiple fields with field boosting
GET /products/_search
{
  "query": {
    "multi_match": {
      "query": "gaming laptop",
      "fields": ["name^3", "description", "tags^2"],  // ^N = boost factor
      "type": "best_fields"
    }
  }
}
```

### Boolean Queries (Filtering + Searching)

The bool query is where real search features come alive. It combines full-text search with structured filtering in a single query, and the distinction between `must` and `filter` clauses is one of the most important performance decisions you will make.

```json
// Find: in-stock Sony headphones under $200, sorted by rating
GET /products/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "name": "headphones" } }      // Affects relevance score
      ],
      "filter": [
        { "term": { "category": "electronics" } }, // Does NOT affect score (cached)
        { "term": { "in_stock": true } },
        { "range": { "price": { "lte": 200 } } },
        { "prefix": { "brand.raw": "Sony" } }
      ],
      "must_not": [
        { "term": { "tags": "refurbished" } }
      ],
      "should": [
        { "term": { "tags": "featured" } }         // Optional boost
      ],
      "minimum_should_match": 0
    }
  },
  "sort": [
    { "rating": { "order": "desc" } },
    "_score"
  ]
}
```

**`filter` vs `must`:** Filters don't compute relevance scores and are cached by Elasticsearch. Always use `filter` for structured criteria (category, price range, boolean flags) and `must` only for full-text queries that should influence ranking.

### Aggregations: Faceted Search

Aggregations are what power the sidebar filters you see on every e-commerce site — "Electronics (143)", "$500-$1000", "4+ stars". The query below runs a search and simultaneously computes facet counts, price distribution, and average rating, all in a single request. Without aggregations, you would need separate queries for each of these counts.

```json
// Product search with facets (category counts, price histogram)
GET /products/_search
{
  "query": { "match": { "name": "laptop" } },
  "aggs": {
    "by_category": {
      "terms": { "field": "category", "size": 10 }
    },
    "price_ranges": {
      "range": {
        "field": "price",
        "ranges": [
          { "to": 500 },
          { "from": 500, "to": 1000 },
          { "from": 1000, "to": 2000 },
          { "from": 2000 }
        ]
      }
    },
    "avg_rating": { "avg": { "field": "rating" } },
    "in_stock_count": {
      "filter": { "term": { "in_stock": true } }
    }
  },
  "size": 10
}
```

### Nested Queries

Nested queries exist because of how Elasticsearch flattens arrays of objects. Without `nested` type and queries, searching for "red L variant" might match a product that has a red M and a blue L as separate variants — not what you want. The `nested` query preserves object boundaries within arrays so that all conditions must match within the same variant object.

```json
// Find products that have a red variant in size L
{
  "query": {
    "nested": {
      "path": "variants",
      "query": {
        "bool": {
          "filter": [
            { "term": { "variants.color": "red" } },
            { "term": { "variants.size": "L" } },
            { "range": { "variants.stock": { "gt": 0 } } }
          ]
        }
      },
      "inner_hits": {}  // Return the matching variant in the result
    }
  }
}
```

## Java Client (Official Elasticsearch Java API)

The official Java client uses a fluent builder API that mirrors the JSON Query DSL structure. The search service below combines multi-field search with category and price filters, and appends an aggregation for facets — all in a single type-safe call. The builder pattern makes it easy to conditionally add clauses based on which filters the user actually provided.

```java
@Service
public class ProductSearchService {

    @Autowired
    private ElasticsearchClient client;

    public SearchResult<Product> search(ProductSearchRequest req) throws IOException {
        SearchResponse<Product> response = client.search(s -> s
            .index("products")
            .query(q -> q
                .bool(b -> {
                    if (req.getQuery() != null) {
                        b.must(m -> m.multiMatch(mm -> mm
                            .query(req.getQuery())
                            .fields("name^3", "description", "tags^2")
                            .fuzziness("AUTO")
                        ));
                    }
                    if (req.getCategory() != null) {
                        b.filter(f -> f.term(t -> t.field("category").value(req.getCategory())));
                    }
                    if (req.getMaxPrice() != null) {
                        b.filter(f -> f.range(r -> r.field("price").lte(JsonData.of(req.getMaxPrice()))));
                    }
                    b.filter(f -> f.term(t -> t.field("in_stock").value(true)));
                    return b;
                })
            )
            .sort(so -> so.field(f -> f.field("_score").order(SortOrder.Desc)))
            .sort(so -> so.field(f -> f.field("rating").order(SortOrder.Desc)))
            .from(req.getPage() * req.getSize())
            .size(req.getSize())
            .aggregations("categories", a -> a.terms(t -> t.field("category").size(20)))
            , Product.class
        );

        return buildResult(response);
    }
}
```

## Production Tuning

Production Elasticsearch performance comes down to three areas: JVM memory settings, index configuration for your write pattern, and ongoing monitoring. The settings below are starting points — you will need to adjust based on your cluster's actual size and workload.

```yaml
# JVM heap: 50% of RAM, max 32GB (compressed OOPs stop working above 32GB)
ES_JAVA_OPTS: "-Xms16g -Xmx16g"

# elasticsearch.yml
indices.memory.index_buffer_size: 20%      # Buffer for indexing (default 10%)
indices.fielddata.cache.size: 20%          # FieldData cache for aggregations
```

During bulk data loads (initial indexing or migration), disabling replicas and relaxing the refresh interval can dramatically increase throughput. The steps below show how to maximize write speed during ingestion, then restore production settings when done. The `forcemerge` step is important: it compacts many small Lucene segments into one, which significantly speeds up queries on the freshly loaded index.

```bash
# Index settings for write-heavy ingestion
PUT /products/_settings
{
  "refresh_interval": "30s",              # Less frequent refresh = faster indexing
  "number_of_replicas": 0                 # Disable replicas during bulk load, re-enable after
}

# After bulk load, re-enable:
PUT /products/_settings
{ "number_of_replicas": 1, "refresh_interval": "5s" }

# Force merge after bulk load (improves query performance)
POST /products/_forcemerge?max_num_segments=1
```

**Monitoring KPIs:**
- **Search latency**: `p99 < 200ms` for most queries
- **Indexing latency**: `p99 < 500ms` for real-time indexing
- **JVM heap used**: alert at 85% (above 75% triggers GC pressure)
- **Disk I/O**: sustained high disk I/O = segment merges happening (normal)
- **Rejected requests**: thread pool rejections = cluster overwhelmed, add nodes or reduce load

Elasticsearch rewards careful mapping design and query construction far more than hardware scaling. Get the mapping right first, use filters instead of queries wherever possible, and let aggregations tell you what your data looks like.
