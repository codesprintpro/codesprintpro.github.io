---
title: "System Design: Building an Email Delivery Platform"
description: "Design a production email delivery platform with queues, templates, provider failover, idempotency, suppression lists, bounce handling, unsubscribe flows, rate limits, and observability."
date: "2026-04-08"
category: "System Design"
tags: ["system design", "email delivery", "queues", "rate limiting", "idempotency", "notifications", "backend engineering"]
featured: false
affiliateSection: "system-design-courses"
---

Sending one email is easy.

Sending millions of emails reliably, legally, and without damaging your domain reputation is a system design problem.

Email delivery touches product workflows, background jobs, third-party providers, user preferences, compliance, templates, rate limits, bounces, retries, idempotency, and observability. If the platform is weak, checkout confirmation emails disappear, password resets get delayed, marketing campaigns flood provider limits, and support has no way to explain what happened.

This guide designs a production email delivery platform.

## Problem Statement

Build a platform that lets product teams send emails safely and consistently.

Examples:

- password reset
- login verification
- order confirmation
- invoice receipt
- failed payment notice
- weekly digest
- product announcement
- security alert

The platform should support critical transactional email and lower-priority bulk email without letting one starve the other.

## Requirements

Functional requirements:

- accept email send requests
- render templates with variables
- enforce user preferences
- suppress unsubscribed or bounced recipients
- queue emails by priority
- send through one or more providers
- retry transient failures
- handle provider webhooks
- track delivery status
- support idempotency
- expose search/debugging for support

Non-functional requirements:

- high availability for critical email
- low latency for OTP/password reset
- rate limiting per provider and domain
- tenant isolation
- auditability
- template versioning
- safe retries without duplicate sends
- graceful degradation during provider outages
- privacy controls for email content

The platform must make delivery observable. "We sent it" is not enough. You need to know whether the request was accepted, queued, rendered, sent to provider, bounced, delivered, opened, clicked, or suppressed.

## High-Level Architecture

```text
Product Service
  |
  v
Email API
  |
  +-- validate request
  +-- idempotency check
  +-- template lookup
  +-- preference/suppression check
  |
  v
Priority Queues
  |
  v
Email Workers
  |
  +-- render template
  +-- rate limit
  +-- provider selection
  +-- send email
  |
  v
Provider Webhooks -> Delivery Tracker
```

Separate ingestion from delivery. Product services should not wait for a third-party email provider in the request path.

## Data Model

Email message:

```sql
CREATE TABLE email_messages (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  message_key TEXT NOT NULL,
  recipient_email_hash TEXT NOT NULL,
  recipient_email_encrypted BYTEA NOT NULL,
  template_key TEXT NOT NULL,
  template_version INT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT,
  provider TEXT,
  provider_message_id TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  queued_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, idempotency_key)
);
```

Template:

```sql
CREATE TABLE email_templates (
  tenant_id TEXT NOT NULL,
  template_key TEXT NOT NULL,
  version INT NOT NULL,
  subject_template TEXT NOT NULL,
  html_template TEXT NOT NULL,
  text_template TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, template_key, version)
);
```

Suppression list:

```sql
CREATE TABLE email_suppressions (
  tenant_id TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, email_hash, reason)
);
```

Use hashes for lookup and encrypted values for sending. Avoid storing raw email addresses in many tables.

## Send API

```http
POST /v1/email/send
Idempotency-Key: order-confirmation-order-123
```

```json
{
  "tenantId": "t_42",
  "recipient": {
    "email": "customer@example.com",
    "userId": "u_123"
  },
  "templateKey": "order_confirmation",
  "variables": {
    "firstName": "Asha",
    "orderId": "order_123",
    "total": "$42.00"
  },
  "priority": "transactional",
  "category": "order_updates"
}
```

Response:

```json
{
  "messageId": "msg_123",
  "status": "QUEUED"
}
```

The API should return after enqueueing. It should not wait for final delivery.

## Priority Queues

Use separate queues for different urgency:

```text
email.critical       password reset, OTP, security alert
email.transactional  receipts, invoices, order updates
email.standard       digests, onboarding
email.bulk           marketing, announcements
```

Workers for critical email should have reserved capacity. A marketing campaign should never delay password reset.

Example routing:

```ts
function queueFor(priority: EmailPriority): string {
  switch (priority) {
    case "critical":
      return "email.critical";
    case "transactional":
      return "email.transactional";
    case "bulk":
      return "email.bulk";
    default:
      return "email.standard";
  }
}
```

