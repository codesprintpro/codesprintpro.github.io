---
title: "Retrieval Systems for RAG: BM25, Dense Retrieval, Hybrid Search, and Reranking"
description: "How modern retrieval pipelines work: BM25 internals (TF-IDF, k1/b parameters), bi-encoder dense retrieval, why hybrid search beats both individually, Reciprocal Rank Fusion, cross-encoder reranking with ColBERT, HyDE query expansion, chunking strategies, and evaluating retrieval quality with NDCG and Recall@K."
date: "2026-04-08"
category: "AI/ML"
tags: ["retrieval", "bm25", "rag", "hybrid search", "reranking", "colbert", "elasticsearch", "dense retrieval"]
featured: false
affiliateSection: "ai-ml-books"
---

Retrieval is the component that determines whether your RAG system produces accurate answers or confident hallucinations. The LLM is constrained by what you hand it. If the retrieved chunks are wrong, the generation is wrong — and the model will not tell you so. This post dissects the retrieval stack: BM25 internals, dense retrieval with bi-encoders, hybrid search with Reciprocal Rank Fusion, reranking with cross-encoders, chunking tradeoffs, query expansion with HyDE, and how to measure whether any of this is working.

## BM25 Internals

BM25 (Best Match 25) is the ranking function underlying Elasticsearch, Solr, and Lucene. It is a probabilistic model, not a simple count of term occurrences.

The score of document `d` given query `q` with terms `q1...qn` is:

```
score(d, q) = Σ IDF(qi) * [ tf(qi, d) * (k1 + 1) ] / [ tf(qi, d) + k1 * (1 - b + b * |d| / avgdl) ]
```

where:
- `tf(qi, d)` — term frequency of term `qi` in document `d`
- `|d|` — document length in tokens
- `avgdl` — average document length in the corpus
- `k1` — term frequency saturation parameter (typically 1.2–2.0)
- `b` — length normalization parameter (typically 0.75)

**IDF smoothing.** Raw IDF is `log(N / df)` where `N` is total documents and `df` is the number of documents containing the term. BM25 uses a smoothed variant:

```
IDF(q) = log( (N - df + 0.5) / (df + 0.5) + 1 )
```

The `+ 0.5` prevents division by zero and reduces the weight of very common terms without eliminating them entirely. The `+ 1` outside the log keeps IDF positive even when `df > N/2`.

**k1 controls saturation.** Without saturation, a document mentioning a term 100 times would score 100x higher than one mentioning it once. `k1` caps this — as `tf` increases, the numerator and denominator grow at similar rates. At `k1 = 1.2`, a term appearing 10 times contributes roughly 1.7x compared to appearing once, not 10x.

**b controls length normalization.** At `b = 1.0`, retrieval fully normalizes for document length — a term in a 100-word document scores identically to the same term in a 1000-word document. At `b = 0.0`, no normalization occurs. `b = 0.75` is the empirically tuned default: longer documents get a mild penalty, but are not completely equalized with short ones. For domain-specific corpora (e.g., dense technical documentation), lowering `b` toward 0.5 often helps.

**What BM25 is good at:**
- Exact keyword matching
- Named entity retrieval (product codes, error codes, version strings)
- Low-frequency technical terms with no semantic synonyms
- Queries where the user knows the correct terminology

**Where BM25 fails:**
- Semantic paraphrasing: "car" vs "automobile", "fix" vs "resolve"
- Conceptual queries: "how does garbage collection work" against a doc that never says "garbage collection"
- Cross-lingual retrieval

## Dense Retrieval with Bi-Encoders

Dense retrieval encodes both query and document into fixed-size embedding vectors. Retrieval is maximum inner product search (MIPS) over all document embeddings.

The bi-encoder architecture encodes independently:

```python
query_embedding = encoder(query)          # shape: [768]
doc_embedding   = encoder(document)       # shape: [768]
score           = dot(query_embedding, doc_embedding)
```

