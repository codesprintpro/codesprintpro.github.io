---
title: "Kubernetes in Production: Patterns Every Backend Engineer Must Know"
description: "Resource requests and limits, liveness vs readiness probes, rolling deployments, HPA configuration, pod disruption budgets, and the mistakes that cause production outages in Kubernetes."
date: "2025-06-08"
category: "AWS"
tags: ["kubernetes", "k8s", "devops", "containers", "deployment", "aws", "eks"]
featured: false
affiliateSection: "aws-resources"
---

Running a container in Kubernetes and running a production workload in Kubernetes are different disciplines. The gap between `kubectl apply -f deployment.yaml` and a service that survives node failures, deployment rollouts, and traffic spikes without user-visible downtime is filled with configuration that doesn't exist in most tutorials.

## Resource Requests and Limits: The Foundation

Every production pod must have resource requests and limits. Without them, Kubernetes cannot make scheduling decisions and nodes become dangerously overloaded.

```yaml
resources:
  requests:
    memory: "512Mi"    # Scheduler uses this for placement decisions
    cpu: "250m"        # 250 millicores = 25% of one CPU core
  limits:
    memory: "1Gi"      # Container is OOMKilled if it exceeds this
    cpu: "1000m"       # Container is CPU-throttled (not killed) if it exceeds this
```

**CPU throttling vs OOM Kill:** CPU limits throttle — the container is slowed but kept running. Memory limits kill — the container is OOMKilled and restarted. This distinction matters: a CPU limit that's too low causes latency spikes; a memory limit that's too low causes crashes.

**Requests vs Limits ratio:** Kubernetes allows "overcommitting" — requesting 500m but limiting at 2000m. This is valid for bursty workloads but creates a risk: if all pods burst simultaneously, the node runs out of resources. For critical services, set requests = limits (Guaranteed QoS class) to prevent eviction.

**Setting the right values:**
```bash
# Check actual usage in production:
kubectl top pod -l app=api-service --containers
# Use P95 of observed memory as request, P99 + 20% headroom as limit

# For CPU: set request = P50 usage, limit = 2-4× request
```

## Liveness vs Readiness vs Startup Probes

These three probes are distinct and frequently misconfigured:

```yaml
livenessProbe:
  # Is the application alive? If not, restart the container.
  # Use this ONLY for deadlock detection — processes that are running but stuck.
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 3         # Restart after 3 failures
  timeoutSeconds: 5

readinessProbe:
  # Can the application serve traffic? If not, remove from Service endpoints.
  # Use this to signal when the app is ready and when it's temporarily busy.
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 3
  successThreshold: 1

startupProbe:
  # Overrides liveness during startup — prevents premature restarts for slow-starting apps.
  # Only needed when app takes > 30s to start.
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  failureThreshold: 30        # Allow up to 30 × 10s = 300s to start
  periodSeconds: 10
```

**Spring Boot actuator separation:**
```java
// application.properties
management.endpoint.health.group.liveness.include=livenessState
management.endpoint.health.group.readiness.include=readinessState,db,redis
```

Readiness probe fails → pod removed from load balancer (no new traffic) → existing connections drain. This is correct behavior during DB connection issues — the pod stays alive but stops receiving traffic.

Liveness probe fails → pod restarted. **Do not include DB/external checks in liveness probes.** If your DB is down and liveness probes fail, Kubernetes restarts all pods. Now you have all pods simultaneously in restart loops. The DB comes back but pods are thrashing. Always keep liveness probes lightweight.

## Rolling Deployments Without Downtime

Default rolling update configuration is too aggressive:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1          # Default: 25% — create at most 1 extra pod
    maxUnavailable: 0    # Never have fewer than replicas running
                         # This ensures zero-downtime: new pod must be Ready before old is terminated
