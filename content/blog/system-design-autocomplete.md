---
title: "System Design: Search Autocomplete at Google Scale"
description: "Design a typeahead/autocomplete system that returns relevant suggestions in under 100ms for billions of queries. Covers trie vs inverted index, ranking algorithms, and distributed architecture."
date: "2025-02-20"
category: "System Design"
tags: ["system design", "search", "autocomplete", "trie", "distributed systems"]
featured: false
affiliateSection: "system-design-courses"
---

Search autocomplete — the dropdown that appears as you type — seems simple but is one of the most latency-sensitive features in any product. Google returns suggestions in under 100ms for billions of queries per day. This article designs the system behind that.

## Requirements

**Functional:**
- Return top 5 suggestions as the user types (after each keystroke)
- Suggestions ranked by historical query frequency + recency
- Personalized suggestions (user's history)
- Support for typo tolerance (fuzzy matching)
- Trending queries bubble up quickly

**Non-Functional:**
- 10B daily queries → 115,000 queries/sec
- Latency p99 < 100ms (including network round-trip)
- High availability (99.99%)
- Suggestions updated from query logs within 10 minutes (near real-time)

## Data Model: What Are We Searching?

Before choosing a data structure, you need to understand what the input and output of the system actually are. The system receives a user's partially typed query and must return the five most relevant completions. The "most relevant" part is not about text matching — it is about predicting what the user intends to type, which requires a scoring model built from historical behavior.

```
Query log (source of truth):
  Each search query is recorded with timestamp, user_id, result_click_count.

Aggregation pipeline:
  Raw logs → Count per query → Filter noise → Rank → Index

Ranked query store:
  query: "java virtual threads"
  score: 8,432,100         (weighted: frequency × recency × CTR)
  updated_at: 2025-02-20

Goal: Given prefix "java v", return:
  1. java virtual threads
  2. java versions
  3. java volatile keyword
  4. java vector api
  5. java var keyword
```

The score formula `frequency × recency × CTR` is the key insight here: a query that was searched a million times two years ago should not outrank a query searched 100,000 times in the last hour if the recent one shows high click-through rate. Weighting these three signals together produces suggestions that feel current and useful rather than historically accurate but stale.

## Core Data Structure: Trie vs Inverted Index

With the data model defined, the next question is how to index it so that a prefix lookup returns the top-5 completions in under 10ms. There are two fundamentally different approaches, and understanding their tradeoffs is what interviewers are really testing here.

### Option 1: Trie (Prefix Tree)

A trie is a tree where each path from root to a leaf spells out a string. It is the most natural data structure for prefix lookups, but its real power — and its main limitation — comes from how you store suggestions at each node.

```
Trie for ["java", "java virtual", "javascript"]:

root
 └─ j
    └─ a
       └─ v
          ├─ a [end: score=8M]
          │  └─  [space]
          │      └─ v
          │         └─ i
          │            └─ r [end: score=8.4M]
          └─ a
             └─ s [end: score=12M]
```

Each node can store the top-K suggestions for that prefix (precomputed). Lookup: O(prefix_length). Memory: O(total characters × K suggestions per node).

The critical insight of storing top-K suggestions at every node is what makes the trie usable for autocomplete: instead of traversing all children to find the best suggestions at query time, you precompute the answer during index build and store it directly at the node. A query for "java v" returns results in exactly as many steps as there are characters in the prefix.

```java
class TrieNode {
    Map<Character, TrieNode> children = new HashMap<>();
    // Store top-K (e.g., 5) suggestions at this node — avoids tree traversal on query
    PriorityQueue<Suggestion> topK = new PriorityQueue<>(Comparator.comparingLong(Suggestion::getScore));
    boolean isEnd;
}

class AutocompleteTrie {

    private final TrieNode root = new TrieNode();
    private final int K = 5;

    public void insert(String query, long score) {
        TrieNode node = root;
        for (char c : query.toCharArray()) {
            node.children.putIfAbsent(c, new TrieNode());
            node = node.children.get(c);
            updateTopK(node, new Suggestion(query, score));
        }
        node.isEnd = true;
    }

    private void updateTopK(TrieNode node, Suggestion suggestion) {
        node.topK.offer(suggestion);
        if (node.topK.size() > K) {
            node.topK.poll(); // Remove lowest score
        }
    }

    public List<String> search(String prefix) {
        TrieNode node = root;
        for (char c : prefix.toCharArray()) {
            node = node.children.get(c);
            if (node == null) return Collections.emptyList();
        }
        // Top-K already precomputed at this node
        return node.topK.stream()
            .sorted(Comparator.comparingLong(Suggestion::getScore).reversed())
            .map(Suggestion::getQuery)
            .collect(Collectors.toList());
    }
}
```

The `PriorityQueue` used as a min-heap of size K is the right choice here: when you call `poll()`, it removes the lowest-scoring suggestion, so after processing all inserts you are left with the K highest-scoring ones. This gives you O(log K) insert time at each node, which is effectively constant since K is fixed at 5.

**Trie pros/cons:**
- Pros: O(L) lookup where L = prefix length, perfect for prefix matching
- Cons: Memory-intensive for large vocabularies, difficult to update incrementally, no fuzzy matching

### Option 2: Elasticsearch with Edge N-Grams (Production Choice)

The trie is elegant for teaching, but production systems at Google or LinkedIn scale choose Elasticsearch because it combines prefix search, typo tolerance, and popularity ranking in a single system that is horizontally scalable. The edge n-gram analyzer is the key configuration: it pre-indexes every prefix of every query term at index time, so a search for "java v" matches any document that contains a token starting with "java v" — without any trie traversal at all.

For production at scale, Elasticsearch handles prefix search, typo tolerance, and ranking in one system:

```json
// Index mapping with edge n-gram analyzer
{
  "settings": {
    "analysis": {
      "analyzer": {
        "autocomplete_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "autocomplete_filter"]
        },
        "search_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase"]
        }
      },
      "filter": {
        "autocomplete_filter": {
          "type": "edge_ngram",
          "min_gram": 1,
          "max_gram": 20
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "query": {
        "type": "text",
        "analyzer": "autocomplete_analyzer",
        "search_analyzer": "search_analyzer"
      },
      "score": { "type": "long" },
      "updated_at": { "type": "date" }
    }
  }
}
```

Notice that `autocomplete_analyzer` is used at index time but `search_analyzer` (without the edge n-gram filter) is used at search time. This asymmetry is intentional: you want to store all prefixes in the index, but at search time you want to match the user's typed prefix as-is against those stored tokens.

With the index configured to handle prefix matching, the query below adds a second layer: it boosts documents by their historical score and applies a time-decay so that recently trending queries rank higher than equally popular but older ones.

```json
// Query: prefix "java v" with boost for recency
{
  "query": {
    "function_score": {
      "query": { "match": { "query": "java v" } },
      "functions": [
        { "field_value_factor": { "field": "score", "modifier": "log1p", "factor": 1 } },
        {
          "gauss": {
            "updated_at": { "origin": "now", "scale": "7d", "decay": 0.5 }
          }
        }
      ],
      "boost_mode": "multiply"
    }
  },
  "size": 5
}
```

The `gauss` decay function is what makes trending queries surface quickly: a query updated today gets a decay score of 1.0, while a query updated 7 days ago gets a score of 0.5 (`decay` parameter), and 14 days ago about 0.25. Multiplied by the frequency score, this ensures a viral query can jump from page 3 to position 1 within hours of spiking.

## Distributed Architecture

With the core search logic defined, the architecture adds a caching layer in front of Elasticsearch. This is not optional: at 115,000 queries per second, Elasticsearch would need hundreds of nodes to handle the full load. Caching popular prefixes in Redis and CDN reduces the load Elasticsearch actually sees to a small fraction of total traffic.

```
Client                CDN                 API          Redis          Elasticsearch
  │                    │                   │              │                │
  ├─ type "j" ────────►├─── cache hit? ────►│              │                │
  │                    │    YES: return     │              │                │
  │◄────── ["java"]────┤                   │              │                │
  │                    │                   │              │                │
  ├─ type "ja" ───────►├─── miss ──────────►├─ get("ja") ─►│                │
  │                    │                   │◄─ ["java"] ──┤                │
  │◄─ ["java", "java"] ┤◄───────────────────┤              │                │
  │                    │                   │              │                │
  ├─ type "jav" ──────►├─── miss ──────────►├─ miss ───────►├─ search("jav")►│
  │                    │                   │◄─────────────────────────────┤
  │◄─ [suggestions] ───┤◄───────────────────┤              │                │
```

**Caching strategy:**
- CDN (CloudFront): Cache responses for common prefixes ("a", "th", "he" — ~80% of traffic)
- Redis: Cache prefix → suggestions with 5-minute TTL
- Cache key: `suggest:{lang}:{prefix}` (normalize: lowercase, trim)

The short 5-minute TTL in Redis is deliberate: it ensures that trending queries — which your pipeline updates every minute — propagate to users within 5 minutes of spiking, even for cached prefixes. A longer TTL would make the system more cache-efficient but less responsive to trends.

```java
@Service
public class AutocompleteService {

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private ElasticsearchClient es;

    public List<String> suggest(String prefix, String locale) {
        String normalized = prefix.toLowerCase().trim();
        if (normalized.length() < 2) return Collections.emptyList(); // Min 2 chars

        String cacheKey = "suggest:" + locale + ":" + normalized;
        String cached = redis.opsForValue().get(cacheKey);

        if (cached != null) {
            return objectMapper.readValue(cached, List.class);
        }

        List<String> suggestions = searchElasticsearch(normalized, locale);

        redis.opsForValue().set(cacheKey, objectMapper.writeValueAsString(suggestions),
            Duration.ofMinutes(5));

        return suggestions;
    }
}
```

The minimum prefix length of 2 characters is a practical optimization: single-character prefixes like "a" or "t" would match millions of queries and are too ambiguous to be useful, while their cache entries would occupy disproportionate memory. By skipping them, you eliminate a class of expensive queries with low signal.

## Keeping Suggestions Fresh: Real-Time Updates

With the serving layer in place, you need a pipeline that continuously feeds new query data back into the index. The challenge is balancing freshness (how quickly a viral query appears) against noise (a query that spikes once due to a bot should not permanently pollute the index).

Query logs are processed to update suggestion scores:

```
Pipeline:
  User searches → App logs query → Kafka topic "search-queries"
      → Flink/Spark aggregation (5-minute windows)
      → Top queries with updated scores
      → Update Elasticsearch + rebuild Redis cache

Frequency:
  Trend detection: 1-minute windows (detect viral queries immediately)
  Full re-rank: 10-minute windows (stabilize rankings)
  Full index rebuild: Daily (garbage collect dead queries)
```

The three-tier frequency schedule is the key design insight here: 1-minute windows for trend detection mean a breaking news query surfaces within 60 seconds, while the daily full rebuild prunes queries that trended briefly and are now dead weight in the index.

```java
// Kafka Streams aggregation
KStream<String, SearchEvent> searches = builder.stream("search-queries");

KTable<String, Long> queryCounts = searches
    .groupBy((key, event) -> event.getNormalizedQuery())
    .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofMinutes(5)))
    .count();

queryCounts.toStream()
    .map((window, count) -> KeyValue.pair(window.key(), count))
    .to("query-scores", Produced.with(Serdes.String(), Serdes.Long()));
```

`ofSizeWithNoGrace` is worth understanding: the "no grace period" setting means the window closes immediately at the 5-minute mark and emits its result without waiting for late-arriving events. For autocomplete scoring, this tradeoff is correct — a small number of late events does not materially change query rankings, and lower latency is more valuable than perfect accuracy.

## Personalization

Global suggestions are a strong baseline, but users who have searched for "java concurrency" three times this week should see Java-related completions ranked above unrelated queries. The personalization layer blends a small number of personal suggestions into the global top-5, placing them first so they appear immediately when relevant.

Personal suggestions boost queries from the user's search history:

```java
public List<String> suggestPersonalized(String prefix, String userId) {
    // Blend global suggestions with personal history
    List<String> global = suggest(prefix, "en");

    List<String> personal = userHistoryService.getMatchingHistory(userId, prefix, 3);

    // Merge: personal first (max 2), then global (fill remaining 3)
    return Stream.concat(personal.stream(), global.stream())
        .distinct()
        .limit(5)
        .collect(Collectors.toList());
}
```

Capping personal suggestions at 2 out of 5 ensures the global ranking still dominates. If you let personalization dominate entirely, users in a narrow interest category would see increasingly narrow suggestions, a filter-bubble effect that reduces discovery of new topics.

## Typo Tolerance

Even with perfect indexing and caching, users make typos. Without fuzzy matching, a user typing "jva virtual" would see no suggestions at all. Elasticsearch's built-in `fuzziness` setting handles this by finding documents within a configurable edit distance from the typed query.

Use Elasticsearch's fuzzy matching for queries with typos:

```json
{
  "query": {
    "multi_match": {
      "query": "jva virtual",
      "fields": ["query"],
      "fuzziness": "AUTO",     // 0 edits for 1-2 chars, 1 for 3-5, 2 for 6+
      "prefix_length": 2,      // First 2 chars must match exactly (performance)
      "max_expansions": 50
    }
  }
}
```

The `prefix_length: 2` parameter is a critical performance guard: it tells Elasticsearch that the first two characters must match exactly, which dramatically reduces the search space for fuzzy expansion. Without this, "AUTO" fuzziness on a short query like "jv" could expand to thousands of candidate terms and make every keystroke slow.

The difference between a good autocomplete and a great one is the ranking function. Frequency alone gives stale results. Recency alone gives noisy trending results. The combination — frequency × recency × click-through rate — matches user intent. Instrument your system to measure suggestion acceptance rate and use that signal to continuously improve rankings.