Because each side is encoded separately, you can pre-compute and index all document embeddings offline. At query time, only the query is encoded — then ANN (Approximate Nearest Neighbor) search finds top-K candidates using HNSW or IVF indexes.

**Training.** Bi-encoders are trained with contrastive loss, typically InfoNCE. For each query, you have one positive document and several negatives (in-batch negatives plus hard negatives mined from BM25 or a weaker model). Hard negatives — documents that are lexically similar but semantically wrong — are critical for training quality.

Models like `sentence-transformers/all-mpnet-base-v2`, `BAAI/bge-large-en-v1.5`, and `intfloat/e5-large-v2` are strong general-purpose bi-encoders. Domain-specific fine-tuning on your corpus almost always improves results.

**Where dense retrieval wins:**
- Semantic similarity without shared vocabulary
- Intent-based queries
- Multilingual retrieval (shared embedding space)
- Paraphrase-rich corpora

**Where it loses to BM25:**
- Rare technical terms not in training distribution
- Out-of-vocabulary tokens (model ID strings, error codes)
- Short queries with critical rare keywords

## Hybrid Search with Reciprocal Rank Fusion

Neither BM25 nor dense retrieval dominates across all query types. Hybrid search combines both rank lists without requiring calibrated scores — which is important because BM25 scores and cosine similarities are on different scales.

**Reciprocal Rank Fusion** converts rankings to scores:

```
RRF_score(d) = Σ_r  1 / (k + rank_r(d))
```

where `k = 60` is the standard constant (empirically reduces sensitivity to high-ranked documents), and `rank_r(d)` is the position of document `d` in ranker `r`.

```python
def reciprocal_rank_fusion(
    rank_lists: list[list[str]],
    k: int = 60
) -> list[tuple[str, float]]:
    """
    rank_lists: list of ranked doc-id lists (each sorted best-first)
    Returns: merged list sorted by descending RRF score
    """
    scores: dict[str, float] = {}
    for ranked in rank_lists:
        for rank, doc_id in enumerate(ranked, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)


# Example
bm25_results  = ["doc_3", "doc_7", "doc_1", "doc_9"]
dense_results = ["doc_7", "doc_2", "doc_3", "doc_5"]

fused = reciprocal_rank_fusion([bm25_results, dense_results])
# doc_7 appears at rank 2 in BM25 and rank 1 in dense -> high RRF score
# doc_3 appears at rank 1 in BM25 and rank 3 in dense -> also high
print(fused[:3])
# [('doc_7', 0.0328), ('doc_3', 0.0317), ('doc_2', 0.0159)]
```

RRF is parameter-free beyond `k` and robust to score magnitude differences. On mixed workloads, hybrid retrieval often beats either BM25-only or dense-only retrieval because it preserves exact-match signals while recovering semantic matches. Measure it on your own corpus, especially if your traffic mixes product codes, logs, documentation, and conversational questions.

## Elasticsearch Hybrid Query

Elasticsearch 8.x supports hybrid search natively via `knn` + `query` combination with RRF:

```python
from elasticsearch import Elasticsearch

client = Elasticsearch("http://localhost:9200")

def hybrid_search(
    query_text: str,
    query_embedding: list[float],
    index: str = "documents",
    top_k: int = 20,
) -> list[dict]:
    response = client.search(
        index=index,
        body={
            "retriever": {
                "rrf": {
                    "retrievers": [
                        {
                            "standard": {
                                "query": {
                                    "multi_match": {
                                        "query": query_text,
                                        "fields": ["content", "title^2"],
                                        "type": "best_fields",
                                    }
                                }
                            }
                        },
                        {
                            "knn": {
                                "field": "embedding",
                                "query_vector": query_embedding,
                                "num_candidates": 100,
                                "k": top_k,
                            }
                        },
                    ],
                    "rank_constant": 60,
                    "window_size": 100,
                }
            },
            "size": top_k,
            "_source": ["id", "content", "title", "chunk_index"],
        },
    )
    return [hit["_source"] for hit in response["hits"]["hits"]]


def index_document_chunk(
    doc_id: str,
    chunk_index: int,
    content: str,
    embedding: list[float],
    index: str = "documents",
) -> None:
    client.index(
        index=index,
        id=f"{doc_id}_{chunk_index}",
        document={
            "id": doc_id,
            "chunk_index": chunk_index,
            "content": content,
            "embedding": embedding,
        },
    )
```

