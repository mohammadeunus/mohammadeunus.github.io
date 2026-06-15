---
title: "What Working With a Greek Engineer Taught Me"
description: "From months of real technical disagreements on a production ABP system — the things that genuinely changed how I write code, and one I still disagree with."
excerpt: "Multiple rounds of code review, days-long debates, real disagreements — and the things that actually stuck after the project ended."
date: 2026-06-15T00:00:00+06:00
lastmod: 2026-06-15T00:00:00+06:00
draft: false
images: []
categories: ["Software Architecture", "Development", "ABP Framework", "Career"]
tags: ["Architecture", "Design Patterns", "CQRS", "DDD", "Repository Pattern", "Software Engineering", ".NET", "ABP Framework", "Blazor", "Code Review", "Clean Code"]
contributors: []
pinned: false
homepage: false
---

Some lessons arrive through documentation. Others arrive through a disagreement on a real system, under real pressure — and you don't fully understand what you learned until months later.

I spent several months working on a Hospital Management System built on ABP Framework with Blazor. The lead engineer on the client side reviewed everything, had strong opinions about most of it, and was not the kind of person who accepted "it works" as a sufficient answer. We disagreed on a few things. Some discussions went on for days. On some issues I pushed back, we reasoned through it, and I came away thinking the other position was right. On others I still disagree. He is one of the best engineers I have worked with in my career — and the disagreements were part of why.

What I want to write down are the things that genuinely changed how I think — the ones that stuck after the project ended and the debates cooled.

---

## Exceptions Are a Tracing Tool, Not Just an Error Mechanism

This was the one that took the most time to land.

The mindset shift he pushed me toward was this: fix errors before the client reports them. Not by writing perfect code — that is not realistic — but by writing code that tells you where something went wrong before anyone else notices it did. The goal is to be the first person who knows.

To do that, you have to think ahead. When you write a piece of logic, you already have a rough sense of where it might break — which inputs could be wrong, which states should not be possible, which business rules could be violated. Most developers acknowledge those risks and move on. The better habit is to act on them: put a named, specific exception at every one of those points. `InvalidOperationException` when the system reaches a state that should not be reachable. A domain exception with a clear code when a business rule is violated. Not because the exception prevents the failure — the assumption was already there — but because when the failure happens, you want one glance at the logs to tell you exactly where and why.

Code that swallows errors, returns silent defaults, or fails without signaling gives you the worst of both outcomes: the bug still exists, and now it is invisible. You hear about it from the client. You open the logs and find nothing useful. You start guessing.

Code with well-placed exceptions gives you confidence in the opposite direction. You know that if something goes wrong in the areas you care about, the logs will surface it clearly — specific, named, traceable. You are not waiting to be surprised. You built the early warning system yourself.

That is the real shift: from reactive debugging to proactive instrumentation. You are not just handling errors — you are anticipating where they might occur and making sure you will see them first.

---

## Persistence in the Domain Layer or Application Layer?

I originally treated persistence as an application-layer concern and viewed any write operation inside domain managers as a design smell. Querying from the domain layer is fine — but committing state, that belongs to the application layer. Domain managers handle business logic. Application services coordinate and save. Clean separation.

ABP's own documentation reflects this default — let the unit of work handle commits, not the domain layer. But the docs also acknowledge it is not wrong when the situation warrants it. That nuance is easy to skip over, and I was skipping it.

Working through real-world cases with him changed my perspective.

The more important question, as I came to understand it, is not *which layer makes the database call* — it is *which layer owns the business operation*. Any write operation from the domain layer — `UpdateAsync`, `InsertAsync`, `DeleteAsync` — can feel like a design smell when you have internalized the rule that committing state belongs to the application layer. But that rule exists to protect business logic from being tangled with persistence concerns, not to prohibit the domain from controlling when a commit happens. When persistence is inseparable from enforcing a business rule or maintaining a domain invariant, letting the domain manager control it can actually make the model clearer rather than less pure.

The practical consequence of not doing this: in ABP, `autoSave: true` is an option you pass to repository write calls to flush within the current unit of work rather than waiting for it to complete. Without it, the entity is not committed until the unit of work ends. If a second operation in the same request touches that entity before the transaction closes, it reads stale state. Errors surface at the end of the transaction rather than at the point of the operation that caused them — harder to trace, harder to catch as specific domain errors, harder to handle cleanly. With `autoSave: true`, the state is committed immediately. What follows reads current data. Errors surface where they originate.

