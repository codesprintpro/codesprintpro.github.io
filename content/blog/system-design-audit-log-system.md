---
title: "System Design: Building an Audit Log System for Compliance and Debugging"
description: "Design a production audit log system with immutable events, schema design, write paths, search, retention, tamper resistance, PII controls, partitioning, and compliance tradeoffs."
date: "2026-04-07"
category: "System Design"
tags: ["system design", "audit logs", "compliance", "security", "event architecture", "backend engineering"]
featured: false
affiliateSection: "system-design-courses"
---

Audit logs answer a simple question: **who did what, to which resource, from where, and when?**

That question matters during security investigations, customer support, compliance audits, data recovery, and debugging. A normal application log is not enough. Application logs are optimized for engineers. Audit logs are product and compliance records.

An audit log system must be durable, queryable, immutable, and careful with sensitive data.

## Requirements

Functional requirements:

- record user actions
- record system actions
- show audit history for a resource
- search by actor, action, resource, tenant, and time range
- export logs for compliance
- retain logs based on policy

Non-functional requirements:

- high write availability
- append-only behavior
- tamper resistance
- low-latency search for recent data
- cheap storage for old data
- PII minimization
- tenant isolation

## Event Schema

A practical audit event:

```json
{
  "eventId": "evt_01HXYZ",
  "tenantId": "t_123",
  "actor": {
    "type": "USER",
    "id": "u_456",
    "emailHash": "f2a1..."
  },
  "action": "ROLE_ASSIGNED",
  "resource": {
    "type": "USER_ROLE",
    "id": "role_admin"
  },
  "result": "SUCCESS",
  "ipAddress": "203.0.113.10",
  "userAgent": "Mozilla/5.0",
  "requestId": "req_789",
  "occurredAt": "2025-07-24T10:15:30Z",
  "metadata": {
    "targetUserId": "u_999"
  }
}
```

Avoid storing raw sensitive data when a stable hash is enough. For example, `emailHash` may be enough for investigation without storing the full email in the audit stream.

## Write Path

There are two common approaches.

### Synchronous Write

The API writes audit logs inside the request path:

```java
userRoleService.assignRole(userId, role);
auditLogService.record(RoleAssignedEvent.from(userId, role));
```

This is simple but risky. If the audit log store is slow, the product action becomes slow. If audit logging fails, do you fail the user request? For compliance-critical actions, maybe yes. For lower-risk actions, maybe no.

### Asynchronous Write

The API publishes an event and an audit consumer persists it:

```java
@Transactional
public void assignRole(String userId, String role) {
    roleRepository.assign(userId, role);
    outboxRepository.save(AuditEvent.roleAssigned(userId, role));
}
```

Then a publisher sends the audit event to Kafka:

```
application -> outbox table -> Kafka -> audit-log-service -> storage
```

This avoids losing audit events when the app crashes after the business transaction commits.

## Storage Model

Audit logs are append-heavy. A relational table works well for moderate volume:

```sql
CREATE TABLE audit_events (
  event_id UUID PRIMARY KEY,
  tenant_id VARCHAR(128) NOT NULL,
  actor_type VARCHAR(50) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id VARCHAR(128) NOT NULL,
  result VARCHAR(20) NOT NULL,
  occurred_at TIMESTAMP NOT NULL,
  request_id VARCHAR(128),
  ip_address INET,
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_audit_resource_time
  ON audit_events (tenant_id, resource_type, resource_id, occurred_at DESC);

CREATE INDEX idx_audit_actor_time
  ON audit_events (tenant_id, actor_id, occurred_at DESC);
```

For high-volume systems, use a two-tier model:

- PostgreSQL or OpenSearch for recent searchable events
- S3/Glacier for long-term retention

## Search Design

Common access patterns:

- "Show all changes to user u_123"
- "Show all actions by admin a_456 last week"
- "Show failed login attempts for tenant t_1"
- "Export all permission changes for Q2"

OpenSearch mapping should keep fields structured:

```json
{
  "mappings": {
    "properties": {
      "tenantId": { "type": "keyword" },
      "actor.id": { "type": "keyword" },
      "action": { "type": "keyword" },
      "resource.type": { "type": "keyword" },
      "resource.id": { "type": "keyword" },
      "occurredAt": { "type": "date" },
      "metadata": { "type": "flattened" }
    }
  }
}
```

Do not index every nested metadata field dynamically forever. Mapping explosion is a real production problem.

## Immutability and Tamper Resistance

Audit logs should be append-only. Application code should not update or delete individual events.

At the database layer:

```sql
REVOKE UPDATE, DELETE ON audit_events FROM app_user;
GRANT INSERT, SELECT ON audit_events TO app_user;
```

For stronger tamper evidence, add hash chaining:

```json
{
  "eventId": "evt_2",
  "payloadHash": "hash(current_payload)",
  "previousHash": "hash(evt_1)"
}
```

If someone modifies an old event, the chain breaks. This is not a replacement for access control, but it helps detect tampering.

For regulated environments, write old logs to S3 with Object Lock/WORM retention.

## Retention and PII

Retention is a policy decision. Do not keep audit logs forever by default.

Example:

| Event Type | Retention |
|---|---|
| Authentication events | 1 year |
| Permission changes | 7 years |
| Billing changes | 7 years |
| Debug-only admin views | 90 days |

PII rules:

- store IDs instead of names/emails where possible
- hash sensitive values used only for matching
- encrypt long-term archives
- restrict who can search audit logs
- log access to the audit log itself

## Production Checklist

- Define audit-worthy actions explicitly
- Use an append-only event schema
- Write through outbox for critical actions
- Store structured fields, not free-form strings only
- Index by tenant, actor, resource, action, and time
- Separate recent search storage from long-term archive
- Minimize PII
- Make audit log access itself auditable
- Add retention policies
- Consider hash chaining or WORM storage for tamper evidence

An audit log system is not just a compliance checkbox. It is the memory of your product. Design it as a reliable event system, and it will pay for itself during the first serious investigation.