```

For a service with 10 replicas:
- `maxUnavailable: 0, maxSurge: 1` → 1 new pod created, 1 old pod terminated when new is Ready. Linear, predictable.
- `maxUnavailable: 25%, maxSurge: 25%` → up to 2 old pods removed before new pods are Ready → brief 80% capacity.

**Graceful shutdown:** When Kubernetes terminates a pod, it sends `SIGTERM`, waits `terminationGracePeriodSeconds`, then sends `SIGKILL`. Your application must handle `SIGTERM` gracefully — stop accepting new connections, finish in-flight requests, then exit.

```java
// Spring Boot graceful shutdown:
// application.properties:
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

```yaml
# Pod spec:
terminationGracePeriodSeconds: 60  # Must be > your slowest request timeout
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 5"]
      # 5-second sleep before SIGTERM gives the load balancer time to
      # deregister the pod before it stops accepting connections
```

## Horizontal Pod Autoscaler Configuration

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-service
  minReplicas: 3          # Never go below 3 — one per AZ for HA
  maxReplicas: 50
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 60    # Scale at 60%, not 80% — headroom for spikes
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 70
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0      # Scale up immediately
      policies:
      - type: Percent
        value: 100                        # Can double pod count per 15s
        periodSeconds: 15
    scaleDown:
      stabilizationWindowSeconds: 300    # Wait 5 minutes before scaling down
```

**The HPA + JVM problem:** JVM heap is counted against memory limits. During startup, JVM allocates max heap upfront. If `maxHeap > memory.request`, every new pod immediately looks memory-heavy. HPA sees average memory at 90% and scales up before the JVM has warmed up. Fix: set `Xmx` to `memory.limit × 0.75`, and set `memory.request = memory.limit` (Guaranteed QoS).

## Pod Disruption Budgets

PDBs prevent Kubernetes from simultaneously evicting too many pods during node drains or cluster upgrades:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-service-pdb
spec:
  minAvailable: 2     # Always keep at least 2 pods running
  # OR:
  maxUnavailable: 1   # Never disrupt more than 1 pod at a time
  selector:
    matchLabels:
      app: api-service
```

Without a PDB, `kubectl drain node-1` removes all pods on that node simultaneously. With `minAvailable: 2` on a 3-replica deployment, the drain can only proceed one pod at a time — safe.

## ConfigMaps and Secrets: Common Mistakes

```yaml
# DO: Use envFrom for cleaner pod specs
envFrom:
- configMapRef:
    name: api-config
- secretRef:
    name: api-secrets

# DON'T: Mount secrets as env vars for sensitive data that rotates —
# env vars require pod restart to pick up new values.
# DO: Mount as files for secrets that rotate:
volumeMounts:
- name: db-credentials
  mountPath: /etc/credentials
  readOnly: true
volumes:
- name: db-credentials
  secret:
    secretName: db-credentials
    # Updates to the secret propagate to the file within ~1 minute
    # No pod restart needed
```

## Resource Quotas Per Namespace

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: production-quota
  namespace: production
spec:
  hard:
    requests.cpu: "50"          # Total CPU requests across all pods
    requests.memory: 100Gi
    limits.cpu: "100"
    limits.memory: 200Gi
    pods: "200"
    services: "20"
    persistentvolumeclaims: "50"
```

Quotas prevent a single team's misconfigured deployment from consuming all cluster resources.

## Production Checklist

Before any service goes to production on Kubernetes:

```
□ Resource requests AND limits set on all containers
□ Liveness probe (lightweight, no external deps)
□ Readiness probe (includes DB/cache connectivity)
□ Graceful shutdown configured (SIGTERM handler + preStop sleep)
□ terminationGracePeriodSeconds > max request duration
□ PodDisruptionBudget configured (minAvailable ≥ 2 for critical services)
□ HPA configured with appropriate min/max replicas
□ Anti-affinity rules for HA (pods spread across AZs)
□ Network policies limiting ingress/egress
□ Image tag pinned (never use :latest in production)
□ Resource quotas on namespace
```

Anti-affinity for AZ spread:
```yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
    - labelSelector:
        matchLabels:
          app: api-service
      topologyKey: topology.kubernetes.io/zone
      # Required: pods MUST be in different AZs
      # If only 1 AZ available, pod stays Pending (fail safe)
```
