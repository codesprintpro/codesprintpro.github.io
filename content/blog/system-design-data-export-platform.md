---
title: "System Design: Building a Data Export Platform"
description: "Design a production data export platform for CSV, JSON, and Parquet exports with async jobs, snapshots, object storage, authorization, audit logs, retention, throttling, and failure recovery."
date: "2026-04-08"
category: "System Design"
tags: ["system design", "data export", "async jobs", "object storage", "audit logs", "backend engineering", "saas"]
featured: false
affiliateSection: "system-design-courses"
---

Data export is one of those features that sounds small until it takes down production.

A product manager asks for "Export to CSV." The first implementation runs a SQL query in the web request, builds a file in memory, and streams it to the browser. It works in staging. Then a customer exports five years of audit logs, the query runs for minutes, the connection pool fills up, the application runs out of memory, and support gets a ticket saying "the export button is broken."

Real export systems need job orchestration, permissions, snapshots, object storage, progress tracking, audit logs, throttling, retention, and privacy controls.

This guide designs a production data export platform for SaaS products.

## Problem Statement

Build a platform that lets users request and download large exports without hurting the online application.

Examples:

- export invoices as CSV
- export audit logs for compliance
- export user activity as JSON
- export usage events as Parquet
- export customer records for GDPR/DSAR workflows
- export filtered search results
- export reports that join multiple tables

The platform should handle small exports synchronously only when safe. Large exports should be asynchronous.

## Requirements

Functional requirements:

- create an export request
- validate filters and permissions
- run export asynchronously
- track status and progress
- write files to object storage
- support CSV, JSONL, and Parquet-like formats
- notify users when exports complete
- provide signed download URLs
- expire and delete old exports
- audit who exported what

Non-functional requirements:

- protect transactional databases
- avoid unbounded memory usage
- support large exports
- maintain tenant isolation
- enforce authorization
- support retries and resumability
- limit abuse and expensive queries
- preserve a consistent snapshot when needed
- protect sensitive data

The key design principle: export is a background data pipeline, not a web request.

## High-Level Architecture

```text
User
  |
  v
Export API
  |
  +-- authorization
  +-- request validation
  +-- export_jobs row
  |
  v
Queue
  |
  v
Export Worker
  |
  +-- read source data
  +-- stream encode rows
  +-- write object storage
  +-- update progress
  |
  v
Object Storage + Signed Download URL
```

The API records an export job and returns quickly. Workers execute jobs from a queue. Files go to object storage, not to the application server's local disk. The UI polls job status or receives a notification when the file is ready.

## Data Model

```sql
CREATE TABLE export_jobs (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  export_type TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL,
  filters JSONB NOT NULL,
  requested_columns JSONB NOT NULL DEFAULT '[]',
  snapshot_token TEXT,
  object_key TEXT,
  row_count BIGINT NOT NULL DEFAULT 0,
  byte_count BIGINT NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX export_jobs_tenant_requested_idx
ON export_jobs (tenant_id, requested_by, created_at DESC);

CREATE INDEX export_jobs_status_idx
ON export_jobs (status, created_at);
```

Statuses:

- `QUEUED`
- `RUNNING`
- `SUCCEEDED`
- `FAILED`
- `CANCELLED`
- `EXPIRED`

Add attempts:

```sql
CREATE TABLE export_job_attempts (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES export_jobs(id),
  worker_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT
);
```

Attempts help debug retries. Do not overwrite the history of failed attempts.

## Request API

Create export:

```http
POST /v1/exports
```

```json
{
  "exportType": "audit_logs",
  "format": "csv",
  "filters": {
    "from": "2026-04-01T00:00:00Z",
    "to": "2026-04-08T00:00:00Z",
    "eventTypes": ["ROLE_GRANTED", "USER_LOGIN"]
  },
  "columns": ["createdAt", "actor", "eventType", "resource", "decision"]
}
```

Response:

```json
{
  "exportId": "exp_123",
  "status": "QUEUED",
  "statusUrl": "/v1/exports/exp_123"
}
```

