---
title: "System Design: Building a File Upload Platform"
description: "Design a production file upload platform with signed URLs, multipart uploads, object storage, metadata, virus scanning, media processing, access control, deduplication, lifecycle policies, CDN delivery, and failure recovery."
date: "2026-04-08"
category: "System Design"
tags: ["system design", "file upload", "object storage", "s3", "cdn", "security", "backend engineering"]
featured: false
affiliateSection: "system-design-courses"
---

File upload looks easy until production traffic arrives. Users upload huge files, mobile networks drop halfway through, browsers retry, malicious files appear, thumbnails fail, metadata gets out of sync, signed URLs expire, and storage bills quietly grow forever.

A good file upload platform separates the upload path from the processing path. It lets clients upload directly to object storage, records metadata durably, scans files before exposing them, processes media asynchronously, enforces access control, and gives users a way to recover from partial failures.

This guide designs a production file upload platform: signed URLs, multipart uploads, object storage, metadata tables, virus scanning, media processing, deduplication, access control, CDN delivery, lifecycle policies, and observability.

## Requirements

Functional requirements:

- users can upload files
- users can download files they are allowed to access
- large uploads can resume or retry
- files are scanned before being published
- images and videos can be processed asynchronously
- metadata is searchable
- files can be deleted or expired
- users can see upload status

Non-functional requirements:

- upload path should not overload application servers
- support large files
- tolerate client disconnects
- protect against malicious files
- enforce tenant isolation
- keep metadata and object storage consistent
- keep storage cost under control
- provide clear operational visibility

The most important design choice: do not proxy large file bytes through your application servers unless you absolutely must. Use signed URLs and upload directly to object storage.

## High-Level Architecture

```text
Client
  |
  +-- request upload session
        |
        v
      Upload API
        |
        +-- create file metadata row
        +-- create signed upload URL
        |
        v
Client uploads bytes directly to object storage
        |
        v
Object storage event
        |
        v
Processing pipeline
  |
  +-- verify object
  +-- virus scan
  +-- extract metadata
  +-- generate thumbnails/transcodes
  +-- mark file READY
```

The application controls permissions and metadata. Object storage handles bytes. Workers handle slow processing.

## File Metadata Schema

```sql
CREATE TABLE files (
  file_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT,
  checksum_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'UPLOAD_REQUESTED',
  visibility TEXT NOT NULL DEFAULT 'PRIVATE',
  scan_status TEXT NOT NULL DEFAULT 'PENDING',
  processing_status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_files_tenant_owner_time
  ON files (tenant_id, owner_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_files_status
  ON files (status, created_at);
```

Use a generated object key, not the raw filename:

```text
tenant_123/2026/04/08/file_01JABC/original
```

Raw filenames can contain unsafe characters, duplicates, or sensitive information. Keep them as metadata only.

## Upload Session

The upload session is the contract between client, API, and object storage.

