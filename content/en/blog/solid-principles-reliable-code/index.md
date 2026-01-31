---
title: "SOLID Principles: The Core of My Most Reliable Code"
description: "Four critical refactoring scenarios from ABP Framework projects, each mapped to a SOLID principle with before-and-after solutions."
excerpt: "Four critical issues—bloated services, parameter monsters, tight coupling, and modification-heavy handlers—refactored using SOLID principles."
date: 2025-07-15T00:00:00+06:00
lastmod: 2025-07-15T00:00:00+06:00
draft: false
images: []
categories: ["Development", "Best Practices", "SOLID"]
tags: ["ABP Framework","SOLID", "Clean Code", "OOP", "Best Practices"]
contributors: ["Your Name"]
pinned: false
homepage: false
---

Have you ever opened a class with 13 injected dependencies, a 444-line method, or a payment API that takes 20 parameters? If so, you've hit the kind of code that SOLID principles are designed to fix.

In this post, I walk through **four critical issues** I've run into on real ABP Framework projects—and how each maps to a SOLID principle and a concrete refactor. You'll see a bloated tenant subscription service, a payment method that became a parameter monster, a modular monolith with inverted dependencies, and an MQTT handler that broke every time we added a topic. Each example shows the problem, the pain it caused, and the refactored design that made the code maintainable again.

## The Single Responsibility Principle: When Your Class Is Doing Too Much

On an ABP Framework project, I encountered an application service that violated SRP in a way that made maintenance costly. Here is the original implementation:

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
 
        return new SubscriptionResult
        {
            Success = true,
            PaymentPlanId = paymentPlan.Id,
            SubscriptionRequestId = subscriptionRequest.Id
        };
    }
}
```

Look at that constructor! That's like 13 different services being injected. It's like trying to build a Swiss Army knife, but instead of being useful, it's just confusing and hard to maintain. 

### Why This is a Problem 🚨

This class is doing everything:
- Managing tenants
- Handling payments
- Processing subscriptions
- Managing features
- Dispatching events
- Calculating costs

> A useful heuristic:
> **If your constructor has more than 5–6 parameters, the class is likely doing too much.**

### The Fix: Breaking It Down ✨

Here's how I refactored it:

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

        // Validate tenant
        var tenant = await tenantRepository.GetAsync(input.TenantId);
   
        // Calculate cost
        var cost = await costCalculationService.CalculateAsync(input.PlanId, input.Options);

        // Create payment plan
        var paymentPlan = await paymentPlanService.CreateAsync(input.TenantId, input.PlanId, cost);

        // Save subscription request
        var subscriptionRequest = new SubscriptionRequest
        {
            TenantId = input.TenantId,
            PlanId = input.PlanId,
            Cost = cost,
            CreatedAt = Clock.Now
        };
        await subscriptionRequestRepository.InsertAsync(subscriptionRequest);

        // (Other responsibilities are handled by their respective services)

        return new SubscriptionResult
        {
            Success = true,
            PaymentPlanId = paymentPlan.Id,
            SubscriptionRequestId = subscriptionRequest.Id
        };
    }
}
```

The refactored class has a clear, single responsibility: **orchestrating tenant subscriptions**. It delegates payment, tenant, and feature logic to focused services such as `IPaymentPlanService`. If payment logic changes, only the payment service is touched. If tenant logic changes, only the tenant service is touched. Each class has **one reason to change**—the essence of the Single Responsibility Principle.

## The Interface Segregation Principle: When Your Method Becomes a Parameter Monster

A common anti-pattern is the overloaded method that handles every use case through a large parameter list. Example:

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

That's over 20 parameters! 😵 Some are for insurance payments, some for vouchers, some for regular payments. Most of the time, you're passing `null` or `false` for things you don't even care about.

### Why This Is Problematic

