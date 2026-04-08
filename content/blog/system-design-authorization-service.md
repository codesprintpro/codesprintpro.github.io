---
title: "System Design: Building an Authorization Service"
description: "Design a production authorization service with RBAC, ABAC, policy evaluation, relationship-based permissions, caching, audit logs, consistency tradeoffs, and safe rollout patterns."
date: "2026-04-08"
category: "System Design"
tags: ["system design", "authorization", "permissions", "rbac", "abac", "security", "distributed systems"]
featured: false
affiliateSection: "system-design-courses"
---

Authentication answers "Who are you?"

Authorization answers "What are you allowed to do?"

Most systems start with a simple `role` column on the user table. That works until the product grows. Then permissions become tenant-specific, resource-specific, time-bound, inherited through teams, and different across environments. A support agent can view an account but not export data. A project admin can invite members but not change billing. A service account can read webhooks but not rotate credentials. A user may be an admin in one workspace and a viewer in another.

At that point, authorization becomes a platform problem.

This guide designs a production authorization service: RBAC, ABAC, relationship-based permissions, policy evaluation, caching, consistency tradeoffs, audit logs, admin workflows, and failure modes.

## Problem Statement

Build a service that lets product teams answer permission checks consistently:

```text
Can principal P perform action A on resource R in context C?
```

Examples:

- Can user `u_123` update project `p_456`?
- Can service account `svc_webhook_worker` replay delivery `d_789`?
- Can support agent `agent_7` view tenant `t_42` after entering a ticket?
- Can user `u_123` export audit logs for workspace `w_9`?
- Can API client `client_abc` call `POST /v1/refunds`?

The authorization service should make these decisions fast, explainably, and safely.

## Requirements

Functional requirements:

- define permissions and actions
- assign roles to users and service accounts
- support resource-specific access
- support group/team inheritance
- support tenant isolation
- support attribute-based policy conditions
- evaluate authorization decisions
- explain deny decisions
- audit policy changes and sensitive checks
- support safe policy rollout

Non-functional requirements:

- low latency
- high availability
- clear consistency model
- minimal blast radius for bad policies
- strong auditability
- easy debugging
- backward-compatible policy changes
- safe caching and invalidation

The hardest requirement is not storing permissions. It is making permission decisions correct everywhere, even when policies change, caches exist, and product teams keep adding special cases.

## Authorization Models

Most real systems use a mix of models.

**RBAC: Role-Based Access Control**

Users get roles. Roles contain permissions.

```text
workspace_admin -> project:create, project:update, member:invite
workspace_viewer -> project:read, member:read
```

RBAC is simple and understandable. It becomes awkward when every customer wants custom roles or when permissions depend on resource attributes.

**ABAC: Attribute-Based Access Control**

Policies use attributes of the principal, resource, action, and request.

```text
allow if principal.department == resource.department
allow if request.ip_range in trusted_networks
allow if resource.sensitivity != "restricted"
```

ABAC is flexible, but policy debugging can become painful if every decision depends on many attributes.

**ReBAC: Relationship-Based Access Control**

Permissions come from relationships between objects.

```text
user:u_123 member workspace:w_9
workspace:w_9 owner project:p_456
```

ReBAC is useful for collaboration products: documents, folders, workspaces, teams, organizations, and inherited permissions.

Good product authorization often uses RBAC for common roles, ABAC for conditions, and ReBAC for resource hierarchy.

## High-Level Architecture

```text
        +------------------+
        | Product Service  |
        +--------+---------+
                 |
                 v
        +--------+---------+
        | AuthZ SDK / Cache|
        +--------+---------+
                 |
                 v
+----------------+----------------+
|         Authorization API        |
+----------------+----------------+
                 |
      +----------+----------+
      | Policy Evaluation   |
      | Engine              |
      +----------+----------+
                 |
      +----------+----------+
      | Permission Store    |
      | Relationship Store  |
      | Attribute Provider  |
      +----------+----------+
                 |
                 v
          +------+------+
          | Audit Log   |
          +-------------+
```

Product services call the authorization SDK. The SDK handles local caching and request shaping. The authorization API authenticates callers and sends checks to the policy engine. The engine reads role assignments, relationships, resource attributes, and policy definitions. Every policy change and sensitive access decision is written to the audit log.

## Core Data Model

Start with actions:

```sql
CREATE TABLE authz_actions (
  action TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  risk_level TEXT NOT NULL
);
```

Roles:

```sql
CREATE TABLE authz_roles (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE authz_role_permissions (
  role_id UUID NOT NULL REFERENCES authz_roles(id),
  action TEXT NOT NULL REFERENCES authz_actions(action),
  PRIMARY KEY (role_id, action)
);
```

Assignments:

```sql
CREATE TABLE authz_role_assignments (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role_id UUID NOT NULL REFERENCES authz_roles(id),
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX authz_assignments_lookup_idx
ON authz_role_assignments (
  tenant_id,
  principal_type,
  principal_id,
  resource_type,
  resource_id
);
```

Relationships:

```sql
CREATE TABLE authz_relationships (
  tenant_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (
    tenant_id,
    subject_type,
    subject_id,
    relation,
    object_type,
    object_id
  )
);
```

Example relationships:

```text
user:u_123 member workspace:w_9
group:g_engineering member workspace:w_9
project:p_456 child_of workspace:w_9
folder:f_1 parent_of document:d_2
```

## Decision API

Single check:

```http
POST /v1/authorize
```

```json
{
  "principal": {
    "type": "user",
    "id": "u_123"
  },
  "action": "project:update",
  "resource": {
    "type": "project",
    "id": "p_456"
  },
  "context": {
    "tenantId": "t_42",
    "requestIp": "10.2.4.10",
    "ticketId": null
  }
}
```

Response:

```json
{
  "decision": "ALLOW",
  "reason": "role workspace_admin on workspace w_9 includes project:update",
  "policyVersion": "2026-04-08.17",
  "cacheTtlSeconds": 30
}
```

Batch check:

```http
POST /v1/authorize/batch
```

Use batch checks for list pages:

```json
{
  "principal": { "type": "user", "id": "u_123" },
  "checks": [
    { "action": "project:update", "resource": { "type": "project", "id": "p_1" } },
    { "action": "project:update", "resource": { "type": "project", "id": "p_2" } },
    { "action": "project:update", "resource": { "type": "project", "id": "p_3" } }
  ],
  "context": { "tenantId": "t_42" }
}
```

Without batch APIs, product services often create N+1 authorization calls and make every list page slow.

## Policy Evaluation

Policy evaluation should be deterministic and explainable.

Pseudo-code:

```ts
async function authorize(req: AuthorizationRequest): Promise<AuthzDecision> {
  const resource = await resourceGraph.resolve(req.resource);

  const roleAssignments = await assignmentStore.findAssignments({
    tenantId: req.context.tenantId,
    principal: req.principal,
    resourceLineage: resource.lineage,
  });

  const permissions = expandPermissions(roleAssignments);
  const hasAction = permissions.includes(req.action);

  if (!hasAction) {
    return deny("no matching role permission");
  }

  const conditions = await policyStore.findConditions(req.action);
  for (const condition of conditions) {
    const ok = await evaluateCondition(condition, req, resource);
    if (!ok) {
      return deny(`condition failed: ${condition.name}`);
    }
  }

  return allow("matching role and conditions");
}
```

Prefer explicit deny for safety:

```ts
if (hasDenyAssignment(req)) {
  return deny("explicit deny assignment");
}
```

But do not overuse explicit deny. It can make debugging difficult because an old deny rule can override a new allow rule in surprising ways.

## Resource Hierarchy

Permissions often inherit through a tree:

```text
organization
  -> workspace
      -> project
          -> environment
              -> deployment
```

If a user is `workspace_admin` on workspace `w_9`, they may be allowed to update projects under that workspace.

Store lineage:

```sql
CREATE TABLE resource_edges (
  tenant_id TEXT NOT NULL,
  parent_type TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  child_type TEXT NOT NULL,
  child_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, parent_type, parent_id, child_type, child_id)
);
```

At read time, resolve ancestors:

```sql
WITH RECURSIVE ancestors AS (
  SELECT parent_type, parent_id, child_type, child_id
  FROM resource_edges
  WHERE tenant_id = :tenant_id
    AND child_type = :resource_type
    AND child_id = :resource_id

  UNION ALL

  SELECT e.parent_type, e.parent_id, e.child_type, e.child_id
  FROM resource_edges e
  JOIN ancestors a
    ON e.child_type = a.parent_type
   AND e.child_id = a.parent_id
  WHERE e.tenant_id = :tenant_id
)
SELECT parent_type, parent_id FROM ancestors;
```

For high-scale systems, precompute resource lineage or keep it in a graph-optimized store. Recursive SQL is fine for moderate depth and moderate traffic, but list pages with thousands of resources need careful batching.