I still treat the unit of work as the default. But I no longer treat `autoSave` in the domain layer as automatically wrong. The question now is whether the business operation actually requires immediate persistence to remain correct — and the answer is yes more often than I once assumed.

---

## Smaller Things That Stuck

Not everything was a days-long debate. Some things were a comment in a review, a preference stated once, a habit I picked up without realizing until later.

**Use `ConcurrencyStamp` on critical features that operate on live data.** In ABP, any entity that implements `IHasConcurrencyStamp` (or inherits from `AggregateRoot`, which includes it) gets this automatically. It is ABP's built-in optimistic concurrency mechanism — when a user loads a record, the current stamp comes with it. When they save, the stamp is sent back. If it no longer matches what is in the database — because someone else saved in between — ABP throws a concurrency exception before the write goes through.

Without it, the last save wins silently. Consider a hospital scheduling system: a doctor opens a patient's appointment record to reschedule, and a nurse opens the same record at the same moment. Without concurrency protection, whichever save arrives last overwrites the other — no warning, no conflict, no trace. With `ConcurrencyStamp`, the second save fails with a clear exception: *"This record was modified since you loaded it. Please refresh and try again."* The user sees the conflict. No data is silently lost.

Use it anywhere two users could reasonably edit the same record at the same time — appointments, inventory allocations, financial entries, patient records. It costs almost nothing to add and prevents a category of bug that is genuinely hard to detect after the fact.

**Leave no nullable warnings in the codebase.** A nullable warning is the compiler telling you there is an unhandled assumption somewhere in the code. Ignoring it is a choice to not know. It costs almost nothing to fix in the moment and can cost a lot to trace in production. Treat the compiler as a collaborator, not background noise.

**Test cases are a bigger saver than most developers admit — and even more so now.** With AI-assisted development, code gets written faster than it gets understood. AI-generated code can look correct and be subtly wrong in ways that only a test will catch. Tests are not just for catching regressions. They are for catching confidence that isn't earned yet.

**Read the ABP documentation.** It is beautifully written — not just as reference material, but as a guide to good practices. The ABP team has thought carefully about why things are structured the way they are, and that thinking is in the docs. I have used them more than once to anchor an architectural argument with a colleague. It works better than you'd expect. 😄

---

## The One I Still Disagree With

Not every debate ended with me changing my mind. This one didn't.

We disagreed about where data projection should happen. My instinct was to project as close to the query as possible — if a screen needed five fields, the database should return five fields. Lean on `.Select()` in the query layer, return a flat DTO optimized for the caller, skip loading anything that won't be used.

His position was that repositories should own data access concerns entirely. Letting projections reach into the query layer allows query logic to bleed into the application layer over time — harder to maintain consistent patterns, harder to test, harder to reason about where data shaping is happening. Keep the boundary clean.

I went with his approach on that system. He had more experience on the codebase, and consistency across a team matters even when you disagree with the direction. But I have not changed my view.

Query-layer projection is not sloppy. It is a deliberate tradeoff — you accept some spread in exchange for efficiency and directness. The boundary-first approach is also a deliberate tradeoff — you accept some overhead in exchange for consistency. Neither is wrong. What matters is knowing which cost you are paying and why.

What I took from the disagreement was not the pattern — it was that framing. Most architectural debates are not right versus wrong. They are tradeoff versus tradeoff. The moment you can name what each side is actually optimizing for, the argument stops being about who is correct and starts being about what the specific system needs right now.

I still project at the query layer when I own the decision. But I understand the other side clearly enough to argue it — and that is more useful than just winning.

---

## The Actual Lesson

Two debates where I changed my mind. A handful of smaller things that quietly shifted how I work. One disagreement I held my ground on. That is probably the most honest summary of those months.

What changed in the cases where I came around was the same thing each time: I stopped arguing about the pattern and started asking what it was actually optimizing for. Once I could name that clearly, the right call for the specific system became obvious — even when it wasn't the call I would have made on instinct.

The disagreement I held my ground on taught me something different: that deferring to experience is sometimes right, and disagreeing with experience is sometimes also right. The question is whether you have done the work to know which situation you are in. Seniority is not an argument. But neither is instinct.

A good technical debate is not useful because one side wins. It is useful because it forces both sides to name what they are optimizing for. That habit — asking the harder question before you ship — is what I took from those months more than any specific pattern or decision.

---

*Thank you, Filimon Konstantinidis — if you are reading this.*