- **Unnecessary coupling**: A simple cash payment still requires awareness of insurance, vouchers, and invoice parameters.
- **Error-prone**: Parameter order and semantics are easy to get wrong; callers must remember which parameters apply to each scenario.
- **Unreadable**: It is unclear which parameters are required for a given scenario.

This violates the Interface Segregation Principle: clients are forced to depend on an interface that exposes more than they need.

### The Solution: Split the Interface

**Step 1: Create Focused Interfaces**

Replace the overloaded method with smaller, focused interfaces:

```csharp
public interface IPaymentService
{
    Task<Payment> CreateCashAsync(Booking booking, Money amount, DateTimeOffset paidOn);
    Task<Payment> CreateCardAsync(Booking booking, Money amount, DateTimeOffset paidOn, CardInfo card);
    Task<Payment> CreateInsuranceAsync(InsurancePaymentRequest request);
    Task<Payment> CreateVoucherAsync(VoucherPaymentRequest request);
}
```

**Step 2: Use Scenario-Specific Methods**

For a simple cash payment:

```csharp
var payment = await paymentService.CreateCashAsync(booking, amount, paidOn);
```

The caller provides only the data required for the scenario. No null padding, no parameter sprawl.

## The Dependency Inversion Principle: The ABP Modular Monolith Challenge

ABP's modular monolith architecture enforces a clear rule: **Core modules must not reference child modules.** The Core should remain reusable and independent. A common tension: the Core sometimes needs to invoke logic that exists only in a child module.

The solution: invert the dependency through abstraction.

### The Pattern: Interface in Core, Implementation in Child

```csharp
// Defined in Core module
public interface IFeatureXValidator
{
    Task<bool> IsValidAsync(Guid entityId);
}
```

```csharp
// Implemented in child module
public class FeatureXValidator : IFeatureXValidator
{
    public Task<bool> IsValidAsync(Guid entityId)
    {
        // child-specific logic here
    }
}
```

The Core module only depends on the **abstraction** (the interface), not the implementation. The actual implementation is wired up using dependency injection at runtime.

This is textbook **Dependency Inversion Principle**:

> High-level modules (Core) should not depend on low-level modules (children). Both should depend on abstractions.

### Why This Approach Works

- **No circular dependencies** between modules
- **Decoupled and testable**: Core can be tested with a fake implementation
- **Modular**: Feature modules can be replaced or restructured without touching the Core

Defining the interface in the Core and implementing it in child modules enforces clear boundaries while preserving extensibility. The result is a more maintainable and future-proof architecture.

## The Open/Closed Principle: Open for Extension, Closed for Modification

The Open/Closed Principle states that **software should be open for extension but closed for modification**—you add behaviour by adding new code, not by modifying existing code.

On one ABP project, a single class subscribed to MQTT and handled every topic:

```csharp
// Before: One class, four topics, and every new topic meant editing this file again
public class MqttEventHandler
{
    public async Task StartAsync(CancellationToken ct)
    {
        await _mqttClient.SubscribeAsync("swiftaccesshub/events/access", HandleAccessEventAsync);
        await _mqttClient.SubscribeAsync("swiftaccesshub/events/device", HandleDeviceEventAsync);
        await _mqttClient.SubscribeAsync("swiftaccesshub/events/vehicle", HandleVehicleEventAsync);
        await _mqttClient.SubscribeAsync("swiftaccesshub/notification/result", HandleNotificationResultAsync);
        // Tomorrow: another topic? Open this file again, add another method, more ifs...
    }

    private async Task HandleAccessEventAsync(string payload) { /* 200+ lines */ }
    private async Task HandleDeviceEventAsync(string payload) { /* 100+ lines */ }
    private async Task HandleVehicleEventAsync(string payload) { /* 300+ lines */ }
    private async Task HandleNotificationResultAsync(string payload) { /* 80+ lines */ }
}
```

Adding a fifth topic requires opening this class again, adding another subscription and another large method. That is modification, not extension. Each change risks regressions in the other handlers.

### Why This Hurts 🩹

