---
title: "AI Infrastructure on AWS: SageMaker, EKS GPU Scheduling, and Cost-Efficient Inference"
description: "Production AI/ML infrastructure on AWS: SageMaker real-time vs async inference endpoints, EKS GPU scheduling with nvidia device plugin, EC2 GPU instance selection (p4, g5, inf2 Inferentia), Spot instances for training workloads, and the architecture decisions that keep GPU bills under control."
date: "2026-04-08"
category: "AI/ML"
tags: ["aws", "sagemaker", "gpu", "eks", "inferentia", "ml infrastructure", "cost optimization", "ai"]
featured: false
affiliateSection: "aws-resources"
---

Running AI workloads in production is a different discipline from running web services. The hardware is expensive, the failure modes are opaque, and the cost curve compounds fast. After operating inference infrastructure across three production systems — a real-time fraud scoring API, a batch document processing pipeline, and an LLM-backed customer service agent — I have learned the decisions that matter and the ones that waste weeks of engineering time.

This post covers the concrete infrastructure layer: SageMaker endpoint types, EKS GPU scheduling, EC2 GPU instance selection, cost optimization levers, and the war stories that changed how I think about ML infrastructure.

---

## SageMaker Real-Time Inference Endpoints

SageMaker real-time endpoints are the right choice when your application needs a synchronous response within a few seconds. They maintain a persistent, warm container and load balancer, which means there is no cold start penalty per request.

### Instance Selection

The instance you choose determines your latency floor and cost ceiling. The general rules:

- **ml.g4dn.xlarge**: 1x NVIDIA T4, 16 GB GPU memory, 4 vCPU. The default starting point for most Transformers inference. Adequate for models up to ~7B parameters with quantization.
- **ml.g5.2xlarge**: 1x NVIDIA A10G, 24 GB GPU memory. Better throughput for LLMs and embedding workloads than T4-class instances. Step up when g4dn becomes the bottleneck or the model barely fits in 16 GB VRAM.
- **ml.p3.2xlarge**: 1x V100, 16 GB GPU memory. Older generation — better for training than inference. Avoid for new deployments.
- **ml.inf2.xlarge**: 2x Inferentia2 chips. AWS-purpose-built accelerator — excellent for Transformer inference after Neuron SDK compilation. Benchmark it for steady-state throughput workloads where framework compatibility is not a blocker.

The instance choice should follow measurement, not instinct. Before promoting any endpoint, capture p50, p95, p99 latency, tokens per second, GPU utilization, and cost per 1,000 requests under a realistic traffic mix. A model that looks cheap at one request per second can become expensive when concurrency rises and queueing begins.

### Deploying a Real-Time Endpoint (boto3)

```python
import boto3
import sagemaker
from sagemaker.model import Model
from sagemaker import get_execution_role

session = boto3.Session(region_name="us-east-1")
sm_client = boto3.client("sagemaker", region_name="us-east-1")
role = get_execution_role()

# Model artifact must be in S3 — tar.gz containing model weights + inference.py
model_artifact_uri = "s3://your-model-bucket/fraud-detector/v3/model.tar.gz"

model = Model(
    image_uri="763104351884.dkr.ecr.us-east-1.amazonaws.com/pytorch-inference:2.1.0-gpu-py310",
    model_data=model_artifact_uri,
    role=role,
    name="fraud-detector-v3",
    env={
        "SAGEMAKER_CONTAINER_LOG_LEVEL": "20",
        "MODEL_SERVER_WORKERS": "2",
        "TS_MAX_RESPONSE_SIZE": "10000000",
    },
)

predictor = model.deploy(
    initial_instance_count=2,
    instance_type="ml.g4dn.xlarge",
    endpoint_name="fraud-detector-prod",
    serializer=sagemaker.serializers.JSONSerializer(),
    deserializer=sagemaker.deserializers.JSONDeserializer(),
)
```

### Auto-Scaling the Endpoint

Default SageMaker endpoints do not scale. You must attach an Application Auto Scaling policy explicitly:

```python
autoscaling_client = boto3.client("application-autoscaling", region_name="us-east-1")

# Register the endpoint as a scalable target
autoscaling_client.register_scalable_target(
    ServiceNamespace="sagemaker",
    ResourceId="endpoint/fraud-detector-prod/variant/AllTraffic",
    ScalableDimension="sagemaker:variant:DesiredInstanceCount",
    MinCapacity=2,
    MaxCapacity=8,
)

# Target tracking policy on SageMakerVariantInvocationsPerInstance
autoscaling_client.put_scaling_policy(
    PolicyName="fraud-detector-scale-policy",
    ServiceNamespace="sagemaker",
    ResourceId="endpoint/fraud-detector-prod/variant/AllTraffic",
    ScalableDimension="sagemaker:variant:DesiredInstanceCount",
    PolicyType="TargetTrackingScaling",
    TargetTrackingScalingPolicyConfiguration={
        "TargetValue": 500.0,  # invocations per instance per minute
        "PredefinedMetricSpecification": {
            "PredefinedMetricType": "SageMakerVariantInvocationsPerInstance"
        },
        "ScaleInCooldown": 300,   # 5 minutes — avoid flapping
        "ScaleOutCooldown": 60,   # 1 minute — respond fast to spikes
    },
)
```

**War story**: We initially set `ScaleInCooldown` to 60 seconds. On a Friday afternoon traffic drop, the endpoint aggressively scaled in to 2 instances. Monday morning spike hit before scale-out completed, and p99 latency spiked to 8 seconds. Setting `ScaleInCooldown` to 300 seconds costs a few extra instance-hours on weekends but completely eliminated Monday morning latency incidents.

### Multi-Model Endpoints

When you have dozens of models that each receive sporadic traffic, running a dedicated endpoint per model is financially irrational. Multi-Model Endpoints (MME) load models from S3 on demand and cache them in memory. You pay for one endpoint, host many models.

The constraint: all models must use the same container. This works well for customer-specific fine-tuned variants of the same base model, or A/B experiment variants. It does not work when models have different frameworks.

```python
from sagemaker.multidatamodel import MultiDataModel

mme = MultiDataModel(
    name="customer-variant-models",
    model_data_prefix="s3://model-store/customer-variants/",
    model=model,          # base model definition from earlier
    role=role,
)

mme.deploy(
    initial_instance_count=1,
    instance_type="ml.g5.2xlarge",
    endpoint_name="customer-variants-mme",
)

# Invoke with target model specified per request
runtime_client = boto3.client("sagemaker-runtime")
response = runtime_client.invoke_endpoint(
    EndpointName="customer-variants-mme",
    TargetModel="customer-id-7841/model.tar.gz",
    ContentType="application/json",
    Body=json.dumps({"text": "process this"}),
)
```

---

## SageMaker Async Inference

Real-time endpoints fail silently when your model needs 30+ seconds per request — clients time out, retry loops amplify load, and your endpoint falls over. Async Inference is the answer for long-running jobs: document OCR, video analysis, large batch scoring.

Requests go to an SQS queue. SageMaker pulls from the queue, runs inference, writes output to S3, and optionally triggers an SNS notification.

```python
from sagemaker.async_inference import AsyncInferenceConfig

async_config = AsyncInferenceConfig(
    output_path="s3://inference-outputs/async-results/",
    notification_config={
        "SuccessTopic": "arn:aws:sns:us-east-1:123456789:inference-success",
        "ErrorTopic":   "arn:aws:sns:us-east-1:123456789:inference-error",
    },
    max_concurrent_invocations_per_instance=4,
)

model.deploy(
    initial_instance_count=1,
    instance_type="ml.g5.4xlarge",
    endpoint_name="doc-processor-async",
    async_inference_config=async_config,
)

# Submit a job — returns immediately with an InferenceId
response = runtime_client.invoke_endpoint_async(
    EndpointName="doc-processor-async",
    InputLocation="s3://inference-inputs/documents/doc-8821.json",
    ContentType="application/json",
)
inference_id = response["InferenceId"]
output_location = response["OutputLocation"]
```

The output lands in S3 at `OutputLocation`. Your application polls or waits for the SNS notification to know when it is ready.

**Important**: Async endpoints can scale down when the queue is empty, which makes them useful for bursty, cost-sensitive workloads. Newer SageMaker inference features also support scale-to-zero patterns for some real-time generative AI deployments, but async inference remains the simpler mental model when the user does not need an immediate response.

---

## EKS GPU Scheduling

If you run your own model serving stack — vLLM, TorchServe, Triton, or a custom FastAPI server — EKS gives you more control than SageMaker at the cost of more operational responsibility.

### NVIDIA Device Plugin

The device plugin is a DaemonSet that exposes GPU resources to the Kubernetes scheduler. Without it, pods cannot request GPUs.

```bash
kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.14.5/nvidia-device-plugin.yml
```

Verify it picked up the GPUs:

```bash
kubectl get nodes -o json | jq '.items[].status.allocatable | select(."nvidia.com/gpu")'
# {"nvidia.com/gpu": "8"}
```

### GPU Node Pool Configuration

