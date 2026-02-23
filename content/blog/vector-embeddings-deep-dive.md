---
title: "Vector Embeddings: The Foundation of Modern AI Applications"
description: "Understand vector embeddings, similarity search, and vector databases. Build semantic search, recommendation systems, and RAG pipelines using pgvector, Pinecone, and OpenAI embeddings."
date: "2025-03-11"
category: "AI/ML"
tags: ["ai", "embeddings", "vector database", "semantic search", "rag", "pgvector", "pinecone"]
featured: false
affiliateSection: "ai-ml-books"
---

Every modern AI application — semantic search, RAG, recommendations, duplicate detection — is built on vector embeddings. An embedding converts text, images, or audio into a point in high-dimensional space where semantically similar items are geometrically close. This geometric property is what powers "find me articles about machine learning" returning results that match the concept, not the exact words.

## What Are Embeddings?

Before diving into code, here is the intuition: imagine placing every piece of text you have ever written onto a map, where texts that mean similar things end up in the same neighborhood. "Machine learning" and "neural networks" would be a few blocks apart; "machine learning" and "cooking recipes" would be in different cities. An embedding model learns to draw this map by training on billions of examples of which texts are semantically related. The diagram below shows concretely what changes between traditional keyword search and this map-based approach.

```
Traditional keyword search:
  Query: "machine learning"
  Matches: "machine learning", "Machine Learning", "MACHINE LEARNING"
  Does NOT match: "neural networks", "deep learning", "AI algorithms"

Embedding-based semantic search:
  Query: "machine learning"
  Matches: "machine learning", "neural networks", "deep learning",
           "AI algorithms", "gradient descent", "model training"
  Based on: meaning, not string matching

How:
  "machine learning" → [0.23, -0.45, 0.12, 0.89, ...] (1536 dimensions)
  "neural networks"  → [0.21, -0.43, 0.15, 0.87, ...] (similar vector!)
  "cooking recipes"  → [-0.67, 0.34, -0.89, 0.12, ...] (very different vector)

  Cosine similarity("machine learning", "neural networks") = 0.94 (very similar)
  Cosine similarity("machine learning", "cooking recipes") = 0.12 (unrelated)
```

Each dimension captures some aspect of meaning — not interpretable individually, but the ensemble encodes semantic relationships learned from billions of text examples.

## Generating Embeddings

Now you can see how to generate these vectors in practice. The `cosine_similarity` function at the bottom is the mathematical equivalent of measuring how close two points are on your semantic map — a score near 1.0 means the texts are neighbors, near 0 means they are unrelated.

```python
# OpenAI text-embedding-3-small (best cost/performance ratio)
from openai import OpenAI
import numpy as np

client = OpenAI()

def embed(text: str) -> list[float]:
    """Generate embedding for a single text."""
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=text,
        encoding_format="float"
    )
    return response.data[0].embedding

def embed_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for multiple texts in one API call."""
    # Batch up to 2048 texts per request
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=texts
    )
    return [item.embedding for item in sorted(response.data, key=lambda x: x.index)]

# Dimensions: text-embedding-3-small = 1536, text-embedding-3-large = 3072
# Cost: $0.02 per million tokens (very cheap)

# Cosine similarity
def cosine_similarity(a: list[float], b: list[float]) -> float:
    a, b = np.array(a), np.array(b)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

# Example:
e1 = embed("Java virtual threads")
e2 = embed("Java lightweight concurrency")
e3 = embed("Python web scraping")

print(cosine_similarity(e1, e2))  # ~0.92 (highly similar)
print(cosine_similarity(e1, e3))  # ~0.45 (unrelated)
```

The results show exactly why embeddings are useful: "Java virtual threads" and "Java lightweight concurrency" score 0.92 even though they share only the word "Java" — the model understood they describe the same concept. A score of 0.45 for the Python web scraping comparison confirms they are semantically unrelated despite being in the same programming domain.

## Vector Databases: Efficient Similarity Search

Brute-force cosine similarity over 1M vectors takes seconds. Vector databases use ANN (Approximate Nearest Neighbor) algorithms to answer "find 10 most similar vectors" in milliseconds.

The tradeoff here is precision for speed: an ANN index might miss the single most-similar vector 1-2% of the time, but it answers in under 10ms instead of several seconds. For search applications, that tradeoff is almost always worth it — your users will not notice the occasional near-miss, but they will absolutely notice a slow response.

### Option 1: pgvector (PostgreSQL Extension)

Best for: existing PostgreSQL users, < 10M vectors, want SQL joins with similarity search.

If you are already running PostgreSQL, pgvector is a compelling choice because it lets you combine similarity search with all the power of SQL — you can filter by category, join against user tables, or run aggregations alongside your vector queries without managing a separate service.

