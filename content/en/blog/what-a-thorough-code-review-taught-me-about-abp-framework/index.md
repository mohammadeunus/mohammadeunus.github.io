---
title: "What Working With a Greek Engineer Taught Me"
description: "Multiple rounds of code review, days-long debates, real disagreements — and a few things that genuinely changed how I write code."
excerpt: "I didn't agree with everything. Some discussions took days. But working through real technical disagreements with a senior engineer left me with a few things that actually changed how I code — and those are worth writing down."
date: 2026-02-04T00:00:00+06:00
lastmod: 2026-02-04T00:00:00+06:00
draft: true
images: []
categories: ["Development", "ABP Framework", "Code Quality"]
tags: ["ABP Framework", "Blazor", "Code Review", ".NET", "DDD", "Exceptions", "Debugging", "Clean Code", "Architecture"]
contributors: []
pinned: false
homepage: false
---

I spent several months working on a scheduling module for a Greek client — a complex enterprise system built on ABP Framework with Blazor. The client was a senior engineer. He reviewed everything, had strong opinions about most of it, and was not the kind of person who accepts "it works" as a sufficient answer.

We had a lot of discussions. Some of them went on for days. On certain issues I pushed back, we reasoned through it together, and I came away thinking he was right. On others I still disagree. That is how it should work — two engineers with different experience trying to figure out what correct actually means for a specific system.

What I want to write down are the things that genuinely changed how I think. The ones that stuck after the project ended and the debates cooled.

There are three.

---

## Exceptions Are a Tracing Tool, Not Just an Error Mechanism

This was the one that took the most time to land.

My instinct, and I think it is a common one, is to be conservative with exceptions. Throw when something is truly broken. Handle errors gracefully. Do not crash the system over something minor. That instinct is not wrong, but it is incomplete — and the conversation with him clarified why.

In production, you do not have a debugger. You have logs. If something goes wrong, the only way to understand what happened is to look at what was recorded. Code that swallows an error, returns a default, or fails silently gives you nothing. You see the symptom — a wrong value, a missing record, unexpected behavior — but the cause is invisible.

His approach was to use exceptions liberally as a deliberate tracing strategy. Not throwing everywhere randomly, but ensuring that every place where an assumption about the system could be wrong had a named, specific exception attached to it. `InvalidOperationException` when the system reaches a state that should not be possible. Domain exceptions with codes that identify the exact business rule that was violated. Not because the exceptions make the code more correct — the assumption was already there, already being made — but because when the assumption turns out to be wrong in production, you know immediately where and why.

The mental shift was thinking of exceptions less as crash-prevention and more as *instrumentation*. You are tagging the places in your code where the logic depends on something being true. When it is not true, you want a signal, not silence. Logs built from exceptions that say exactly what was expected and what was found are infinitely more useful than logs that say "something went wrong in the scheduler module."

We went back and forth on where the line was. I still think there are cases where returning null or a result type is cleaner than throwing. But the core principle — write code so that when it fails, the logs tell you exactly where and why — is now something I think about actively when I write code. It changed what questions I ask: not just "does this work?" but "if this breaks at 2am, will I know where to look?"

---

## DDD Does Not Lock Persistence to the Application Layer

This one came out of a specific debate about `autoSave: true` in domain managers, and it opened into a longer discussion about where persistence responsibility actually lives in domain-driven design.

The conventional reading — at least the one I had internalized — is that persistence is an application-layer concern. Domain managers handle business logic and modify entities. Application services coordinate the operation and call the repository to save. Clean separation. Each layer does its job.

His position was more nuanced: that is the *default* pattern, but it is not a rule that DDD imposes. DDD cares about where *business logic* lives, not about where the save call happens. If a business operation is meaningless without immediate persistence — if the operation and its commit are inseparable from the domain's perspective — then there is nothing architecturally wrong with the domain layer owning that persistence step.

The concrete case was `autoSave: true` in manager methods. Without it, the ConcurrencyStamp is not committed until the unit of work ends. Anything that reads the entity before that gets a stale stamp. Persistence errors surface at the end of a transaction rather than at the point of the operation that caused them, making them harder to trace and harder to handle as specific domain errors. With `autoSave: true`, the save happens immediately. The stamp is correct. Errors surface where they originate.

I reasoned against this for a while. It felt like blurring the layer boundary. What convinced me was separating the principle from the implementation: the application layer is still coordinating the operation. The manager is still responsible for the business logic. The question of when a database write happens is a technical decision about correctness and error handling, not a violation of the domain model's integrity.

Not every case warrants this. But it changed how I evaluate the pattern when I see it — I stopped treating "persistence in the domain layer" as automatically wrong and started asking whether it is justified by what the business operation actually requires.

---

## Write Code So You Can Always Trace What Happened

These two lessons — exceptions as instrumentation, and understanding where persistence belongs — are really both expressions of the same thing he cared about consistently: **you should always be able to reconstruct what happened from the outside**.

A well-designed system is not just one that behaves correctly under normal conditions. It is one that, when something goes wrong, tells you what went wrong, where, and why — through logs, through exceptions, through the shape of the data. Code that hides its failures makes bugs expensive. Code that exposes them clearly makes debugging fast.

We disagreed about a lot of things — naming conventions, how much abstraction was appropriate at specific boundaries, whether certain patterns from the other modules in the codebase should be followed strictly or adapted to the context. Those disagreements were real and some of them are unresolved.

But on this — the idea that a developer's job includes writing code that is traceable, not just code that runs — I came away thinking he was right. It is easy to focus on correctness in the happy path. It is harder, and more important, to write code that is honest about its failure modes.

---

Some of the code review feedback was about patterns I do not fully agree with. Some of the discussions I would have landed differently given a second chance. But the things that stuck are the ones that apply beyond ABP, beyond Blazor, beyond any specific framework or project.

Write code that tells you when it breaks, and tells you clearly. Know why your layers are structured the way they are, not just that they are. And if you are going to have a days-long technical debate with a senior engineer — do not concede the point until you actually understand why they are making it.

That last one might be the most useful thing I took from the whole experience.
