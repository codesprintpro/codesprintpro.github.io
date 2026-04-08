---
title: "LLM Inference Optimization: Quantization, KV Cache, and High-Throughput Serving"
description: "Production LLM serving: how quantization (GGUF, GPTQ, AWQ) cuts memory by 4x, KV cache memory math, continuous batching in vLLM, TensorRT-LLM for NVIDIA GPUs, and the throughput vs latency trade-offs that determine your serving architecture."
date: "2026-04-08"
category: "AI/ML"
tags: ["llm", "inference", "quantization", "vllm", "tensorrt", "kv-cache", "gpu", "ai infrastructure"]
featured: false
affiliateSection: "ai-ml-books"
---

## The Real Cost of Running LLMs

A 70B-parameter model in fp16 requires roughly 140 GB of GPU VRAM just for weights. That means two 80 GB accelerator cards before you serve a single token. Add KV cache for concurrent users and you are looking at a third or fourth card. The economics collapse fast.

Every production LLM deployment is ultimately a memory management problem. The optimizations that matter — quantization, KV cache eviction, continuous batching — are all different attacks on the same constraint. This post covers the math, the tradeoffs, and the concrete decisions you need to make.

---

## GPU Memory Math: Weights

The fundamental formula for model weight memory:

```
memory_bytes = num_parameters × bytes_per_parameter
```

For fp32 (4 bytes), fp16/bf16 (2 bytes), int8 (1 byte), int4 (0.5 bytes):

| Model         | Parameters | fp16 (GB) | int8 (GB) | int4 (GB) |
|---------------|------------|-----------|-----------|-----------|
| 8B model      | 8B         | 16        | 8         | 4         |
| 70B model     | 70B        | 140       | 70        | 35        |
| Mixtral 8x7B  | 47B        | 94        | 47        | 23.5      |
| Qwen2 72B     | 72B        | 144       | 72        | 36        |

int4 quantization gets you a 4x reduction — enough to drop from 2x A100-80GB to a single one for a 70B model. That is not a rounding error in cost.

---

## KV Cache Memory Math

KV cache is often underestimated. During autoregressive decoding, each transformer layer stores key and value tensors for every token in the context. The formula:

```
kv_cache_bytes = 2 × num_layers × num_kv_heads × head_dim × seq_len × batch_size × bytes_per_element
```

Factor breakdown:
- `2` — one K tensor and one V tensor per layer
- `num_layers` — for a representative 70B-class model: 80
- `num_kv_heads` — for a representative 70B-class model with grouped-query attention: 8
- `head_dim` — 128
- `seq_len` — depends on your workload
- `batch_size` — concurrent requests
- `bytes_per_element` — 2 for fp16

**Example — 70B-class model, batch size 32, seq_len 4096:**

```
2 × 80 × 8 × 128 × 4096 × 32 × 2
= 2 × 80 × 8 × 128 × 4096 × 64
= 27,487,051,776 bytes
≈ 25.6 GB
```

So with weights at 140 GB (fp16) you need 165+ GB for weights plus KV cache at batch 32. That is realistically 3x A100-80GB. With int4 weights at 35 GB you fit on a single A100 with room for KV cache.

KV cache grows linearly with both sequence length and batch size. This is why long-context models (128K context) are memory-prohibitive at high batch sizes without careful management. A single 128K-context request at the same representative 70B-class shape consumes:

```
2 × 80 × 8 × 128 × 131072 × 1 × 2 ≈ 51.5 GB
```

One request at full context uses more VRAM than the quantized weights.

---

## Quantization: GGUF, GPTQ, AWQ

There are three dominant quantization approaches in production, each with different tradeoffs.

### GPTQ — Post-Training Quantization on GPU

GPTQ (Generative Pre-Trained Quantization) uses second-order information (the Hessian) to minimize reconstruction error layer by layer. It quantizes to int4 or int8 with per-channel or per-group scales.

**How it works:** For each layer, GPTQ solves a least-squares problem to find quantized weights `W_q` that minimize `||W·X - W_q·X||²`. It processes columns sequentially and updates remaining columns to compensate for quantization error.

**Strengths:**
- High quality — uses calibration data to minimize per-layer error
- GPU-native — runs efficiently with CUDA kernels (AutoGPTQ, ExllamaV2)
- Good for online serving on GPU

**Weaknesses:**
- Quantization takes hours on large models
- Requires calibration dataset (quality-sensitive)
- Less flexible for CPU inference

### GGUF — Flexible CPU/GPU Hybrid via llama.cpp

GGUF (successor to GGML) is the format used by llama.cpp. It supports mixed-precision quantization — different layers at different bit widths (Q4_K_M, Q5_K_M, Q8_0, etc.).

