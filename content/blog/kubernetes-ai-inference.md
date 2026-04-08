---
title: "Kubernetes for AI Inference: GPUs, Autoscaling, Queues, and Cost Control"
description: "A practical guide to running AI inference on Kubernetes: GPU scheduling, node pools, taints and tolerations, model servers, queue-based autoscaling with KEDA, admission controls, observability, and cost guardrails."
date: "2026-04-08"
category: "AI/ML"
tags: ["kubernetes", "gpu", "ai infrastructure", "inference", "autoscaling", "keda", "cost optimization"]
featured: false
affiliateSection: "aws-resources"
---

Kubernetes can run AI inference workloads well, but only if you treat GPU capacity as a scarce production resource instead of "just another Deployment." GPU nodes are expensive, images are large, cold starts are painful, and the wrong autoscaling signal can create either idle spend or request queues that never drain.

The mistake is trying to operate inference like a stateless web API:

```text
HTTP request -> Deployment -> pod -> model -> response
```

That works for small models and steady traffic. It breaks when you add large model weights, bursty traffic, multiple model sizes, GPU fragmentation, long-running requests, and cost constraints.

This guide walks through a practical Kubernetes design for AI inference: GPU node pools, taints, tolerations, resource requests, queue-based autoscaling, model server probes, PodDisruptionBudgets, admission controls, and observability. The goal is not to make Kubernetes fashionable for AI. The goal is to run inference without wasting GPUs or surprising the on-call engineer.

## When Kubernetes Makes Sense

Kubernetes is a good fit when:

- you already operate Kubernetes well
- you need multiple model services
- you need custom routing, auth, or tenant controls
- you want shared observability and deployment workflows
- you run batch and online inference in the same platform
- you need portability across cloud providers or on-prem clusters

Kubernetes is not automatically the right answer when:

- you have one model and one endpoint
- your team has no Kubernetes operating experience
- your traffic is tiny and sporadic
- managed inference platforms already meet your needs
- GPU availability is more important than platform flexibility

The trade-off is control versus operational surface area. Kubernetes gives you control. You pay for it with scheduling, capacity planning, driver management, security, autoscaling, and debugging.

## The Basic Architecture

A production inference architecture often looks like this:

```text
Client
  |
  v
API Gateway
  |
  +-- auth, rate limits, tenant routing
  |
  v
Inference Router
  |
  +-- small-model-service
  +-- medium-model-service
  +-- large-model-service
       |
       +-- GPU node pool
       +-- model cache volume
       +-- queue worker or streaming server
       +-- metrics exporter
```

Do not put every request directly behind one GPU Deployment. Add a routing layer that can choose the right model, reject requests above tenant limits, fall back when a model is unavailable, and direct batch work to queues.

## GPU Scheduling Basics

Kubernetes exposes GPUs through device plugins. After drivers and a vendor device plugin are installed on nodes, the cluster exposes a schedulable GPU resource such as `nvidia.com/gpu`. Kubernetes documents that GPU resources are specified in `limits`; if a GPU limit is set without a request, Kubernetes uses the limit as the request, and if both are set they must be equal: [Kubernetes GPU scheduling](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/).

A minimal GPU pod:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: embedding-inference
spec:
  restartPolicy: Always
  containers:
    - name: server
      image: registry.example.com/ml/embedding-server:2026-04-08
      ports:
        - containerPort: 8080
      resources:
        limits:
          nvidia.com/gpu: 1
          cpu: "4"
          memory: 24Gi
```

For real services, use a Deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: embedding-inference
  labels:
    app: embedding-inference
spec:
  replicas: 2
  selector:
    matchLabels:
      app: embedding-inference
  template:
    metadata:
      labels:
        app: embedding-inference
    spec:
      containers:
        - name: server
          image: registry.example.com/ml/embedding-server:2026-04-08
          ports:
            - name: http
              containerPort: 8080
          resources:
            requests:
              cpu: "4"
              memory: 24Gi
            limits:
              cpu: "4"
              memory: 24Gi
              nvidia.com/gpu: 1
```

The CPU and memory requests are not decoration. Tokenization, request batching, JSON serialization, and streaming responses still consume CPU and memory. If you under-request them, pods may land on nodes that cannot serve reliably.

