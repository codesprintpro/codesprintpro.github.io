---
title: "System Design: Building a Secrets Management Platform"
description: "Design a production secrets management platform with envelope encryption, versioned secrets, rotation, access control, audit logs, SDK caching, Kubernetes delivery, and incident playbooks."
date: "2026-04-08"
category: "System Design"
tags: ["system design", "secrets management", "security", "encryption", "kubernetes", "access control", "backend engineering"]
featured: false
affiliateSection: "system-design-courses"
---

Secrets management looks like a simple storage problem until you operate it in production.

At first, the requirement sounds like this: "Store API keys and database passwords somewhere safe." Then real systems arrive. Services need different values per environment. Developers need break-glass access. Kubernetes workloads need secrets without restarting every pod. Rotations must happen without downtime. Audit logs must answer who read what and why. A leaked secret must be revoked quickly. The platform must be available during deploys, but it cannot become a convenient place for everyone to dump plaintext credentials.

This guide designs a secrets management platform from first principles. It covers secret models, envelope encryption, KMS integration, access control, versioning, rotation, audit logs, delivery into applications, caching, Kubernetes integration, observability, and failure modes.

## Problem Statement

Build a platform that lets services and operators store, read, rotate, and audit secrets.

Examples:

- database passwords
- webhook signing secrets
- third-party API keys
- OAuth client secrets
- TLS private keys
- encryption subkeys
- service-to-service credentials

The platform should reduce secret sprawl. It should not make secrets magically harmless. A secret read by an application can still be logged, leaked, copied to a laptop, or embedded into a crash dump. Good design narrows the blast radius and gives teams a reliable way to rotate after something goes wrong.

## Requirements

Functional requirements:

- create a secret
- read the latest secret version
- read a specific version
- rotate a secret
- disable or destroy old versions
- attach metadata and ownership
- enforce access policies
- audit reads and writes
- support break-glass access
- deliver secrets to applications

Non-functional requirements:

- strong encryption at rest
- secure transport
- high availability for reads
- strict authorization
- low read latency for applications
- safe rotation with overlap windows
- immutable audit trail
- tenant and environment isolation
- predictable behavior during outages

The hardest requirement is rotation. A platform that can store secrets but cannot rotate them safely often creates a false sense of security.

## Core Concepts

Use a small vocabulary:

- `Secret`: logical name, such as `prod/payments/stripe-api-key`
- `SecretVersion`: immutable encrypted value
- `Alias`: pointer like `current`, `previous`, or `next`
- `Policy`: who can read, write, rotate, or administer the secret
- `Lease`: optional short-lived access grant for dynamic credentials
- `AuditEvent`: immutable record of reads and writes

Versioning matters because rotation is rarely instant. During a rollout, some instances may still use the old database password while new instances use the new one. The platform must represent that overlap explicitly.

## High-Level Architecture

```text
           +-------------------+
           |   Admin Console   |
           +---------+---------+
                     |
                     v
+----------+   +-----+------+   +----------------+
| Service  |-->| Secret API |-->| Policy Engine  |
| SDK      |   +-----+------+   +----------------+
+----------+         |
                     v
             +-------+--------+
             | Metadata Store |
             +-------+--------+
                     |
                     v
             +-------+--------+       +------+
             | Encrypted Blob |<----->| KMS  |
             | Store          |       +------+
             +-------+--------+
                     |
                     v
              +------+------+
              | Audit Log   |
              +-------------+
```

The API service handles request validation and authentication. The policy engine decides whether the caller can act. The metadata store tracks names, owners, versions, and aliases. The encrypted blob store holds ciphertext. KMS protects data-encryption keys. The audit log receives every sensitive operation.

For small systems, metadata and encrypted blobs can live in one relational database. For large systems, metadata can remain relational while encrypted values are stored in object storage or a dedicated key-value store.

## Data Model

```sql
CREATE TABLE secrets (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  path TEXT NOT NULL,
  owner_team TEXT NOT NULL,
  description TEXT,
  rotation_strategy TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, environment, path)
);

CREATE TABLE secret_versions (
  id UUID PRIMARY KEY,
  secret_id UUID NOT NULL REFERENCES secrets(id),
  version_number BIGINT NOT NULL,
  ciphertext BYTEA NOT NULL,
  encrypted_data_key BYTEA NOT NULL,
  key_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  UNIQUE (secret_id, version_number)
);

CREATE TABLE secret_aliases (
  secret_id UUID NOT NULL REFERENCES secrets(id),
  alias TEXT NOT NULL,
  version_number BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (secret_id, alias)
);
```

