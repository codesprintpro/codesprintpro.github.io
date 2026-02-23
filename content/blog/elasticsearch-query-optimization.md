---
title: "Elasticsearch Query Optimization: From Slow to Sub-100ms"
description: "Elasticsearch performance tuning in production: query vs filter context, mapping optimization, shard sizing strategy, field data vs doc values, aggregation performance, index lifecycle management, and the profiling tools that identify bottlenecks."
date: "2025-05-29"
category: "Databases"
tags: ["elasticsearch", "search", "performance", "indexing", "aggregations", "kibana", "spring boot"]
featured: false
affiliateSection: "database-resources"
---

Elasticsearch is a distributed search and analytics engine built on top of Apache Lucene. At small scale, it's fast regardless of what you do. At production scale — billions of documents, hundreds of concurrent queries, real-time indexing — the difference between a well-tuned cluster and a poorly configured one is 10-100× in query latency. Most Elasticsearch performance problems are caused by a small set of well-understood mistakes.

## Query Context vs. Filter Context

The single most impactful optimization: use filter context instead of query context wherever relevance scoring is not needed.

```json
// SLOW: Query context — calculates relevance scores for every document
GET /orders/_search
{
  "query": {
    "bool": {
      "must": [
        { "term": { "status": "pending" } },
        { "term": { "region": "us-east-1" } },
        { "range": { "created_at": { "gte": "2025-01-01" } } }
      ]
    }
  }
}

// FAST: Filter context — binary match/no-match, results are CACHED
GET /orders/_search
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "status": "pending" } },
        { "term": { "region": "us-east-1" } },
        { "range": { "created_at": { "gte": "2025-01-01" } } }
      ]
    }
  }
}
```

Filter context differences from query context:
1. **No scoring** — filters are true/false, no TF-IDF calculation
2. **Cached** — Elasticsearch caches filter results in the filter cache (not query cache)
3. **Faster** — 2-10× faster for exact-value and range queries

Rule: put `must` clauses in `filter` unless you actually need relevance ranking. Use `must` (query context) only for full-text search where you need `_score`.

```json
// Correct hybrid: full-text search with filters
{
  "query": {
    "bool": {
      "must": [
        { "match": { "description": "blue running shoes" } }  // Query context: scoring needed
      ],
      "filter": [
        { "term": { "in_stock": true } },                    // Filter context: no scoring
        { "range": { "price": { "lte": 100 } } }
      ]
    }
  }
}
```

## Mapping Optimization: Disable What You Don't Need

Elasticsearch's default dynamic mapping indexes everything with maximum flexibility. In production, disable features you don't use:

```json
PUT /orders
{
  "mappings": {
    "dynamic": "strict",  // Reject unknown fields (don't silently index new fields)
    "properties": {
      "order_id": {
        "type": "keyword"  // Exact match — don't use 'text' for IDs
      },
      "status": {
        "type": "keyword",
        "doc_values": true,  // For sorting/aggregations (default true for keyword)
        "index": true        // For filtering (default true)
      },
      "description": {
        "type": "text",
        "index": true,
        "doc_values": false,  // Text fields can't be aggregated anyway
        "norms": false,       // Disable length normalization if not needed
        "index_options": "docs"  // 'docs' < 'freqs' < 'positions' < 'offsets' (ascending cost)
      },
      "user_id": {
        "type": "keyword",
        "index": true,
        "doc_values": false   // No aggregations on user_id → disable doc_values (saves heap)
      },
      "internal_notes": {
        "type": "text",
        "index": false        // Store the field but don't index it (can't search, can retrieve)
      },
      "created_at": {
        "type": "date",
        "format": "strict_date_optional_time"
      },
      "amount_cents": {
        "type": "long"
      }
    }
  }
}
```

**doc_values vs fielddata:**

For aggregations and sorting on `keyword` fields: use `doc_values` (default on, stored on disk, low heap impact).

