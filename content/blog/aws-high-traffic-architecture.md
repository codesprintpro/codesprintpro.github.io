---
title: "AWS Architecture Patterns for High-Traffic Applications"
description: "Learn how to architect systems that handle millions of requests on AWS — covering load balancing, auto-scaling, RDS with read replicas, ElastiCache, SQS decoupling, and CloudFront CDN."
date: "2025-01-19"
category: "AWS"
tags: ["aws", "architecture", "high availability", "scalability", "cloud"]
featured: false
affiliateSection: "aws-resources"
---

Architecting on AWS is not about using every service in the catalog — it's about choosing the right services for your scale, stitching them together correctly, and understanding the failure modes of each. This article walks through a production-grade, high-traffic architecture with the reasoning behind each decision.

## The Reference Architecture

Before diving into each layer, it helps to see how all the pieces fit together. The diagram below shows the full request path — from a user's browser through DNS, CDN, load balancer, compute, caching, and into the database, with async job processing on the side. Understanding this end-to-end flow will make each layer's purpose clearer as you build it.

```
Internet
    │
    ▼
┌───────────────────────────────────────────┐
│           Route 53 (DNS)                  │
│    Latency-based routing to nearest region│
└─────────────────┬─────────────────────────┘
                  │
    ┌─────────────▼──────────────┐
    │    CloudFront CDN           │
    │    Static assets + API cache│
    │    WAF + Shield protection  │
    └─────────────┬──────────────┘
                  │
    ┌─────────────▼──────────────┐
    │  Application Load Balancer  │
    │  (ALB) — path-based routing │
    └──┬──────────┬──────────────┘
       │          │
  ┌────▼──┐  ┌────▼──────────┐
  │ ECS   │  │  ECS Fargate  │
  │Fargate│  │  (API service)│
  │(web)  │  │  Auto-scaling │
  └────┬──┘  └────┬──────────┘
       │          │
       └────┬─────┘
            │
  ┌─────────▼──────────────────────────┐
  │           ElastiCache Redis         │
  │     (session, hot data, rate limit) │
  └─────────────────┬──────────────────┘
                    │ cache miss
  ┌─────────────────▼──────────────────┐
  │        RDS Aurora PostgreSQL        │
  │   Primary (writes) + Reader x2      │
  │   Multi-AZ, automatic failover      │
  └─────────────────┬──────────────────┘
                    │
  ┌─────────────────▼──────────────────┐
  │              SQS                    │
  │    (async job decoupling)           │
  └─────────────────┬──────────────────┘
                    │
  ┌─────────────────▼──────────────────┐
  │         Lambda / ECS Workers        │
  │    (email, notifications, reports)  │
  └────────────────────────────────────┘
```

Notice that no single component handles the entire request — each layer offloads work to the next. This separation of concerns is what lets the system scale each component independently without rebuilding the whole stack.

## Layer 1: Traffic Entry — CloudFront + WAF

CloudFront is your first line of defense and performance optimization. Deploy it in front of everything — not just static assets.

Before writing any Terraform, it is worth understanding how CloudFront decides what to cache and for how long. The cache behavior table below maps URL path patterns to caching policies — this is the design decision that determines how much traffic ever reaches your origin servers. Without this differentiation, you either cache user-specific data incorrectly or miss the opportunity to cache public data entirely.

```
CloudFront use cases:
1. Static assets (S3): JS, CSS, images → cached at 600+ edge locations globally
2. API responses: Cache GET endpoints with low volatility (product catalog, pricing)
3. DDoS mitigation: CloudFront + AWS Shield Standard absorbs L3/L4 attacks for free

CloudFront cache behaviors:
  Path: /static/*           → Cache: 1 year, compress: gzip/brotli
  Path: /api/products/*     → Cache: 5 minutes (TTL), invalidate on update
  Path: /api/user/*         → No cache (personalized)
  Path: /api/checkout/*     → No cache, forward all headers
```