The naming convention is meaningful:
- `Q4_K_M` — 4-bit weights, K-quantization scheme, Medium variant (some layers at 6-bit)
- `Q5_K_S` — 5-bit, Small variant
- `Q8_0` — 8-bit, simple quantization

K-quantization quantizes groups of weights together with a shared scale and minimum, reducing outlier error compared to naive round-to-nearest.

**Strengths:**
- CPU inference — offload layers to RAM when GPU VRAM is insufficient
- Flexible split — partial GPU offload with `--n-gpu-layers`
- Wide tooling support (Ollama, LM Studio, Jan)

**Weaknesses:**
- Lower throughput than pure GPU serving (GPTQ + vLLM)
- Not optimized for high-concurrency server workloads

### AWQ — Activation-Aware Weight Quantization

AWQ observes that not all weights are equally important — weights that correspond to high-magnitude activations cause disproportionate quantization error. AWQ scales these salient weights before quantization to protect them.

**The key insight:** Instead of quantizing uniformly, AWQ finds a per-channel scale `s` that minimizes:

```
||W·X - (W/s)_quantized · (X·s)||
```

This is equivalent to scaling activations rather than weights, which is hardware-friendly (scale is folded into adjacent layers at runtime).

**Strengths:**
- Better quality than GPTQ at same bit width, especially 4-bit
- Fast quantization — no per-column optimization, runs in minutes
- Excellent with vLLM and TGI (native AWQ kernel support)

**Weaknesses:**
- Slightly more complex calibration setup
- Less mature tooling than GPTQ for edge cases

### Quantization Comparison

| Method | Quality | Throughput | CPU Support | Calibration Time | Best For |
|--------|---------|------------|-------------|-----------------|----------|
| GPTQ   | Good    | High       | No          | Hours           | GPU serving, legacy tooling |
| AWQ    | Best    | High       | No          | Minutes         | GPU serving, vLLM deployment |
| GGUF Q4_K_M | Good | Medium | Yes       | Minutes         | Local inference, CPU/hybrid |
| GGUF Q8_0  | Near fp16 | Medium | Yes    | Minutes         | High-quality CPU inference |

Decision rule: **GPU serving at scale → AWQ or GPTQ**. **Local / edge / CPU-only → GGUF**. When in doubt on GPU, AWQ at Q4 outperforms GPTQ at Q4 and is faster to produce.

---

## Continuous Batching vs Static Batching

Static batching — the naive approach — groups N requests, runs forward passes until all N complete, then takes the next batch. The problem: requests have different lengths. A short request finishes early but holds its batch slot until the longest request in the group completes. GPU utilization collapses.

**Continuous batching** (also called iteration-level scheduling or in-flight batching) processes each decode step as a separate scheduling opportunity. After each forward pass, completed requests are evicted and new requests are inserted — no waiting for the batch to drain.

This is the core insight in Orca-style scheduling and what vLLM and TGI implement. The result is substantially higher throughput than static batching under realistic workload distributions with mixed prompt lengths, mixed output lengths, and uneven request arrivals.

---

## vLLM Architecture

vLLM's primary contribution is **PagedAttention** — a KV cache management system modeled after virtual memory paging in operating systems.

### The Problem with Contiguous KV Cache

Traditional serving allocates a contiguous KV cache block per request, sized for the maximum sequence length. Two problems:
1. **Internal fragmentation** — a 512-token request in a 4096-token slot wastes 7/8 of the slot
2. **External fragmentation** — free blocks cannot be combined to serve a larger request

### PagedAttention

PagedAttention divides the KV cache into fixed-size blocks (pages), typically 16 tokens per page. Each request gets pages allocated on demand. Pages are not contiguous — the attention kernel uses a block table to map logical positions to physical blocks.

```
Request A: [block 0, block 3, block 7]    # non-contiguous in VRAM
Request B: [block 1, block 4]
Request C: [block 2, block 5, block 6, block 8]
```

The attention kernel fetches blocks by index rather than requiring contiguous memory. This eliminates fragmentation and enables two additional features:

**Copy-on-Write for parallel sampling:** When generating multiple outputs for the same prompt (beam search, `n > 1`), the prompt's KV cache pages are shared across all sequences. A page is only copied when a sequence needs to write to it (divergence point). This reduces memory for beam search by sharing the prompt KV cache.

**Prefix caching:** Pages from common prefixes (system prompts) can be cached and reused across requests. A request with a system prompt that matches an existing cached prefix gets those pages for free.

### Running vLLM

Install and serve a quantized model:

```bash
pip install vllm

# Serve an AWQ-quantized 70B-class model on 2 accelerators
python -m vllm.entrypoints.openai.api_server \
  --model example-org/example-70b-awq \
  --quantization awq \
  --tensor-parallel-size 2 \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.90 \
  --max-num-seqs 256 \
  --host 0.0.0.0 \
  --port 8000
```