Get status:

```http
GET /v1/exports/exp_123
```

```json
{
  "exportId": "exp_123",
  "status": "RUNNING",
  "rowCount": 120000,
  "byteCount": 18432000,
  "progress": {
    "partitionsCompleted": 3,
    "partitionsTotal": 12
  }
}
```

Download:

```http
POST /v1/exports/exp_123/download-url
```

```json
{
  "url": "https://storage.example.com/signed/export.csv?signature=...",
  "expiresInSeconds": 300
}
```

Generate signed URLs on demand. Do not store long-lived public links.

## Authorization

Exports need stronger permission checks than normal reads because they move data out of the product.

Check:

- user can read the underlying data
- user can export that data
- requested columns are allowed
- filters stay within tenant boundary
- export size is within policy
- sensitive fields require extra permission

Example:

```ts
await authz.require(user, "audit_log:export", {
  type: "workspace",
  id: workspaceId,
});

for (const column of request.columns) {
  await authz.require(user, `audit_log:export_column:${column}`, {
    type: "workspace",
    id: workspaceId,
  });
}
```

Do not trust filters directly from the client:

```ts
const query = buildAuditLogQuery({
  tenantId: user.tenantId,
  workspaceId,
  from: request.filters.from,
  to: request.filters.to,
});
```

Tenant ID should come from authenticated context, not request JSON.

## Export Planning

Before enqueuing a job, create an execution plan.

```json
{
  "exportType": "audit_logs",
  "estimatedRows": 2400000,
  "estimatedBytes": 380000000,
  "partitions": [
    { "from": "2026-04-01T00:00:00Z", "to": "2026-04-02T00:00:00Z" },
    { "from": "2026-04-02T00:00:00Z", "to": "2026-04-03T00:00:00Z" }
  ],
  "requiresAsync": true
}
```

Planning lets the API reject impossible exports early:

- time range too large
- unsupported column
- missing index for filter
- too many rows for CSV
- tenant over quota
- user lacks sensitive export permission

If you cannot estimate exactly, estimate conservatively.

## Snapshot Semantics

What should happen if data changes while an export is running?

Options:

**Best effort.** Export reads data as it scans. Rows may reflect different moments in time.

**Database snapshot.** Export uses repeatable-read semantics or a snapshot token.

**Materialized snapshot.** Export first writes matching IDs to an export snapshot table, then workers read from that set.

For compliance exports, use a consistent snapshot when possible.

Snapshot table:

```sql
CREATE TABLE export_snapshot_items (
  export_id UUID NOT NULL REFERENCES export_jobs(id),
  partition_id INT NOT NULL,
  source_id TEXT NOT NULL,
  PRIMARY KEY (export_id, source_id)
);
```

This costs extra storage, but it makes retries deterministic. If a worker fails halfway through partition 3, it can rerun partition 3 against the same item set.

## Worker Implementation

Do not build the entire file in memory.

Stream rows:

```ts
async function runCsvExport(job: ExportJob) {
  const upload = objectStorage.createMultipartUpload(job.objectKey);
  const encoder = createCsvEncoder(job.columns);

  let rowCount = 0;
  let partBuffer = Buffer.alloc(0);

  for await (const row of queryRows(job)) {
    const encoded = encoder.encode(row);
    partBuffer = Buffer.concat([partBuffer, encoded]);
    rowCount++;

    if (partBuffer.length >= 8 * 1024 * 1024) {
      await upload.uploadPart(partBuffer);
      partBuffer = Buffer.alloc(0);
      await exportRepository.updateProgress(job.id, { rowCount });
    }
  }

  if (partBuffer.length > 0) {
    await upload.uploadPart(partBuffer);
  }

  await upload.complete();
  await exportRepository.markSucceeded(job.id, { rowCount });
}
```

In a high-throughput system, avoid repeated `Buffer.concat` for every row. Use a streaming writer or chunked buffers. The design point is the same: bounded memory.

## Partitioning Large Exports

