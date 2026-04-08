---
title: "LLM Observability in Production: Traces, Evals, Cost, Latency, and Failure Modes"
description: "A production guide to LLM observability: OpenTelemetry traces, token and cost metrics, RAG retrieval spans, eval results, safety signals, prompt/version tracking, dashboards, alerts, and redaction patterns."
date: "2026-04-08"
category: "AI/ML"
tags: ["llm", "observability", "evals", "cost", "latency", "tracing", "rag", "production"]
featured: false
affiliateSection: "ai-ml-books"
---

LLM systems fail differently from normal backend systems. A normal service usually fails with a timeout, an exception, or a bad status code. An LLM application can return a fluent answer that is wrong, unsupported by retrieved context, too expensive, too slow, unsafe, or subtly worse than yesterday's prompt.

That means normal observability is necessary but not sufficient.

You still need traces, metrics, and logs. But for LLM systems you also need token usage, model version, prompt version, retrieval quality, judge scores, refusal rates, tool call traces, safety flags, and cost by tenant or feature. Without those signals, production debugging becomes guesswork.

This guide shows how to instrument an LLM system so a backend team can answer practical questions:

- Why did this answer take 18 seconds?
- Which model or prompt version produced it?
- How much did this request cost?
- Did retrieval return the right documents?
- Did the answer use the retrieved context?
- Are hallucinations increasing after a prompt change?
- Which tenant or endpoint is driving spend?
- Did an agent call a risky tool?

## The Observability Model

A typical LLM request touches more than one component:

```text
HTTP request
  |
  +-- auth and tenant lookup
  +-- prompt template render
  +-- retrieval query rewrite
  +-- vector search
  +-- reranking
  +-- model call
  +-- tool call loop
  +-- safety check
  +-- response formatting
  +-- eval sampling
```

The trace should show this flow as one request. The metrics should summarize behavior across many requests. The logs should explain specific failures without leaking secrets or PII.

Use this mental model:

| Signal | Answers |
|---|---|
| Traces | Where did this request spend time? |
| Metrics | Is the system healthy across traffic? |
| Logs | What happened in this specific failure? |
| Evals | Is answer quality improving or regressing? |
| Audit events | Who or what took an action? |

LLM observability is the combination of all five.

## Trace The Whole LLM Request

The root span should represent the user-visible operation, not just the model provider call.

```text
POST /api/assistant/query
  render_prompt
  rag.rewrite_query
  rag.retrieve
    vector_search
    bm25_search
    rerank
  llm.chat
  safety.check_response
  response.serialize
```

If you only trace `llm.chat`, you will miss the real bottleneck. In many production RAG systems, latency comes from retrieval, reranking, network retries, tool calls, or oversized prompts rather than the model itself.

Here is a small Python example using OpenTelemetry-style spans:

```python
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

tracer = trace.get_tracer("assistant-api")


def answer_question(request: dict) -> dict:
    with tracer.start_as_current_span("assistant.answer") as span:
        span.set_attribute("app.feature", "support_assistant")
        span.set_attribute("app.tenant_id", request["tenant_id"])
        span.set_attribute("app.prompt_version", "support-v17")
        span.set_attribute("app.rag.enabled", True)

        try:
            prompt = render_prompt(request)
            context = retrieve_context(request["question"])
            answer = call_model(prompt=prompt, context=context)
            checked = safety_check(answer)
            return checked
        except Exception as exc:
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, str(exc)))
            raise
```

Avoid adding raw prompts or raw answers as span attributes. Span attributes are often indexed and replicated across vendors. Store hashes, IDs, counts, versions, and redacted previews instead.

## Instrument The Model Call

The model call span should capture enough metadata to debug latency, cost, and behavior:

```python
import time
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

tracer = trace.get_tracer("llm-client")


def call_model(prompt: str, context: list[dict]) -> dict:
    with tracer.start_as_current_span("llm.chat") as span:
        started = time.monotonic()

        span.set_attribute("gen_ai.operation.name", "chat")
        span.set_attribute("gen_ai.request.model", "configured-chat-model")
        span.set_attribute("llm.prompt.version", "support-v17")
        span.set_attribute("llm.prompt.hash", sha256_text(prompt))
        span.set_attribute("llm.context.chunk_count", len(context))

        try:
            response = llm_client.chat(
                model=MODEL_NAME,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
            )

            usage = response["usage"]
            span.set_attribute("gen_ai.usage.input_tokens", usage["input_tokens"])
            span.set_attribute("gen_ai.usage.output_tokens", usage["output_tokens"])
            span.set_attribute("gen_ai.response.finish_reasons", response["finish_reason"])
            span.set_attribute("llm.latency_ms", int((time.monotonic() - started) * 1000))

            return response
        except Exception as exc:
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, str(exc)))
            raise
```

OpenTelemetry now has Generative AI semantic conventions, but they are still marked as development in the official docs. Use them deliberately, and pin your instrumentation behavior so dashboards do not silently break during convention changes. See the OpenTelemetry GenAI semantic convention docs for the current attribute and event names: [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).

## Metrics That Actually Help

Start with metrics that map to real operating questions.

Latency:

- `llm_request_duration_ms`
- `llm_first_token_latency_ms`
- `rag_retrieval_duration_ms`
- `rerank_duration_ms`
- `tool_call_duration_ms`

Cost and usage:

- `llm_input_tokens_total`
- `llm_output_tokens_total`
- `llm_estimated_cost_usd_total`
- `llm_cache_read_tokens_total`
- `llm_cache_write_tokens_total`

Quality:

- `llm_eval_faithfulness_score`
- `llm_eval_answer_relevance_score`
- `rag_recall_at_k`
- `rag_context_precision`
- `llm_user_thumbs_down_total`

Reliability:

- `llm_provider_errors_total`
- `llm_provider_timeouts_total`
- `llm_retry_attempts_total`
- `llm_fallback_model_total`
- `llm_safety_block_total`

Agent behavior:

- `agent_tool_calls_total`
- `agent_tool_errors_total`
- `agent_tool_approval_required_total`
- `agent_tool_denied_total`
- `agent_loop_iterations`

You do not need all of these on day one. You do need token usage, latency, errors, prompt version, and model version before production traffic.

## Cost Tracking

Cost debugging is impossible if you only look at the provider invoice.

Track cost at request time:

```python
MODEL_PRICING = {
    # Example placeholders. Keep real prices in config because provider pricing changes.
    "configured-chat-model": {
        "input_per_million": 0.0,
        "output_per_million": 0.0,
    }
}


def estimate_llm_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    pricing = MODEL_PRICING[model]
    input_cost = (input_tokens / 1_000_000) * pricing["input_per_million"]
    output_cost = (output_tokens / 1_000_000) * pricing["output_per_million"]
    return round(input_cost + output_cost, 6)
```

Emit it with dimensions that help you act:

```python
llm_cost_counter.add(
    amount=estimated_cost,
    attributes={
        "tenant_id": tenant_id,
        "feature": "support_assistant",
        "model": model,
        "prompt_version": prompt_version,
    },
)
```

Useful cost dashboards:

- cost by feature
- cost by tenant
- cost by model
- cost by prompt version
- cost per successful answer
- cost per eval-passing answer
- top 20 most expensive requests

The last one catches accidental prompt bloat faster than monthly billing reports.

## RAG Observability

For RAG systems, the model call is only half the story. The retrieval trace is just as important.

Capture:

- original query
- query rewrite hash
- retriever type: BM25, dense, hybrid, graph
- embedding model version
- index name and index version
- top-K requested
- top-K returned
- reranker model version
- source document IDs
- chunk IDs
- retrieval latency
- score distribution

Example:

```python
def retrieve_context(question: str) -> list[dict]:
    with tracer.start_as_current_span("rag.retrieve") as span:
        rewritten_query = rewrite_query(question)
        span.set_attribute("rag.query.hash", sha256_text(rewritten_query))
        span.set_attribute("rag.retriever", "hybrid_rrf")
        span.set_attribute("rag.embedding_model", EMBEDDING_MODEL)
        span.set_attribute("rag.index", "support_docs_v42")
        span.set_attribute("rag.top_k.requested", 20)

        candidates = hybrid_search(rewritten_query, top_k=20)
        reranked = rerank(question, candidates, top_k=5)

        span.set_attribute("rag.top_k.returned", len(reranked))
        span.set_attribute("rag.source_ids", ",".join(doc["source_id"] for doc in reranked))
        span.set_attribute("rag.chunk_ids", ",".join(doc["chunk_id"] for doc in reranked))

        return reranked
```

Do not put full chunk text in attributes. If you need raw context for debugging, store it in a controlled debug store with retention, redaction, and access controls.

## Evaluation Results As Telemetry

Offline evals are necessary, but production also needs sampled online evals.

Example eval event:

```json
{
  "request_id": "req_123",
  "trace_id": "4f7a...",
  "tenant_id": "tenant_abc",
  "feature": "support_assistant",
  "prompt_version": "support-v17",
  "model": "configured-chat-model",
  "retriever": "hybrid_rrf",
  "faithfulness": 0.82,
  "answer_relevance": 0.76,
  "context_recall": 0.71,
  "toxicity_flag": false,
  "hallucination_flag": false,
  "judge_model": "configured-judge-model",
  "sample_type": "production_sample"
}
```

Store eval results separately from normal logs. Evals need longitudinal analysis:

- quality by prompt version
- quality by retriever version
- quality by model
- quality by tenant
- quality by query type
- quality before and after release

For RAG, pair answer-level evals with retrieval-level evals. If faithfulness drops, you need to know whether retrieval missed the right context or the model ignored it.

## Prompt And Model Versioning

Every production trace should tell you:

- prompt template version
- system prompt version
- tool definition version
- retrieval pipeline version
- embedding model version
- reranker model version
- generator model version
- judge model version

Example:

```json
{
  "prompt_version": "support-v17",
  "system_prompt_hash": "sha256:9f2...",
  "tool_manifest_version": "tools-2026-04-08",
  "retrieval_pipeline_version": "rag-hybrid-v6",
  "embedding_model_version": "embedding-v3",
  "reranker_model_version": "reranker-v2",
  "generator_model": "configured-chat-model",
  "judge_model": "configured-judge-model"
}
```

Without versioning, you cannot explain regressions. "The model got worse" is not a diagnosis. It might be a prompt change, retrieval change, schema change, rate limit fallback, safety filter change, or provider-side model update.

## Redaction And Privacy

LLM observability can accidentally become a shadow database of user prompts, customer data, secrets, and generated answers. That is dangerous.

Rules:

- never log raw secrets
- avoid storing full prompts by default
- hash prompts and answers for correlation
- store redacted previews with length limits
- separate debug sampling from normal telemetry
- give debug stores short retention
- restrict who can view raw samples
- log access to raw samples

Example redactor:

```python
import re

SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_-]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"(?i)(password|api_key|secret)\s*[:=]\s*['\"]?[^'\"\s]+"),
]


def redact_text(value: str, max_length: int = 500) -> str:
    redacted = value
    for pattern in SECRET_PATTERNS:
        redacted = pattern.sub("[REDACTED]", redacted)

    if len(redacted) > max_length:
        redacted = redacted[:max_length] + "...[TRUNCATED]"

    return redacted
```

Also consider tenant-level controls. Some customers may require that prompts never leave your region, never enter a third-party observability vendor, or never be retained.

## Dashboards

Create dashboards for different audiences.

Engineering dashboard:

- request rate
- p50/p95/p99 latency
- provider errors and timeouts
- retry rate
- token usage
- fallback model usage
- trace samples for slow requests

Product dashboard:

- daily active users
- successful answer rate
- thumbs up/down rate
- unanswered query rate
- top query categories
- cost per active user

AI quality dashboard:

- eval score trends
- faithfulness by prompt version
- context recall by retriever version
- hallucination flag rate
- safety block rate
- quality by query category

Finance dashboard:

- spend by feature
- spend by tenant
- spend by model
- spend by environment
- top expensive requests
- projected month-end spend

Do not make one dashboard do all jobs. The on-call engineer and the product manager are asking different questions.

## Alerts

Useful alerts are tied to action.

Examples:

```yaml
alerts:
  - name: llm_provider_error_rate_high
    condition: error_rate{provider="primary"} > 5% for 10m
    action: switch traffic to fallback model or investigate provider status

  - name: llm_p95_latency_high
    condition: p95(llm_request_duration_ms) > 8000 for 15m
    action: inspect traces for retrieval, reranking, provider latency, or retries

  - name: llm_daily_cost_burn_high
    condition: projected_monthly_cost > budget * 1.2
    action: inspect top tenants, prompt versions, and token usage

  - name: rag_context_recall_drop
    condition: context_recall_rolling_avg drops by 15% after deploy
    action: rollback retrieval config or inspect index freshness

  - name: agent_dangerous_tool_denied_spike
    condition: denied_dangerous_tool_calls > baseline * 3
    action: inspect prompt injection or tool routing regression
```

Bad alerts say "LLM is bad." Good alerts point to the next debugging step.

## Failure Modes To Track

Track these explicitly:

**Prompt bloat.** Prompt length grows slowly as teams add instructions. Token cost and latency increase even though traffic is flat.

**Retrieval drift.** Indexes become stale, embedding versions mismatch, or chunking changes without re-evaluation.

**Silent quality regression.** Prompt or model changes pass unit tests but fail judge-based evals or user feedback.

**Provider fallback storm.** A provider slows down, retries increase, and the fallback model becomes overloaded or too expensive.

**Tool loop runaway.** An agent repeatedly calls search or inspection tools without reaching a final answer.

**Safety false positives.** Safe user requests get blocked after a safety policy update.

**Safety false negatives.** Unsafe outputs pass because the safety checker is only looking at the final response, not retrieved context or tool outputs.

**Tenant cost spike.** One customer, batch job, or integration drives a large percentage of spend.

**Debug log leakage.** Raw prompts enter a vendor log pipeline without retention or access controls.

## A Practical Trace Payload

A useful trace has identifiers, not raw content:

```json
{
  "trace_id": "4f7a...",
  "request_id": "req_123",
  "tenant_id": "tenant_abc",
  "feature": "support_assistant",
  "prompt_version": "support-v17",
  "prompt_hash": "sha256:9f2...",
  "generator_model": "configured-chat-model",
  "input_tokens": 1842,
  "output_tokens": 318,
  "estimated_cost_usd": 0.0042,
  "retriever": "hybrid_rrf",
  "index_version": "support_docs_v42",
  "top_k_returned": 5,
  "source_ids": ["doc_12", "doc_88", "doc_91"],
  "eval_sampled": true,
  "faithfulness": 0.82,
  "safety_blocked": false,
  "latency_ms": 2430
}
```

This lets you debug without dumping the entire prompt into telemetry.

## Rollout Checklist

Before launch:

- trace the full request path
- record model and prompt versions
- record token usage
- estimate cost per request
- capture retrieval metadata
- add redaction before telemetry export
- add request IDs to user-visible error reports
- create a slow-request trace dashboard
- create a cost dashboard
- add eval sampling
- add alerts for latency, error rate, cost, and quality regression

After launch:

- review top expensive requests weekly
- review failed eval samples weekly
- add production failures to the eval set
- compare prompt versions before rollout
- inspect safety false positives and false negatives
- track provider fallback rate
- delete raw debug samples after retention expires

## Read Next

- [LLM Evaluation at Scale](/blog/llm-evaluation-at-scale/)
- [Building Production Observability with OpenTelemetry and Grafana Stack](/blog/observability-opentelemetry-production/)
- [LLM Inference Optimization](/blog/llm-inference-optimization/)
- [Building AI Agents with Tool Use](/blog/llm-agents-tool-use/)

## Sources

- [OpenTelemetry Generative AI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenTelemetry Generative AI Events](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/)