Use a dead-letter queue for messages that exhaust retries.

## Idempotency

Email is a side effect. Retries can create duplicates unless you design for idempotency.

Use a business idempotency key:

```text
password-reset:u_123:token_abc
order-confirmation:order_123
invoice-receipt:invoice_456
```

Ingestion:

```ts
async function enqueueEmail(req: SendEmailRequest) {
  const existing = await emailRepository.findByIdempotencyKey(
    req.tenantId,
    req.idempotencyKey
  );

  if (existing) {
    return existing;
  }

  return emailRepository.createQueuedMessage(req);
}
```

Worker retry idempotency is different. If a worker times out after sending but before storing provider response, a retry may send again. Some providers support provider-side idempotency or custom headers. If not, keep retries conservative around ambiguous timeouts.

## Template Rendering

Templates need versioning.

```json
{
  "templateKey": "invoice_receipt",
  "version": 17,
  "subject": "Your invoice {{invoiceNumber}} is ready",
  "requiredVariables": ["invoiceNumber", "amount", "downloadUrl"]
}
```

Validate variables before enqueue:

```ts
function validateTemplateVariables(template: Template, variables: Record<string, unknown>) {
  for (const name of template.requiredVariables) {
    if (variables[name] == null) {
      throw new Error(`Missing template variable: ${name}`);
    }
  }
}
```

Render in the worker using the pinned template version from the message. Do not let a template edit change emails that are already queued.

Add preview and test-send workflows for operators. Broken templates are production incidents.

## Preferences and Suppression

Before sending, check:

- global unsubscribe
- category unsubscribe
- hard bounce suppression
- complaint suppression
- tenant-level suppression
- legal requirements for bulk email

Transactional email usually bypasses marketing unsubscribe, but not all suppression. For example, a hard bounce should suppress all future sends to that address until corrected.

Preference example:

```json
{
  "userId": "u_123",
  "emailPreferences": {
    "security_alerts": true,
    "order_updates": true,
    "weekly_digest": false,
    "marketing": false
  }
}
```

Suppression check:

```ts
if (await suppressionList.isSuppressed(tenantId, emailHash)) {
  await emailRepository.markSuppressed(message.id, "recipient_suppressed");
  return;
}
```

Suppressed is a terminal status. Do not retry it.

## Provider Selection and Failover

Use provider routing rules:

```json
{
  "critical": ["provider_a", "provider_b"],
  "transactional": ["provider_a", "provider_b"],
  "bulk": ["provider_c"]
}
```

Provider selection can consider:

- provider health
- tenant configuration
- email priority
- recipient domain
- current rate limit
- cost
- historical deliverability

Failover rules:

```ts
function shouldFailover(error: ProviderError): boolean {
  return error.type === "timeout" ||
    error.type === "rate_limited" ||
    error.type === "provider_5xx";
}
```

Do not fail over on deterministic recipient errors such as invalid email address or hard bounce. That just sends bad traffic to another provider.

## Rate Limiting

Rate limits protect providers, domains, users, and your reputation.

Limit dimensions:

- provider account
- tenant
- recipient domain
- recipient user
- email category
- global platform

Token bucket:

```ts
async function acquireSendToken(key: string, limitPerMinute: number): Promise<boolean> {
  const now = Date.now();
  return redis.evalsha("token_bucket", {
    keys: [key],
    arguments: [String(limitPerMinute), String(now)],
  }) === 1;
}
```

Domain throttling matters:

```text
gmail.com -> 5,000/min
company.com -> 500/min
new-domain.example -> 50/min warmup
```

New sending domains should be warmed up gradually. Sudden high-volume sends from a new domain can hurt deliverability.

## Provider Webhooks

Providers send events:

- accepted
- delivered
- bounced
- complained
- opened
- clicked
- deferred
- rejected

Webhook handler:

```ts
async function handleProviderEvent(event: ProviderEvent) {
  await verifySignature(event);

  const message = await emailRepository.findByProviderMessageId(
    event.provider,
    event.providerMessageId
  );

  if (!message) {
    return;
  }

  await deliveryEventRepository.insert({
    messageId: message.id,
    provider: event.provider,
    type: event.type,
    occurredAt: event.occurredAt,
    rawEventId: event.id,
  });

  if (event.type === "hard_bounce" || event.type === "complaint") {
    await suppressionList.add(message.tenantId, message.recipientEmailHash, event.type);
  }
}
```

Webhook events are often duplicated and out of order. Store provider event IDs for deduplication and make status transitions tolerant.