Key flags:
- `--tensor-parallel-size` — splits model across N GPUs (each GPU holds 1/N of weights per layer)
- `--gpu-memory-utilization` — fraction of GPU memory to allocate for model + KV cache (leave headroom for CUDA context)
- `--max-num-seqs` — maximum concurrent sequences in the scheduler
- `--max-model-len` — caps context length, directly controls max KV cache per sequence

Python client (OpenAI-compatible):

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="not-required",
)

response = client.chat.completions.create(
    model="example-org/example-70b-awq",
    messages=[
        {"role": "system", "content": "You are a senior engineer. Be precise."},
        {"role": "user", "content": "Explain how PagedAttention eliminates KV cache fragmentation."},
    ],
    max_tokens=512,
    temperature=0.2,
)

print(response.choices[0].message.content)
```

Async batch client for throughput benchmarking:

```python
import asyncio
import time
from openai import AsyncOpenAI

client = AsyncOpenAI(base_url="http://localhost:8000/v1", api_key="none")

async def single_request(prompt: str, request_id: int) -> dict:
    start = time.monotonic()
    response = await client.chat.completions.create(
        model="example-org/example-70b-awq",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=256,
    )
    latency = time.monotonic() - start
    tokens = response.usage.completion_tokens
    return {
        "request_id": request_id,
        "latency_s": latency,
        "tokens": tokens,
        "tokens_per_second": tokens / latency,
    }

async def benchmark(num_concurrent: int = 32):
    prompt = "Write a production-grade connection pool in Python with health checks."
    tasks = [single_request(prompt, i) for i in range(num_concurrent)]
    results = await asyncio.gather(*tasks)

    total_tokens = sum(r["tokens"] for r in results)
    total_time = max(r["latency_s"] for r in results)
    p99_latency = sorted(r["latency_s"] for r in results)[int(0.99 * len(results))]

    print(f"Throughput: {total_tokens / total_time:.1f} tokens/sec")
    print(f"P99 TTLT: {p99_latency:.2f}s")
    print(f"Avg TPS per request: {sum(r['tokens_per_second'] for r in results) / len(results):.1f}")

asyncio.run(benchmark(32))
```

---

## TensorRT-LLM

TensorRT-LLM is NVIDIA's inference library that compiles LLMs into optimized TensorRT engines. It applies:

- **Kernel fusion** — fusing attention, layer norm, and activation into single CUDA kernels, eliminating intermediate buffer writes
- **FP8 quantization** — on Hopper-class GPUs, FP8 is hardware-accelerated and can improve throughput when quality is validated for your workload
- **In-flight batching** — equivalent to vLLM's continuous batching, built into the C++ runtime
- **Multi-GPU pipeline and tensor parallelism** — with optimized NCCL communication

TensorRT-LLM requires building an engine per GPU type and model configuration, which is its main friction. The engine is not portable across GPU generations. For organizations running homogeneous NVIDIA clusters at scale, the additional throughput can justify the build complexity. For teams that change models frequently, the build pipeline overhead may not be worth it.

Quick build and serve with Triton:

```bash
# Build TRT-LLM engine for an 8B-class model on a single accelerator
python convert_checkpoint.py \
  --model_dir ./example-8b-hf \
  --output_dir ./trt_ckpt/example-8b \
  --dtype float16

trtllm-build \
  --checkpoint_dir ./trt_ckpt/example-8b \
  --output_dir ./trt_engines/example-8b \
  --max_batch_size 64 \
  --max_input_len 2048 \
  --max_output_len 512 \
  --use_inflight_batching \
  --paged_kv_cache enable
