---
title: "Why I Stopped Calling Myself a Web Developer"
description: "Working across frameworks, architectures, and domains didn't just teach me new syntax — it taught me that software engineering is bigger than any single label."
excerpt: "I've worked across Angular, Blazor, React, .NET, multiple architectures, and a dozen domains. Here's what that actually taught me — and why the label was the first thing to go."
date: 2026-01-01T00:00:00+06:00
lastmod: 2026-06-15T00:00:00+06:00
draft: false
images: []
categories: ["Development", "Software Architecture", "Career"]
tags: ["Architecture", "Monolith", "Modular Monolith", "Microservices", "CQRS", "Angular", "Blazor", "Career Development", "Software Engineering"]
contributors: []
pinned: false
homepage: false
---

When someone asks me what I do, I used to say "I'm a web developer." It felt accurate. I built web apps. I wrote APIs. I worked with databases.

But somewhere between my first monolith and my fourth SaaS system, that label stopped feeling right. I wasn't just building web pages anymore. I was making decisions about how systems would grow over five years, how teams would own code without stepping on each other, and why a system that looked fine at 100 users started falling apart at 10,000.

The shift happened gradually — one project at a time, one framework at a time, one architecture at a time. And at some point I stopped thinking of myself as an Angular developer, or a .NET developer, or any kind of framework developer.

I started thinking of myself as a software engineer.

That shift changed everything about how I approach new work.

---

## The Pattern That Appears Everywhere

The first time I built a service in Angular — a class you inject into components to share state and logic — it felt like Angular magic. The decorator, the module registration, the way components asked for it by type.

Then I worked in .NET. Same idea. Different syntax. You register a service, you inject it by interface, your class receives it without knowing where it came from. Dependency injection. Same concept, different keywords.

Then Blazor. Same again. Then React — not built-in the same way, but the pattern still appears: context providers, custom hooks, state lifted into a shared layer.

That moment of recognition — *I've solved this before, just with different syntax* — is what working across frameworks gives you. The problem doesn't change. The framework just gives it a different name and a different ceremony.

Once you see it once, you see it everywhere:

- **Component architecture** — Angular components, Blazor components, React components. Props go in, events come out. Different decorators, same model.
- **Reactive state** — RxJS Observables in Angular, `useState` and `useEffect` in React, Blazor's `StateHasChanged`. Different APIs, same idea: something changed, update the view.
- **Form validation** — Angular's reactive forms, Blazor's `EditForm` with DataAnnotations, React controlled inputs. The pattern is always: bind → validate → surface errors → submit.
- **HTTP and data fetching** — `HttpClient` in .NET and Angular, `fetch` in JavaScript, Next.js `getServerSideProps`. Different layers, same responsibility: call something, handle the response, handle the failure.

When you work in only one framework, these feel like framework features. When you work across several, you realise they are software engineering fundamentals that every framework implements in its own way.

---

## Architecture Travels the Same Way

The same thing happened when I moved through different architectural styles — monolith, modular monolith, CQRS, microservices.

Each one taught me a pattern. And once I had seen each pattern in a real system, I stopped treating them as a hierarchy — as if microservices were the "advanced" level you graduate to and monoliths were the beginner version you leave behind. They are different tools with different tradeoffs, and the skill is knowing which one fits the moment.

Working in a traditional monolith taught me speed — how much you can ship when there are no distributed systems in the way. Working in a modular monolith taught me boundaries — how much cleaner a codebase becomes when modules own their data and communicate through interfaces rather than reaching into each other directly. CQRS taught me that read and write workloads are fundamentally different problems that deserve different solutions. And microservices taught me operational cost — what you take on when you make each service independently deployable.

That progression also corrected something I had assumed early in my career: that architecture determines performance. It doesn't, not directly.

One of the clearest lessons from working across all of these is that fast APIs are almost never the result of the right deployment topology. They are the result of good data access patterns — proper indexing, efficient queries, read-optimized models, caching, and returning only the data that is actually needed. A well-designed monolith, backed by a properly optimized database, can handle significant traffic and deliver millisecond response times. Microservices offer real benefits — independent deployment, independent scaling, team autonomy — but performance is not on that list. You do not need distributed infrastructure to build a fast system. You need discipline in how you access data.

This matters practically for how I advise on architecture decisions. For most MVPs and early-stage products, a monolith or modular monolith is the stronger choice. It enables faster development, simpler deployments, and lower operational complexity — while still supporting future growth if the internal structure is clean. The transition to microservices should be driven by concrete requirements: a module that genuinely needs to scale independently, a team that needs autonomous deployment, a data store that needs to diverge. Not by assumptions about what the system might need someday.

A good technical lead optimizes for what the business needs right now, not what it might need in two years. Starting simple and evolving deliberately is not a compromise — it is the more disciplined approach.

---

## The Contradiction I Should Mention

Here is where I have to be honest, because what I just said could sound like an argument for spreading yourself thin across everything equally. That is not what I am saying.

I worked in TypeScript, JavaScript, PHP, and C#. But I focused on C#. That was my primary language — the one I understood deeply, the one I reached for when I needed to think clearly about a problem.

The other languages were slower. I learned them, used them, got things done in them. But I approached them through the lens of what I already knew from C#. Interfaces, generics, type systems, async patterns — I recognised these in TypeScript because I already understood them in C#. The learning curve was shorter because the concept was already familiar.

So the contradiction resolves like this:

> Versatility does not mean equal depth in everything. It means one strong anchor, and the confidence to transfer what you know.

A developer who has only ever used one framework is not necessarily shallow — they might be deeply skilled. But if they have never had to solve the same problem a different way, they may not know whether their solution is a good solution or just the solution their framework reaches for by default. Working across frameworks forces that question.

The goal is not to be an "Angular developer" or a "C# developer." Those are tools. The goal is to be a software engineer who happens to be most fluent in C# — and who can pick up any framework, recognise the patterns underneath it, and build something well.

---

## What Sticking to One Thing Costs You

I have worked with developers who were highly skilled in one framework and genuinely uncomfortable outside it. Not bad developers — often very good ones. But when the project changed, or the team decided to move in a different direction, the adjustment was harder than it needed to be.

The problem was not that they knew one framework well. The problem was that they had mistaken framework knowledge for engineering knowledge. When the framework changed, they felt like beginners again — because the thing they had mastered was the tool, not the discipline behind it.

Working across Angular, Blazor, Blazor Hybrid, React, Next.js, MAUI, .NET Core, ABP Framework, Laravel, and multiple architectural styles did not make me an expert in all of them. It made me not afraid of any of them. And in practice, that confidence is worth more than deep expertise in a single tool — because tools change, and confidence transfers.

---

## The Real Lesson

If you want to become a more versatile engineer, the answer is not to learn every framework. It is to learn *why* the frameworks you use make the decisions they do — and to ask the same question of every architecture pattern, every performance decision, every tradeoff.

Why does Angular use modules? Why does CQRS separate reads from writes? Why does a monolith outperform a naively designed microservices system? The answers are not arbitrary. They reflect real tradeoffs in real problems that every system eventually has to face.

Master your primary language. Learn it deeply enough that you think in it. Then use that depth as a foundation to recognise the same ideas in new places — new frameworks, new architectures, new domains.

I stopped calling myself a "web developer" because that label implies the work stops at the browser. What I actually do is make decisions about how systems behave under load, how teams collaborate without collisions, and how code written today won't become the bottleneck of tomorrow.

That is software engineering. The framework is just the vocabulary it speaks today.