The index mapping must declare `embedding` as a `dense_vector` field with the correct dimension and similarity metric:

```json
{
  "mappings": {
    "properties": {
      "content":    { "type": "text", "analyzer": "english" },
      "title":      { "type": "text", "analyzer": "english" },
      "embedding":  {
        "type":       "dense_vector",
        "dims":       768,
        "index":      true,
        "similarity": "cosine"
      }
    }
  }
}
```

## Chunking Strategies and Their Effect on Retrieval

Chunking is upstream of retrieval and has a larger impact on quality than most practitioners expect.

**Fixed-size chunking.** Split by token count (e.g., 512 tokens) with overlap (e.g., 128 tokens). Simple, predictable. Fails when meaningful units (paragraphs, code blocks) straddle chunk boundaries.

**Sentence-window chunking.** Embed individual sentences but store them with surrounding context. At retrieval time, return the window (e.g., ±2 sentences) rather than the sentence alone. The embedding captures the sentence; the context feeds the LLM.

**Semantic chunking.** Compute embeddings for consecutive sentences and split where cosine similarity drops below a threshold. Keeps topically coherent content together. More expensive but produces cleaner retrieval units.

**Document hierarchy (parent-child).** Index fine-grained child chunks for retrieval (high precision), but return the parent document or section for generation (sufficient context). Llamaindex calls this "parent document retrieval."

```python
import re
from dataclasses import dataclass
from sentence_transformers import SentenceTransformer

@dataclass
class Chunk:
    text: str
    start_char: int
    end_char: int
    embedding: list[float] | None = None


def fixed_size_chunk(text: str, max_tokens: int = 512, overlap: int = 128) -> list[Chunk]:
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + max_tokens, len(words))
        chunk_text = " ".join(words[start:end])
        chunks.append(Chunk(text=chunk_text, start_char=start, end_char=end))
        if end == len(words):
            break
        start = end - overlap
    return chunks


def semantic_chunk(
    text: str,
    model: SentenceTransformer,
    similarity_threshold: float = 0.75,
) -> list[Chunk]:
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    if len(sentences) < 2:
        return [Chunk(text=text, start_char=0, end_char=len(text))]

    embeddings = model.encode(sentences, normalize_embeddings=True)
    chunks, current, start_idx = [], [sentences[0]], 0

    for i in range(1, len(sentences)):
        similarity = float(embeddings[i - 1] @ embeddings[i])
        if similarity >= similarity_threshold:
            current.append(sentences[i])
        else:
            chunks.append(Chunk(
                text=" ".join(current),
                start_char=start_idx,
                end_char=start_idx + len(" ".join(current)),
            ))
            start_idx += len(" ".join(current)) + 1
            current = [sentences[i]]

    if current:
        chunks.append(Chunk(
            text=" ".join(current),
            start_char=start_idx,
            end_char=start_idx + len(" ".join(current)),
        ))
    return chunks
```

Semantic chunking can improve Recall@5 on technical documentation when section boundaries and code blocks matter, at the cost of variable chunk sizes and higher preprocessing time. Treat it as an experiment, not a default. Some corpora work better with boring sentence-window chunking because the structure is predictable and the returned context is easier for the generator to cite.

## Query Expansion with HyDE

HyDE (Hypothetical Document Embeddings) addresses the query-document vocabulary mismatch from the query side. Instead of embedding the raw query, you ask an LLM to generate a hypothetical document that would answer the query, then embed that hypothetical document.