`version_number` should be monotonic per secret. `status` can be:

- `PENDING`: created but not yet used
- `CURRENT`: default version for readers
- `PREVIOUS`: kept for rollback or overlap
- `DISABLED`: not returned to applications
- `DESTROYED`: cryptographic material removed or made unrecoverable

Avoid updating ciphertext in place. Create a new version.

## Envelope Encryption

Do not encrypt every secret directly with a master key. Use envelope encryption.

Write path:

```text
1. Generate a random data key.
2. Encrypt the secret value with the data key.
3. Ask KMS to encrypt the data key.
4. Store ciphertext and encrypted data key.
5. Destroy plaintext key material from memory as soon as possible.
```

Read path:

```text
1. Load ciphertext and encrypted data key.
2. Ask KMS to decrypt the data key.
3. Decrypt the secret value in memory.
4. Return the value to the authorized caller.
5. Emit an audit event.
```

Pseudo-code:

```ts
async function storeSecretVersion(input: {
  secretId: string;
  plaintext: Buffer;
  createdBy: string;
}) {
  const dataKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", dataKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(input.plaintext),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const encryptedDataKey = await kms.encrypt({
    keyId: "secrets-platform-prod",
    plaintext: dataKey,
  });

  await secretVersionRepository.insert({
    secretId: input.secretId,
    ciphertext: Buffer.concat([iv, tag, ciphertext]),
    encryptedDataKey,
    keyId: "secrets-platform-prod",
    createdBy: input.createdBy,
  });

  dataKey.fill(0);
  input.plaintext.fill(0);
}
```

In real systems, use well-reviewed cryptographic libraries and managed KMS clients. The important system design point is separation: the metadata store never has the plaintext master key.

## API Design

Create:

```http
POST /v1/secrets
```

```json
{
  "environment": "prod",
  "path": "payments/stripe-api-key",
  "ownerTeam": "payments",
  "rotationStrategy": "manual-overlap"
}
```

Create version:

```http
POST /v1/secrets/{secretId}/versions
```

```json
{
  "value": "sk_live_redacted",
  "status": "PENDING"
}
```

Read:

```http
GET /v1/secrets/prod/payments/stripe-api-key?alias=current
```

Response:

```json
{
  "path": "payments/stripe-api-key",
  "version": 42,
  "value": "sk_live_redacted",
  "expiresAt": null
}
```

Promote:

```http
POST /v1/secrets/{secretId}/aliases/current
```

```json
{
  "version": 42,
  "expectedPreviousVersion": 41
}
```

Use compare-and-swap semantics when updating aliases. That prevents two rotations from racing and accidentally promoting the wrong version.

## Access Control

Access should be based on workload identity, team ownership, environment, and operation.

Policy example:

```json
{
  "effect": "allow",
  "principal": "service:prod:payments-api",
  "actions": ["secrets:read"],
  "resources": ["prod/payments/*"],
  "conditions": {
    "sourceCluster": "prod-us-east-1",
    "mfa": false
  }
}
```

Admin policy:

```json
{
  "effect": "allow",
  "principal": "group:payments-oncall",
  "actions": ["secrets:rotate", "secrets:read-break-glass"],
  "resources": ["prod/payments/*"],
  "conditions": {
    "mfa": true,
    "ticketRequired": true
  }
}
```

Separate read, write, rotate, administer, and break-glass permissions. A service account that reads a secret does not need permission to rotate it. A developer who can rotate a secret does not automatically need to see its plaintext.

## Application Delivery Patterns

There are three common delivery patterns.

**Direct SDK fetch.**

The application calls the secrets API at startup or when it needs a value.

Pros:

- simple freshness model
- easy audit attribution
- no sidecar dependency

Cons:

- application needs client code
- secrets API latency can affect startup
- every language needs SDK support

**Sidecar agent.**

A local agent fetches and refreshes secrets, then exposes them through files or a local socket.

Pros:

- language agnostic
- centralizes caching and renewal
- works well with Kubernetes

Cons:

- more moving parts
- local file permissions matter
- agent bugs affect every workload