For aggregations on `text` fields: requires `fielddata: true` — this loads the entire inverted index into heap memory. On a large index, this can OOM your cluster.

```json
// DANGEROUS: Enabling fielddata on a high-cardinality text field
PUT /orders/_mapping
{
  "properties": {
    "description": {
      "type": "text",
      "fielddata": true  // Loads all text terms into heap — can cause OOM
    }
  }
}

// CORRECT: Use a multi-field — text for searching, keyword for aggregating
"product_name": {
  "type": "text",
  "fields": {
    "keyword": {           // product_name.keyword → exact match + aggregations
      "type": "keyword",
      "ignore_above": 256  // Don't index very long strings as keyword
    }
  }
}
```

## Shard Sizing: The Root Cause of Most Performance Problems

Shards are the unit of parallelism in Elasticsearch. Too few: can't parallelize. Too many: excessive overhead.

```
Shard sizing guidelines:
- Target: 10-50GB per shard
- Too small (< 1GB): overhead per shard dominates, cluster management expensive
- Too large (> 50GB): recovery time after node failure is too long

Common mistake: 5 shards × 1 replica = 10 shards for an index with 1GB of data
→ Each shard: 100MB — massive overhead
→ Should be 1 shard or reduce replica count

Calculation example:
Index: product catalog
Data: 50GB expected
Shards: 50GB ÷ 30GB target = ~2 primary shards
Replicas: 1 (for redundancy)
Total: 4 shards across cluster

Number of shards also determines maximum parallelism for a single query:
A query hits all shards — 2 shards = query runs on 2 nodes in parallel
```

**You cannot change the number of primary shards without reindexing.** Set it correctly when creating the index. For time-based data, use ILM (Index Lifecycle Management) instead of one giant index.

## Index Lifecycle Management (ILM) for Time-Series Data

```json
// ILM policy: roll over active index when it hits 50GB or 30 days
PUT _ilm/policy/logs-policy
{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": {
            "max_size": "50GB",
            "max_age": "30d"
          },
          "set_priority": { "priority": 100 }
        }
      },
      "warm": {
        "min_age": "30d",
        "actions": {
          "shrink": { "number_of_shards": 1 },   // Reduce to 1 shard (read-only)
          "forcemerge": { "max_num_segments": 1 }, // Merge to 1 segment (fast reads)
          "set_priority": { "priority": 50 }
        }
      },
      "cold": {
        "min_age": "90d",
        "actions": {
          "freeze": {}     // Minimize memory usage — slow to query but searchable
        }
      },
      "delete": {
        "min_age": "365d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}
```

Forcemerge in the warm phase reduces each index from many small segments (created during heavy indexing) to a single segment. Single-segment indexes are faster to read because Lucene doesn't need to merge results from multiple segments.

## Aggregation Performance

```json
// SLOW: Aggregation on a high-cardinality text field with fielddata
// FAST: Aggregation on a keyword field with doc_values

// Cardinality aggregation (approximate count of unique values):
GET /orders/_search
{
  "size": 0,  // Don't return hits, just aggregation results
  "aggs": {
    "unique_customers": {
      "cardinality": {
        "field": "user_id",
        "precision_threshold": 40000  // Higher = more accurate, more memory (max 40000)
      }
    }
  }
}

// Date histogram for time-series data:
GET /orders/_search
{
  "size": 0,
  "query": {
    "bool": {
      "filter": [
        { "range": { "created_at": { "gte": "now-30d/d", "lte": "now/d" } } }
      ]
    }
  },
  "aggs": {
    "orders_over_time": {
      "date_histogram": {
        "field": "created_at",
        "calendar_interval": "1d",
        "time_zone": "UTC"
      },
      "aggs": {
        "total_revenue": {
          "sum": { "field": "amount_cents" }
        }
      }
    }
  }
}
```

**Aggregation optimization techniques:**