## Attribute Conditions

ABAC conditions handle context:

```json
{
  "name": "support_ticket_required",
  "action": "customer:read_sensitive",
  "expression": "principal.type == 'support_agent' && context.ticketId != null"
}
```

Another example:

```json
{
  "name": "business_hours_only",
  "action": "billing:refund",
  "expression": "context.hour >= 9 && context.hour <= 18 && principal.mfa == true"
}
```

Do not let every service invent its own expression language. Standardize policy syntax and test policies before rollout.

If policy expressions become complex, add a policy test suite:

```json
{
  "name": "support cannot export raw card data",
  "request": {
    "principal": { "type": "user", "id": "support_1" },
    "action": "payment_card:export",
    "resource": { "type": "tenant", "id": "t_42" },
    "context": { "ticketId": "INC-1", "mfa": true }
  },
  "expectedDecision": "DENY"
}
```

Treat policy changes like code changes: reviewed, tested, deployed gradually, and easy to roll back.

## Caching Strategy

Authorization checks must be fast. They also must react to permission changes.

Cache layers:

- SDK in-process cache
- authorization service cache
- relationship graph cache
- policy bundle cache

Cache key:

```text
tenantId:principalType:principalId:action:resourceType:resourceId:policyVersion
```

Use short TTLs for sensitive actions:

```ts
function ttlFor(action: string): number {
  if (action.endsWith(":read_sensitive")) return 5;
  if (action.endsWith(":delete")) return 5;
  if (action.endsWith(":read")) return 60;
  return 30;
}
```

Add invalidation events for permission changes:

```json
{
  "eventType": "AUTHZ_POLICY_CHANGED",
  "tenantId": "t_42",
  "principalId": "u_123",
  "resourceType": "workspace",
  "resourceId": "w_9",
  "policyVersion": "2026-04-08.18"
}
```

If invalidation is best effort, keep TTLs bounded. Never rely on cache invalidation alone for critical revocation.

## Consistency Tradeoffs

Authorization has uncomfortable consistency requirements.

If a user loses access, how quickly must it take effect?

For low-risk read actions, a short stale window may be acceptable. For destructive actions, privilege escalation, billing, exports, and production operations, stale decisions should be avoided.

One practical model:

| Action Type | Cache TTL | Stale Allowed | Notes |
|---|---:|---|---|
| Public read | 5 minutes | yes | not sensitive |
| Normal product read | 30-60 seconds | limited | improves UI speed |
| Sensitive read | 5-10 seconds | no after revocation event | audit heavily |
| Write | 5-30 seconds | limited | depends on business risk |
| Delete/export/admin | 0-5 seconds | no | prefer fresh check |

For high-risk actions, force a fresh authorization check:

```ts
await authz.authorize({
  principal,
  action: "audit_log:export",
  resource,
  context,
  consistency: "fresh",
});
```

The authorization service can route fresh checks around caches and read from the primary store.

## Admin Workflows

Permissions are not only APIs. Humans need workflows.

Admin UI features:

- view who has access to a resource
- view what a user can access
- grant a role
- revoke a role
- set expiration
- require approval for privileged roles
- simulate access before applying changes
- show policy explanation
- export audit records

Simulation is important:

```json
{
  "change": {
    "grantRole": "workspace_admin",
    "principal": "user:u_123",
    "resource": "workspace:w_9"
  },
  "preview": {
    "newlyAllowedActions": [
      "project:create",
      "project:update",
      "member:invite"
    ],
    "highRiskActions": [
      "member:invite"
    ]
  }
}
```

Bad permission changes can create security incidents. Make the blast radius visible before the operator clicks apply.

## Audit Logging

Audit policy changes:

```json
{
  "eventType": "ROLE_GRANTED",
  "tenantId": "t_42",
  "actor": "user:admin_1",
  "principal": "user:u_123",
  "role": "workspace_admin",
  "resource": "workspace:w_9",
  "reason": "Project lead for migration",
  "expiresAt": "2026-05-08T00:00:00Z",
  "createdAt": "2026-04-08T10:30:00Z"
}
```

Audit sensitive decisions:

```json
{
  "eventType": "AUTHZ_DECISION",
  "tenantId": "t_42",
  "principal": "user:u_123",
  "action": "audit_log:export",
  "resource": "workspace:w_9",
  "decision": "ALLOW",
  "policyVersion": "2026-04-08.18",
  "requestId": "req_abc",
  "createdAt": "2026-04-08T10:31:00Z"
}
```