```sql
CREATE TABLE upload_sessions (
  session_id UUID PRIMARY KEY,
  file_id UUID NOT NULL REFERENCES files(file_id),
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED',
  upload_type TEXT NOT NULL, -- SINGLE_PART, MULTIPART
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

Create session API:

```json
{
  "filename": "quarterly-report.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 18422192,
  "checksumSha256": "9e4c...",
  "visibility": "PRIVATE"
}
```

Response:

```json
{
  "fileId": "file_123",
  "sessionId": "upl_456",
  "uploadType": "SINGLE_PART",
  "uploadUrl": "https://object-store.example.com/signed-url",
  "expiresAt": "2026-04-08T10:30:00Z"
}
```

Validate before creating a URL:

- user permission
- tenant storage quota
- allowed content type
- max file size
- filename length
- expected checksum format

## Direct Upload With Signed URLs

Signed URLs let the client upload to object storage without sending bytes through your API.

```ts
export async function createUploadSession(request: CreateUploadRequest, user: User) {
  authorizeUpload(user, request);

  const fileId = crypto.randomUUID();
  const objectKey = `${user.tenantId}/${new Date().toISOString().slice(0, 10)}/${fileId}/original`;

  await db.transaction(async tx => {
    await tx.files.insert({
      fileId,
      tenantId: user.tenantId,
      ownerId: user.id,
      objectKey,
      originalFilename: request.filename,
      contentType: request.contentType,
      sizeBytes: request.sizeBytes,
      checksumSha256: request.checksumSha256,
      status: "UPLOAD_REQUESTED",
    });

    await tx.uploadSessions.insert({
      sessionId: crypto.randomUUID(),
      fileId,
      tenantId: user.tenantId,
      uploadType: "SINGLE_PART",
      expiresAt: addMinutes(new Date(), 15),
    });
  });

  const uploadUrl = await objectStore.createSignedPutUrl({
    key: objectKey,
    contentType: request.contentType,
    expiresInSeconds: 900,
    metadata: {
      fileId,
      tenantId: user.tenantId,
    },
  });

  return { fileId, uploadUrl };
}
```

Keep signed URLs short-lived. If the client needs more time, let it request a new session or resume a multipart upload.

## Multipart Uploads

Large files need multipart upload.

Flow:

```text
1. Client asks API to initiate multipart upload.
2. API creates file metadata and multipart upload ID.
3. Client asks API for signed URLs for parts.
4. Client uploads parts directly to object storage.
5. Client tells API all parts are uploaded.
6. API completes multipart upload.
7. Processing pipeline validates and scans object.
```

Part table:

```sql
CREATE TABLE upload_parts (
  session_id UUID NOT NULL REFERENCES upload_sessions(session_id),
  part_number INT NOT NULL,
  etag TEXT,
  size_bytes BIGINT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  uploaded_at TIMESTAMPTZ,
  PRIMARY KEY (session_id, part_number)
);
```

Client completion request:

```json
{
  "sessionId": "upl_456",
  "parts": [
    { "partNumber": 1, "etag": "\"abc\"" },
    { "partNumber": 2, "etag": "\"def\"" }
  ]
}
```

Do not trust the client blindly. Verify that the session belongs to the user and that the parts match the expected upload.

## Finalization

Object storage events are useful, but they can be delayed or duplicated. Make finalization idempotent.

```ts
export async function finalizeUpload(fileId: string): Promise<void> {
  const file = await fileRepository.find(fileId);
  if (!file || file.status === "READY" || file.status === "QUARANTINED") {
    return;
  }

  const object = await objectStore.headObject(file.objectKey);

  if (file.sizeBytes && object.sizeBytes !== file.sizeBytes) {
    await fileRepository.markFailed(fileId, "SIZE_MISMATCH");
    return;
  }

  await fileRepository.markUploaded(fileId, {
    uploadedAt: new Date(),
    actualSizeBytes: object.sizeBytes,
  });

  await processingQueue.enqueue({
    type: "SCAN_AND_PROCESS_FILE",
    fileId,
    objectKey: file.objectKey,
  });
}
```

You can trigger finalization from:

- client completion callback
- object storage event
- periodic reconciliation job

Use all three for resilience. The first is fast, the second is automatic, and the third repairs missed events.

## Virus Scanning And Quarantine

Never publish unscanned user uploads directly.

Processing flow:

```text
UPLOADED -> SCANNING -> CLEAN -> PROCESSING -> READY
                  |
                  v
              QUARANTINED