1. **Filter before aggregating** — use `query.bool.filter` to reduce the document set before running aggregations
2. **Use `size: 0`** — if you only need aggregation results, don't fetch any hits (eliminates top-N scoring overhead)
3. **Limit terms aggregation size** — `"terms": {"field": "status", "size": 10}` — default size is 10, but large sizes (> 10,000) are expensive
4. **Shard-level aggregation** — Elasticsearch aggregates on each shard, then merges. More shards = more parallel aggregation = faster for large datasets

## Query Profiling

Use the Profile API to understand where time goes:

```json
GET /orders/_search
{
  "profile": true,
  "query": {
    "bool": {
      "filter": [
        { "term": { "status": "pending" } },
        { "range": { "created_at": { "gte": "now-1d" } } }
      ]
    }
  }
}

// Profile response (simplified):
{
  "profile": {
    "shards": [{
      "searches": [{
        "query": [{
          "type": "BooleanQuery",
          "description": "+status:pending +created_at:[...]",
          "time_in_nanos": 1532000,  // 1.5ms — whole query
          "breakdown": {
            "create_weight": 450000,
            "build_scorer": 380000,
            "next_doc": 420000,
            "score": 80000,          // 0ms — filter context, no scoring
            "advance": 120000
          },
          "children": [...]
        }]
      }]
    }]
  }
}
```

High `create_weight` time often indicates an expensive `must` clause that should be moved to `filter`. High `next_doc` time indicates iterating many documents — consider if the index is missing a useful field for filtering.

## Bulk Indexing Optimization

```java
// Spring Data Elasticsearch — bulk indexing:
@Service
public class ProductIndexService {

    @Autowired
    private ElasticsearchOperations operations;

    public void bulkIndex(List<Product> products) {
        List<IndexQuery> queries = products.stream()
            .map(product -> new IndexQueryBuilder()
                .withId(product.getId().toString())
                .withObject(product)
                .build())
            .collect(Collectors.toList());

        operations.bulkIndex(queries, IndexCoordinates.of("products"));
    }
}

// Optimal bulk indexing settings (disable during bulk load):
PUT /products/_settings
{
  "settings": {
    "refresh_interval": "-1",        // Disable auto-refresh during bulk load
    "number_of_replicas": "0"        // No replicas during load (re-enable after)
  }
}
// After bulk load completes:
PUT /products/_settings
{
  "settings": {
    "refresh_interval": "30s",       // Or "1s" for near-real-time search
    "number_of_replicas": "1"
  }
}
POST /products/_forcemerge?max_num_segments=5  // Merge segments after bulk load
```

**Index refresh_interval:** Every 1 second (default), Elasticsearch makes new documents searchable by refreshing the in-memory buffer to disk. Each refresh creates a new Lucene segment. Too many small segments → slow searches. During bulk indexing, set `refresh_interval: -1` to batch many documents into fewer, larger segments. After loading, set to `30s` or `1s` depending on your freshness requirement.

## Java Client Configuration

```java
@Configuration
public class ElasticsearchConfig {

    @Bean
    public ElasticsearchClient elasticsearchClient() {
        RestClient restClient = RestClient.builder(
            new HttpHost("es-cluster.example.com", 9200, "https")
        )
        .setRequestConfigCallback(config -> config
            .setConnectTimeout(5000)
            .setSocketTimeout(30000)   // Allow time for complex queries
        )
        .setHttpClientConfigCallback(httpClient -> httpClient
            .setMaxConnTotal(50)           // Connection pool size
            .setMaxConnPerRoute(50)
        )
        .build();

        ElasticsearchTransport transport = new RestClientTransport(
            restClient, new JacksonJsonpMapper());

        return new ElasticsearchClient(transport);
    }
}
```

The path to fast Elasticsearch queries is systematic: understand why filter context is cached, map only what you query, size shards to 10-50GB, let ILM manage index rollover, profile slow queries to find the expensive clause, and use bulk API with refresh disabled for heavy indexing. Each optimization compounds — a well-mapped index in filter context on properly-sized shards can be 10-50× faster than the same data with default settings.