The following Terraform resource creates the CloudFront distribution with two cache behaviors: a default behavior with no caching (safe for dynamic API responses) and an ordered behavior for static assets with a one-year TTL. The `web_acl_id` attachment is what connects WAF rules — without it, your CDN layer has no protection against malicious traffic patterns.

```terraform
resource "aws_cloudfront_distribution" "main" {
  origin {
    domain_name = aws_lb.main.dns_name
    origin_id   = "alb-origin"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "alb-origin"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Origin"]
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 0   # No caching for dynamic content by default
    max_ttl     = 86400
  }

  # Static assets: long cache
  ordered_cache_behavior {
    path_pattern     = "/static/*"
    min_ttl          = 86400
    default_ttl      = 31536000  # 1 year
    max_ttl          = 31536000
    compress         = true
    # ... same methods and origin
  }

  web_acl_id = aws_wafv2_web_acl.main.arn
  price_class = "PriceClass_100"  # US + Europe edge locations only (cost optimization)
}
```

The `price_class = "PriceClass_100"` setting limits edge locations to the US and Europe — a deliberate cost tradeoff. If your users are global, bump this to `PriceClass_All`. Every cache hit here means one fewer request hitting your ALB and compute layer, which is where real money and latency accumulates at scale.

## Layer 2: Load Balancing — ALB vs NLB

Requests that miss the CDN cache arrive at your load balancer. The choice between ALB and NLB matters because they operate at different OSI layers and have very different cost and feature profiles.

**ALB (Application Load Balancer)** for HTTP/HTTPS:
- Path-based routing: `/api/*` → API service, `/admin/*` → admin service
- Host-based routing: `api.example.com` → API target group
- Request tracing (X-Amzn-Trace-Id headers)
- Native gRPC support
- Cost: ~$16/month base + per LCU

**NLB (Network Load Balancer)** for TCP/UDP:
- Ultra-low latency (< 1ms) for TCP-based protocols
- Static IP per AZ (needed for IP whitelisting)
- Handles millions of connections per second
- Use for: gaming servers, WebSockets at extreme scale, Kafka MSK clusters

For standard web APIs, ALB is the right choice.

The target group health check configuration below is where most teams make silent mistakes. The `DeregistrationDelay` setting is especially important — without a drain period, the ALB will send requests to containers that have already started shutting down, producing mysterious 502 errors during deployments.

```yaml
# ALB target group settings for containerized services
TargetGroup:
  HealthCheck:
    Path: /health
    HealthyThresholdCount: 2     # 2 consecutive successes = healthy
    UnhealthyThresholdCount: 3   # 3 consecutive failures = unhealthy
    Interval: 15                 # Check every 15s
    Timeout: 5
  DeregistrationDelay: 30        # Drain connections for 30s before removing instance
  Protocol: HTTP
  Port: 8080
```

## Layer 3: Compute — ECS Fargate with Auto-Scaling

ECS Fargate eliminates EC2 management while providing container orchestration. With the traffic entry layer handling caching and routing, your Fargate tasks only need to handle requests that actually require compute — but they need to scale efficiently when traffic spikes.

The auto-scaling policy below uses three metrics simultaneously. Relying on CPU alone is a common mistake — a memory-bound service or a queue-driven spike will not show CPU pressure until it is already too late. Using all three signals means the system reacts correctly regardless of the bottleneck type.

```yaml
# ECS Service auto-scaling configuration
AutoScaling:
  MinCapacity: 2                 # Never scale below 2 (for HA across AZs)
  MaxCapacity: 50

  ScalingPolicy:
    Type: TargetTrackingScaling
    Metrics:
      - ECSServiceAverageCPUUtilization: 70%  # Scale out when CPU > 70%
      - ECSServiceAverageMemoryUtilization: 80%
      - ALBRequestCountPerTarget: 1000         # Scale out at 1000 req/target

  # Scale-in protection: don't kill instances handling long requests
  ScaleInCooldown: 300           # Wait 5 minutes after scale-in
  ScaleOutCooldown: 60           # Scale out quickly
```

