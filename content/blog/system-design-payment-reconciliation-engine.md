---
title: "System Design: Building a Payment Reconciliation Engine"
description: "Design a production payment reconciliation engine that matches gateway events, bank settlements, internal ledgers, refunds, chargebacks, and reversals with idempotency, tolerance rules, and operational workflows."
date: "2026-04-10"
category: "System Design"
tags: ["system design", "payments", "reconciliation", "distributed systems", "databases", "fintech", "backend engineering"]
featured: false
affiliateSection: "system-design-courses"
---

Payments look simple from the product surface.

A customer pays. The UI says success. The order moves forward.

Under the hood, though, the money and the system state do not move in a single atomic transaction. A payment gateway authorizes. A bank settles later. A webhook arrives out of order. A refund partially completes. A chargeback appears days later. Your internal ledger may say one thing while the gateway report says another.

That gap is where reconciliation lives.

If reconciliation is weak, finance loses trust in engineering, support cannot explain missing money, settlement mismatches pile up, and month-end close turns into a war room. If reconciliation is strong, teams can answer hard questions quickly:

- Which successful orders never settled?
- Which refunds were recorded internally but never processed by the PSP?
- Which chargebacks were received but not applied to the customer account?
- Which transactions are still pending because one event is late, not because money is missing?

This guide designs a production payment reconciliation engine.

## Problem Statement

Build a reconciliation platform for an online payments business.

The platform must compare and reconcile records from:

- internal payment service
- internal ledger
- payment gateway / PSP reports
- bank settlement files
- refund systems
- dispute / chargeback feeds

The output should make mismatches explainable and actionable instead of dumping raw differences into a table that nobody trusts.

## Requirements

Functional requirements:

- ingest internal payment events
- ingest gateway webhooks and settlement reports
- ingest bank settlement files
- ingest refund, reversal, and chargeback events
- match records across systems
- support one-to-one, one-to-many, and many-to-one matching
- classify mismatches by reason
- allow tolerance rules for fees, FX, and timing delays
- expose case management for finance and operations
- support re-runs and backfills
- maintain audit history for every reconciliation decision

Non-functional requirements:

- correctness over raw speed
- idempotent ingestion
- traceable lineage from source file/event to final case
- support late-arriving data
- survive duplicate and out-of-order events
- isolate merchant / tenant data
- handle daily batch files and real-time streams together
- support large settlement volumes without manual SQL firefighting

The main design constraint is this: reconciliation is not just data comparison. It is **stateful matching over imperfect, late, and sometimes contradictory records**.

## Example Flows

To design the engine correctly, you need to be concrete about the money movement patterns.

### Flow 1: Successful card payment

1. customer checks out
2. payment service creates payment `P123`
3. PSP authorizes and captures payment
4. internal ledger records receivable
5. PSP settlement file lands next day
6. bank report confirms net settlement
7. reconciliation marks transaction as matched

### Flow 2: Refund mismatch

1. internal system marks refund successful
2. gateway API call timed out after request submission
3. retry logic misbehaved, creating ambiguity
4. refund report from PSP does not contain the refund
5. reconciliation opens a case: `internal_refund_missing_at_gateway`

### Flow 3: Chargeback

1. payment settled successfully
2. weeks later, a dispute event arrives
3. finance fee appears in dispute feed
4. internal ledger lacks chargeback adjustment
5. reconciliation opens a chargeback mismatch

These flows show why simple "join two tables on payment_id" logic is not enough.

## Data Sources

The engine usually consumes four classes of data:

### 1. Internal operational events

- payment created
- authorization succeeded / failed
- capture succeeded / failed
- refund requested / completed
- reversal completed
- order cancelled

These are closest to product state but not always closest to money movement.

### 2. Internal ledger entries

The ledger is what finance trusts for accounting.

Examples:

- debit cash clearing account
- credit merchant receivable
- debit refund liability
- credit fee expense

If operational services say "success" but ledger entries are missing, reconciliation should flag that too.

### 3. PSP / gateway reports

These may come as:

- webhooks
- REST polling APIs
- CSV files in S3
- SFTP batch files

Typical fields:

- gateway transaction id
- merchant reference
- authorization amount
- capture amount
- fee
- tax
- settlement amount
- currency
- status
- settled date

### 4. Bank settlement files

These confirm what actually landed in the bank.

This is the final money truth for cash movement, but it is delayed and often aggregated.

## Core Design Principle

Do not try to "fix" source systems inside reconciliation.

