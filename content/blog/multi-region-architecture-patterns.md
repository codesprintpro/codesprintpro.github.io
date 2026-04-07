---
title: "Multi-Region Architecture: Active-Active, Active-Passive, and Consistency Trade-Offs"
description: "A practical guide to multi-region system design: active-active vs active-passive, DNS failover, RPO/RTO, data replication, conflict resolution, global databases, and when not to go multi-region."
date: "2026-04-07"
category: "System Design"
tags: ["multi-region", "system design", "distributed systems", "aws", "reliability", "disaster recovery"]
featured: false
affiliateSection: "system-design-courses"
---

Multi-region architecture is expensive insurance. It can improve availability and latency, but it also makes data consistency, deployment, observability, and operations much harder.

Before designing multi-region, ask two questions:

1. **What is the maximum acceptable downtime?** This is RTO: recovery time objective.
2. **How much data can we afford to lose?** This is RPO: recovery point objective.

If the business can tolerate one hour of downtime and five minutes of data loss, the design is very different from a payment system that needs near-zero downtime and no lost transactions.

## Active-Passive

In active-passive, one region serves traffic and another waits as standby.

```
Users -> Region A (active)
          Region B (standby)
```

Data replicates from active to standby. During failover, traffic shifts to the standby region.

Pros:

- simpler than active-active
- fewer write conflicts
- easier operational model
- cheaper if standby is scaled down

Cons:

- failover takes time
- standby may not be fully warm
- replication lag can cause data loss
- failover must be tested regularly

Active-passive is a good default for many companies. It gives disaster recovery without forcing every service to become globally distributed.

## Active-Active

In active-active, multiple regions serve traffic at the same time.

```
Users in India -> ap-south-1
Users in Europe -> eu-west-1
Users in US -> us-east-1
```

Pros:

- lower user latency
- better regional availability
- no cold standby
- can absorb regional traffic locally

Cons:

- write conflicts
- complex data replication
- harder incident response
- harder testing
- more expensive

Active-active is not just "run the same service in two regions." The hard part is data.

## Traffic Routing

DNS-based routing is common:

```yaml
Record: api.example.com
Routing: latency-based
Health check:
  us-east-1 /health/ready
  eu-west-1 /health/ready
```

Route 53 can route users to the lowest-latency healthy region. But DNS has caching. Failover is not instant for every client.

For faster failover, use global load balancers or anycast-style solutions, but expect more operational complexity.

## Data Replication Patterns

### Single-Writer

Only one region accepts writes for a data domain:

```
Reads: local region
Writes: primary region
Replication: primary -> secondary
```

This avoids conflicts. The tradeoff is write latency for users far from the primary region.

Use for:

- payments
- inventory
- account balances
- strongly consistent workflows

### Multi-Writer

Multiple regions accept writes:

```
Region A writes user profile
Region B writes user profile
Replication merges changes
```

Now you need conflict resolution.

Common strategies:

- last write wins
- region priority
- field-level merge
- business-specific conflict handling
- CRDTs for special data types

Last write wins is simple and dangerous. If two admins update different fields, one update can overwrite the other unless merges are field-aware.

## Conflict Example

User profile starts as:

```json
{
  "name": "Asha",
  "phone": "111",
  "address": "Bangalore"
}
```

Region A updates phone:

```json
{ "phone": "222" }
```

Region B updates address:

```json
{ "address": "Mumbai" }
```

If both write full records with last write wins, one change may be lost. Field-level updates are safer:

```json
{
  "phone": { "value": "222", "updatedAt": "10:01:00Z" },
  "address": { "value": "Mumbai", "updatedAt": "10:01:05Z" }
}
```

But this complexity belongs only where multi-writer is truly needed.

## RPO and RTO Mapping

| Requirement | Possible Design |
|---|---|
| RTO hours, RPO minutes | backups + restore runbook |
| RTO minutes, RPO minutes | active-passive with async replication |
| RTO seconds, RPO near-zero | warm standby with strong replication |
| Low latency globally | active-active reads, controlled writes |
| Regional write availability | active-active multi-writer with conflict handling |

Most systems do not need the hardest row in the table.

## Deployment Strategy

Multi-region deploys should be staged:

```
1. Deploy region B canary
2. Validate metrics
3. Deploy region B full
4. Deploy region A canary
5. Deploy region A full
```

Never assume both regions behave the same. Configuration, secrets, quotas, network paths, and dependency endpoints can differ.

Use region labels in every metric:

```
http_request_duration{region="us-east-1"}
http_request_duration{region="eu-west-1"}
```

Without regional labels, you cannot see whether one region is failing.

## Failover Runbook

A failover runbook should be executable under stress:

```markdown
## Failover API from Region A to Region B

1. Confirm Region A user impact
2. Freeze deploys
3. Check Region B readiness dashboard
4. Confirm database replica lag < accepted RPO
5. Promote Region B database if needed
6. Shift 10% traffic
7. Watch error rate and p95 latency for 5 minutes
8. Shift 100% traffic
9. Announce mitigation status
10. Start root cause investigation
```

Test this runbook. Untested failover is wishful thinking.

## When Not to Go Multi-Region

Avoid multi-region when:

- your single-region architecture is not mature
- you do not have strong observability
- database migrations are still risky
- you cannot test failover regularly
- the business does not need the RTO/RPO improvement
- the team cannot support 24/7 operational complexity

A poorly operated multi-region system can be less reliable than a well-operated single-region system.

## Production Checklist

- Define RTO and RPO before architecture
- Prefer active-passive unless active-active is clearly required
- Keep strongly consistent domains single-writer where possible
- Design conflict resolution before enabling multi-writer writes
- Label every metric by region
- Test failover regularly
- Document DNS/global routing behavior
- Monitor replication lag
- Stage deployments by region
- Keep a rollback and failback plan

Multi-region architecture is a tradeoff, not a trophy. Use it when the business requirement justifies the consistency and operational cost. Otherwise, invest first in backups, automation, observability, and safe single-region recovery.