Note the asymmetric cooldowns: scale out fast (60 seconds) to absorb traffic spikes, but scale in slowly (300 seconds) to avoid terminating containers mid-request. If your containers handle long-running operations, increase the scale-in cooldown to match your p99 request duration.

**Container configuration for production:**

The container definition below wires together all the details ECS needs to run your service safely. Pay particular attention to the `startPeriod` in the health check — this gives the JVM or application framework time to initialize before ECS starts counting health check failures. Set it too low and ECS will kill healthy containers before they finish starting up.

```json
{
  "name": "api-service",
  "image": "123456789.dkr.ecr.us-east-1.amazonaws.com/api:latest",
  "cpu": 512,
  "memory": 1024,
  "environment": [
    {"name": "SPRING_PROFILES_ACTIVE", "value": "prod"},
    {"name": "DB_URL", "valueFrom": "arn:aws:ssm:us-east-1::parameter/prod/db-url"}
  ],
  "healthCheck": {
    "command": ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"],
    "interval": 15,
    "timeout": 5,
    "retries": 3,
    "startPeriod": 60
  },
  "logConfiguration": {
    "logDriver": "awslogs",
    "options": {
      "awslogs-group": "/ecs/api-service",
      "awslogs-region": "us-east-1",
      "awslogs-stream-prefix": "ecs"
    }
  }
}
```

## Layer 4: Caching — ElastiCache Redis

ElastiCache Redis reduces database load by 80-95% for read-heavy workloads. Before choosing a caching pattern, you need to understand the tradeoffs — each pattern has different consistency guarantees and failure behavior, and picking the wrong one is a common source of bugs in high-traffic systems.

```
Cache patterns:

1. Cache-aside (most common):
   Read: Check cache → miss → read DB → write cache → return
   Write: Update DB → invalidate cache (or write-through)

2. Write-through:
   Write: Update DB + update cache (synchronously)
   Read: Always from cache (never a miss)
   Downside: Cache is never stale; write latency increases

3. Write-behind (write-back):
   Write: Update cache → queue DB write asynchronously
   Risk: Cache failure = data loss
   Use for: Click counters, view counts (high-write, low-loss-risk)
```

Cache-aside is the default for most API workloads because it tolerates cache failures gracefully — a cache miss just falls through to the database. Write-through is the right choice when staleness is unacceptable (e.g., financial balances). Write-behind is only appropriate when you can accept losing writes in a cache failure scenario.

The Terraform configuration below provisions a Redis replication group with automatic failover and Multi-AZ enabled. The `num_cache_clusters: 3` setting gives you one primary and two replicas — if the primary fails, AWS automatically promotes a replica within seconds. Without `automatic_failover_enabled`, your application would be writing to a dead primary until you manually intervened.

```terraform
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "prod-redis"
  description                = "Production Redis cluster"
  node_type                  = "cache.r7g.large"  # 13.07 GB RAM
  num_cache_clusters         = 3                  # 1 primary + 2 replicas
  automatic_failover_enabled = true               # Auto-promote replica on primary failure
  multi_az_enabled           = true               # Spread across AZs
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = var.redis_auth_token

  # Maintenance window during low traffic
  maintenance_window = "sun:05:00-sun:06:00"
  snapshot_window    = "04:00-05:00"
  snapshot_retention_limit = 7  # Keep 7 days of snapshots
}
```

## Layer 5: Database — RDS Aurora PostgreSQL

With caching handling the majority of reads, your database primarily needs to handle writes and cache misses. Aurora PostgreSQL is the right choice here because it gives you PostgreSQL compatibility with a distributed storage engine built for high availability.

Aurora is PostgreSQL-compatible but with a distributed storage engine that provides:
- **6-way replication** across 3 AZs automatically (no configuration needed)
- **15 read replicas** per cluster (vs 5 for standard RDS)
- **Aurora Serverless v2** for variable workloads (scales instantly from 0.5 to 128 ACUs)
- **Sub-second failover** (vs 60-120s for standard RDS Multi-AZ)