Separate GPU nodes into a dedicated node group. Label them so only ML workloads land there:

```yaml
# eksctl nodegroup config
nodeGroups:
  - name: gpu-inference
    instanceType: g5.2xlarge
    minSize: 2
    maxSize: 10
    labels:
      workload-type: gpu-inference
    taints:
      - key: nvidia.com/gpu
        value: "true"
        effect: NoSchedule
    iam:
      withAddonPolicies:
        cloudWatch: true
```

The taint ensures that only pods with the matching toleration get scheduled on GPU nodes. CPU workloads do not accidentally land on expensive GPU instances.

### GPU Pod Spec

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llm-inference-server
  namespace: ml-serving
spec:
  replicas: 2
  selector:
    matchLabels:
      app: llm-inference-server
  template:
    metadata:
      labels:
        app: llm-inference-server
    spec:
      tolerations:
        - key: nvidia.com/gpu
          operator: Equal
          value: "true"
          effect: NoSchedule
      nodeSelector:
        workload-type: gpu-inference
      containers:
        - name: vllm-server
          image: 123456789.dkr.ecr.us-east-1.amazonaws.com/vllm-server:0.4.1
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "4"
              memory: "16Gi"
              nvidia.com/gpu: "1"
            limits:
              cpu: "8"
              memory: "24Gi"
              nvidia.com/gpu: "1"
          env:
            - name: MODEL_ID
              value: "meta-llama/Llama-3-8b-instruct"
            - name: MAX_MODEL_LEN
              value: "4096"
            - name: TENSOR_PARALLEL_SIZE
              value: "1"
          volumeMounts:
            - name: model-cache
              mountPath: /model-cache
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 120
            periodSeconds: 30
      volumes:
        - name: model-cache
          emptyDir:
            sizeLimit: 50Gi
```

**Requests vs Limits on GPU**: Unlike CPU and memory, Kubernetes does not support GPU over-provisioning. A pod that requests 1 GPU gets exactly 1 GPU exclusively. You cannot set GPU requests lower than limits. Set them equal.

### Horizontal Pod Autoscaler for GPU Pods

Standard HPA on CPU utilization does not make sense for GPU inference. Use KEDA with a custom metric from CloudWatch:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: llm-inference-scaler
  namespace: ml-serving
spec:
  scaleTargetRef:
    name: llm-inference-server
  minReplicaCount: 1
  maxReplicaCount: 8
  cooldownPeriod: 300
  triggers:
    - type: aws-cloudwatch
      metadata:
        namespace: ML/InferenceServer
        metricName: QueueDepth
        targetMetricValue: "10"
        minMetricValue: "0"
        awsRegion: us-east-1
```

---

## EC2 GPU Instance Type Comparison

Choosing the wrong instance type is the most expensive ML infrastructure mistake. Pricing varies by region and changes over time, so use the AWS pricing page for final numbers. The practical comparison below is about shape and fit:

| Instance | Accelerator | Memory Shape | Cost Profile | Best For |
|---|---|---|---|---|
| g4dn.xlarge | T4 x1 | 16 GB GPU memory | Lower | Small models, prototyping, cost-sensitive inference |
| g4dn.12xlarge | T4 x4 | 64 GB aggregate GPU memory | Medium | Multi-GPU small models, batching, legacy CUDA stacks |
| g5.xlarge | A10G x1 | 24 GB GPU memory | Medium | Mid-size Transformers, embedding models, FP16/BF16 inference |
| g5.12xlarge | A10G x4 | 96 GB aggregate GPU memory | High | Larger models, tensor parallelism, high-throughput serving |
| p4d.24xlarge | A100 x8 | 320 GB aggregate GPU memory | Very high | Large model training, heavy distributed inference |
| p5.48xlarge | H100 x8 | 640 GB aggregate GPU memory | Highest | Frontier-scale training and very high-end inference |
| inf2.xlarge | Inferentia2 x2 | Accelerator memory managed by Neuron | Medium | High-throughput Transformer inference with Neuron |
| inf2.48xlarge | Inferentia2 x12 | Large Neuron accelerator pool | High | Large Transformer inference at steady scale |

**Decision framework**:

1. If you are serving a model compatible with the Neuron SDK, benchmark `inf2` early. The savings can be meaningful at steady state, but only if compilation, operator support, and latency behavior work for your model.
2. For variable latency requirements where you need GPU flexibility, `g5` hits the best balance of cost and capability.
3. Use `p4d` only for training runs or when you genuinely need 8x A100s for a large model.
4. `g4dn` is a legacy-class instance now. Only use it if budget is extremely constrained and models fit in 16 GB VRAM.