## Separate GPU Node Pools

Keep GPU nodes separate from general-purpose nodes. Use labels and taints.

Example node labels:

```bash
kubectl label node gpu-node-1 workload=inference
kubectl label node gpu-node-1 accelerator=nvidia-l4
kubectl label node gpu-node-1 model-tier=medium
```

Example taint:

```bash
kubectl taint node gpu-node-1 nvidia.com/gpu=true:NoSchedule
```

Inference pods must tolerate the taint and select the right node class:

```yaml
spec:
  tolerations:
    - key: "nvidia.com/gpu"
      operator: "Equal"
      value: "true"
      effect: "NoSchedule"
  nodeSelector:
    workload: inference
    accelerator: nvidia-l4
```

This prevents random workloads from landing on expensive GPU nodes and prevents GPU workloads from landing on nodes without the right hardware.

For mixed GPU fleets, prefer explicit labels:

```yaml
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: accelerator
              operator: In
              values:
                - nvidia-l4
                - nvidia-a10g
```

Do not let a large model randomly land on a small GPU node. Put that decision into scheduling rules, not tribal knowledge.

## Model Server Readiness

An inference pod is not ready when the container process starts. It is ready after:

- the model weights are available
- the model is loaded into GPU memory
- warmup is complete
- the server can accept requests

Use a startup probe for model loading and a readiness probe for traffic:

```yaml
containers:
  - name: server
    image: registry.example.com/ml/generator-server:2026-04-08
    ports:
      - containerPort: 8080
    startupProbe:
      httpGet:
        path: /health/startup
        port: 8080
      failureThreshold: 60
      periodSeconds: 10
    readinessProbe:
      httpGet:
        path: /health/ready
        port: 8080
      periodSeconds: 5
      failureThreshold: 3
    livenessProbe:
      httpGet:
        path: /health/live
        port: 8080
      periodSeconds: 30
      failureThreshold: 3
```

The readiness probe should return false while the model is loading. Otherwise Kubernetes will route traffic to a pod that is technically alive but cannot serve inference.

## Image And Weight Loading Strategy

Large model images create slow rollouts. Keep the container image focused on runtime dependencies and load weights through a controlled path:

| Strategy | Pros | Cons |
|---|---|---|
| Weights baked into image | Simple, reproducible | Huge images, slow pulls, slow rollbacks |
| Weights downloaded on startup | Smaller images, flexible | Cold start latency, external dependency |
| Weights on persistent volume | Faster restart on same node | Volume management, node locality |
| Node-local cache | Fast warm restarts | Cache invalidation, daemon management |

A common pattern is an init container:

```yaml
initContainers:
  - name: fetch-model
    image: registry.example.com/platform/model-fetcher:2026-04-08
    env:
      - name: MODEL_URI
        value: s3://ml-artifacts/models/embedding-v12/
    volumeMounts:
      - name: model-cache
        mountPath: /models
containers:
  - name: server
    image: registry.example.com/ml/embedding-server:2026-04-08
    env:
      - name: MODEL_PATH
        value: /models/embedding-v12
    volumeMounts:
      - name: model-cache
        mountPath: /models
volumes:
  - name: model-cache
    emptyDir:
      sizeLimit: 50Gi
```

For very large models, consider persistent volumes or node-local caches. Measure cold start time as an SLO, not a footnote.

## Queue-Based Inference

Synchronous HTTP is not always the right shape. For long-running generation, batch jobs, or bursty workloads, put a queue in front of inference workers.

```text
API -> queue -> inference workers -> result store -> callback / polling
```

Benefits:

- backpressure is explicit
- retries are controlled
- traffic spikes do not overload GPU pods instantly
- autoscaling can use queue depth
- expensive work can be rate-limited per tenant

Queue message:

```json
{
  "requestId": "req_123",
  "tenantId": "tenant_abc",
  "model": "summary-large",
  "inputUri": "s3://inference-inputs/req_123.json",
  "outputUri": "s3://inference-outputs/req_123.json",
  "priority": "normal",
  "deadlineSeconds": 120
}
```

Do not put huge prompts or documents directly inside queue messages. Store payloads in object storage and put references in the message.

## Autoscaling With KEDA