At scale, a single database connection pool pointed at the writer endpoint becomes a bottleneck. The Java configuration below implements read/write splitting — writes always go to the primary Aurora writer, and reads tagged with `@Transactional(readOnly=true)` are routed to the reader endpoint, which Aurora load-balances across your replicas. This pattern alone can offload 70-90% of your database traffic off the primary.

```java
// Java connection configuration with read/write splitting
@Configuration
public class DataSourceConfig {

    @Bean
    @Primary
    public DataSource writeDataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(System.getenv("AURORA_WRITER_ENDPOINT")); // cluster endpoint
        config.setMaximumPoolSize(20);
        config.setMinimumIdle(5);
        config.setConnectionTimeout(3000);
        config.setIdleTimeout(600000);
        return new HikariDataSource(config);
    }

    @Bean
    public DataSource readDataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(System.getenv("AURORA_READER_ENDPOINT")); // reader endpoint = load balanced across replicas
        config.setMaximumPoolSize(50); // Readers can handle more connections
        config.setReadOnly(true);
        return new HikariDataSource(config);
    }

    // Route @Transactional(readOnly=true) to reader, writes to primary
    @Bean
    public DataSource routingDataSource(
            @Qualifier("writeDataSource") DataSource write,
            @Qualifier("readDataSource") DataSource read) {
        Map<Object, Object> dataSources = new HashMap<>();
        dataSources.put("write", write);
        dataSources.put("read", read);

        AbstractRoutingDataSource routing = new AbstractRoutingDataSource() {
            @Override
            protected Object determineCurrentLookupKey() {
                return TransactionSynchronizationManager.isCurrentTransactionReadOnly()
                    ? "read" : "write";
            }
        };
        routing.setTargetDataSources(dataSources);
        routing.setDefaultTargetDataSource(write);
        return routing;
    }
}
```

The key takeaway: the `AbstractRoutingDataSource` inspects Spring's `TransactionSynchronizationManager` at runtime to choose the datasource — no application code needs to know which database it is talking to. Your existing `@Transactional(readOnly=true)` annotations on service methods are the only signal needed to route traffic correctly.

## Layer 6: Async Decoupling — SQS + Lambda

Synchronous calls to slow operations (email, PDF generation, third-party APIs) increase latency and reduce availability. Decouple them with SQS.

The problem this solves is straightforward: if sending an order confirmation email takes 800ms and Mailgun is down, your `/checkout` endpoint fails with a 503. By publishing to SQS instead, the order creation succeeds in under 50ms and the email delivery retries independently — a failure in the downstream system no longer propagates back to your user.

```java
// Publish to SQS (non-blocking, returns immediately)
@Service
public class OrderService {

    @Autowired
    private SqsAsyncClient sqsClient;

    @Value("${sqs.order-events.url}")
    private String queueUrl;

    public Order createOrder(OrderRequest request) {
        Order order = orderRepository.save(buildOrder(request));

        // Async: don't wait for these — they'll process in background
        sqsClient.sendMessage(SendMessageRequest.builder()
            .queueUrl(queueUrl)
            .messageBody(objectMapper.writeValueAsString(new OrderCreatedEvent(order)))
            .messageGroupId(order.getUserId())         // FIFO: preserve per-user order
            .messageDeduplicationId(order.getId())     // Idempotent
            .build());

        return order; // Return immediately — don't wait for email/notification
    }
}

// Lambda consumer: processes SQS messages
@Component
public class OrderEventHandler {

    @SqsListener("${sqs.order-events.url}")
    public void handleOrderCreated(OrderCreatedEvent event) {
        emailService.sendOrderConfirmation(event);
        inventoryService.reserve(event.getItems());
        analyticsService.trackConversion(event);
    }
}
```

**SQS Configuration for reliability:**

The Terraform configuration below is where the resilience is actually built. The dead letter queue with `maxReceiveCount: 3` ensures that a message that consistently fails processing (a malformed payload, a bug in your handler) does not loop forever and block other messages. The `visibility_timeout_seconds` must be longer than your Lambda's maximum execution time — if it is not, SQS will make the message visible again while your function is still processing it, causing duplicate processing.