Large exports should be partitioned.

By time:

```text
2026-04-01 -> 2026-04-02
2026-04-02 -> 2026-04-03
2026-04-03 -> 2026-04-04
```

By ID range:

```text
id 000000-099999
id 100000-199999
id 200000-299999
```

By shard:

```text
tenant shard 0
tenant shard 1
tenant shard 2
```

Each partition can write one object:

```text
exports/exp_123/part-000.csv
exports/exp_123/part-001.csv
exports/exp_123/manifest.json
```

Manifest:

```json
{
  "exportId": "exp_123",
  "format": "csv",
  "parts": [
    { "key": "exports/exp_123/part-000.csv", "rows": 100000 },
    { "key": "exports/exp_123/part-001.csv", "rows": 100000 }
  ],
  "totalRows": 200000
}
```

For users, you can either return a ZIP archive or expose multiple part files. For machine consumers, a manifest with part files is often better.

## Database Protection

Export workloads can destroy online latency if they share the same database path as user requests.

Protection strategies:

- run exports from read replicas
- use query timeouts
- use cursor-based pagination
- select only needed columns
- require indexed filters
- limit concurrent jobs per tenant
- limit global export worker concurrency
- schedule expensive exports off peak
- throttle rows per second

Cursor query:

```sql
SELECT id, created_at, actor, event_type, resource
FROM audit_logs
WHERE tenant_id = :tenant_id
  AND created_at >= :from
  AND created_at < :to
  AND id > :last_seen_id
ORDER BY id
LIMIT 5000;
```

Avoid offset pagination for large exports. `OFFSET 1000000` forces the database to skip a lot of rows repeatedly.

## File Formats

CSV:

- easiest for business users
- awkward for nested data
- needs escaping and formula injection protection

JSONL:

- good for nested events
- easy to stream
- larger than columnar formats

Parquet:

- efficient for analytics
- good compression and typed columns
- less friendly for non-technical users

CSV formula injection is easy to miss. If a field starts with `=`, `+`, `-`, or `@`, spreadsheet software may interpret it as a formula.

```ts
function escapeCsvCell(value: string): string {
  if (/^[=+\-@]/.test(value)) {
    return `'${value}`;
  }
  return value;
}
```

## Retention and Deletion

Exports are copies of data. They need expiration.

Policy:

```json
{
  "defaultRetentionDays": 7,
  "sensitiveExportRetentionDays": 1,
  "maxDownloads": 5,
  "signedUrlTtlSeconds": 300
}
```

Cleanup job:

```sql
SELECT id, object_key
FROM export_jobs
WHERE status = 'SUCCEEDED'
  AND expires_at < now()
LIMIT 500;
```

After deleting the object, mark the job expired:

```sql
UPDATE export_jobs
SET status = 'EXPIRED'
WHERE id = :export_id
  AND status = 'SUCCEEDED';
