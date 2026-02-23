---
title: "Cloud Cost Optimization: Engineering Practices That Cut AWS Bills by 50%"
description: "Systematic AWS cost reduction: right-sizing EC2 and RDS instances, Savings Plans vs Reserved Instances, S3 lifecycle policies, data transfer cost elimination, EKS node optimization, RDS read replicas vs caching, and the observability stack for cost monitoring."
date: "2025-04-29"
category: "AWS"
tags: ["aws", "cost optimization", "ec2", "rds", "s3", "eks", "savings plans", "finops"]
featured: false
affiliateSection: "aws-resources"
---

Cloud bills scale with usage — but they also scale with inattention. Most teams that haven't deliberately optimized their AWS spend are 30-50% over what they need to pay for the same workload. The savings come from a predictable set of actions: right-sizing overprovisioned resources, eliminating idle resources, using commitment discounts for stable workloads, and fixing the architectural patterns that cause unnecessary data transfer costs.

## The Cost Visibility Problem

You can't optimize what you can't measure. Start with AWS Cost Explorer and cost allocation tags:

```bash
# Tag every resource with team, environment, service:
aws ec2 create-tags \
  --resources i-1234567890abcdef0 \
  --tags Key=Team,Value=platform Key=Service,Value=order-api Key=Environment,Value=prod

# AWS CLI: find untagged resources (the silent budget killers):
aws resource-tagging get-resources \
  --tag-filters 'Key=Environment' \
  --resource-type-filters 'ec2:instance' \
  --query 'ResourceTagMappingList[?Tags[?Key==`Environment`].Value|[0]!=`prod`]'

# Cost allocation tags must be activated in AWS Billing:
aws ce create-cost-category-definition \
  --name "By Service" \
  --rule-version CostCategoryExpression.v1 \
  --rules '[{"Value":"order-api","Rule":{"Tags":{"Key":"Service","Values":["order-api"]}}}]'
```

**The Trusted Advisor / Compute Optimizer check:**

```bash
# AWS Compute Optimizer: automated right-sizing recommendations
aws compute-optimizer get-ec2-instance-recommendations \
  --account-ids 123456789012 \
  --query 'instanceRecommendations[?finding==`OVER_PROVISIONED`].{
    Instance: instanceArn,
    CurrentType: currentInstanceType,
    RecommendedType: recommendationOptions[0].instanceType,
    EstimatedSavings: recommendationOptions[0].estimatedMonthlySavings.value
  }'
# Output: list of instances with recommended downsizes and savings estimates
```

## Right-Sizing: The Highest-ROI Action

An m5.2xlarge running at 8% CPU average is paying for 8× more compute than needed. Compute Optimizer provides evidence-based recommendations:

```
Right-sizing process:

1. Enable Compute Optimizer (free for basic, $0.003/resource/month for enhanced)
2. Run for 14+ days to collect utilization data
3. Filter recommendations by "Over-provisioned" + estimated savings
4. Sort by estimated monthly savings descending
5. Review utilization graphs: CPU p99, memory, network
6. Right-size: use next smaller instance type (don't jump 2 sizes — verify first)

Common finding: m5.2xlarge (8 vCPU) at 8% avg CPU
Recommendation: m5.large (2 vCPU) at 30% avg CPU
Monthly savings: $150-200/instance
```

**RDS right-sizing follows the same pattern:**

```bash
# Check RDS CPU and memory utilization:
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name CPUUtilization \
  --dimensions Name=DBInstanceIdentifier,Value=orders-prod \
  --start-time 2025-01-01T00:00:00Z \
  --end-time 2025-02-01T00:00:00Z \
  --period 86400 \
  --statistics Average,p99

# If avg CPU < 20% and memory > 60% free:
# Consider: db.r6g.large → db.r6g.medium (save ~$100/month)
# Or: db.r6g.large → db.t4g.large (burstable — if traffic is bursty, saves ~$150/month)
```

**One risk:** Averages lie. An instance running at 5% CPU average may spike to 95% during business hours. Use p99 metrics and peak utilization windows, not just averages.

## Savings Plans and Reserved Instances

On-demand pricing is 3-4× more expensive than commitment pricing for stable workloads:

```
EC2 pricing comparison (m5.xlarge, us-east-1):
On-demand:         $0.192/hour = $139.67/month
1-year no-upfront: $0.118/hour = $86.14/month  (38% savings)
3-year no-upfront: $0.072/hour = $52.56/month  (62% savings)
1-year all-upfront: $0.109/hour (effective) = $795.25/year = $66.27/month (43% savings)

For an instance running 24/7 that you know you'll need for 1 year:
Committing saves $53/month = $636/year per instance.
At 50 instances: $31,800/year saved with zero architectural change.
```

**Savings Plans vs. Reserved Instances:**

| Factor | Savings Plans (Compute) | Reserved Instances |
|--------|------------------------|-------------------|
| Flexibility | Any EC2, Fargate, Lambda | Specific instance family/region |
| Discount | Up to 66% | Up to 72% |
| Commitment | $/hour spend commitment | Specific resource |
| Recommendation | Most cases | When you know exact instance type |

**Process:**
1. Run at least 3 months on on-demand to understand stable baseline
2. Use Cost Explorer's Savings Plans Recommendations (analyzes your usage, suggests commitment amount)
3. Buy Savings Plans for 70-80% of stable baseline (leave buffer for scale-up periods)
4. Review quarterly — add more coverage as workloads stabilize

## S3 Cost Optimization

S3 costs have three components: storage, requests, and data transfer:

```
Storage class cost per GB/month (us-east-1, Jan 2025):
S3 Standard:              $0.023
S3 Standard-IA:           $0.0125 (45% cheaper, retrieval fee applies)
S3 One Zone-IA:           $0.01
S3 Glacier Instant:       $0.004
S3 Glacier Flexible:      $0.0036
S3 Glacier Deep Archive:  $0.00099

Lifecycle policy: automatically move objects to cheaper tiers as they age
```

```json
// S3 lifecycle policy — tiered cost reduction:
{
  "Rules": [{
    "ID": "IntelligentTieringAndArchival",
    "Status": "Enabled",
    "Filter": { "Prefix": "logs/" },
    "Transitions": [
      { "Days": 30, "StorageClass": "STANDARD_IA" },
      { "Days": 90, "StorageClass": "GLACIER_IR" },
      { "Days": 365, "StorageClass": "DEEP_ARCHIVE" }
    ],
    "Expiration": { "Days": 2555 }  // Delete after 7 years
  }]
}
```

**S3 Intelligent Tiering** — for objects with unpredictable access patterns. Automatically moves objects between tiers based on access frequency. Management fee: $0.0025/1,000 objects. Worthwhile at > 100K objects.

**Data transfer costs (often the surprise):**
```
S3 data transfer pricing:
Inbound to S3: free
Outbound to internet: $0.09/GB (first 10TB)
Outbound to EC2 in SAME region: free
Outbound to EC2 in DIFFERENT region: $0.02/GB
Between availability zones in same region: $0.01/GB each direction

Fix cross-AZ costs:
- Deploy EC2, RDS, and S3 in the same AZ for data-heavy applications
- Use VPC endpoints for S3 (traffic via AWS backbone, not internet)
- Use CloudFront for serving content (replaces S3 → internet transfers)
```

## Data Transfer: The Hidden Cost Driver

Data transfer is often the largest unexpected cost item:

```
Common data transfer cost scenarios:

1. EC2 → Internet (no CloudFront): $0.09/GB
   At 10TB/month: $920/month
   With CloudFront: $0.085/GB (marginal difference, but CloudFront adds caching = less origin traffic)
   With CloudFront + cache hit 80%: effectively $0.017/GB on origin traffic

2. NAT Gateway: $0.045/GB + $0.045/hour
   Lambda or ECS in private subnet → NAT Gateway → Internet
   At 10TB/month: $450/month just for NAT
   Fix: VPC endpoints for AWS services (S3, DynamoDB, Secrets Manager)
   Fix: Consider public subnet for non-sensitive services (with security groups)

3. Cross-region replication: $0.02/GB inter-region
   Multi-region replication for S3/RDS: can add up at high volumes

4. RDS Multi-AZ: Cross-AZ replication included in Multi-AZ pricing
   (Not an additional cost — already factored in)
```

**VPC endpoint savings:**

```bash
# Create VPC endpoint for S3 (eliminates NAT Gateway costs for S3 traffic):
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-12345678 \
  --service-name com.amazonaws.us-east-1.s3 \
  --route-table-ids rtb-12345678 rtb-87654321

# Create VPC endpoint for DynamoDB:
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-12345678 \
  --service-name com.amazonaws.us-east-1.dynamodb \
  --route-table-ids rtb-12345678

# Create Interface endpoint for Secrets Manager (costs $0.01/hour but saves NAT costs):
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-12345678 \
  --vpc-endpoint-type Interface \
  --service-name com.amazonaws.us-east-1.secretsmanager \
  --subnet-ids subnet-12345678
```

## EKS / Container Cost Optimization

```
EKS node right-sizing:
Default: m5.xlarge nodes, avg pod utilization 25%
→ 75% of compute purchased is unused (scheduling overhead, bin-packing inefficiency)

Solutions:
1. Karpenter: right-sized node provisioning per workload
   → Provisions exact node size needed for pending pods
   → Consolidation: moves pods to fill nodes, terminates underutilized ones
   → Savings: 30-50% reduction in node count

2. Spot instances for non-critical workloads:
   Spot pricing: 70-90% discount vs on-demand
   Risk: 2-minute interruption notice
   Safe for: batch jobs, stateless services with replicas, dev/staging

3. ARM/Graviton nodes: 20% cheaper than x86 for same performance
   m6g.xlarge vs m5.xlarge: $0.154/hour vs $0.192/hour (20% savings)
   Requirements: multi-platform Docker images (--platform linux/amd64,linux/arm64)
```

## Cost Monitoring: Anomaly Detection

```bash
# AWS Cost Anomaly Detection — automatic alert on unexpected spend:
aws ce create-anomaly-monitor \
  --anomaly-monitor '{
    "MonitorName": "AllServices",
    "MonitorType": "DIMENSIONAL",
    "MonitorDimension": "SERVICE"
  }'

aws ce create-anomaly-subscription \
  --anomaly-subscription '{
    "MonitorArnList": ["arn:aws:ce::123456789012:anomalymonitor/..."],
    "SubscriptionName": "CostAnomalyAlert",
    "Threshold": 20,
    "Frequency": "DAILY",
    "Subscribers": [{"Address": "platform-team@company.com", "Type": "EMAIL"}]
  }'
# Alerts when any service's daily spend is 20% above expected
```

The most reliable cost reduction comes from treating cloud costs as an engineering problem, not a finance problem. Right-size resources with Compute Optimizer data, commit to Savings Plans for stable baseline usage, eliminate cross-AZ and NAT Gateway traffic with VPC endpoints, and use lifecycle policies on S3. The combination of these four actions, applied systematically, consistently reduces cloud bills by 40-60% without changing application behavior.