Do not audit every low-risk read decision synchronously if it would make the system too expensive. Use sampling or asynchronous logging for low-risk checks, but keep full audit logs for privileged actions.

## Integration With Product Services

Keep the call site boring:

```java
authz.require(
    principal,
    "project:update",
    Resource.of("project", projectId),
    AuthzContext.ofTenant(tenantId)
);
```

For list pages, avoid checking one resource at a time:

```java
Map<String, Decision> decisions = authz.batchAuthorize(
    principal,
    "project:update",
    projects.stream()
        .map(project -> Resource.of("project", project.id()))
        .toList(),
    AuthzContext.ofTenant(tenantId)
);
```

Do not load all projects and then filter unauthorized ones if the list is large. Push coarse authorization into the query when possible:

```sql
SELECT p.*
FROM projects p
JOIN authz_relationships r
  ON r.object_type = 'workspace'
 AND r.object_id = p.workspace_id
WHERE p.tenant_id = :tenant_id
  AND r.subject_type = 'user'
  AND r.subject_id = :user_id
  AND r.relation IN ('member', 'admin');
```

Then use the authorization service for fine-grained checks on returned objects.

## Safe Policy Rollout

Policy rollout should support:

- dry run
- shadow evaluation
- canary by tenant
- policy version pinning
- rollback
- decision diff reporting

Shadow mode example:

```json
{
  "currentDecision": "ALLOW",
  "candidateDecision": "DENY",
  "action": "invoice:read",
  "resource": "invoice:inv_123",
  "principal": "user:u_123",
  "reason": "candidate requires billing_viewer role"
}
```

Before changing a widely used policy, run the candidate policy against production traffic in shadow mode and measure:

- new denies
- new allows
- high-risk decision changes
- top affected tenants
- endpoints affected

Most authorization incidents are boring: a policy was technically correct but broader than expected.

## Observability

Metrics:

- decision latency
- allow/deny rate by action
- policy evaluation errors
- cache hit rate
- stale decision count
- fresh check rate
- policy bundle version skew
- relationship graph lookup latency
- audit logging failures
- shadow policy decision diff rate

Structured log:

```json
{
  "event": "authz_decision",
  "tenantId": "t_42",
  "principal": "user:u_123",
  "action": "project:update",
  "resource": "project:p_456",
  "decision": "ALLOW",
  "policyVersion": "2026-04-08.18",
  "latencyMs": 7
}
```

Useful dashboards:

- top denied actions
- p95/p99 authorization latency
- cache hit rate by service
- policy version adoption
- high-risk action volume
- admin role grants
- expired grants still active

## Failure Modes

**Default allow.** A timeout or unknown action accidentally returns allow.

**Permission cache is too sticky.** A revoked user keeps access for minutes or hours.

**N+1 authorization checks.** List pages become slow because every row calls the authz service separately.

**Policy language is too flexible.** Nobody can predict what a change will do without running production traffic through it.

**Resource lineage is wrong.** A project points to the wrong workspace, granting inherited access to the wrong users.

**No explanation.** Support cannot debug why a customer lost access.

**Authorization is split across services.** One service checks `project:update`; another checks `workspace:admin`; behavior diverges.

**Audit logging is optional.** Privileged role changes happen without a durable record.

**Cyclic group membership.** Group inheritance loops cause slow or incorrect evaluation.

**Policy rollout has no rollback.** A bad policy deploy locks out users or exposes data.

## Production Checklist

- Define actions centrally.
- Separate authentication from authorization.
- Start with RBAC, then add ABAC/ReBAC only where needed.
- Make tenant and environment part of every decision.
- Support batch authorization for list pages.
- Keep high-risk actions fresh or near-fresh.
- Use short TTLs and invalidation for permission caches.
- Emit audit logs for policy changes and sensitive checks.
- Add policy simulation before applying admin changes.
- Support shadow evaluation for risky policy changes.
- Explain deny decisions.
- Test resource hierarchy and inheritance.
- Detect group membership cycles.
- Fail closed on unknown actions and evaluation errors.
- Track policy version rollout and decision diff rate.

## Read Next

- [Spring Security OAuth2 and JWT](/blog/spring-security-oauth2-jwt/)
- [System Design: Building an API Gateway Platform](/blog/system-design-api-gateway-platform/)
- [System Design: Building an Audit Log System](/blog/system-design-audit-log-system/)
- [Multi-Tenancy Architecture](/blog/multi-tenancy-architecture/)