The intuition: a well-formed answer uses the vocabulary and phrasing of real documents. A hypothetical answer embedding is closer in vector space to the actual relevant documents than the question embedding is.

```python
import os

import anthropic
from sentence_transformers import SentenceTransformer

client = anthropic.Anthropic()
embedder = SentenceTransformer("BAAI/bge-large-en-v1.5")
HYDE_MODEL = os.environ.get("HYDE_MODEL", "your-query-expansion-model")


def generate_hypothetical_document(query: str) -> str:
    response = client.messages.create(
        model=HYDE_MODEL,
        max_tokens=200,
        messages=[
            {
                "role": "user",
                "content": (
                    f"Write a concise technical paragraph (100-150 words) that directly "
                    f"answers the following question. Write as if it appears in technical "
                    f"documentation. Do not reference the question.\n\nQuestion: {query}"
                ),
            }
        ],
    )
    return response.content[0].text.strip()


def hyde_embedding(query: str) -> list[float]:
    hypothetical_doc = generate_hypothetical_document(query)
    embedding = embedder.encode(hypothetical_doc, normalize_embeddings=True)
    return embedding.tolist()


# In the retrieval pipeline:
# Instead of: embedding = embedder.encode(query)
# Use:        embedding = hyde_embedding(query)
```

HyDE adds one LLM call per query, so it is not free. It can improve dense retrieval for short or ambiguous queries because the hypothetical answer contains richer domain vocabulary than the raw user question. The gain is usually smaller for already well-formed queries, and it may hurt if the generated hypothetical document invents the wrong domain context. Put HyDE behind an experiment flag and compare Recall@K, NDCG@K, latency, and cost before rolling it out to all traffic.

## Reranking with Cross-Encoders

First-stage retrieval (BM25 or bi-encoder) is fast but approximate. A cross-encoder reranker takes the query and each candidate document as a joint input, producing a precise relevance score.

```
score = cross_encoder([query, document])  # full attention between both
```

Because both are processed together with full attention, cross-encoders capture fine-grained interactions that bi-encoders miss. They are too slow for full-corpus search (no pre-computation) but tractable for reranking 20–100 candidates.

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2", max_length=512)


def rerank(
    query: str,
    candidates: list[dict],
    content_field: str = "content",
    top_k: int = 5,
) -> list[dict]:
    if not candidates:
        return []

    pairs = [(query, doc[content_field]) for doc in candidates]
    scores = reranker.predict(pairs)

    ranked = sorted(
        zip(candidates, scores),
        key=lambda x: x[1],
        reverse=True,
    )
    return [doc for doc, _ in ranked[:top_k]]


def full_retrieval_pipeline(
    query: str,
    index: str = "documents",
    first_stage_k: int = 20,
    rerank_top_k: int = 5,
) -> list[dict]:
    # Stage 1: Embed query (optionally with HyDE)
    query_embedding = embedder.encode(query, normalize_embeddings=True).tolist()

    # Stage 2: Hybrid retrieval (BM25 + dense via RRF)
    candidates = hybrid_search(
        query_text=query,
        query_embedding=query_embedding,
        index=index,
        top_k=first_stage_k,
    )

    # Stage 3: Cross-encoder reranking
    reranked = rerank(query=query, candidates=candidates, top_k=rerank_top_k)
    return reranked
