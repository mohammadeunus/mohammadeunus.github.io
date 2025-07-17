---
title: "Custom SaaS Subscription System: ABP Framework"
description: "A deep dive into building a flexible, dynamic subscription system using ABP Framework, including architecture, code, and lessons learned."
excerpt: "How I built a custom, dynamic SaaS subscription system with ABP Framework."
date: 2025-07-14T00:00:00+06:00
lastmod: 2025-07-14T00:00:00+06:00
draft: false
weight: 50
images: []
categories: ["Development", "SaaS", "ABP Framework"]
tags: ["ABP Framework", "Custom Plans", "SaaS", "Payments"]
contributors: ["Henk Verlinde"]
pinned: false
homepage: false
---

Finally got a chance to build a custom subscription system! I have been longing to fill up this empty section of my knowledge for a long time. When my client approached me with a unique requirement - they wanted to offer custom subscription plans instead of the standard "one-size-fits-all" packages - I knew this was the perfect opportunity to dive deep into ABP Framework's payment system and create something truly flexible.

## How ABP Payment Works ✅

In ABP’s SaaS edition, when a customer subscribes to a 1-year plan, their tenant account is activated with the selected edition and features for exactly 12 months. If the subscription is not renewed, it is marked as expired. After a configurable grace period, access is automatically restricted or disabled. This ensures that only customers with active subscriptions can continue using the system.

## How Our Goal Differs 🔄

ABP provides a plan-based subscription model where predefined plans are created by the platform owner (e.g., Super Admin), and customers subscribe to one of those plans.

In contrast, our goal is to let customers create their own plans based on their specific needs—customizing features, modules, or usage limits before subscribing.

## How We’ll Achieve This 🛠

ABP already provides essential features that align with our needs:

- Automatic access restriction if a customer fails to renew.
- Built-in subscription management and payment gateway integration via the admin panel.

However, to meet our goal, we will:

- Modify parts of the existing subscription workflow.
- Allow plan creation dynamically when a customer configures their subscription from the public website.
- Automatically generate a corresponding payment request and link it to the custom plan.

## The Challenge: Custom Subscription Plans 🎯

Traditional SaaS platforms offer predefined packages like "Standard," "Professional," and "Enterprise." But my client wanted something different - a system where customers could pick and choose exactly what they needed. Think of it like building your own pizza - you get to choose every single topping, and you only pay for what you want.

Now, here's where things get interesting. ABP Framework already has this amazing payment system built-in, but it's designed for those traditional fixed packages. My client's requirement? They wanted to create plans on-the-fly based on customer selections. That's like trying to fit a square peg in a round hole, but hey, that's what makes programming fun, right? 😄

## The Architecture: How We Made It Work 🏗️

Let me break down what we built here, because this is where the magic happens:

### 1. The Custom Plan Builder UI ✨
First, we created this beautiful interface where users can:
- Select the number of rooms and hotels they need
- Pick specific features they want (like integrations, add-ons, etc.)
- See real-time pricing updates
- Choose between monthly and annual billing

It's like a shopping cart, but for software features. Pretty cool, right?

### 2. The Dynamic Plan Creation Process 🔄
Here's the genius part - instead of having predefined plans, we create them dynamically:

Instead of showing code, here's how it works:
- When a user submits their custom plan, we collect their selections (features, rooms, hotels, etc.) and tenant details.
- The system creates a new plan in the backend based on these selections.
- After the plan is created, a subscription and payment session are generated and linked to the new plan.

### 3. The Payment Flow Magic 💫
This is where it gets really interesting. We're essentially doing this:

1. **User customizes their plan** → We calculate the price
2. **Create a plan in our system** → ABP plan management
3. **Create a subscription request** → Track the payment
4. **Create a tenant with a "blank" edition** → No features yet
5. **Process payment** → User pays
6. **Activate features** → We activate the features

It's like a three-step dance: Plan → Pay → Activate. 💃

## The Technical Deep Dive 🔧

### Payment Processing: Setting Up the Dance
Instead of code, here's the process:
- When a user is ready to pay, the backend starts a payment session with the selected gateway.
- The system sets up return and cancel URLs for the payment process.
- A payment request is created and tracked for the session.

### Payment Completion: Where the Magic Happens ✨
Process overview:
- After payment, the system verifies the payment status with the gateway.
- If payment is successful, the system creates the actual edition with the features the user paid for and activates the subscription.
- If payment fails, the process is halted and the tenant is not activated.

## The Security Considerations 🔒

Now, let me address something important - security. When I first started this project, I was like "Oh, this is going to be a security nightmare." But here's what we did right:

1. **Server-side plan creation** - No sensitive data exposed to client
2. **Payment verification** - We verify all payment data
3. **Tenant isolation** - Each tenant gets their own isolated environment
4. **Payment verification** - We double-check the payment status before activating features

## The Edge Cases We Handled 🎯

You know what's the most challenging part? Edge cases. Here are some we had to think about:

- **What if payment fails?** → We clean up the created tenant
- **What if payment processing fails?** → We have retry mechanisms
- **What if user cancels?** → We handle the cancellation gracefully
- **What if payment gateway is down?** → We have fallback mechanisms

## The Performance Optimizations ⚡

Creating plans dynamically sounds expensive, right? Well, we optimized it:

1. **Caching** - We cache frequently requested plan combinations
2. **Async processing** - Payment processing is completely async
3. **Database optimization** - We use efficient queries for plan creation
4. **Session management** - We handle session expiration properly

## The Result: A Flexible, Scalable System 🎉

What we ended up with is a system that:
- ✅ Creates custom plans on-demand
- ✅ Handles payments securely
- ✅ Scales with your business
- ✅ Provides real-time pricing
- ✅ Integrates seamlessly with ABP Framework

## Lessons Learned 📚

1. **ABP Framework is powerful** - But you need to understand its conventions
2. **Payment processing is reliable** - But always verify payments
3. **Dynamic plan creation is complex** - But totally worth it
4. **Security should be built-in** - Not added later

## The Code That Makes It All Work 💻

Instead of sharing code, here's the high-level flow:
- Show a loading screen while processing.
- Step 1: Create the plan based on user input.
- Step 2: Create the subscription and initiate the payment session.
- Step 3: Redirect the user to the payment gateway for checkout.
- If payment fails, show an error message. If successful, activate the subscription and features.
- Hide the loading screen when done.

## Conclusion: Why This Matters 🌟

This isn't just about building a payment system. It's about creating flexibility for your customers. In today's competitive SaaS market, the ability to offer truly custom plans can be a game-changer.

The beauty of this approach is that it leverages ABP Framework's existing infrastructure while adding the flexibility your business needs. You get the best of both worlds - enterprise-grade architecture with startup-level flexibility.

## Need Help Implementing This? 👨‍💻

If you're reading this and thinking "This is exactly what I need, but I don't have the time or expertise to implement it," well, you're in luck! I specialize in ABP Framework integrations and custom payment systems. Whether you need a similar custom subscription system or want to integrate any payment gateway with ABP Framework, I can help you build it right.

The key is understanding both the technical requirements and the business logic. It's not just about writing code - it's about creating a system that grows with your business.

So there you have it - a complete custom subscription system built on ABP Framework. From dynamic plan creation to secure payment processing, this system handles it all while maintaining the flexibility your customers demand.

Remember, in the world of SaaS, flexibility is king. And with this system, you're not just selling software - you're selling solutions that fit perfectly into your customers' workflows. 👑

---

*P.S. If you found this helpful and want to implement something similar, feel free to reach out! I love helping fellow developers build amazing systems.* 😊