The reconciliation engine should:

- ingest source truth as-is
- normalize it into a common model
- match according to explicit rules
- classify differences
- produce cases
- feed corrections back to upstream systems through well-defined workflows

If you mutate source records directly during matching, the audit trail becomes muddy and re-runs become dangerous.

## High-Level Architecture

```text
Internal Payment Service ----\
Internal Ledger ------------- \
Gateway Webhooks ------------- > Ingestion Layer -> Raw Store -> Normalization -> Matching Engine
Gateway Reports ------------- /                                            |
Bank Settlement Files -------/                                             v
                                                                  Reconciliation Cases
                                                                            |
                                                                            +--> Ops Dashboard
                                                                            +--> Finance Reports
                                                                            +--> Replay / Backfill
                                                                            +--> Correction Workflows
```

Break the system into five clear stages:

1. ingestion
2. raw storage
3. normalization
4. matching
5. case management

Each stage should be rerunnable without corrupting the previous stage.

## Canonical Data Model

Every source record needs a canonical representation before matching.

```sql
CREATE TABLE reconciliation_records (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_system TEXT NOT NULL,        -- internal_payment, ledger, psp_report, bank_file
  source_type TEXT NOT NULL,          -- event, file_row, webhook, api_poll
  source_record_id TEXT NOT NULL,
  source_file_id TEXT,
  record_type TEXT NOT NULL,          -- payment, refund, settlement, fee, chargeback
  transaction_ref TEXT,
  external_ref TEXT,
  order_id TEXT,
  payment_id TEXT,
  ledger_entry_id TEXT,
  currency TEXT NOT NULL,
  gross_amount NUMERIC(18, 2),
  fee_amount NUMERIC(18, 2),
  tax_amount NUMERIC(18, 2),
  net_amount NUMERIC(18, 2),
  event_time TIMESTAMPTZ,
  settlement_date DATE,
  status TEXT,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  ingestion_run_id UUID NOT NULL,
  normalized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_system, source_record_id)
);

CREATE INDEX idx_recon_payment_id ON reconciliation_records (tenant_id, payment_id);
CREATE INDEX idx_recon_external_ref ON reconciliation_records (tenant_id, external_ref);
CREATE INDEX idx_recon_type_date ON reconciliation_records (tenant_id, record_type, settlement_date);
CREATE INDEX idx_recon_order_id ON reconciliation_records (tenant_id, order_id);
```

This table should not be your only storage layer, but it is the shared language of the reconciliation engine.

## Why Raw Storage Matters

Always keep the raw payload.

```sql
CREATE TABLE reconciliation_raw_events (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_file_id TEXT,
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ingestion_run_id UUID NOT NULL,
  UNIQUE (tenant_id, source_system, source_record_id)
);
```

This helps with:

- re-parsing when normalization logic changes
- audit and dispute analysis
- debugging source parsing issues
- proving that a mismatch came from upstream data, not your transformation

Think of raw storage as the black box recorder for payments.

## Ingestion Layer

Different sources arrive in different shapes and cadences.

### Real-time sources

- payment events from Kafka
- gateway webhooks
- ledger postings

### Batch sources

- daily gateway CSV
- bank settlement files
- dispute export files

Handle ingestion as append-only and idempotent.

Example ingestion worker:

```java
@Service
public class RawIngestionService {

    public void ingest(RawEnvelope envelope) {
        String dedupeKey = envelope.tenantId() + ":" + envelope.sourceSystem() + ":" + envelope.sourceRecordId();

        if (rawRepository.existsByUniqueKey(dedupeKey)) {
            return;
        }

        rawRepository.save(
            RawEventEntity.builder()
                .id(UUID.randomUUID())
                .tenantId(envelope.tenantId())
                .sourceSystem(envelope.sourceSystem())
                .sourceRecordId(envelope.sourceRecordId())
                .sourceFileId(envelope.sourceFileId())
                .payload(envelope.payload())
                .payloadHash(hash(envelope.payload()))
                .ingestionRunId(envelope.ingestionRunId())
                .build()
        );
    }
}
```

The dedupe key must be source-specific. If a gateway retries the same webhook five times, the raw store should still contain one logical record, not five duplicates that later create false mismatches.

## Normalization Layer

Normalization converts raw payloads into the canonical schema.

Example:

```java
public ReconciliationRecord normalizeGatewaySettlement(GatewaySettlementRow row, UUID runId) {
    return ReconciliationRecord.builder()
        .id(UUID.randomUUID())
        .tenantId(row.merchantId())
        .sourceSystem("psp_report")
        .sourceType("file_row")
        .sourceRecordId(row.reportRowId())
        .sourceFileId(row.fileId())
        .recordType("settlement")
        .transactionRef(row.merchantReference())
        .externalRef(row.pspReference())
        .paymentId(row.merchantPaymentId())
        .currency(row.currency())
        .grossAmount(row.amount())
        .feeAmount(row.fee())
        .netAmount(row.amount().subtract(row.fee()))
        .settlementDate(row.settlementDate())
        .status(row.status())
        .ingestionRunId(runId)
        .attributes(Map.of(
            "scheme", row.scheme(),
            "country", row.country(),
            "batchId", row.batchId()
        ))
        .build();
}
```

Normalization is also where you standardize:

- currency codes
- timestamp formats
- status enums
- fee direction
- tenant identifiers

Do not hide ambiguity here. If a field is missing or unclear, keep it explicit in `attributes` and let matching rules decide.

## Matching Strategy

Not all records match the same way.

### One-to-one

Most clean card payments:

- internal payment `P123`
- PSP capture `P123`
- ledger entry `P123`

### One-to-many

One order may be split into:

- one payment
- multiple settlement rows
- separate fee rows

### Many-to-one

A bank may settle several gateway transactions in one aggregated deposit.

That means the engine needs configurable matchers, not a single SQL join.

## Matching Keys

Use a priority ladder, not a single key.

Example order:

1. exact external gateway reference
2. payment id
3. merchant reference / order id
4. amount + currency + date window + merchant

Why a ladder matters:

- some PSPs preserve merchant references
- some bank files only carry batch-level references
- some refunds have distinct external ids from the original payment

## Matching Windows and Tolerance Rules

Reconciliation without timing tolerance will produce garbage.

Example rules:

- settlement can arrive up to T+2 days after capture
- fee differences up to 0.50 may be acceptable for tax rounding
- FX difference may be tolerated within configured basis points
- chargeback can arrive up to 180 days later

Represent these explicitly:

```sql
CREATE TABLE reconciliation_rules (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  match_priority INT NOT NULL,
  time_tolerance_hours INT,
  amount_tolerance NUMERIC(18, 2),
  percent_tolerance NUMERIC(8, 4),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb
);
```

This allows merchant-specific or PSP-specific reconciliation behavior without code deployment for every finance request.

## Matching Engine Design

The matching engine should run in deterministic phases:

1. exact id match
2. exact business reference match
3. tolerant amount/date match
4. aggregate settlement match
5. unmatched classification

A simple version:

```java
public MatchResult reconcile(ReconRecord internalRecord, List<ReconRecord> candidates, RuleSet rules) {
    Optional<ReconRecord> exactExternalRef = candidates.stream()
        .filter(c -> Objects.equals(c.externalRef(), internalRecord.externalRef()))
        .findFirst();

    if (exactExternalRef.isPresent()) {
        return MatchResult.matched("EXTERNAL_REF", List.of(exactExternalRef.get()));
    }

    Optional<ReconRecord> exactPaymentId = candidates.stream()
        .filter(c -> Objects.equals(c.paymentId(), internalRecord.paymentId()))
        .findFirst();

    if (exactPaymentId.isPresent()) {
        return MatchResult.matched("PAYMENT_ID", List.of(exactPaymentId.get()));
    }

    List<ReconRecord> amountWindowMatches = candidates.stream()
        .filter(c -> sameCurrency(c, internalRecord))
        .filter(c -> withinAmountTolerance(c.netAmount(), internalRecord.netAmount(), rules.amountTolerance()))
        .filter(c -> withinTimeWindow(c.eventTime(), internalRecord.eventTime(), rules.timeTolerance()))
        .toList();

    if (amountWindowMatches.size() == 1) {
        return MatchResult.matched("AMOUNT_TIME_TOLERANCE", amountWindowMatches);
    }

    if (amountWindowMatches.size() > 1) {
        return MatchResult.ambiguous("MULTIPLE_CANDIDATES", amountWindowMatches);
    }

    return MatchResult.unmatched("NO_CANDIDATE_FOUND");
}
```

This code is intentionally plain. Reconciliation logic should be boring and explainable. Clever matching that nobody can reason about is operational debt.

## Reconciliation States

Each logical transaction group needs a reconciliation state:

```text
PENDING_SOURCE_DATA
MATCHED
MATCHED_WITH_TOLERANCE
PARTIAL_MATCH
UNMATCHED_INTERNAL_ONLY
UNMATCHED_EXTERNAL_ONLY
AMOUNT_MISMATCH
STATUS_MISMATCH
DUPLICATE_EXTERNAL_RECORD
AMBIGUOUS_MATCH
MANUALLY_RESOLVED
ESCALATED
```

This state machine matters because finance does not want a binary answer. They want to know whether the problem is:

- likely timing
- likely missing ledger entry
- likely PSP issue
- likely duplicate event
- likely human investigation

## Case Management

A mismatch without workflow is just a table that gets ignored.

Create a case object:

```sql
CREATE TABLE reconciliation_cases (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  case_type TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT NOT NULL,
  reconciliation_key TEXT NOT NULL,
  summary TEXT NOT NULL,
  details JSONB NOT NULL,
  assignee TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution_type TEXT,
  resolution_notes TEXT
);

CREATE INDEX idx_recon_cases_status ON reconciliation_cases (tenant_id, status, severity);
```

Example cases:

- payment missing in gateway report
- settlement net amount mismatch
- refund posted internally but absent externally
- duplicate chargeback event
- missing ledger for settled payment

Cases should support comments, attachments, and state transitions, because real reconciliation work is collaborative.

## Bank Aggregation Problem

Bank settlement is one of the hardest parts.

Why?

Because a single bank credit can represent:

- 10,000 captured payments
- minus PSP fees
- minus refunds
- minus dispute deductions
- maybe in a different time zone and banking date

This is not a row-level match problem. It is a group-level balance problem.

One useful pattern is a settlement bucket:

```sql
CREATE TABLE settlement_buckets (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  settlement_date DATE NOT NULL,
  currency TEXT NOT NULL,
  batch_reference TEXT,
  gross_total NUMERIC(18, 2) NOT NULL,
  fee_total NUMERIC(18, 2) NOT NULL,
  refund_total NUMERIC(18, 2) NOT NULL,
  net_total NUMERIC(18, 2) NOT NULL,
  record_count INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Then compare:

- PSP settlement bucket
- bank deposit bucket
- ledger cash-clearing bucket

This gives you both transaction-level and batch-level reconciliation.

## Late Data and Replay

Some mismatches should auto-resolve when late data arrives.

Example:

- internal capture arrives on day T
- PSP settlement arrives on T+1
- bank report arrives on T+2

If you mark the capture as permanently broken on day T, your cases will explode.

Instead:

- open `PENDING_SOURCE_DATA`
- rerun matching when new source data lands
- auto-close if the case resolves cleanly

Keep replays explicit:

```http
POST /v1/reconciliation/runs
{
  "tenantId": "merchant_42",
  "fromDate": "2026-04-01",
  "toDate": "2026-04-07",
  "reason": "late_bank_file_replay"
}
```

Backfills are normal in reconciliation systems, not an exception.

## Idempotency and File Safety

Files get resent. Webhooks are retried. APIs replay. Humans upload the same CSV twice.

Use:

- unique `(tenant_id, source_system, source_record_id)` constraints
- file content hash
- ingestion run id
- file version metadata

Example file registry:

```sql
CREATE TABLE source_files (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_date DATE,
  status TEXT NOT NULL,
  row_count INT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, source_system, file_hash)
);
```

This protects finance teams from accidental duplicate uploads turning into fake duplicate mismatches.

## Operational Dashboard

The dashboard should answer three levels of questions:

### Executive / finance view

- total matched amount
- total unmatched amount
- settlement completion by day
- mismatch trends by PSP / merchant / currency

### Operations view

- open cases by type
- aging of unmatched cases
- files pending processing
- replay status

### Engineering view

- ingestion lag
- normalization errors
- matching throughput
- auto-resolution rate
- duplicate input rate

## Useful Queries

Unmatched settled payments:

```sql
SELECT payment_id, net_amount, currency, settlement_date
FROM reconciliation_records
WHERE tenant_id = 'merchant_42'
  AND source_system = 'psp_report'
  AND record_type = 'settlement'
  AND NOT EXISTS (
    SELECT 1
    FROM reconciliation_cases c
    WHERE c.tenant_id = reconciliation_records.tenant_id
      AND c.reconciliation_key = reconciliation_records.payment_id
      AND c.status IN ('MATCHED', 'MANUALLY_RESOLVED')
  );