```

**MS-MARCO models** (MiniLM, MiniLM-L-12, Electra) are trained on 500K+ query-passage pairs and are the standard starting point for English reranking.

**ColBERT** takes a different approach — late interaction. Instead of collapsing each document to a single vector, ColBERT stores one embedding per token. At query time, it computes the MaxSim operator: for each query token, find the maximum similarity to any document token, then sum across query tokens.

```
score(q, d) = Σ_{qi ∈ q}  max_{dj ∈ d}  qi · dj
```

ColBERT is more expressive than bi-encoders and faster than cross-encoders because document embeddings are pre-computed at the token level. The cost is storage: a 512-token document at 128 dimensions requires 512 × 128 × 4 bytes ≈ 256 KB per document. ColBERTv2 addresses this with residual compression. For retrieval-focused deployments, ColBERT via the RAGatouille library is worth evaluating.

## Evaluating Retrieval Quality

Generating answers is not retrieval evaluation. You need to measure whether the correct documents are being retrieved before the LLM sees them.

**Recall@K.** Fraction of relevant documents appearing in top-K results. For RAG, Recall@5 or Recall@10 is the primary signal — if the answer is not in the top-K, the LLM cannot generate it.

**NDCG@K** (Normalized Discounted Cumulative Gain). Accounts for rank position. A relevant document at rank 1 contributes more than one at rank 5.

```
DCG@K  = Σ_{i=1}^{K}  rel_i / log2(i + 1)
NDCG@K = DCG@K / IDCG@K          # IDCG: ideal ordering
```

**MRR** (Mean Reciprocal Rank). Average of `1 / rank_of_first_relevant_document`. Useful when you care about whether the top result is correct.

```python
def recall_at_k(retrieved_ids: list[str], relevant_ids: set[str], k: int) -> float:
    retrieved_k = set(retrieved_ids[:k])
    if not relevant_ids:
        return 0.0
    return len(retrieved_k & relevant_ids) / len(relevant_ids)


def ndcg_at_k(retrieved_ids: list[str], relevant_ids: set[str], k: int) -> float:
    import math

    def dcg(ids: list[str]) -> float:
        return sum(
            (1.0 / math.log2(i + 2))
            for i, doc_id in enumerate(ids[:k])
            if doc_id in relevant_ids
        )

    ideal_hits = min(len(relevant_ids), k)
    ideal_dcg = sum(1.0 / math.log2(i + 2) for i in range(ideal_hits))
    if ideal_dcg == 0:
        return 0.0
    return dcg(retrieved_ids) / ideal_dcg


def mrr(retrieved_ids: list[str], relevant_ids: set[str]) -> float:
    for rank, doc_id in enumerate(retrieved_ids, start=1):
        if doc_id in relevant_ids:
            return 1.0 / rank
    return 0.0


def evaluate_retrieval(
    test_cases: list[dict],   # [{"query": ..., "relevant_ids": [...], "retrieved_ids": [...]}]
    k: int = 5,
) -> dict[str, float]:
    recalls, ndcgs, mrrs = [], [], []
    for case in test_cases:
        relevant = set(case["relevant_ids"])
        retrieved = case["retrieved_ids"]
        recalls.append(recall_at_k(retrieved, relevant, k))
        ndcgs.append(ndcg_at_k(retrieved, relevant, k))
        mrrs.append(mrr(retrieved, relevant))

    return {
        f"Recall@{k}": round(sum(recalls) / len(recalls), 4),
        f"NDCG@{k}":   round(sum(ndcgs)   / len(ndcgs),   4),
        "MRR":         round(sum(mrrs)     / len(mrrs),    4),
    }