```terraform
resource "aws_sqs_queue" "order_events" {
  name                        = "order-events.fifo"
  fifo_queue                  = true
  content_based_deduplication = false

  # Dead Letter Queue: move unprocessable messages after 3 attempts
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.order_events_dlq.arn
    maxReceiveCount     = 3
  })

  # Visibility timeout > Lambda function max execution time
  visibility_timeout_seconds = 120  # 2 minutes
  message_retention_seconds  = 86400 * 7  # 7 days
}
```

## Observability: CloudWatch + X-Ray

With the core architecture in place, you need to see what is happening inside it. Structured logging is the foundation — CloudWatch Logs Insights can run SQL-like queries against JSON logs, letting you find all errors for a specific user or calculate p99 latency across a time window in seconds.

The Spring AOP aspect below intercepts every request handler without modifying individual controllers. Emitting structured JSON for both success and error paths means every request is queryable in CloudWatch without string parsing — you can query `status="error"` and immediately see error rates by method.

```java
// Structured logging (CloudWatch Insights can query JSON logs)
@Aspect
@Component
public class RequestLoggingAspect {

    @Around("@annotation(org.springframework.web.bind.annotation.RequestMapping)")
    public Object logRequest(ProceedingJoinPoint pjp) throws Throwable {
        long start = System.currentTimeMillis();
        try {
            Object result = pjp.proceed();
            log.info("{\"event\":\"request\",\"method\":\"{}\",\"duration_ms\":{},\"status\":\"success\"}",
                pjp.getSignature().getName(), System.currentTimeMillis() - start);
            return result;
        } catch (Exception e) {
            log.error("{\"event\":\"request\",\"method\":\"{}\",\"duration_ms\":{},\"status\":\"error\",\"error\":\"{}\"}",
                pjp.getSignature().getName(), System.currentTimeMillis() - start, e.getMessage());
            throw e;
        }
    }
}
```

**Key CloudWatch alarms to set:**

Alarms are your early warning system — they tell you something is wrong before your customers do. The two alarms below cover the most critical signals: error rate at the load balancer (the first place you will see cascading failures) and database CPU (the most common database bottleneck under sustained load). Set these before you go live, not after the first incident.

```terraform
# ALB error rate alarm
resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "prod-alb-5xx-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_ELB_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 50       # Alert if >50 5xx errors per minute
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# RDS CPU alarm
resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "prod-aurora-cpu"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  threshold           = 80       # Alert at 80% CPU
  period              = 300      # 5-minute average
}
```

## Cost Optimization

Once your architecture is functional and observable, cost optimization is about choosing the right purchasing model for each layer's usage pattern. The six levers below apply to every production AWS architecture — each one saves money without changing your application code.

```
Architecture cost levers:

1. Reserved Instances for predictable baseline (1-year RI = 30-40% savings)
   → ECS Fargate Compute Savings Plans, RDS Reserved Instances

2. Spot Instances for fault-tolerant batch workloads
   → Lambda@Edge, ECS Spot (with Spot interruption handling)

3. S3 Intelligent-Tiering for infrequently accessed objects
   → Automatically moves to cheaper storage tiers

4. CloudFront reduces origin (ALB + compute) costs by serving cache
   → Every cache hit saves an ALB request + compute + DB query

5. Aurora Serverless v2 for dev/staging environments
   → Scales to zero when idle → pay only when in use

6. DynamoDB on-demand vs provisioned
   → On-demand for unpredictable workloads (pay per request)
   → Provisioned + auto-scaling for predictable traffic (cheaper)
```

This architecture handles 100K+ RPS with sub-100ms p99 latency. The key architectural principles: cache aggressively at every layer, decouple async work from the request path, use managed services to reduce operational overhead, and design for failure at every layer.

The AWS Well-Architected Framework labels these as the Reliability, Performance, and Cost pillars. In practice, they're just good engineering — the same principles that worked before cloud, applied to managed services.