```sql
-- Install pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Table: blog articles with embeddings
CREATE TABLE articles (
    id          BIGSERIAL PRIMARY KEY,
    slug        VARCHAR(200) UNIQUE NOT NULL,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    category    VARCHAR(50),
    embedding   vector(1536),    -- OpenAI text-embedding-3-small dimensions
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- IVFFlat index: fast approximate search
-- lists = sqrt(total_rows) is a good starting point
CREATE INDEX idx_articles_embedding ON articles
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- HNSW index (PostgreSQL 15+): better recall, more memory
CREATE INDEX idx_articles_embedding_hnsw ON articles
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Semantic search query
SELECT
    id,
    title,
    category,
    1 - (embedding <=> '[0.23, -0.45, 0.12, ...]'::vector) AS similarity
FROM articles
WHERE category = 'System Design'           -- Filter BEFORE similarity (important!)
ORDER BY embedding <=> '[0.23, ...]'::vector  -- <=> = cosine distance
LIMIT 10;

-- Operators:
-- <=>  cosine distance (use for text — normalized vectors)
-- <->  Euclidean distance
-- <#>  negative inner product (use if vectors are normalized)
```

Notice the comment "Filter BEFORE similarity (important!)". Applying your `WHERE category = 'System Design'` filter before the vector search dramatically reduces the number of vectors the index needs to scan, giving you both faster queries and more relevant results.

```python
# Python + pgvector
import psycopg2
import numpy as np

def search_similar_articles(
    query: str,
    category: str | None = None,
    limit: int = 5
) -> list[dict]:
    query_embedding = embed(query)

    sql = """
        SELECT id, title, category, slug,
               1 - (embedding <=> %s::vector) AS similarity
        FROM articles
        WHERE 1=1
    """
    params = [str(query_embedding)]

    if category:
        sql += " AND category = %s"
        params.append(category)

    sql += " ORDER BY embedding <=> %s::vector LIMIT %s"
    params.extend([str(query_embedding), limit])

    with psycopg2.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [
                {"id": r[0], "title": r[1], "category": r[2],
                 "slug": r[3], "similarity": r[4]}
                for r in cur.fetchall()
            ]
```

### Option 2: Pinecone (Managed Vector Database)

Best for: > 10M vectors, need managed scaling, serverless pricing.

When your vector count grows into the tens of millions or you need zero-ops infrastructure, Pinecone removes the burden of tuning index parameters, managing shards, and handling node failures. The code below shows the same semantic search capability as pgvector, but backed by a fully managed service.

```python
from pinecone import Pinecone, ServerlessSpec

pc = Pinecone(api_key="your-api-key")

# Create index
pc.create_index(
    name="articles",
    dimension=1536,
    metric="cosine",
    spec=ServerlessSpec(cloud="aws", region="us-east-1")
)

index = pc.Index("articles")

# Upsert vectors with metadata
def index_article(article: dict):
    embedding = embed(article["title"] + "\n\n" + article["content"])
    index.upsert(vectors=[{
        "id": article["slug"],
        "values": embedding,
        "metadata": {
            "title": article["title"],
            "category": article["category"],
            "created_at": article["created_at"]
        }
    }])

# Query with metadata filtering
def search(query: str, category: str | None = None, top_k: int = 5):
    query_embedding = embed(query)

    filter_dict = {}
    if category:
        filter_dict["category"] = {"$eq": category}

    results = index.query(
        vector=query_embedding,
        top_k=top_k,
        filter=filter_dict if filter_dict else None,
        include_metadata=True
    )

    return [
        {
            "id": match.id,
            "score": match.score,
            **match.metadata
        }
        for match in results.matches
    ]
```

## Hybrid Search: Combining Keyword and Semantic

Pure semantic search misses exact keyword matches. Pure keyword search misses semantic matches. Hybrid search combines both.

Consider a user searching for a specific API endpoint like `POST /api/v2/users/reset-password`. Pure semantic search might return conceptually related content about authentication but miss this exact path. Pure keyword search finds the path but misses related documentation. Reciprocal Rank Fusion (RRF) below solves this by merging the two ranked lists into a single score that rewards items that rank well in both.

```python
# Reciprocal Rank Fusion (RRF) — combine two result lists
def hybrid_search(query: str, k: int = 5) -> list[dict]:
    # 1. Semantic search via vector similarity
    semantic_results = search_similar_articles(query, limit=20)

    # 2. Keyword search via PostgreSQL full-text search
    keyword_results = keyword_search(query, limit=20)

    # 3. Merge using RRF: score = sum(1 / (rank + 60))
    scores: dict[str, float] = {}
    RRF_K = 60

    for rank, result in enumerate(semantic_results):
        scores[result["slug"]] = scores.get(result["slug"], 0) + 1 / (rank + RRF_K)

    for rank, result in enumerate(keyword_results):
        scores[result["slug"]] = scores.get(result["slug"], 0) + 1 / (rank + RRF_K)

    # Sort by combined score
    all_slugs = {r["slug"]: r for r in semantic_results + keyword_results}
    return sorted(
        [all_slugs[slug] for slug in scores],
        key=lambda x: scores[x["slug"]],
        reverse=True
    )[:k]
```

