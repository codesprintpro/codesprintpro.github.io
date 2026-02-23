---
title: "Building a Production RAG System: Embeddings, Vector DBs, and Retrieval"
description: "A practical guide to building a Retrieval-Augmented Generation system — from chunking strategies and embedding models to vector databases, retrieval optimization, and avoiding hallucinations."
date: "2025-02-12"
category: "AI/ML"
tags: ["ai", "llm", "rag", "langchain", "vector database", "embeddings"]
featured: true
affiliateSection: "ai-ml-books"
---

Retrieval-Augmented Generation (RAG) is the most practical technique for making LLMs useful on your private data. Instead of hoping the model memorizes your documents during training (it doesn't), RAG retrieves relevant context at query time and injects it into the prompt. The model reasons over retrieved facts rather than hallucinated ones.

Getting RAG to work in a notebook demo is easy. Getting it to work reliably in production — with accurate retrieval, consistent quality, and measurable performance — requires understanding every component in the pipeline.

## Why RAG, Not Fine-Tuning?

| Approach | When to Use | Cost | Freshness |
|---|---|---|---|
| **RAG** | Dynamic data, factual Q&A, large corpora | Low compute, storage cost | Real-time updates |
| **Fine-tuning** | Style/tone transfer, format adherence, domain jargon | High GPU cost, retraining | Snapshot in time |
| **Context stuffing** | <128K tokens, structured data | API cost (tokens) | Real-time |
| **RAG + Fine-tuning** | Best factual recall + domain style | High | Real-time |

For most enterprise use cases — internal knowledge bases, documentation Q&A, customer support — RAG is the right tool.

## The RAG Pipeline

Think of the RAG pipeline as two separate workflows: an offline ingestion phase where you prepare and index your documents, and an online query phase where you look up relevant information to answer each user question. Understanding this separation helps you optimize each phase independently.

```
Ingestion Pipeline (offline):
  Documents → Chunker → Embedder → Vector DB

Query Pipeline (online):
  Question → Embedder → Vector DB → [Top-K chunks] → LLM → Answer

Full flow:
  ┌──────────┐   ┌──────────┐   ┌────────────┐   ┌──────────────┐
  │ Document │──►│  Chunk   │──►│  Embed     │──►│  Vector DB   │
  │ (PDF,    │   │  Split   │   │  (OpenAI,  │   │  (Pinecone,  │
  │  DOCX,   │   │          │   │  Cohere)   │   │  ChromaDB,   │
  │  HTML)   │   └──────────┘   └────────────┘   │  pgvector)   │
  └──────────┘                                    └──────┬───────┘
                                                         │ similarity
  ┌──────────┐   ┌──────────┐   ┌────────────┐         │ search
  │  Answer  │◄──│   LLM    │◄──│  Prompt    │◄────────┘
  │          │   │ (GPT-4,  │   │  Template  │  Top-K chunks
  └──────────┘   │  Claude) │   └────────────┘
                 └──────────┘
```

## Step 1: Document Loading and Chunking

Chunking is the most underappreciated step. Bad chunking breaks context across meaningful boundaries, and no retrieval algorithm can recover from that.

Your goal with chunking is to create pieces of text that are self-contained enough to answer a question on their own, while staying small enough to be precise when retrieved. The code below demonstrates three strategies — from the simplest recursive split to the most sophisticated semantic approach — so you can pick the right tool for your document type.

```python
from langchain.document_loaders import PyPDFLoader, DirectoryLoader
from langchain.text_splitter import (
    RecursiveCharacterTextSplitter,
    MarkdownHeaderTextSplitter,
)

# Load documents
loader = DirectoryLoader("./docs", glob="**/*.pdf", loader_cls=PyPDFLoader)
raw_docs = loader.load()

# Strategy 1: Recursive character splitting (most robust for mixed content)
# Tries to split on: paragraphs → sentences → words → characters
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,      # Characters per chunk
    chunk_overlap=200,    # Overlap to preserve context across boundaries
    separators=["\n\n", "\n", ". ", " ", ""],
)
chunks = text_splitter.split_documents(raw_docs)

# Strategy 2: Markdown-aware splitting (for structured docs)
# Respects heading hierarchy — chunks stay within sections
md_splitter = MarkdownHeaderTextSplitter(
    headers_to_split_on=[
        ("#", "h1"),
        ("##", "h2"),
        ("###", "h3"),
    ],
    strip_headers=False,  # Keep headers in chunk for context
)

# Strategy 3: Semantic chunking (most accurate, slower)
# Groups sentences by embedding similarity — no arbitrary character limits
from langchain_experimental.text_splitter import SemanticChunker
from langchain_openai import OpenAIEmbeddings

semantic_splitter = SemanticChunker(
    OpenAIEmbeddings(),
    breakpoint_threshold_type="percentile",  # Split at 95th percentile of similarity drop
    breakpoint_threshold_amount=95,
)
```

Notice that the `chunk_overlap=200` parameter is doing important work here: it ensures that a sentence split across two chunks appears in both, so neither chunk loses critical context at its boundary.

**Chunking guidelines from production experience:**
- **500-1000 characters** for Q&A over prose documents
- **1500-2000 characters** for code documentation (preserve function context)
- **200 character overlap** to prevent context loss at boundaries
- **Metadata preservation** is critical: always keep source URL, page number, section header

## Step 2: Embedding Models

Embeddings convert text to vectors — numerical representations where semantically similar text clusters together in high-dimensional space.

Think of an embedding as a sophisticated "fingerprint" for meaning: two sentences that say the same thing in different words will have nearly identical fingerprints, while two sentences about completely different topics will have fingerprints that bear no resemblance to each other. The code below shows how to generate these fingerprints using three different providers, each with different cost and performance tradeoffs.

```python
from langchain_openai import OpenAIEmbeddings
from langchain_community.embeddings import HuggingFaceEmbeddings

# Option 1: OpenAI text-embedding-3-small (recommended for most use cases)
# Dimensions: 1536, Cost: $0.02/1M tokens
# Strong multilingual support, easy integration
embeddings = OpenAIEmbeddings(model="text-embedding-3-small")

# Option 2: Open-source via HuggingFace (no API cost, self-hosted)
# BAAI/bge-large-en-v1.5: Strong English performance, competitive with OpenAI
embeddings = HuggingFaceEmbeddings(
    model_name="BAAI/bge-large-en-v1.5",
    model_kwargs={"device": "cpu"},
    encode_kwargs={"normalize_embeddings": True},
)

# Option 3: Cohere embed-english-v3.0
# Better at distinguishing search queries from documents (trained with input_type)
from langchain_cohere import CohereEmbeddings
embeddings = CohereEmbeddings(
    model="embed-english-v3.0",
    input_type="search_query",  # Or "search_document" for indexing
)
```

Pay attention to the `input_type` parameter in the Cohere example — this is a subtle but powerful feature. Cohere trains the model to understand that a short user question and a long document passage are answering the same semantic question from different sides, which improves retrieval quality compared to treating both identically.

**Embedding model comparison (MTEB benchmark, 2024):**

| Model | MTEB Score | Dimensions | Cost |
|---|---|---|---|
| OpenAI text-embedding-3-large | 64.6 | 3072 | $0.13/1M tokens |
| Cohere embed-english-v3.0 | 64.5 | 1024 | $0.10/1M tokens |
| BAAI/bge-large-en-v1.5 | 63.5 | 1024 | Free (self-hosted) |
| OpenAI text-embedding-3-small | 62.3 | 1536 | $0.02/1M tokens |

For most production RAG systems, `text-embedding-3-small` or `bge-large-en-v1.5` provides the best cost/performance tradeoff.

## Step 3: Vector Databases

Once your documents are embedded, you need somewhere to store and efficiently search those vectors. A vector database is purpose-built for one operation: given a query vector, find the N most similar stored vectors as fast as possible. The choice of database mainly comes down to your scale and infrastructure constraints — the code patterns look nearly identical across all three options shown here.

```python
# Option 1: ChromaDB (local development, small-medium scale)
import chromadb
from langchain_chroma import Chroma

chroma_client = chromadb.PersistentClient(path="./chroma_db")
vectorstore = Chroma(
    collection_name="docs",
    embedding_function=embeddings,
    client=chroma_client,
)

# Ingest documents
vectorstore.add_documents(chunks)

# Option 2: pgvector (PostgreSQL extension — great for existing PG users)
from langchain_postgres import PGVector

vectorstore = PGVector(
    embeddings=embeddings,
    collection_name="docs",
    connection="postgresql+psycopg://user:pass@localhost:5432/mydb",
)

# Option 3: Pinecone (managed, production-grade, serverless)
from langchain_pinecone import PineconeVectorStore
import pinecone

pc = pinecone.Pinecone(api_key="YOUR_API_KEY")
index = pc.Index("docs-index")

vectorstore = PineconeVectorStore(
    index=index,
    embedding=embeddings,
    text_key="text",
)
```

**Vector DB selection criteria:**

| | ChromaDB | pgvector | Pinecone | Weaviate |
|---|---|---|---|---|
| Setup | Trivial | Easy (extension) | Managed | Self-hosted/managed |
| Scale | <1M vectors | <100M vectors | Hundreds of millions | Billions |
| Filtering | Basic | Full SQL | Metadata filters | GraphQL |
| Cost | Free | PG cost | Pay per vector | Free/managed |
| Best for | Dev/prototype | Existing PG | Production SaaS | Complex filtering |

## Step 4: Building the Retrieval Chain

Now that you have indexed documents, you can wire together the full question-answering chain. The prompt template here is doing a critical job: it instructs the model to stay within the retrieved context and explicitly say when it doesn't know something, which is what prevents hallucination.

Basic retrieval is just similarity search. Production retrieval combines dense search, sparse (BM25) search, and reranking.

```python
from langchain_openai import ChatOpenAI
from langchain.chains import RetrievalQA
from langchain.prompts import PromptTemplate

# Basic RAG chain
llm = ChatOpenAI(model="gpt-4o", temperature=0)

prompt_template = """Use the following context to answer the question.
If the answer is not in the context, say "I don't have enough information to answer this question."
Do not make up information.

Context:
{context}

Question: {question}

Answer:"""

prompt = PromptTemplate(
    template=prompt_template,
    input_variables=["context", "question"],
)

qa_chain = RetrievalQA.from_chain_type(
    llm=llm,
    chain_type="stuff",                       # stuff: concat all chunks into one prompt
    retriever=vectorstore.as_retriever(
        search_type="similarity",
        search_kwargs={"k": 5}                # Retrieve top 5 chunks
    ),
    chain_type_kwargs={"prompt": prompt},
    return_source_documents=True,             # For citation support
)

result = qa_chain.invoke({"query": "What is the refund policy?"})
print(result["result"])
print("Sources:", [doc.metadata for doc in result["source_documents"]])
```

The `return_source_documents=True` flag is important for production use: it lets you display citations alongside the answer, so users can verify the information and you can debug retrieval failures.

### Advanced: Hybrid Search with Reranking

Pure vector similarity misses keyword-heavy queries. Hybrid search combines dense (embedding) and sparse (BM25/TF-IDF) retrieval. Imagine a user searching for a product code like "SKU-7829" — pure semantic search will struggle with this exact string, but BM25 keyword search handles it perfectly. By blending both approaches, you get the best of both worlds.

```python
from langchain.retrievers import BM25Retriever, EnsembleRetriever
from langchain.retrievers.document_compressors import CrossEncoderReranker
from langchain_community.cross_encoders import HuggingFaceCrossEncoder

# BM25: keyword-based retrieval (great for exact terms, product codes, names)
bm25_retriever = BM25Retriever.from_documents(chunks)
bm25_retriever.k = 10

# Dense: semantic retrieval
dense_retriever = vectorstore.as_retriever(search_kwargs={"k": 10})

# Ensemble: weighted hybrid (60% dense, 40% sparse)
hybrid_retriever = EnsembleRetriever(
    retrievers=[dense_retriever, bm25_retriever],
    weights=[0.6, 0.4],
)

# Reranker: re-scores top-20 results using a cross-encoder model
# Cross-encoders compare query+document jointly — much more accurate than bi-encoder similarity
reranker_model = HuggingFaceCrossEncoder(model_name="BAAI/bge-reranker-large")
reranker = CrossEncoderReranker(model=reranker_model, top_n=5)

# Final chain: retrieve 20, rerank to top 5
from langchain.retrievers import ContextualCompressionRetriever

final_retriever = ContextualCompressionRetriever(
    base_compressor=reranker,
    base_retriever=hybrid_retriever,
)
```

The two-stage retrieve-then-rerank pattern is the key insight here: you cast a wide net with fast approximate search (retrieving 20 candidates), then apply an expensive but highly accurate cross-encoder to reorder just those 20 into the final top 5. This gives you accuracy close to brute-force search at a fraction of the cost.

## Step 5: Evaluating RAG Quality

RAG quality is hard to measure without a systematic evaluation framework. The three key metrics:

Without measurement, you cannot tell the difference between a retrieval bug and a generation bug — they both produce wrong answers. The RAGAS library gives you automated scores across four dimensions, letting you pinpoint exactly where your pipeline is failing.

```python
# Using RAGAS (open-source RAG evaluation library)
from ragas import evaluate
from ragas.metrics import (
    faithfulness,       # Does the answer contain only information from context?
    answer_relevancy,   # Is the answer relevant to the question?
    context_precision,  # Are retrieved chunks relevant to the question?
    context_recall,     # Were all relevant chunks retrieved?
)
from datasets import Dataset

# Build evaluation dataset
eval_data = {
    "question": ["What is the return policy?", "How do I reset my password?"],
    "answer": [answer1, answer2],              # Model's generated answers
    "contexts": [[doc1, doc2], [doc3]],        # Retrieved chunks
    "ground_truth": ["30-day returns...", "Click Forgot Password..."],  # Expected answers
}

dataset = Dataset.from_dict(eval_data)
result = evaluate(dataset, metrics=[faithfulness, answer_relevancy, context_precision, context_recall])

print(result)
# faithfulness: 0.92 (high = model stays within retrieved context)
# answer_relevancy: 0.87
# context_precision: 0.78 (room to improve retrieval)
# context_recall: 0.83
```

A low `context_precision` score (like 0.78 above) tells you that your retriever is returning irrelevant chunks — the problem is in retrieval, not generation. A low `faithfulness` score tells you the LLM is going off-script and adding information not in the retrieved context — the fix is a stricter prompt. These metrics let you diagnose and fix the right component.

## Common Production Pitfalls

**1. Chunks too large:**
The LLM sees the full chunk even if only 2 sentences are relevant. Information density drops. Solution: smaller chunks (500-800 chars) with reranking to surface the best ones.

**2. No metadata filtering:**
Searching all documents when the user's question is clearly about product X. Solution: extract entities from the query and filter by metadata before vector search.

Before performing similarity search, you can narrow the candidate pool using structured metadata filters — this is far cheaper than relying on the vector index alone to find the right product or time range.

```python
# Filter by document source before vector search
results = vectorstore.similarity_search(
    query=user_question,
    k=5,
    filter={"product": "product-x", "version": "2.0"},
)
```

**3. Missing query rewriting:**
User questions are often terse or ambiguous. Rewrite queries before retrieval. A user typing "refund?" has a very different retrieval surface area than the full query "What is the process for requesting a refund for a digital product?". Query rewriting bridges that gap automatically.

```python
rewrite_prompt = """Rewrite this user question into a detailed search query
that will retrieve relevant documentation chunks.

User question: {question}
Search query:"""

# Multi-query: generate 3 variations, union retrieval results
from langchain.retrievers.multi_query import MultiQueryRetriever
multi_retriever = MultiQueryRetriever.from_llm(
    retriever=vectorstore.as_retriever(),
    llm=llm,
)
```

**4. No citation/grounding:**
Users cannot verify answers if sources aren't surfaced. Always return source documents and display them alongside the answer.

**5. Embedding model mismatch:**
Indexing with one model and querying with another produces garbage results. Document your embedding model version and treat it as a breaking change when upgrading.

## Production Architecture

With all the individual components understood, here is how they fit together in a complete production system. Notice that caching and monitoring are first-class concerns — not afterthoughts — because they determine whether your system is fast and debuggable at scale.

```
Query flow:
  API request → Query rewriter → Hybrid retriever → Reranker → LLM → Response
                                        ↕
                               Pinecone + ElasticSearch
                               (dense + sparse search)

Caching:
  Embed query → Hash → Redis cache → Return cached answer if hit
  Cache TTL: 1 hour (for FAQ-style queries that repeat)

Monitoring:
  - Faithfulness score per request (flag <0.8)
  - Retrieval latency (p99 should be <500ms)
  - LLM latency (p99 should be <3s)
  - Thumbs up/down feedback → used to improve retrieval
```

RAG is not a silver bullet, but for the right use cases — private knowledge bases, document Q&A, support bots — it's the most cost-effective and maintainable path to reliable LLM-powered applications. The difference between a demo and a production system lies in chunking quality, hybrid retrieval, reranking, and systematic evaluation.