**Build-time or deploy-time injection.**

CI/CD injects secrets into environment variables or config.

Pros:

- simple to adopt
- no runtime dependency

Cons:

- rotation usually requires redeploy
- environment variables can leak in process dumps and logs
- weak audit attribution for individual reads

For production services, prefer runtime delivery through SDK or sidecar. For static configuration that changes rarely, deploy-time injection may be acceptable.

## SDK Caching

Without caching, every request path can become dependent on the secrets platform.

SDK cache behavior:

```ts
type CachedSecret = {
  value: string;
  version: number;
  expiresAt: number;
};

class SecretClient {
  private cache = new Map<string, CachedSecret>();

  async get(path: string): Promise<string> {
    const cached = this.cache.get(path);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const fresh = await this.fetchSecret(path);
    this.cache.set(path, {
      value: fresh.value,
      version: fresh.version,
      expiresAt: now + 60_000,
    });

    return fresh.value;
  }
}
```

Cache TTL should be short enough for rotation and revocation to take effect, but long enough to survive brief platform hiccups.

Add jitter:

```ts
const baseTtlMs = 60_000;
const jitterMs = Math.floor(Math.random() * 15_000);
const ttlMs = baseTtlMs + jitterMs;
```

Jitter prevents every instance from refreshing at the same time after a deploy.

## Rotation Workflow

A safe rotation flow:

```text
1. Create version 42 as PENDING.
2. Update downstream system to accept both version 41 and 42.
3. Promote alias next -> 42 for canary workloads.
4. Verify canary metrics.
5. Promote alias current -> 42.
6. Wait for SDK caches and application rollout.
7. Mark version 41 as PREVIOUS.
8. After the rollback window, disable version 41.
9. Destroy version 41 when retention policy allows.
```

For database passwords, rotation often requires both the database and application to support overlap:

```sql
CREATE USER app_v42 WITH PASSWORD 'new_password';
GRANT app_role TO app_v42;
```

Then update applications to use `app_v42`, monitor connection success, and remove the old user after the overlap window:

```sql
REVOKE app_role FROM app_v41;
DROP USER app_v41;
```

If the downstream system does not support multiple active credentials, the rotation plan must include a coordinated maintenance window or a proxy layer that can absorb the change.

## Dynamic Secrets

Some secrets should not be stored as long-lived values at all.

For database access, the platform can issue short-lived credentials:

```json
{
  "username": "svc_payments_20260408_103000",
  "password": "temporary-password",
  "leaseId": "lease_123",
  "expiresAt": "2026-04-08T11:00:00Z"
}
```

The platform creates the credential in the downstream database, returns it to the service, and revokes it when the lease expires.

Dynamic secrets reduce blast radius, but they require deeper integration with downstream systems. They also need renewal, cleanup, and emergency revocation flows.

## Kubernetes Integration

Kubernetes Secrets are useful, but they are not a complete secrets management strategy.

A common production pattern:

```text
Secrets platform -> External Secrets controller -> Kubernetes Secret -> pod volume
```

Mount secrets as files when rotation matters:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: payments-api
spec:
  containers:
    - name: app
      image: payments-api:2026.04.08
      volumeMounts:
        - name: app-secrets
          mountPath: /var/run/secrets/app
          readOnly: true
  volumes:
    - name: app-secrets
      secret:
        secretName: payments-api-secrets