```

Amount mismatches above tolerance:

```sql
SELECT
  i.payment_id,
  i.net_amount AS internal_amount,
  e.net_amount AS external_amount,
  ABS(i.net_amount - e.net_amount) AS difference
FROM internal_recon_view i
JOIN external_recon_view e
  ON i.tenant_id = e.tenant_id
 AND i.payment_id = e.payment_id
WHERE ABS(i.net_amount - e.net_amount) > 1.00;
```

These queries are not the whole engine, but they are what finance teams eventually ask for on bad days.

## Failure Modes

### 1. Duplicate webhook creates false mismatch

Fix:

- idempotent raw ingestion
- duplicate classification

### 2. Ledger posting delayed by downstream outage

Fix:

- pending state before mismatch escalation
- retry-aware matching windows

### 3. Settlement file schema changes silently

Fix:

- schema versioning
- parser validation
- source-file quarantine on unexpected columns

### 4. Aggregated bank deposits cannot be attributed

Fix:

- batch-level bucket reconciliation
- preserve batch identifiers and processing dates

### 5. Manual resolutions overwrite machine evidence

Fix:

- immutable audit log for case transitions
- manual resolution reason required
- keep original machine classification

## Audit Trail

Every decision should be explainable later.

```sql
CREATE TABLE reconciliation_audit_log (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,      -- case, record, run
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,           -- created, matched, reopened, manually_resolved
  actor_type TEXT NOT NULL,       -- system, user
  actor_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

When finance asks, "Why did this case close yesterday?", the answer should be one query away.

## Scaling Considerations

Reconciliation is usually not latency-critical like checkout, but volume still matters.

Patterns that help:

- partition canonical records by tenant and date
- process files in chunks
- use materialized views for reporting
- separate hot operational tables from long-term history
- keep matching workers stateless
- cache reconciliation rules by tenant

If volume grows, move matching candidates into a search-friendly projection keyed by:

- tenant
- payment id
- external ref
- order id
- date bucket
- amount bucket

That reduces expensive full-table scans during tolerant matching.

## Multi-Tenant Design

If this is a platform serving many merchants:

- all primary keys should include tenant boundaries at query level
- prevent one merchant replay from starving the whole system
- allow tenant-specific tolerance rules
- isolate dashboards and exports

This is not just security. Different merchants can have different settlement cycles, fee contracts, and refund flows.

## Design Trade-Offs

### Real-time vs batch reconciliation

- real-time gives faster detection
- batch is simpler for settlement-grade accuracy

Most systems need both:

- real-time provisional reconciliation for operations
- batch settlement reconciliation for finance truth

### Strict vs tolerant matching

- strict matching reduces false positives
- tolerant matching reduces false negatives

Use deterministic phases so tolerance is explicit, not accidental.

### Single-table engine vs workflow-driven cases

- single-table is easier initially
- workflow-driven cases become necessary once humans participate

If finance teams are emailing CSVs around, you already need cases.

## Production Checklist

- raw source data retained
- canonical model versioned
- idempotent ingestion
- tolerance rules configurable
- replay supported
- duplicate file protection
- auto-close on late-arriving data
- mismatch reasons explicit
- case workflow auditable
- dashboard shows amount at risk, not only record count

## What I Would Build First

Phase 1:

- raw ingestion
- canonical normalization
- exact matching on payment id / external ref
- basic unmatched case table

Phase 2:

- tolerance rules
- replay runs
- auto-resolution
- finance dashboard

Phase 3:

- bank bucket reconciliation
- chargeback workflows
- manual case tooling
- anomaly alerts

This sequencing matters. Teams often jump straight to a fancy dashboard before they have trustworthy ingestion and canonicalization. That always backfires.

## Final Takeaway

A payment reconciliation engine is a trust system.

Its job is not to make mismatches disappear. Its job is to make money movement explainable across systems that were never truly atomic together.

If you design it well, finance can trust engineering, support can explain customer issues, and settlement problems surface early instead of at month-end close.

If you design it poorly, every missing rupee becomes a manual investigation.

## Read Next

- [System Design: Usage Metering and Billing for SaaS](/blog/system-design-usage-metering-billing/)
- [Transactional Outbox Pattern: Reliable Event Publishing Without Dual Writes](/blog/transactional-outbox-pattern/)
- [Idempotency Keys in APIs: Retries, Duplicate Requests, and Exactly-Once Illusions](/blog/api-idempotency-keys/)