```

If deletion from object storage fails, retry. A database row marked expired while the object still exists is a privacy bug.

## Notifications

Users should not have to stare at a progress page.

Notification options:

- email with link to export page
- in-app notification
- webhook for API customers
- callback URL for enterprise integrations

Do not put the signed object URL directly in a long-lived email. Link to your app, re-check authorization, then generate a short-lived signed URL.

Completion event:

```json
{
  "eventType": "EXPORT_COMPLETED",
  "exportId": "exp_123",
  "tenantId": "t_42",
  "requestedBy": "u_123",
  "rowCount": 2400000,
  "expiresAt": "2026-04-15T00:00:00Z"
}
```

## Idempotency and Retries

Create export requests should support idempotency:

```http
Idempotency-Key: export-audit-logs-2026-04-08
```

If the user double-clicks export, return the existing job instead of creating duplicates.

Worker retries should be safe:

- write to a temporary object key
- commit manifest after all parts succeed
- mark job succeeded only after object upload completes
- include attempt ID in temporary keys

Example keys:

```text
exports/exp_123/attempt_1/part-000.csv
exports/exp_123/attempt_2/part-000.csv
exports/exp_123/final/manifest.json
```

Only final keys are served to users.

## Audit Logging

Audit every export request:

```json
{
  "eventType": "DATA_EXPORT_REQUESTED",
  "tenantId": "t_42",
  "actor": "user:u_123",
  "exportType": "audit_logs",
  "format": "csv",
  "filtersHash": "sha256:abc123",
  "requestedColumns": ["createdAt", "actor", "eventType"],
  "createdAt": "2026-04-08T10:00:00Z"
}
```

Audit downloads:

```json
{
  "eventType": "DATA_EXPORT_DOWNLOADED",
  "tenantId": "t_42",
  "actor": "user:u_123",
  "exportId": "exp_123",
  "sourceIp": "203.0.113.10",
  "createdAt": "2026-04-08T10:30:00Z"
}
```

Do not store raw filters if they contain sensitive search terms. Store a redacted preview and a hash.

## Abuse Controls

Exports can become a data exfiltration path.

Controls:

- daily export quota per user
- concurrent export limit per tenant
- extra approval for sensitive exports
- row and byte limits
- watermarking for certain file types
- anomaly detection for unusual export volume
- alerts for high-risk export types
- mandatory retention expiration

Example quota check:

```sql
SELECT count(*)
FROM export_jobs
WHERE tenant_id = :tenant_id
  AND requested_by = :user_id
  AND created_at >= now() - interval '24 hours'
  AND status IN ('QUEUED', 'RUNNING', 'SUCCEEDED');
```

Quotas should be product-aware. A compliance officer may legitimately need more exports than a normal user.

## Observability

Metrics:

- export requests by type
- export success and failure rate
- queue wait time
- job runtime
- rows exported
- bytes exported
- database query latency
- object storage upload failures
- download URL generation count
- expired object deletion failures
- quota denial count

Structured log:

```json
{
  "event": "export_job_completed",
  "exportId": "exp_123",
  "tenantId": "t_42",
  "exportType": "audit_logs",
  "format": "csv",
  "rowCount": 2400000,
  "byteCount": 380000000,
  "durationSeconds": 420
}
```

Useful dashboards:

- slowest export types
- largest tenants by export bytes
- failed exports by error code
- read replica CPU during exports
- queue backlog by priority
- expired object cleanup lag

## Failure Modes

**Web request does the export.** Long query and file generation block request threads.

**Memory grows with file size.** Worker builds the whole file before upload.

**Offset pagination gets slower over time.** Large offsets repeatedly scan skipped rows.

**No authorization on download.** Anyone with an old URL can download the file.

**Signed URLs live too long.** Export links stay usable after the user loses access.

**No tenant filter.** A bug in query building exports another tenant's data.

**CSV formula injection.** A customer opens the file and spreadsheet software executes a formula-like cell.

**Cleanup marks expired before deletion.** Object remains in storage after the database says it is gone.

**Retries create duplicate files.** Multiple attempts write to the same final key.

**No audit trail.** Nobody can answer who exported sensitive records.

## Production Checklist

- Make large exports asynchronous.
- Store export job metadata durably.
- Enforce authorization before enqueue and before download.
- Derive tenant ID from trusted context.
- Use object storage for generated files.
- Stream output with bounded memory.
- Use cursor pagination or partitioned reads.
- Prefer read replicas for expensive exports.
- Use idempotency keys for create requests.
- Write temporary objects and commit final manifests.
- Add retention and deletion workflows.
- Audit export requests and downloads.
- Protect CSV output from formula injection.
- Limit concurrency per tenant and globally.
- Alert on unusual export volume and cleanup failures.

## Read Next

- [System Design: Building an Audit Log System](/blog/system-design-audit-log-system/)
- [System Design: Building a File Upload Platform](/blog/system-design-file-upload-platform/)
- [System Design: Building a Distributed Job Scheduler](/blog/system-design-job-scheduler/)
- [Idempotency Keys in APIs](/blog/api-idempotency-keys/)