- **Too many reasons to change**: New topic, format change, or business rule—all require edits to the same class.
- **Risk**: Tweaking access events can accidentally break vehicle or notification logic.
- **Testing**: You can't test "just the access handler" without bringing in the whole thing.

### The Fix: One Handler Per Topic

The system was refactored to be **open for extension** (new handler = new class) and **closed for modification** (existing handlers and dispatcher remain unchanged):

```csharp
// 1. One interface: "I handle one topic"
public interface IMqttTopicHandler
{
    string Topic { get; }
    Task HandleAsync(string payload, CancellationToken cancellationToken = default);
}

// 2. Dispatcher stays tiny and never changes when we add topics
public class MqttEventHandler
{
    private readonly IEnumerable<IMqttTopicHandler> _handlers;

    public async Task StartAsync(CancellationToken ct)
    {
        await _mqttClient.ConnectAsync();
        foreach (var handler in _handlers)
        {
            await _mqttClient.SubscribeAsync(handler.Topic, payload => handler.HandleAsync(payload));
        }
    }
}

// 3. New topic? New class. Zero edits to MqttEventHandler or other handlers.
public class AccessEventTopicHandler : IMqttTopicHandler
{
    public string Topic => "swiftaccesshub/events/access";
    public async Task HandleAsync(string payload, CancellationToken ct) { /* only access logic */ }
}

public class VehicleEventTopicHandler : IMqttTopicHandler
{
    public string Topic => "swiftaccesshub/events/vehicle";
    public async Task HandleAsync(string payload, CancellationToken ct) { /* only vehicle logic */ }
}
```

New MQTT topic? **Add a new handler class and register it.** The dispatcher and all existing handlers stay exactly as they are. That's OCP in practice.

### Why This Feels Better ✨

- **Closed for modification**: `MqttEventHandler` and existing handlers don't need to change when we add topics.
- **Open for extension**: New behaviour = new class implementing `IMqttTopicHandler`.
- **Single place to change**: Bug in vehicle handling? You only touch `VehicleEventTopicHandler`.
- **Testable**: Each handler can be unit-tested in isolation with a fake payload and scoped services.

**Open for extension, closed for modification.** Add behaviour by adding code, not by modifying existing code.

## The Liskov Substitution Principle

LSP states that derived classes must be substitutable for their base classes without altering the correctness of the program. Any subtype should honour the contract established by its base type. A dedicated treatment of LSP with real-world examples is planned for a follow-up.

## The Big Picture: Why SOLID Matters

Here's the thing about SOLID principles - they're not just academic concepts. They're practical tools that make your code:

- ✅ **Easier to test** (you can mock smaller, focused dependencies)
- ✅ **Easier to maintain** (changes are isolated to specific areas)
- ✅ **Easier to understand** (each class has a clear purpose)
- ✅ **Easier to extend** (you can add new features without breaking existing code)

## When to Reach for a Design Pattern

Not every project requires the full set of design patterns, and that's perfectly fine. Patterns were not invented before coding; they evolved from experience, to make complex codebases more understandable, maintainable, and predictable across teams. In practice, you should consider applying a pattern when:

- **You identify repeating or boilerplate code** that can be centralized.
- **A strict business requirement demands** that a process is handled consistently and never fails.
- **You want to ensure** that your codebase is easy for other developers to extend and evolve without introducing risk.

## Conclusion: Start Small, Think Big

SOLID can feel overwhelming. A practical approach: **introduce one principle at a time.**

1. **Single Responsibility**—identify classes with too many dependencies
2. **Interface Segregation**—replace overloaded methods with focused interfaces
3. **Dependency Inversion**—introduce abstractions for concrete dependencies
4. **Open/Closed**—design for extension rather than modification
5. **Liskov Substitution**—ensure inheritance hierarchies honour base-type contracts

The goal is not perfection from day one. The goal is code that is easier to understand, test, and maintain. Incremental adoption of these principles will steadily improve the quality and longevity of your codebase. 