## Status Transitions

Example:

```text
QUEUED -> RENDERED -> SENT -> DELIVERED
QUEUED -> SUPPRESSED
QUEUED -> FAILED_RETRYABLE -> QUEUED
SENT -> BOUNCED
SENT -> COMPLAINED
```

Not every provider emits delivered events. Treat `SENT` as "provider accepted responsibility," not "user received it."

Use a transition function:

```ts
function applyStatus(current: EmailStatus, event: DeliveryEvent): EmailStatus {
  if (current === "COMPLAINED") return current;
  if (event.type === "complaint") return "COMPLAINED";
  if (event.type === "hard_bounce") return "BOUNCED";
  if (event.type === "delivered" && current === "SENT") return "DELIVERED";
  return current;
}
```

Keep raw events even if the summary status does not change.

## Unsubscribe Handling

Bulk and marketing emails need unsubscribe links.

Do not put raw user IDs in unsubscribe URLs:

```text
https://example.com/unsubscribe?token=opaque_signed_token
```

Token payload:

```json
{
  "tenantId": "t_42",
  "userId": "u_123",
  "category": "marketing",
  "expiresAt": "2026-05-08T00:00:00Z"
}
```

When the user unsubscribes, update preferences and emit an audit event:

```json
{
  "eventType": "EMAIL_UNSUBSCRIBED",
  "tenantId": "t_42",
  "userId": "u_123",
  "category": "marketing",
  "source": "unsubscribe_link"
}
```

Unsubscribe flows should be fast and reliable. Do not require login for one-click unsubscribe.

## Search and Support Tools

Support needs to answer:

- Was the email requested?
- Which template version was used?
- Was it suppressed?
- Which provider was used?
- Did the provider accept it?
- Did it bounce?
- Was there a complaint?
- Did rate limiting delay it?

Search by:

- message ID
- user ID
- recipient hash
- provider message ID
- idempotency key
- tenant ID
- template key

Do not show full email bodies to broad support roles. Show metadata and redacted previews by default.

## Observability

Metrics:

- send requests by priority
- queue depth by priority
- queue wait time
- provider send latency
- provider error rate
- retry count
- suppression count
- hard bounce rate
- complaint rate
- delivery rate
- template render failures
- webhook processing lag
- rate limit delays

Structured log:

```json
{
  "event": "email_sent",
  "messageId": "msg_123",
  "tenantId": "t_42",
  "templateKey": "order_confirmation",
  "priority": "transactional",
  "provider": "provider_a",
  "providerMessageId": "pm_456"
}
```

Alerts:

- critical queue wait time above threshold
- provider failure spike
- hard bounce rate spike
- complaint rate spike
- webhook signature verification failures
- template render failures after deploy
- DLQ growth

## Failure Modes

**Product service sends directly.** Checkout or password reset depends on provider latency.

**No idempotency.** Retries send duplicate invoices or duplicate password reset emails.

**Bulk email starves critical email.** Marketing backlog delays OTP or security alerts.

**Template changes affect queued messages.** A bad edit breaks already-enqueued sends.

**Provider webhook is not idempotent.** Duplicate webhook events corrupt delivery status.

**Hard bounces keep sending.** Domain reputation suffers because suppressions are not enforced.

**Failover sends bad traffic twice.** Invalid addresses are retried against another provider.

**Signed unsubscribe token leaks identity.** URL contains raw user IDs or email addresses.

**Support sees full content by default.** Email bodies leak sensitive user data.

**No provider health model.** Workers keep sending to a failing provider and build backlog.

## Production Checklist

- Keep email sending out of product request paths.
- Use priority queues.
- Reserve capacity for critical email.
- Use idempotency keys for send requests.
- Pin template versions at enqueue time.
- Validate template variables before queueing.
- Enforce preferences and suppression lists.
- Treat hard bounces and complaints as suppressions.
- Use provider failover only for transient errors.
- Add provider, tenant, domain, and category rate limits.
- Verify webhook signatures.
- Deduplicate provider events.
- Do not store raw email bodies in broad support views.
- Add unsubscribe flows for bulk email.
- Monitor queue delay, bounce rate, complaint rate, and DLQ growth.

## Read Next

- [System Design: Notification System](/blog/system-design-notification-system/)
- [Notification System at 100K Events Per Second](/blog/notification-system-100k-per-second/)
- [Transactional Outbox Pattern](/blog/transactional-outbox-pattern/)
- [Idempotency Keys in APIs](/blog/api-idempotency-keys/)