```

Environment variables are easy, but they are usually harder to rotate without restart and easier to leak through diagnostics.

If you use a sidecar agent, it can write refreshed secrets to a memory-backed volume and notify the application to reload. The application still needs a reload path. Rotation is not just a platform feature; it is also an application feature.

## Audit Logging

Every sensitive operation should emit an audit event:

```json
{
  "eventType": "SECRET_READ",
  "tenantId": "internal",
  "environment": "prod",
  "path": "payments/stripe-api-key",
  "version": 42,
  "principal": "service:prod:payments-api",
  "sourceIp": "10.2.4.17",
  "requestId": "req_abc",
  "decision": "ALLOW",
  "createdAt": "2026-04-08T10:30:00Z"
}
```

Do not store the plaintext value in audit logs. Not even "temporarily." Audit logs often have broader access than secret stores.

Read events can be high volume. Store full-fidelity audit logs in an append-only stream or warehouse, and expose summarized views in the UI:

- reads by principal
- reads by secret
- break-glass reads
- denied reads
- rotations by owner team
- stale secrets without rotation

Break-glass reads should require a reason and ticket:

```json
{
  "reason": "production incident INC-1842",
  "ticketUrl": "https://tracker.example.com/INC-1842",
  "durationMinutes": 30
}
```

## Availability Strategy

Secrets access sits on a painful boundary. If the platform is unavailable, new pods may fail to start. If the platform fails open, an authorization bug can leak everything.

Use different behavior for startup and steady state.

Startup:

- fail closed for missing critical secrets
- retry with exponential backoff
- surface clear error messages
- do not log plaintext values

Steady state:

- continue using cached values for a bounded stale window
- refresh asynchronously
- alert on cache staleness
- stop using a secret if revocation is explicitly signaled

Example SDK policy:

```json
{
  "cacheTtlSeconds": 60,
  "maxStaleSeconds": 900,
  "failOpenOnRefreshError": true,
  "failOpenOnExplicitRevocation": false
}
```

This says: tolerate a temporary refresh outage, but do not ignore a revocation event.

## Multi-Region Design

For multi-region systems, decide whether secrets are regional or global.

Regional secrets:

- lower blast radius
- simpler data residency
- region-specific credentials
- more operational work

Global secrets:

- simpler application config
- easier single control plane
- larger blast radius
- cross-region replication concerns

For critical production systems, keep the control plane multi-region but avoid making every read cross-region. Replicate encrypted secret versions and policy snapshots into each serving region. Writes and rotations can go through a primary region if the operational model is simpler.

The KMS strategy must match the data model. If a region cannot decrypt replicated secrets during an outage, replication did not buy you much.

## Observability

Metrics:

- secret read latency
- read success and failure rate
- KMS decrypt latency
- policy decision latency
- cache hit rate
- stale cache usage
- denied access count
- break-glass count
- rotation success rate
- secrets past rotation SLA
- SDK refresh failures

Logs should include secret path, version, principal, request ID, and decision. They should never include plaintext.

Alerts:

- spike in denied reads
- break-glass access in production
- KMS decrypt errors
- sudden increase in reads for a sensitive secret
- stale cache usage above threshold
- secret past rotation deadline
- failed rotation for critical secret

Security teams care about unusual access. Platform teams care about startup failures and refresh errors. Product teams care that deploys continue working.

## Failure Modes

**Plaintext appears in logs.** A debugging statement logs request or response bodies from the secrets API.

**No version overlap.** Rotation breaks production because old and new credentials cannot coexist.

**Policy too broad.** A wildcard permission gives one service access to another team's secrets.

**No owner metadata.** Nobody knows who should approve rotation or deletion.

**Stale caches last forever.** An SDK keeps using a revoked secret because max stale age is not enforced.

**Audit log is best effort only.** Sensitive reads succeed even when audit logging is broken.

**KMS throttling becomes an outage.** Every application starts at once and triggers a decrypt storm.

**Environment variables leak.** Secrets show up in process dumps, debug endpoints, or support bundles.

**Break-glass is invisible.** Humans can read production secrets without reason, ticket, or alert.

**Destroyed versions are still recoverable.** Backups retain encrypted data and keys without a destruction policy.

## Production Checklist

- Store immutable secret versions.
- Use envelope encryption.
- Keep master keys outside the metadata database.
- Separate read, rotate, administer, and break-glass permissions.
- Require workload identity for application reads.
- Make rotation a first-class workflow.
- Support overlap windows for old and new credentials.
- Prefer runtime delivery for frequently rotated secrets.
- Use SDK caching with TTL, jitter, and max stale age.
- Emit audit events for reads, writes, denies, and break-glass access.
- Never log plaintext secrets.
- Alert on unusual reads and failed rotations.
- Track owners and rotation SLAs.
- Test KMS outage, policy denial, stale cache, and rotation rollback.
- Document what happens when the secrets platform is unavailable.

## Read Next

- [Spring Security OAuth2 and JWT](/blog/spring-security-oauth2-jwt/)
- [Kubernetes Production Best Practices](/blog/kubernetes-production-best-practices/)
- [Terraform Infrastructure as Code](/blog/terraform-infrastructure-as-code/)
- [System Design: Building a Webhook Delivery Platform](/blog/system-design-webhook-delivery-platform/)