```

Build a labeled evaluation set from your actual domain — 100–500 query/relevant-document pairs. Use this before and after any change to the retrieval pipeline. If you cannot build labeled data manually, use an LLM to generate synthetic query-document pairs from your corpus, then validate a sample.

## Production Failure Modes

Retrieval bugs are often invisible because the answer still looks fluent. Build checks around the places where the pipeline can quietly drift.

**Stale indexes.** The document store has the latest content, but the vector index still serves old chunks. Track `source_updated_at`, `indexed_at`, and `embedding_model_version` on every chunk. Alert when indexing lag crosses your freshness target.

**Embedding model mismatch.** Query embeddings are generated with one model version while document embeddings were generated with another. This usually happens during partial rollouts. Store the embedding model name and version in the index, and reject mixed versions unless you intentionally support multiple indexes.

**Chunk ID drift.** Re-chunking a document changes chunk IDs, but citations or cached answers still point to old IDs. Use stable source document IDs plus deterministic chunk positions, or write a migration that invalidates caches after re-chunking.

**Duplicate chunks.** Re-ingestion without idempotency creates repeated chunks that dominate top-K. Use deterministic chunk IDs like `{source_id}:{chunk_hash}` and upsert instead of blind insert.

**ACL filtering after retrieval.** If you retrieve top-20 globally and then remove documents the user cannot access, you may end with too few context chunks. Apply access filters during retrieval whenever the search backend supports it. If not, retrieve a larger candidate window and enforce a minimum post-filter count.

**Citation mismatch.** The LLM cites a source title from metadata but the answer came from a different chunk. Keep source URL, title, section heading, and chunk ID together through the entire pipeline. Do not let the generation layer reconstruct citations from free-form text.

**Token budget overflow.** Good chunks are retrieved, but later chunks are dropped because the prompt exceeds the context budget. Rerank before truncation, compress long chunks, and reserve prompt space for instructions plus the user question.

**Evaluation leakage.** Synthetic eval queries can accidentally mirror chunk text too closely, making retrieval look better than it is. Keep a small manually reviewed eval set and add real failed production queries as they appear.

```python
def validate_retrieval_batch(results: list[dict], min_chunks: int = 3) -> None:
    """
    Lightweight production guardrail after filtering and reranking.
    Raise before generation when retrieval is clearly unsafe.
    """
    if len(results) < min_chunks:
        raise ValueError("retrieval returned too few usable chunks")

    seen_chunk_ids = set()
    for result in results:
        required = ["chunk_id", "source_id", "title", "content", "embedding_model_version"]
        missing = [field for field in required if not result.get(field)]
        if missing:
            raise ValueError(f"retrieval result missing metadata: {missing}")

        chunk_id = result["chunk_id"]
        if chunk_id in seen_chunk_ids:
            raise ValueError(f"duplicate chunk returned: {chunk_id}")
        seen_chunk_ids.add(chunk_id)
```

## Putting It Together

The production retrieval pipeline for a RAG system looks like this:

1. **Ingestion**: chunk documents (semantic or sentence-window), compute embeddings, index in Elasticsearch with both `text` and `dense_vector` fields.
2. **Query time**: optionally apply HyDE to expand the query; run hybrid BM25 + KNN with RRF; retrieve top-20 candidates.
3. **Reranking**: pass candidates through a cross-encoder; return top-5.
4. **Generation**: pass reranked chunks as context to the LLM with citation references.
5. **Evaluation**: track Recall@5 and NDCG@5 on your labeled set; run regression checks on every pipeline change.

The right configuration depends on your query distribution. If users query with exact technical terminology, BM25 weight matters more. If queries are conversational, dense retrieval and HyDE matter more. Measure on your data.

## Key Takeaways

- BM25's `k1` and `b` parameters are tunable — benchmark your corpus before accepting defaults.
- Dense retrieval fails on rare keywords; BM25 fails on semantic paraphrasing — hybrid with RRF reliably outperforms either alone.
- RRF requires no score calibration and is robust across result list lengths.
- Cross-encoder reranking on 20–100 candidates often adds meaningful quality, but latency depends on model size, hardware, batch size, candidate count, and max sequence length.
- Chunking strategy has a first-order effect on retrieval quality; semantic chunking, sentence-window chunking, and parent-child retrieval should be evaluated against your corpus.
- HyDE improves dense retrieval for short or ambiguous queries at the cost of one LLM call.
- Measure Recall@K before optimizing generation — retrieval failures are silent and fatal.

## Read Next

- [Building a RAG System with LangChain](/blog/building-rag-system-langchain/)
- [Vector Embeddings Deep Dive](/blog/vector-embeddings-deep-dive/)
- [LLM Evaluation at Scale](/blog/llm-evaluation-at-scale/)
- [AI Infrastructure on AWS](/blog/ai-infrastructure-aws/)
