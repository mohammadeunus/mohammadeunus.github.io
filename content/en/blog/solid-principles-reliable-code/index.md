---
title: "SOLID Principles: The Core of My Most Reliable Code"
description: "How applying SOLID principles transformed my code quality and reliability, with real-world project examples."
excerpt: "Discover how SOLID principles became the foundation of my most reliable software, with practical examples from real projects."
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

Alright, let's talk about something that completely changed how I write code - SOLID principles! 🎯

You know what's funny? I used to think these were just some fancy programming concepts that senior developers talked about to sound smart. But then I actually started applying them in my real projects, and oh boy, did my code quality skyrocket! 📈

Today, I'm going to show you how SOLID principles became the backbone of my most reliable code. We're talking real-world scenarios here - no theoretical mumbo jumbo. Just straight-up, "I've been there, done that" examples that will make your code actually maintainable. 💪

## The Single Responsibility Principle: When Your Class is Doing Too Much 😅

Let me start with a story. I was working on this ABP Framework project, and I came across this application service that made me go "What in the world is happening here?" 🤔

Here's what I found:

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

Look at that constructor! That's like 13 different services being injected. It's like trying to build a Swiss Army knife, but instead of being useful, it's just confusing and hard to maintain. 😵‍💫

### Why This is a Problem 🚨

This class is doing everything:
- Managing tenants
- Handling payments
- Processing subscriptions
- Managing features
- Dispatching events
- Calculating costs

It's like having one person trying to be a chef, waiter, cashier, and dishwasher all at the same time. Sure, it might work, but it's going to be a mess! 

The rule of thumb I follow: **If your constructor has more than 5-6 parameters, your class is probably doing too much.**

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

Now we're talking! 🎉 This class has a clear, single responsibility: **orchestrating tenant subscriptions**. It delegates the complex stuff to focused services like `IPaymentPlanService`.

The beauty of this approach? If I need to change how payments work, I only touch the payment service. If I need to change tenant logic, I only touch the tenant service. Each class has **one reason to change**. That's the Single Responsibility Principle in action! 💯

## The Interface Segregation Principle: When Your Method is a Parameter Monster 😱

Okay, this next one is a classic. I've seen this pattern so many times, even from senior developers. It's the "do-everything" method with a gazillion parameters. Let me show you what I mean:

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

### Why This is Terrible 🤦‍♂️

- **You're forced to know about everything**: Want to make a simple payment? Too bad, you still need to know about insurance, vouchers, and who knows what else.
- **It's error-prone**: You might pass the wrong value or forget which parameters matter for your use case.
- **It's unreadable**: Future developers (including future you!) will have no idea what's required for each scenario.

This is a classic violation of the Interface Segregation Principle. You're being forced to depend on interfaces you don't use!

### The Solution: Split It Up! 🎯

**Step 1: Create Focused Interfaces**

Instead of one monster method, create smaller, focused interfaces:

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

Now, when you want to make a simple cash payment:

```csharp
var payment = await paymentService.CreateCashAsync(booking, amount, paidOn);
```

Clean, simple, and you only provide what you actually need! No more passing 20 parameters when you only need 3. 🎉

## The Dependency Inversion Principle: The ABP Modular Monolith Challenge 🏗️

Here's a scenario I faced in ABP Framework that perfectly demonstrates the Dependency Inversion Principle.

In ABP modular monolith architecture, there's this golden rule: **Core modules must never reference their child modules.** The Core should be reusable and independent.

But here's the problem: What if the Core needs to trigger some logic that only exists in a child module? 🤔

I faced this exact situation. My solution was simple and elegant:

### The Pattern: Interface in Core, Implementation in Child 🔄

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

### Why This Approach is Genius 🧠

- 🔄 **No circular dependencies** between modules
- 🧩 **Decoupled and testable**: Core can be tested with a fake implementation
- 📦 **Modular**: Feature modules can be replaced or restructured without touching the Core

By introducing the interface in the Core and having child modules implement them, you enforce clean boundaries while still allowing extensibility. This makes your application architecture far more **maintainable** and **future-proof**.

## The Open/Closed Principle: Stop Cracking Open the Same Egg 🥚

Ever had that moment where you add one new feature and suddenly you're editing the same giant class again? I've been there. The Open/Closed Principle says: **software should be open for extension, but closed for modification.** In plain English: add new behaviour by adding new code, not by rewriting the old code.

Here's a pattern I ran into on an ABP project. We had one class that subscribed to MQTT and handled every topic in the world:

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

Want to add a fifth topic? You're back inside this monster, adding another subscription and another huge method. That's not extension—that's **modification**. And every change risks breaking the other four handlers.

### Why This Hurts 🩹

- **One file has too many reasons to change**: New topic, new format for a topic, new business rule—all in the same class.
- **Risk**: Tweaking access events can accidentally break vehicle or notification logic.
- **Testing**: You can't test "just the access handler" without bringing in the whole thing.

So the class is "open" in the worst way: we keep **opening** it to change it.

### The Fix: One Handler Per Topic 🎯

We made the system **open for extension** (new handler = new class) and **closed for modification** (existing handlers and the dispatcher stay untouched):

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
- **Testable**: Each handler can be unit-tested with a fake payload and scoped services.

So: **open for extension, closed for modification.** Add features by adding code, not by cracking open the same egg over and over. 🥚➡️🐣

## The Liskov Substitution Principle: Also Coming Soon! 🚧

This one is about making sure that if you have a base class, any derived class should be able to replace it without breaking the system. It's like the "contract" between parent and child classes.

## The Big Picture: Why SOLID Matters 🌟

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

## Conclusion: Start Small, Think Big 🎯

SOLID principles might seem overwhelming at first, but here's my advice: **Start with one principle at a time.**

1. **Start with Single Responsibility**: Look for classes with too many dependencies
2. **Then try Interface Segregation**: Break down those monster methods
3. **Add Dependency Inversion**: Create abstractions for your dependencies
4. **Master Open/Closed**: Design for extension, not modification
5. **Perfect Liskov Substitution**: Ensure your inheritance hierarchies work correctly

---

Remember, the goal isn't to follow these principles perfectly from day one. The goal is to write code that's easier to understand, test, and maintain. And trust me, once you start seeing the benefits, you'll never want to go back to the old way! 😊 
