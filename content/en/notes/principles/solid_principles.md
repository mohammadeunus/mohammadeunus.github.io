---
title: "SOLID Principles"
description: "How applying SOLID principles transformed my code quality and reliability, with real-world project examples."
lead: "A practical guide to SOLID principles, with real-world scenarios and code refactoring examples."
date: 2025-07-15T00:00:00+06:00
lastmod: 2025-07-15T00:00:00+06:00
draft: false
images: []
menu:
  notes:
    parent: "principles"
weight: 270
toc: true
---

## Introduction

SOLID principles completely changed how I write code. They aren't just academic concepts—they're practical tools that make your code more maintainable, testable, and reliable. Here you'll find real-world scenarios and refactoring examples that show how SOLID can transform your codebase.

---

## Single Responsibility Principle (SRP)

**Definition:** A class should have only one reason to change.

### Real-World Example: The Overloaded Service

**Before (Doing Too Much):**
```csharp
public class TenantSubscriptionAppService(
    EditionManager editionManager,
    IOptions<AbpDbConnectionOptions> dbConnectionOptions,
    IFeatureManager featureManager,
    IDistributedEventBus DistributedEventBus,
    ITenantManager tenantManager,
    ITenantRepository TenantRepository,
    ISettingManager settingManager,
    IEditionRepository EditionRepository,
    ISubscriptionManager subscriptionManager,
    IPlanRepository PlanRepository,
    IStripePaymentService stripePaymentService,
    ICostCalculationService costCalculationService,
    IRepository<Subscription, Guid> Repository)
    : ApplicationService, ITenantSubscriptionAppService
{
    public async Task<SubscriptionResult> CreateTenantSubscriptionAsync(CreateTenantSubscriptionInput input)
    {
        // Before refactoring, this method was 444 lines long, handling everything from validation,
        // payment processing, cost calculation, to event dispatching. It was hard to read and maintain.
        // ...
    }
}
```

**After (Single Responsibility):**
```csharp
public class TenantSubscriptionAppService(
    ITenantRepository tenantRepository,
    ISettingManager settingManager,
    IPaymentPlanService paymentPlanService,
    ICostCalculationService costCalculationService,
    IRepository<SubscriptionRequest, Guid> subscriptionRequestRepository)
    : ApplicationService, ITenantSubscriptionAppService
{
    public async Task<SubscriptionResult> CreateTenantSubscriptionAsync(CreateTenantSubscriptionInput input)
    {
        // After refactoring, each responsibility is delegated to focused services, making the code clean and readable.
        var tenant = await tenantRepository.GetAsync(input.TenantId);
        var cost = await costCalculationService.CalculateAsync(input.PlanId, input.Options);
        var paymentPlan = await paymentPlanService.CreateAsync(input.TenantId, input.PlanId, cost);
        var subscriptionRequest = new SubscriptionRequest
        {
            TenantId = input.TenantId,
            PlanId = input.PlanId,
            Cost = cost,
            CreatedAt = Clock.Now
        };
        await subscriptionRequestRepository.InsertAsync(subscriptionRequest);
        return new SubscriptionResult
        {
            Success = true,
            PaymentPlanId = paymentPlan.Id,
            SubscriptionRequestId = subscriptionRequest.Id
        };
    }
}
```

---

## Interface Segregation Principle (ISP)

**Definition:** No client should be forced to depend on methods it does not use.

### Real-World Example: The Parameter Monster

**Before (One Monster Method):**
```csharp
// Use case 1: Simple contract payment
var payment = await paymentManger.CreateAsync(
    bookingContract,
    bookingContract.Id,
    guest.Id,
    null,
    Clock.Now,
    roomBooking.PaidAmount,
    PaymentMethod.Cash,
    CardType.Visa,
    string.Empty,
    string.Empty,
    false,
    null,
    null,
    null,
    null,
    null,
    null);

// Use case 2: Insurance, voucher, and invoice payment
var payment = await paymentManger.CreateAsync(
    input.ContractId.HasValue ? contract : null,
    input.ContractId,
    input.ReceivedFromId,
    input.ItemId,
    Clock.Now,
    paymentAmount,
    paymentMethod,
    input.CardType,
    referenceNumber,
    note,
    isInsurancePayment,
    paymentAccountId,
    input.InsuranceAmount,
    input.InsurancePaymentMethod,
    input.InsuranceReferenceNumber,
    input.InsurancePaymentAccountId,
    input.InsuranceNote,
    input.ItemTypeName,
    input.VoucherType,
    input.VoucherId,
    input.InvoiceId
);
```

**After (Focused Interfaces):**
```csharp
public interface IPaymentService
{
    Task<Payment> CreateCashAsync(Booking booking, Money amount, DateTimeOffset paidOn);
    Task<Payment> CreateCardAsync(Booking booking, Money amount, DateTimeOffset paidOn, CardInfo card);
    Task<Payment> CreateInsuranceAsync(InsurancePaymentRequest request);
    Task<Payment> CreateVoucherAsync(VoucherPaymentRequest request);
}

// Usage:
var payment = await paymentService.CreateCashAsync(booking, amount, paidOn);
```

---

## Dependency Inversion Principle (DIP)

**Definition:** High-level modules should not depend on low-level modules. Both should depend on abstractions.

### Real-World Example: Modular Monoliths

**Pattern:**
```csharp
// Defined in Core module
public interface IFeatureXValidator
{
    Task<bool> IsValidAsync(Guid entityId);
}

// Implemented in child module
public class FeatureXValidator : IFeatureXValidator
{
    public Task<bool> IsValidAsync(Guid entityId)
    {
        // child-specific logic here
    }
}
```

---

## Open/Closed Principle (OCP)

**Definition:** Software entities should be open for extension, but closed for modification.

**Example:**
Design your system so you can add new features (like plugins) without changing existing code. (See blog for future code example.)

---

## Liskov Substitution Principle (LSP)

**Definition:** Subtypes must be substitutable for their base types.

**Example:**
Ensure that any derived class can replace its base class without breaking the system. (See blog for future code example.)

---

## Why SOLID Matters

Applying SOLID principles leads to code that is:
- Easier to test (smaller, focused dependencies)
- Easier to maintain (isolated changes)
- Easier to understand (clear class purposes)
- Easier to extend (add features without breaking code)

**Start small:** Refactor one class at a time. Over time, your codebase will become more robust, flexible, and enjoyable to work with. 