---
title: "Why I Stopped Calling Myself a Web Developer"
description: "Working across frameworks, domains, and clients didn't just teach me new syntax — it taught me that software engineering is bigger than any label."
excerpt: "I've worked across Angular, Blazor, React, .NET, healthcare, ERP, hospitality, and more. Here's what that actually taught me — and why the label was the first thing to go."
date: 2026-01-01T00:00:00+06:00
lastmod: 2026-01-01T00:00:00+06:00
draft: false
images: []
categories: ["Development", "Career", "Personal Growth"]
tags: ["UI Frameworks", "Blazor", "Angular", "React", "Frontend Development", "Career Development", "Software Architecture", "Full Stack", "Web Development"]
contributors: []
pinned: false
homepage: false
---

Early in my career, I would have described myself as a .NET developer. Then a project came along that needed Blazor. Then another needed React. Then Next.js, then MAUI, then Angular, then ABP Framework.

I didn't plan to work across all of them. It just happened — one project at a time. And somewhere along the way I stopped thinking of myself as an Angular developer, or a Blazor developer, or any kind of framework developer.

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
- **Form validation** — Angular's reactive forms, Blazor's `EditForm` with `DataAnnotations`, React controlled inputs. The pattern is always: bind → validate → surface errors → submit.
- **HTTP and data fetching** — `HttpClient` in .NET, Angular's `HttpClient`, `fetch` in JavaScript, Next.js `getServerSideProps`. Different layers, same responsibility: call something, handle the response, handle the failure.

When you work in only one framework, these feel like framework features. When you work across several, you realise they are software engineering fundamentals that every framework implements in its own way.

---

## Architecture Travels Better Than Syntax

The deeper lesson wasn't about patterns — it was about architecture.

A well-structured Angular application and a well-structured Blazor application look similar at the conceptual level. Separation of concerns. Clear boundaries between UI and business logic. Services that do one thing. Components that know only what they need to know.

When I moved from Angular to Blazor on a new project, the syntax was unfamiliar. But the questions I asked were the same: *Where does this logic live? Who owns this state? How does this component communicate with that one?*

Those questions don't belong to any framework. They belong to software engineering. And once you've answered them well in one place, answering them in another becomes faster — not because the framework is similar, but because the discipline is the same.

This is what I mean when I say working across frameworks made me architecturally sound. Not that I memorised more APIs. That I stopped asking "how do I do this in Angular?" and started asking "what is the right way to do this?" — and then finding the answer in whatever framework I was working in.

That shift also changed how I evaluate tools. A developer who only knows one framework tends to reach for it regardless of fit. When you have worked across several, you stop defaulting and start comparing. A public-facing site with SEO requirements points toward Next.js. An enterprise dashboard with complex role-based UI points toward Angular. A cross-platform desktop and mobile app points toward MAUI. A rapid internal tool points toward Blazor. The frameworks did not change — but your ability to match the right one to the problem did.

The same thing happened across domains. I worked across hotel management, healthcare, ERP, field services, education, and more. Each domain had its own language, its own stakeholders, its own edge cases. But the structural problems underneath were familiar — multi-step workflows, approval chains, billing cycles, user roles, reporting. Once you have solved a booking system, you recognise the shape of a scheduling system. Once you have built a modular ERP, you understand why a hospital needs the same boundaries between its departments.

That cross-domain exposure changed how I work with requirements. When a client describes what they need, I am not hearing it for the first time. I have usually seen a version of that problem before — in a different industry, with a different name, solved a different way. That context makes it easier to ask the right questions, spot what is missing in the spec, and propose something better than what was originally asked for. Not because I am clever, but because I have enough reference points to recognise patterns the client themselves might not see yet.

It also changed how I work with other developers. Having written Angular, I understand what a frontend developer means when they say state management is getting messy. Having built MAUI apps, I understand the constraints a mobile developer is working within. Having worked on backend ABP modules, I understand why a backend engineer pushes back on a UI-driven requirement that breaks domain boundaries. You cannot fake that understanding. It comes from having been in each position yourself — and it reduces the kind of friction that slows cross-functional teams down.

---

## The Contradiction I Should Mention

Here is where I have to be honest, because what I just said sounds like an argument for spreading yourself thin across many languages and frameworks equally. That is not what I am saying.

I worked in TypeScript, JavaScript, and C#. But I focused on C#. That was my primary language — the one I understood deeply, the one I reached for when I needed to think clearly about a problem.

TypeScript and JavaScript were slower. I learned them, I used them, I got things done in them. But I approached them through the lens of what I already knew from C#. Interfaces, generics, type systems, async patterns — I recognised these in TypeScript because I already understood them in C#. The learning curve was shorter because the concept was already familiar.

So the contradiction resolves like this:

> Versatility does not mean equal depth in everything. It means one strong anchor, and the confidence to transfer what you know.

A developer who has only ever used Angular is not necessarily shallow — they might be deeply skilled. But if they have never had to solve the same problem a different way, they may not know whether their solution is a good solution or just an Angular solution. Working across frameworks forces that question.

The goal is not to be an "Angular developer" or a "C# developer." Those are tools. The goal is to be a software engineer who happens to be most fluent in C# — and who can pick up any framework, recognise the patterns underneath it, and build something well.

---

## What Sticking to One Framework Costs You

I have worked with developers who were highly skilled in one framework and genuinely uncomfortable outside it. Not bad developers — often very good ones. But when the project changed, or the framework version broke something fundamental, or the team decided to move in a different direction, the adjustment was harder than it needed to be.

The problem was not that they knew one framework well. The problem was that they had mistaken framework knowledge for engineering knowledge. When the framework changed, they felt like beginners again — because the thing they had mastered was the tool, not the discipline behind it.

Working across Blazor, Blazor Hybrid, Angular, React, Next.js, MAUI, .NET Core, and ABP Framework did not make me an expert in all of them. It made me not afraid of any of them. And in practice, that confidence is worth more than deep expertise in a single tool — because tools change, and confidence transfers.

This matters more now than it did a few years ago. The pace at which the industry is shifting — AI-assisted development, new runtimes, new paradigms — means adaptability is no longer a nice trait to have. It is the work. Developers who have only ever operated inside one familiar environment tend to struggle when the environment changes. Developers who have moved across environments before know that the discomfort is temporary, the fundamentals carry over, and the ramp-up is faster than it looks from the outside.

---

## The Real Lesson

If you want to become a more versatile developer, the answer is not to learn every framework. It is to learn *why* the frameworks you use make the decisions they do.

Why does Angular use modules? Why does React prefer composition over inheritance? Why does Blazor lean on the .NET type system? The answers are not arbitrary. They reflect real trade-offs in real problems that every UI framework has to solve.

When you understand the trade-offs, you understand the pattern. When you understand the pattern, the syntax is just syntax.

Master your primary language. Learn it deeply enough that you think in it. Then use that depth as a foundation to recognise the same ideas in new places. The second language will be slower. The third will be faster than the second. By the time you are in unfamiliar territory, the most important things will already feel familiar.

That is software engineering. The framework is just the vocabulary it speaks today.