```

When to choose TensorRT-LLM over vLLM:
- Homogeneous NVIDIA fleet (single GPU SKU)
- Hopper-class GPUs with FP8 support
- Maximum throughput is the primary metric and you can absorb the build pipeline cost
- Already using NVIDIA Triton Inference Server

When to stay with vLLM:
- Mixed GPU fleet or frequent model iteration
- Need fast iteration on new models (vLLM ships model support faster)
- AMD GPUs (vLLM has ROCm support)
- Lower operational complexity is valued

---

## Throughput vs Latency Trade-offs

These objectives are fundamentally in tension. Continuous batching maximizes throughput by keeping the GPU busy — but a request that arrives when the batch is full waits in queue, increasing latency.

**Time to First Token (TTFT)** — dominated by prefill. A large prompt (4096 tokens) requires one big forward pass through all layers. Prefill is compute-bound.

**Time Per Output Token (TPOT)** — dominated by memory bandwidth during decode. Each decode step repeatedly touches large weight matrices. Batching amortizes this memory traffic across multiple requests. The exact number depends on the GPU, attention implementation, quantization format, and kernel stack, but the shape of the trade-off is stable: small batches favor latency, larger batches favor throughput until the queue starts to build.

**The batching cliff:** Increasing batch size improves throughput until you hit the memory bandwidth ceiling or VRAM limit. Beyond that point, additional requests queue rather than batch, and both throughput and p99 latency degrade.

Practical guidance:

| Use Case | Optimize For | Configuration |
|----------|-------------|---------------|
| Interactive chat | TTFT < 500ms, TPOT < 50ms | Small batch, low `max-num-seqs`, streaming |
| Async document processing | Throughput | Large batch, high `max-num-seqs`, no streaming |
| RAG retrieval augmentation | TTFT | Short context, prioritize prefill speed |
| Code completion (copilot) | TPOT | Medium context, streaming, low temperature |

---

## Speculative Decoding

One technique worth adding to your toolkit: speculative decoding uses a small draft model to generate K candidate tokens cheaply, then verifies them in a single forward pass of the large target model.

If the draft tokens match the target distribution (which they often do for common continuations), you effectively get K tokens per target model forward pass instead of 1. Wall-clock TPOT drops without changing output distribution.

vLLM supports this via `--speculative-model`:

```bash
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-3-70B-Instruct \
  --speculative-model meta-llama/Llama-3-8B-Instruct \
  --num-speculative-tokens 5 \
  --tensor-parallel-size 2
```

Gains are workload-dependent. Code generation with predictable tokens often benefits more than creative tasks with high entropy. Always benchmark speculative decoding against your own prompt distribution because a poor draft model can add overhead without improving latency.

---

## Capacity Planning for an Inference Endpoint

A useful first-pass capacity estimate uses four numbers:

```
required_output_tokens_per_second =
  peak_requests_per_second × average_output_tokens
```

Then compare that to measured endpoint throughput, not vendor benchmarks:

```
required_replicas =
  ceil(required_output_tokens_per_second / measured_tokens_per_second_per_replica)
```

Example:

```
peak_requests_per_second = 20
average_output_tokens = 300
required_output_tokens_per_second = 6000

measured_tokens_per_second_per_replica = 1200
required_replicas = ceil(6000 / 1200) = 5
```

This estimate is incomplete, but useful. It ignores prefill cost, prompt length distribution, streaming behavior, queueing, retries, and cold starts. Use it to size the first load test, not the final production fleet.

For production, split capacity planning into two tests:

- **Prefill-heavy test**: long prompts, short outputs. This catches RAG and summarization workloads.
- **Decode-heavy test**: short prompts, long outputs. This catches chat, code generation, and agent workflows.

If you only benchmark one synthetic prompt, you will choose the wrong configuration.

---

## Production Checklist

Before you push a serving endpoint:

1. **Measure actual VRAM usage** — use `nvidia-smi dmon` under load, not just model weight estimates. KV cache at peak concurrency often surprises.
2. **Set `--gpu-memory-utilization` to 0.90**, not 0.95+ — CUDA runtime needs headroom; OOM kills the server process.
3. **Profile prefill vs decode separately** — high TTFT usually means large prompts or insufficient tensor parallelism. High TPOT usually means bandwidth-bound decode or insufficient batch size.
4. **Enable prefix caching** for workloads with shared system prompts (`--enable-prefix-caching` in vLLM).
5. **Use quantization** — AWQ Q4 with < 1% benchmark regression is nearly always worth the 4x memory saving. Validate on your specific task domain before deploying.
6. **Benchmark with realistic concurrency** — single-request benchmarks are useless for capacity planning. Use the async client pattern above with N concurrent requests matching your expected peak.
7. **Monitor token throughput, not just latency** — a server with 100ms p50 latency at 1 RPS and 100ms p50 latency at 100 RPS are very different systems.
8. **Track TTFT and TPOT separately** — one tells you about prefill and queueing; the other tells you about decode throughput.
9. **Set admission limits** — reject or queue requests when context length or concurrency would blow up KV cache memory.
10. **Version every serving config** — model weights, quantization format, tokenizer, runtime, flags, and GPU type all affect output and latency.

## Read Next

- [AI Infrastructure on AWS: SageMaker, EKS GPU Scheduling, and Cost-Efficient Inference](/blog/ai-infrastructure-aws/)
- [LLM Evaluation at Scale: LLM-as-Judge, RAGAS, and Building Automated Eval Pipelines](/blog/llm-evaluation-at-scale/)
- [Vector Embeddings Deep Dive: From Theory to Production Search](/blog/vector-embeddings-deep-dive/)