KEDA is useful when the scaling signal is an event source such as SQS, Kafka, Pub/Sub, RabbitMQ, or Prometheus. KEDA's docs explain that it can decide activation from zero to one, then pass scaling decisions to HPA for one-to-N scaling: [KEDA scaling deployments](https://keda.sh/docs/2.17/concepts/scaling-deployments/).

Example with a queue trigger:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: summary-worker
spec:
  scaleTargetRef:
    name: summary-worker
  pollingInterval: 15
  cooldownPeriod: 300
  minReplicaCount: 0
  maxReplicaCount: 12
  triggers:
    - type: aws-sqs-queue
      metadata:
        queueURL: https://sqs.us-east-1.amazonaws.com/123456789012/summary-jobs
        queueLength: "5"
        awsRegion: us-east-1
      authenticationRef:
        name: keda-aws-auth
```

For GPU workloads, be careful with scale-to-zero:

- Scale-to-zero saves money.
- Scale-from-zero can be slow if nodes and model weights are cold.
- Some user-facing endpoints need warm minimum capacity.
- Queue workers tolerate cold starts better than interactive chat.

Use `minReplicaCount: 0` for batch or async jobs. Use a warm floor for interactive traffic.

## HPA Is Not Enough For Every Inference Workload

CPU utilization is a poor proxy for GPU inference saturation. A GPU worker can be overloaded while CPU looks fine, or CPU can spike during tokenization while the GPU is underused.

Better scaling signals:

- queue depth
- oldest message age
- in-flight requests per pod
- GPU utilization
- GPU memory utilization
- request latency
- tokens generated per second
- batch wait time
- admission reject rate

If your model server exposes Prometheus metrics, scale on application signals:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: generator-server
spec:
  scaleTargetRef:
    name: generator-server
  minReplicaCount: 2
  maxReplicaCount: 8
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring.svc.cluster.local:9090
        metricName: inference_inflight_requests
        query: sum(inference_inflight_requests{service="generator-server"})
        threshold: "40"
```

This is still a simplification. For large models, a new pod may not be useful until the cluster has GPU nodes, the image is pulled, weights are loaded, and warmup completes.

## Admission Control

Inference services need request admission control before work reaches the GPU.

Example policy:

```ts
type InferenceRequest = {
  tenantId: string;
  model: string;
  inputTokens: number;
  maxOutputTokens: number;
  priority: "low" | "normal" | "high";
};

type TenantBudget = {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxConcurrentRequests: number;
  dailyTokenBudget: number;
};

export function admitRequest(
  request: InferenceRequest,
  budget: TenantBudget,
  currentConcurrency: number,
  tokensUsedToday: number
): { allowed: true } | { allowed: false; reason: string } {
  if (request.inputTokens > budget.maxInputTokens) {
    return { allowed: false, reason: "input token limit exceeded" };
  }

  if (request.maxOutputTokens > budget.maxOutputTokens) {
    return { allowed: false, reason: "output token limit exceeded" };
  }

  if (currentConcurrency >= budget.maxConcurrentRequests) {
    return { allowed: false, reason: "tenant concurrency limit exceeded" };
  }

  if (tokensUsedToday + request.inputTokens + request.maxOutputTokens > budget.dailyTokenBudget) {
    return { allowed: false, reason: "daily token budget exceeded" };
  }

  return { allowed: true };
}
```

This protects the system before Kubernetes is involved. Kubernetes autoscaling is not a substitute for product-level rate limits and budgets.

## PodDisruptionBudgets

Avoid voluntary disruptions taking down too much warm GPU capacity:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: generator-server-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: generator-server
```

For batch workers, a PDB may be less important if jobs are idempotent and checkpointed. For interactive model servers with long warmup, it matters.

## Graceful Shutdown

Inference pods often serve streaming responses or long jobs. On shutdown:

1. Fail readiness immediately.
2. Stop accepting new requests.
3. Finish in-flight requests within a deadline.
4. Checkpoint or requeue unfinished work.
5. Exit before `terminationGracePeriodSeconds`.

Example:

```yaml
terminationGracePeriodSeconds: 120
containers:
  - name: server
    lifecycle:
      preStop:
        httpGet:
          path: /admin/drain
          port: 8080