```

Worker:

```ts
export async function scanFile(job: ScanFileJob): Promise<void> {
  const file = await fileRepository.find(job.fileId);
  if (!file || file.scanStatus === "CLEAN") {
    return;
  }

  await fileRepository.markScanning(job.fileId);

  const scanResult = await virusScanner.scanObject(file.objectKey);

  if (scanResult.status === "INFECTED") {
    await fileRepository.markQuarantined(job.fileId, scanResult.signature);
    await auditLog.record({
      action: "FILE_QUARANTINED",
      tenantId: file.tenantId,
      resourceId: file.fileId,
      metadata: { signature: scanResult.signature },
    });
    return;
  }

  await fileRepository.markClean(job.fileId);
  await mediaProcessingQueue.enqueue({ fileId: file.fileId });
}
```

Quarantined files should not be downloadable by normal users. Keep a restricted admin path for security review if required.

## Media Processing

Images and videos need asynchronous processing:

- image thumbnails
- image dimension extraction
- video transcodes
- audio waveform generation
- PDF previews
- text extraction

Derivative table:

```sql
CREATE TABLE file_derivatives (
  derivative_id UUID PRIMARY KEY,
  file_id UUID NOT NULL REFERENCES files(file_id),
  type TEXT NOT NULL, -- THUMBNAIL, PREVIEW, TRANSCODE
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  width INT,
  height INT,
  size_bytes BIGINT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Keep original and derivatives separate. If thumbnail generation fails, the original file metadata should still tell the truth.

## Access Control

Do not make object storage paths guessable and public by default.

Download flow for private files:

```text
Client -> Download API -> authorize -> signed GET URL -> object storage
```

Example:

```ts
export async function createDownloadUrl(fileId: string, user: User) {
  const file = await fileRepository.find(fileId);

  if (!file || file.deletedAt) {
    throw new NotFoundError();
  }

  authorizeDownload(user, file);

  if (file.status !== "READY") {
    throw new Error("file is not ready for download");
  }

  return objectStore.createSignedGetUrl({
    key: file.objectKey,
    expiresInSeconds: 300,
    responseContentDisposition: `attachment; filename="${safeFilename(file.originalFilename)}"`,
  });
}
```

For public files, serve through a CDN and keep metadata in your database. Public does not mean unmanaged.

## Deduplication

Use checksums for deduplication when it is worth the complexity.

```sql
CREATE TABLE file_blobs (
  blob_id UUID PRIMARY KEY,
  checksum_sha256 TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  size_bytes BIGINT NOT NULL,
  reference_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Metadata rows can reference a shared blob:

```sql
ALTER TABLE files ADD COLUMN blob_id UUID REFERENCES file_blobs(blob_id);
```

Be careful with security. Cross-tenant deduplication can leak whether another tenant already uploaded a file. For sensitive systems, deduplicate only within a tenant or avoid user-visible dedup behavior.

## Reconciliation

Metadata and object storage can drift:

- metadata row exists but upload never completed
- object exists but processing event was missed
- file marked ready but object was deleted manually
- multipart session never completed

Run reconciliation jobs:

```sql
SELECT file_id, object_key
FROM files
WHERE status = 'UPLOAD_REQUESTED'
  AND created_at < now() - interval '1 hour';
```

Actions:

- expire abandoned upload sessions
- abort stale multipart uploads
- enqueue missing scan jobs
- mark missing objects as failed
- delete orphaned derivatives

Do not rely on event delivery alone for correctness.

## Lifecycle And Cost Control

Storage grows forever unless you design deletion and lifecycle policies.

Policies:

- expire abandoned uploads after a few hours
- move old private files to cheaper storage tiers
- delete derivatives when originals are deleted
- retain quarantined files only as long as policy requires
- hard-delete after legal retention expires

Soft delete first:

```sql
UPDATE files
SET deleted_at = now(),
    status = 'DELETED'
WHERE tenant_id = :tenant_id
  AND file_id = :file_id;
```

Then asynchronous cleanup deletes the object and derivatives.

## Observability

Metrics:

- upload sessions created
- upload completion rate
- abandoned upload count
- upload size distribution
- scan duration
- scan failure rate
- quarantined file count
- processing duration
- derivative failure rate
- signed URL generation failures
- storage bytes by tenant

Structured event:

```json
{
  "event": "file_processing_completed",
  "fileId": "file_123",
  "tenantId": "tenant_abc",
  "contentType": "image/png",
  "sizeBytes": 18422192,
  "scanStatus": "CLEAN",
  "processingStatus": "READY",
  "durationMs": 8420
}
```

Dashboards should show upload funnel health:

```text
UPLOAD_REQUESTED -> UPLOADED -> SCANNING -> PROCESSING -> READY
```

If files get stuck between states, you need to see exactly where.

## Failure Modes

**Client disconnects mid-upload.** Session remains open and object may be partial or absent.

**Signed URL expires.** Client needs a clean way to request a fresh URL.

**Object event is missed.** File stays uploaded but unprocessed unless reconciliation exists.

**Virus scanner backlog.** Files pile up in `SCANNING` and users cannot download them.

**Metadata says ready but object missing.** Manual deletion or lifecycle policy removed the object too early.

**Public exposure bug.** Unscanned or private files are served through CDN.

**Multipart upload leak.** Unfinished multipart uploads accumulate storage charges.

**Cross-tenant dedup leak.** A tenant infers another tenant uploaded the same file.

## Production Checklist

- Upload directly to object storage with signed URLs.
- Keep signed URLs short-lived.
- Use multipart upload for large files.
- Store metadata separately from bytes.
- Generate object keys; do not trust raw filenames.
- Scan files before publishing.
- Keep quarantined files inaccessible to normal users.
- Process media asynchronously.
- Make finalization idempotent.
- Use reconciliation jobs for missed events.
- Authorize every download.
- Use CDN only for files safe to expose.
- Add lifecycle policies for abandoned uploads and old objects.
- Track storage bytes by tenant.
- Avoid cross-tenant dedup unless the privacy model allows it.

## Read Next

- [System Design: Building a Webhook Delivery Platform](/blog/system-design-webhook-delivery-platform/)
- [System Design: Building an Audit Log System](/blog/system-design-audit-log-system/)
- [AWS High Traffic Architecture](/blog/aws-high-traffic-architecture/)
- [Zero-Downtime Database Migrations](/blog/zero-downtime-database-migrations/)