### A Simple Routing Decision Matrix

| Workload | Latency Need | Traffic Shape | Preferred AWS Pattern |
|---|---|---|---|
| Fraud scoring | < 200 ms to a few seconds | Always on, spiky | SageMaker real-time endpoint with warm capacity |
| Document OCR | Minutes acceptable | Bursty, queueable | SageMaker Async Inference |
| Batch embeddings | Minutes to hours acceptable | Batch jobs | SageMaker Processing, Batch Transform, or EKS job workers |
| LLM chat assistant | Streaming response | User-facing, spiky | SageMaker real-time, inference components, or EKS with vLLM |
| Offline training | Hours acceptable | Interruptible | SageMaker training with Spot and checkpoints |
| Customer-specific small models | Seconds acceptable | Long tail of models | Multi-Model Endpoint if the container is shared |

---

## GPU Cost Optimization

GPU instances are expensive. The bill is where bad infrastructure decisions become visible.

### Spot Instances for Training

Training jobs are interruptible. SageMaker managed training jobs support Spot instances natively with automatic checkpointing:

```python
estimator = PyTorch(
    entry_point="train.py",
    role=role,
    instance_count=4,
    instance_type="ml.p4d.24xlarge",
    use_spot_instances=True,
    max_run=86400,          # 24 hours max wall-clock time
    max_wait=90000,         # allow 90000s including interruptions
    checkpoint_s3_uri="s3://training-checkpoints/run-20250315/",
    checkpoint_local_path="/opt/ml/checkpoints",
)
```

SageMaker restores from the latest checkpoint automatically when a Spot instance is reclaimed and relaunched. Spot savings can be large, but the only safe assumption is that interruption will happen at the worst possible time. Design the training script as if every hour must be recoverable.

**War story**: A training job without proper checkpointing ran for 18 hours, hit a Spot interruption, and restarted from zero. The team had no checkpoint logic in the training script — everything was written to `/tmp`. We lost 18 GPU-hours and the engineer spent a weekend adding `torch.save` checkpoint calls. Always checkpoint to S3. Always.

### Commit Baseline Capacity for Inference

Inference endpoints often run continuously. For the baseline load that never scales down, evaluate committed-use options such as SageMaker Savings Plans or equivalent capacity commitments instead of leaving everything on On-Demand.

The practical approach: commit only to your baseline load, then use On-Demand or autoscaled capacity for bursts above that floor. Do not commit to peak traffic unless the peak is predictable and sustained.

### Right-Sizing Inference Instances

GPU utilization is the signal most teams ignore. A model running at 15% GPU utilization on an `ml.g5.2xlarge` is a candidate for downsize to `ml.g4dn.xlarge` or migration to `inf2.xlarge`.

Enable GPU metrics in CloudWatch:

```python
from datetime import datetime, timedelta

cloudwatch = boto3.client("cloudwatch")

response = cloudwatch.get_metric_statistics(
    Namespace="AWS/SageMaker",
    MetricName="GPUUtilization",
    Dimensions=[
        {"Name": "EndpointName", "Value": "fraud-detector-prod"},
        {"Name": "VariantName",  "Value": "AllTraffic"},
    ],
    StartTime=datetime.utcnow() - timedelta(days=7),
    EndTime=datetime.utcnow(),
    Period=3600,
    Statistics=["Average", "Maximum"],
)
```

If average GPU utilization is below 40% over a 7-day window, you are over-provisioned. If it exceeds 80% regularly, you are under-provisioned and likely experiencing queuing latency.

---

## S3 and ECR Patterns for ML

### S3 Model Artifact Storage

Organize model artifacts with a versioned prefix structure. Flat storage becomes unmanageable past a dozen models:

```
s3://ml-artifacts-prod/
  models/
    fraud-detector/
      v1/model.tar.gz
      v2/model.tar.gz
      v3/model.tar.gz       <- latest production
    doc-processor/
      v4/model.tar.gz
  datasets/
    fraud-training/
      2025-01/raw/
      2025-01/processed/
      2025-02/raw/
      2025-02/processed/
  checkpoints/
    training-run-20250301/
      epoch-10.pt
      epoch-20.pt
      epoch-30.pt           <- final checkpoint
```

Enable S3 versioning on the models bucket. It costs a fraction of the storage bill and has saved two separate incidents where a model overwrite broke production.

Set lifecycle rules to transition old checkpoints to S3 Glacier after 30 days. Training checkpoints accumulate fast.

### ECR for ML Container Images

ML images are large — typically 8-20 GB for a container with CUDA libraries, framework, and dependencies. Manage this deliberately:

- Enable ECR image scanning on push. CUDA base images have known CVEs; you need visibility.
- Use multi-stage Docker builds to keep image size down. Your inference container does not need build tools.
- Tag images with the model version and framework version: `vllm-server:0.4.1-cuda12.1-py311`
- Set a lifecycle policy to expire untagged images after 14 days. ECR storage bills grow quietly.

```json
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Expire untagged images older than 14 days",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 14
      },
      "action": {"type": "expire"}
    }
  ]
}
```

---

## Building a Cost-Efficient Inference Stack

The architecture that consistently produces the lowest inference cost at production quality:

**Synchronous, latency-sensitive paths** (fraud scoring, recommendation ranking, search reranking): SageMaker real-time endpoint on `inf2.xlarge` or `g5.xlarge` with committed baseline capacity and On-Demand for burst. Target tracking auto-scaling on `SageMakerVariantInvocationsPerInstance`.

**Async, throughput-sensitive paths** (document processing, batch embedding generation, video analysis): SageMaker Async Inference on `g5.4xlarge` or `g5.12xlarge`. Scale-to-zero during off-hours. Use Spot instances where checkpoint recovery is feasible.

**Self-managed LLM inference** (when SageMaker's container constraints are too rigid): EKS GPU node pool with `g5` or `inf2` instances, vLLM for serving, KEDA for autoscaling on queue depth. This path requires more operational investment but gives you full control over batching, quantization, and hardware configuration.

The single biggest cost lever is **model quantization**. Moving from FP32 to BF16 cuts memory by 50%. INT8 quantization cuts it by 75%. A model that previously required a `g5.12xlarge` (4 GPUs) at FP32 may fit on a single `g5.2xlarge` at INT8 with acceptable accuracy loss. Benchmark this before choosing your instance class.

The second biggest lever is **request batching**. A single forward pass processing 16 requests costs nearly the same GPU compute as processing 1 request. SageMaker and vLLM both support dynamic batching. Setting the right batch size and timeout requires load testing at your actual request rate — there is no universal answer.

---

## Production Monitoring Checklist

AI infrastructure fails differently from web infrastructure. CPU, memory, and request count are not enough. At minimum, track:

- **p50, p95, and p99 latency** by model version and endpoint variant
- **queue depth** for async inference, batch embedding, and LLM request buffers
- **tokens per second** for generative workloads
- **GPU utilization** and GPU memory utilization
- **model load time** after deployment, restart, and scale-out
- **cold-start or warm-up time** for async and scale-to-zero paths
- **OOM kills** and CUDA out-of-memory errors
- **throttles** from downstream dependencies such as S3, DynamoDB, OpenSearch, or vector stores
- **cost per 1,000 requests** and cost per 1 million tokens
- **error rate by model version**, not just by endpoint

A useful dashboard groups these by model, endpoint, and deployment version. When a new model doubles latency, you want to see that before users report it.

For LLM serving, add a separate panel for prompt length, output length, time to first token, and total generation time. These explain more incidents than average GPU utilization does.

---

## Key Takeaways

- Use SageMaker real-time endpoints for synchronous inference. Attach auto-scaling explicitly — it is not enabled by default.
- Use SageMaker Async Inference for jobs exceeding 10-15 seconds when the caller can wait for an S3/SNS completion path.
- Multi-Model Endpoints are cost-effective when you have many similar models with sporadic traffic patterns.
- On EKS, the NVIDIA device plugin is required before GPU resources are schedulable. Taint GPU nodes to prevent CPU workload spillover.
- GPU requests and limits must be equal in Kubernetes pod specs. No over-provisioning is possible.
- Benchmark `inf2` for steady-state Transformer inference workloads when Neuron compatibility is acceptable.
- Always use Spot instances for training with checkpoint-to-S3 logic. Never run a multi-hour training job without it.
- Commit baseline inference capacity only after measuring real steady-state traffic. Use On-Demand or autoscaled capacity for burst.
- Monitor GPU utilization weekly. Idle GPUs are the most expensive infrastructure waste in ML systems.

The GPU bill is the forcing function that drives good ML infrastructure decisions. Most teams do not look at it until it is already too large to ignore. Look at it before that.

## Read Next

- [Vector Embeddings Deep Dive: From Theory to Production Search](/blog/vector-embeddings-deep-dive/)
- [Building a Production RAG System: Embeddings, Vector DBs, and Retrieval](/blog/building-rag-system-langchain/)
- [AWS Architecture Patterns for High-Traffic Applications](/blog/aws-high-traffic-architecture/)