The constant `RRF_K = 60` dampens the influence of rank position — an item ranked 1st gets score `1/61 ≈ 0.016`, while an item ranked 61st gets `1/121 ≈ 0.008`. This prevents a very high-ranked result in one list from dominating the combined score and means results that appear in both lists consistently float to the top.

## Embeddings for RAG (Retrieval-Augmented Generation)

With embeddings and similarity search in place, you have all the pieces needed to build a complete RAG pipeline. The four steps below — embed the question, retrieve matching chunks, assemble context, and answer with an LLM — are the core loop that powers every document Q&A system. Notice that the LLM is explicitly instructed to only use the retrieved context and to cite sources, which is what prevents hallucination.

```python
# Complete RAG pipeline: question → retrieve context → answer with LLM
from anthropic import Anthropic

anthropic_client = Anthropic()

def rag_answer(question: str) -> str:
    # Step 1: Embed the question
    question_embedding = embed(question)

    # Step 2: Retrieve relevant chunks from knowledge base
    relevant_chunks = search_similar_articles(
        question,
        limit=5  # Top 5 most relevant articles/chunks
    )

    # Step 3: Build context from retrieved chunks
    context = "\n\n---\n\n".join([
        f"Title: {chunk['title']}\n{chunk['content']}"
        for chunk in relevant_chunks
    ])

    # Step 4: Answer with LLM using retrieved context
    response = anthropic_client.messages.create(
        model="claude-opus-4-6",
        max_tokens=1024,
        system="""You are a technical assistant. Answer questions using ONLY
        the provided context. If the answer isn't in the context, say so.
        Cite the specific articles you're drawing from.""",
        messages=[{
            "role": "user",
            "content": f"Context:\n{context}\n\nQuestion: {question}"
        }]
    )

    return response.content[0].text
```

## Chunking Strategy: Critical for RAG Quality

How you split documents before embedding them is arguably more important than which embedding model you choose. A chunk that cuts a sentence in half, or that lumps together five unrelated paragraphs, produces an embedding that represents nothing clearly — and no similarity search can recover useful signal from a bad embedding.

```python
# Bad: chunk by fixed character count (breaks mid-sentence)
def bad_chunking(text: str, chunk_size: int = 1000) -> list[str]:
    return [text[i:i+chunk_size] for i in range(0, len(text), chunk_size)]

# Good: chunk by semantic units (paragraphs, sections)
def good_chunking(markdown_text: str, max_chunk_size: int = 800) -> list[str]:
    chunks = []
    current_chunk = []
    current_size = 0

    for paragraph in markdown_text.split("\n\n"):
        paragraph = paragraph.strip()
        if not paragraph:
            continue

        if current_size + len(paragraph) > max_chunk_size and current_chunk:
            chunks.append("\n\n".join(current_chunk))
            current_chunk = [paragraph]
            current_size = len(paragraph)
        else:
            current_chunk.append(paragraph)
            current_size += len(paragraph)

    if current_chunk:
        chunks.append("\n\n".join(current_chunk))

    return chunks

# Best: sliding window with overlap (maintains context at boundaries)
def sliding_window_chunks(text: str, chunk_size: int = 800, overlap: int = 200) -> list[str]:
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk_words = words[i:i + chunk_size]
        chunks.append(" ".join(chunk_words))
        i += chunk_size - overlap  # Overlap keeps context between chunks
    return chunks
```

The `overlap` parameter in the sliding window approach is doing critical work: it ensures that a sentence split across the boundary between chunk N and chunk N+1 appears fully in at least one of them. Without overlap, every boundary is a potential context loss point that will silently degrade your retrieval quality.

## Dimensionality Reduction for Visualization

Once you have a collection of embeddings, visualizing them is one of the fastest ways to build intuition about your data and validate that your embedding model is working correctly. If the visualization shows random scatter with no clustering by category, that is a signal your embeddings are not capturing the semantic distinctions you care about.

```python
# Visualize your embedding space to understand clustering
import plotly.express as px
from sklearn.manifold import TSNE

# Generate embeddings for a set of articles
articles = fetch_articles()
embeddings = embed_batch([a["title"] for a in articles])

# Reduce 1536D → 2D for visualization (t-SNE)
tsne = TSNE(n_components=2, random_state=42, perplexity=30)
coords_2d = tsne.fit_transform(np.array(embeddings))

# Plot
df = pd.DataFrame({
    "x": coords_2d[:, 0],
    "y": coords_2d[:, 1],
    "title": [a["title"] for a in articles],
    "category": [a["category"] for a in articles]
})

fig = px.scatter(df, x="x", y="y", color="category",
                 hover_data=["title"], title="Article Embedding Space")
fig.show()
# You'll see: System Design articles cluster together, Java articles cluster,
# AI/ML articles cluster — semantic proximity is visible
```

The insight that unlocks vector embeddings: you're not searching text anymore — you're searching a semantic space where proximity equals meaning. Once you build intuition for what's close vs far in embedding space, you'll see applications everywhere: deduplication, content recommendations, anomaly detection, and anything that requires "find similar things." The math is straightforward; the power comes from applying it to the right problems.