```

The `/admin/drain` endpoint should mark the pod not-ready and stop new work. It should not sleep blindly for 120 seconds.

## Observability

Expose model-server metrics:

- request rate
- p50/p95/p99 latency
- first-token latency
- tokens per second
- input tokens
- output tokens
- queue depth
- oldest queue message age
- in-flight requests
- GPU utilization
- GPU memory utilization
- model load time
- cold starts
- admission rejects
- OOM kills

Trace the request:

```text
POST /v1/generate
  admit_request
  enqueue_request
  dequeue_request
  load_model_if_needed
  run_inference
  stream_tokens
  write_result
```

Log structured lifecycle events:

```json
{
  "level": "INFO",
  "event": "inference_completed",
  "requestId": "req_123",
  "tenantId": "tenant_abc",
  "model": "summary-large",
  "inputTokens": 1820,
  "outputTokens": 312,
  "latencyMs": 4210,
  "gpuModel": "nvidia-l4",
  "pod": "summary-worker-6f4d9",
  "node": "gpu-node-7"
}
```

Do not log raw prompts by default. Hash or redact inputs and store raw samples only in controlled debug storage with short retention.

## Cost Controls

Cost controls belong at multiple layers:

Application:

- per-tenant token budgets
- request size limits
- concurrency limits
- priority classes
- cheaper model fallback for low-risk tasks

Kubernetes:

- GPU node taints
- namespace quotas
- max replicas
- priority classes
- cluster autoscaler limits
- scheduled scale-down for non-production

Model serving:

- batching
- quantization where quality allows it
- model cache warmup
- separate pools for small and large models
- queue admission instead of unbounded concurrency

A practical namespace quota:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: inference-quota
  namespace: ai-inference
spec:
  hard:
    requests.cpu: "200"
    requests.memory: 1Ti
    limits.nvidia.com/gpu: "16"
    pods: "80"
```

Quotas are not enough alone, but they prevent one namespace from consuming the whole cluster.

## Failure Modes

**GPU fragmentation.** You have enough total GPUs, but not on the right nodes or not with the right memory profile.

**Cold start storm.** Traffic spike triggers new pods, new pods trigger model downloads, and the cluster spends minutes warming instead of serving.

**Queue age grows while replicas are maxed.** Autoscaling is working, but capacity is capped by GPU nodes or `maxReplicaCount`.

**Readiness lies.** Pods become ready before the model is loaded and start failing real requests.

**CPU bottleneck.** Tokenization or JSON serialization is CPU-bound while GPU utilization looks low.

**OOM during long contexts.** Requests with large prompts or high output limits exceed memory even though normal requests pass.

**Scale-down kills useful work.** Long-running workers are terminated before checkpointing or requeueing.

**One tenant monopolizes GPUs.** Autoscaling increases capacity, but fairness is still broken.

**Metrics hide the model version.** You cannot tell whether a regression came from a model, prompt, image, or routing change.

## Production Checklist

- Use dedicated GPU node pools.
- Taint GPU nodes and require tolerations.
- Label GPU types explicitly.
- Request CPU and memory realistically.
- Put GPU resources in limits.
- Use startup and readiness probes that reflect model load state.
- Prefer queue-based inference for long-running or bursty workloads.
- Scale on queue or application metrics, not CPU alone.
- Keep warm capacity for interactive endpoints.
- Add admission control before the GPU.
- Enforce per-tenant budgets and concurrency limits.
- Use PodDisruptionBudgets for warm serving capacity.
- Drain pods gracefully during shutdown.
- Track GPU utilization, queue age, token throughput, latency, and cold starts.
- Keep raw prompts out of normal logs.
- Cap replicas and node pool size to control spend.

## Read Next

- [AI Infrastructure on AWS](/blog/ai-infrastructure-aws/)
- [LLM Inference Optimization](/blog/llm-inference-optimization/)
- [Kubernetes Production Best Practices](/blog/kubernetes-production-best-practices/)
- [Kafka Consumer Lag Playbook](/blog/kafka-consumer-lag-playbook/)

## Sources

- [Kubernetes: Schedule GPUs](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/)
- [KEDA: Scaling Deployments, StatefulSets, and Custom Resources](https://keda.sh/docs/2.17/concepts/scaling-deployments/)
