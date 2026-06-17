---
title: "Integrating Tap Payment Gateway with ABP Framework"
slug: tap-payment-integration-abp-framework
description: "How I integrated Tap payment gateway into an ABP Framework SaaS application — covering the charge flow, webhook verification, recurring payments, and how ABP's payment module ties it all together."
excerpt: "ABP's payment module gives you the structure. Tap gives you the gateway. Here's how they fit together — charge creation, webhook handling, recurring billing, and failure recovery."
date: 2025-03-15T00:00:00+06:00
lastmod: 2025-03-15T00:00:00+06:00
draft: true
images: []
categories: ["Development", "ABP Framework", "Payments"]
tags: ["ABP Framework", "Tap Payment", "SaaS", "Payment Gateway", "Webhook", "Recurring Payments", ".NET"]
contributors: []
pinned: false
homepage: false
---

When building a SaaS subscription system on ABP Framework, you eventually hit the point where you need real money to move. ABP's payment module gives you the abstractions — `PaymentRequest`, `Plan`, `IGatewayPaymentService` — but it doesn't ship with Tap support out of the box. You build the adapter.

This post covers exactly that: how I integrated [Tap](https://www.tap.company) into an ABP-based multi-tenant SaaS application, from the initial charge through webhook verification, to fully automated recurring billing.

---

## What ABP's Payment Module Gives You

Before writing a single line of Tap code, it helps to understand what ABP already provides.

ABP's `Volo.Payment` module defines a gateway-agnostic payment lifecycle:

- **`PaymentRequest`** — the core entity representing a payment intent. Created before the user is sent to the gateway. Tracks state: `WaitingForPayment`, `Processing`, `Completed`, `Failed`.
- **`Plan`** — a recurring billing plan linked to a payment request.
- **`IGatewayPaymentService`** — the interface your gateway adapter implements. ABP calls `StartAsync()` to initiate payment and `CompleteAsync()` when the user returns.
- **`GatewayPlan`** — links your internal `Plan` entity to the gateway's plan/agreement ID.

Your job is to implement `IGatewayPaymentService` for Tap, wire it up, and handle what happens after the user pays.

---

## The Integration Architecture

```
Subscription Flow
  ↓
SubscriptionPaymentService
  ├── Creates ABP PaymentRequest + Plan
  ├── Calls Tap charges API
  └── Returns transaction.url (user redirected to Tap)

Tap fires webhook on payment result
  ↓
TapPaymentGateway.HandleWebhookAsync()
  ├── Verify HMAC-SHA256 signature
  ├── Extract SubscriptionId + InvoiceId from metadata
  ├── "captured" → PayementSuccessEto
  └── other    → PaymentFailureEto

Event Handlers
  ├── PayementSuccessEventHandler → mark paid, enable features, activate tenant
  └── PaymentFailureEventHandler  → mark failed, send email, allow retry
```

---

## Step 1: Creating the Charge

Before calling Tap, create an ABP `PaymentRequest`. This is what ABP uses to track payment state independently of the gateway:

```csharp
var paymentRequest = await _paymentRequestAppService.CreateAsync(
    new PaymentRequestCreateDto
    {
        Products =
        {
            new PaymentRequestProductCreateDto
            {
                PaymentType = PaymentType.Subscription,
                Name = "SaaS Subscription",
                Code = "PLAN",
                PlanId = plan.Id,
                TotalPrice = invoice.Amount
            }
        },
        Currency = "SAR"
    });
```

With the ABP `PaymentRequest` created, call the Tap charge API. The key detail is what you put in the metadata — your internal subscription and invoice IDs. Tap's webhook arrives with no knowledge of your system, so these IDs are the only way to connect a Tap event back to the right record.

Once Tap returns a charge, link its ID to the ABP Plan so the two systems stay in sync:

```csharp
await _planRepository.InsertGatewayPlanAsync(
    new GatewayPlan(plan.Id, "tap", charge.Id));
```

Return the `transaction.url` from the Tap response to the frontend and redirect the user to Tap's hosted payment form.

---

## Step 2: Handling the Webhook

Tap fires a webhook when a payment completes or fails. This is where the real work happens.

### Verifying the Signature

Every Tap webhook includes a `hashstring` header. Compute an HMAC-SHA256 of the raw payload using your Tap secret key, base64-encode it, and compare. Never process a webhook that fails this check — an unverified webhook endpoint is a free activation endpoint for anyone who finds it.

### Routing via ABP's Event Bus

Once verified, the handler's only job is to extract context and publish an ABP event. All business logic stays out of the webhook endpoint:

```csharp
public async Task HandleWebhookAsync(string payload, IHeaderDictionary headers)
{
    if (!_webhookHelper.VerifyWebhookSignature(payload, hash))
        throw new AbpException("Invalid Tap webhook signature.");

    var webhookData = _webhookHelper.DeserializeWebhookResponse(payload);

    if (webhookData.Status == "captured")
        await _eventBus.PublishAsync(new PayementSuccessEto { /* ids from metadata */ });
    else
        await _eventBus.PublishAsync(new PaymentFailureEto { /* ids from metadata */ });
}
```

The webhook endpoint responds to Tap immediately. Handlers run in their own transaction and can be retried independently if something fails downstream.

---

## Step 3: Activating the Subscription on Success

The success handler is where ABP's patterns do the most work. Three ABP mechanisms come together here — unit of work, tenant switching, and feature management:

```csharp
public async Task HandleEventAsync(PayementSuccessEto eventData)
{
    using var uow = _unitOfWorkManager.Begin();
    using (_currentTenant.Change(eventData.TenantId))
    {
        // Mark invoice paid
        invoice.MarkPaymentPaid(eventData.ChargeId);

        // Reconstruct the full feature set from all paid invoices,
        // then apply it to this tenant's ABP Edition
        var enabledFeatures = await _subscriptionManager
            .CalculateEnabledFeaturesFromInvoicesAsync(subscription.Id);

        await _tenantEditionService.UpdateEditionFeaturesAsync(
            subscription.TenantId, enabledFeatures);

        // Activate the tenant
        tenant.SetActivationState(TenantActivationState.Active);

        await uow.CompleteAsync();
    }
}
```

A few things worth noting here:

**`_currentTenant.Change(tenantId)`** — webhooks arrive without tenant context. This single call switches the correct tenant scope for every repository and feature manager call within the block.

**`_unitOfWorkManager.Begin()`** — invoice update, feature assignment, and tenant activation all commit together or not at all.

**Feature reconstruction** — rather than applying the current invoice's changes on top of current state, all paid invoices are replayed to derive the correct feature set. This handles out-of-order payments correctly: if a retry succeeds after a later invoice has already been paid, the result is still accurate.

---

## Step 4: Handling Payment Failure and Retry

The failure handler follows the same tenant-switching pattern:

```csharp
public async Task HandleEventAsync(PaymentFailureEto eventData)
{
    using (_currentTenant.Change(eventData.TenantId))
    {
        invoice.MarkPaymentFailed(eventData.FailureReason);
        await _subscriptionRepository.UpdateAsync(subscription);
        await _emailSender.SendPaymentFailureEmailAsync(eventData.Email);
    }
}
```

The invoice records the failure reason and increments an attempt counter. The user is notified by email and can retry directly from their invoice list in the portal — no need to go back to the public registration flow.

---

## Step 5: Recurring Payments (Auto-Renewal)

The first successful payment does more than activate the subscription. Tap returns a payment agreement ID and a saved card reference in the charge response. These are stored against the subscription record and enable future merchant-initiated charges without any user interaction.

A background job runs daily and picks up subscriptions whose next billing date has passed. For each one it:

1. Creates a token from the saved card via the Tap token API
2. Generates a renewal invoice
3. Submits a merchant-initiated charge to Tap using the stored agreement ID — no redirect, no user action needed

The webhook flow from there is identical to a regular charge. `"captured"` fires `PayementSuccessEto`, which renews the subscription dates and keeps the tenant active. Failure follows the same path as a manual payment failure.

---

## What ABP Makes Easier

A few ABP patterns that paid off in this integration:

- **Distributed event bus** — the webhook handler never touches the database directly. It publishes an event and returns. Handlers run in their own transaction. If a handler fails, it can be retried without reprocessing the webhook.

- **`ICurrentTenant`** — webhooks arrive without tenant context. Wrapping handler logic in `_currentTenant.Change(tenantId)` switches the correct tenant scope for all repository and feature manager calls within that block.

- **`IFeatureManager` with Edition provider** — enabling a feature for a tenant is one call: `SetAsync(featureName, "true", "E", editionId)`. ABP handles the storage and cache invalidation.

- **Unit of Work** — the success handler wraps invoice update, feature assignment, and tenant activation in a single UoW. All three commit together or none of them do.

---

## Key Lessons

**Always verify the webhook signature.** An unverified webhook endpoint is a free activation endpoint for anyone who finds it.

**Put subscription context in Tap metadata.** Tap's webhook doesn't know about your internal IDs — you have to put them there yourself when creating the charge. Without subscription and invoice IDs in the metadata, the webhook handler has nothing to work with.

**Reconstruct feature state from paid invoices, not from the current event.** Payments can succeed out of order. Applying the current invoice's changes on top of current state produces wrong results when retries succeed after later invoices have already been paid.

**Keep the webhook handler thin.** Verify, extract, publish. Move all business logic to event handlers with their own transactions. The webhook endpoint should respond to Tap in milliseconds — not wait for feature assignment to complete.

**Merchant-initiated recurring charges need a token, not a card.** Tap requires you to create a token from the saved card on each recurring charge. You cannot reuse the original token — it is one-time.
