---
title: "What Building an MCP Server Taught Me About API Design"
slug: what-building-mcp-taught-me-about-api-design
description: "I picked up a task to build an MCP server for a production system. What I found inside changed how I think about API design forever."
excerpt: "Building an MCP server for a live production system exposed every assumption the backend had made about its only consumer: an Angular UI. Here's what I learned."
date: 2026-06-14T00:00:00+06:00
lastmod: 2026-06-14T00:00:00+06:00
draft: false
images: []
categories: ["Development", "API Design", "AI", "MCP"]
tags: ["MCP", "API Design", "REST", "Backend", "AI Integration", "Best Practices", "Software Architecture", "Domain-Driven Design"]
contributors: []
pinned: false
homepage: false
---

The task seemed straightforward: build an MCP (Model Context Protocol) server on top of an existing production system so an AI agent could interact with it. I was the one writing the MCP layer — designing the tools, mapping them to the existing API endpoints, and making the backend legible to an AI. The backend was live. The APIs were working. A frontend client was consuming them without complaints.

I was working under strict constraints — no changes to the backend, no changes to the existing client. My job was to build on top of what existed, not to fix it.

Then I started writing the MCP tools.

And everything I thought I understood about "working APIs" began to unravel. The problems I found weren't mine to fix — only to work around. Which meant I had to understand every one of them deeply enough to route the AI safely past them.

---

## What Is MCP, and Why Does It Expose API Problems?

MCP is a protocol that lets AI models call tools — functions that interact with real systems. You define a tool with a name, a description, and parameters. The AI reads the description, decides when to use the tool, and calls it.

The critical word here is *description*. The AI agent reads your tool description every single time it decides what to do. That means:

- Long, wordy descriptions waste <abbr title="The unit of text an AI model processes. More tokens = more cost and slower responses. A word is roughly 1–2 tokens.">tokens</abbr>
- Vague descriptions cause wrong tool calls
- Inconsistent APIs force the AI (and you) to write complex, fragile glue code

When I started wrapping these APIs as MCP tools, the seams in the backend became impossible to ignore. The frontend had been quietly paper-mâché-ing over cracks for years. MCP had no plaster. It exposed the raw structure directly.

Here is what I found — and what each problem taught me about how APIs should be designed:

- **One API for multiple variants** — conflicting rules, exploding descriptions, no validation per type
- **GET returns the full object graph** — most operations need 2–3 fields; the AI reads 40
- **Updates replace instead of merge** — omit a field and data disappears, silently
- **GET and update use different shapes** — what you read is not what you write
- **Business logic lived in the client, not the backend** — rules invisible to any other consumer
- **Child records repeat what the parent already knows** — redundant data, inconsistent state
- **Date arithmetic pushed to the client** — server stores a different value than it displays
- **Inconsistent return values** — no contract for what a write operation returns

---

## Problem 1: One API for Multiple Variants — Descriptions Grew Too Long to Be Useful

**One API handled several completely different resource variants, and I had to explain all of them in a single tool description. The AI read it every call. Tokens burned. It still got confused.**

Each variant had different required fields. Some fields meant *opposite things* depending on the variant. Take a flag called `isNew`:

- For **variants A, B, C** → must be `true` to signal a new child record
- For **variant D** → must be `false` to signal a new child record (uses `id=null` instead)

Same field. Completely opposite meaning. No type-specific validation on the backend to catch mistakes.

Because the same endpoint served all variants, it couldn't enforce required fields per type — adding a `required` constraint would break the ones that don't need it. The only place validation lived was in the frontend form, which showed different fields depending on which variant the user selected.

**The lesson:**

> One API covering multiple use cases isn't an efficient design. It's several decisions that were never made.

- **Split by type, not by flag.** When a resource has genuinely different required fields per variant, give each its own endpoint. A single endpoint that serves four variants cannot enforce required fields for any of them — adding `required` to a field breaks the variants that don't need it. Separate endpoints each declare exactly what they need.

```
// Bad — one endpoint, five different payloads, no enforcement
POST /resources

// Good — each endpoint enforces its own contract
POST /resources/contract      → status, supplierId, vendorIds required
POST /resources/rebate        → supplierId N/A, id=null signals new items
POST /resources/standard      → status required, vendorIds optional
```

- **A field that means opposite things is not a field — it's a bug.** Same field, inverted meaning, no backend validation to catch mistakes. The fix is a universal convention: `id=null` always means new record, regardless of variant — no flags, no conditional logic.

- **Conditional rules in a description are server-side validation gaps.** If the backend enforced the rule, the description wouldn't need to say it. Every `if type == X then field Y is required` sentence in a tool description is a missing server-side check.

---

## Problem 2: GET Returns the Whole Object — Every Call, Every Time

**Every read fetched the full <abbr title="The complete nested structure of an object and all its related records — header, line items, linked records, calculated fields — all returned together in one response.">object graph</abbr>: header, all line items, all linked records, calculated fields, internal flags. Most operations needed 2–3 fields. The AI had to inspect everything to find them.**

The problems that followed were predictable:

- **Token waste** — the AI processed data it never used, on every single call
- **Field confusion** — the response had multiple similarly-named arrays; reading from the wrong one silently returned wrong data
- **Slower tool chains** — every operation started with a large, expensive fetch before any real work began

**The lesson:**

> An API that returns everything is not comprehensive. It's inconsiderate of its consumers.

A better design splits reads by sub-resource:

```
GET /resources/{id}              → header only
GET /resources/{id}/items        → line items only
GET /resources/{id}/linked       → linked records only
```

- **Return only what was asked for.** A header request should return the header. An items request should return items. Mixing them into one response forces every consumer to parse the full graph every time, even when they only need two fields.

- **Similar-looking sibling fields in one response are a collision waiting to happen.** When a response contains multiple arrays with overlapping names, the AI will eventually read from the wrong one — and there is no error to catch it. Multiple arrays with similar names signal that the response is doing too much.

- **A field that is always null is actively misleading.** If `linkedIds` is always `null` in the GET response while the real data lives in `associations[].id`, the null field implies it will eventually be populated. Remove it or populate it — a null field that silently points nowhere is worse than no field at all.

One trade-off worth naming: multiple sub-resource endpoints means multiple round trips where there was once one. For most AI tool chains this is the right call — smaller and less error-prone outweighs the extra latency. But if a single operation genuinely needs all sub-resources together, a `?include=items,linked` query parameter can offer both in one call.

There is also a forced pre-fetch pattern that emerges from oversized GET responses. Because child record IDs are unstable (reassigned on every save — see Problem 3), the AI must call the full GET immediately before every write just to obtain current IDs. A response that returns many sub-graphs to answer a question about one record is not being helpful — it is masking the real problem, which is that the IDs were never stable to begin with.

---

## Problem 3: Updating One Field Could Delete Hundreds of Records

**The update endpoints didn't merge changes — they replaced the entire object. Send an updated header without the items array, and all the items were deleted. Silently. No warning. No error.**

This was the most dangerous pattern I found. It appeared across multiple resources in the system.

It worked with the frontend because:
- The frontend always had the full object in memory, pre-loaded from the previous GET
- The form held everything — header, items, linked records
- Clicking save meant "send it all back"

<abbr title="Each tool call carries no memory of previous calls. There is no session, no form state held in memory between requests — just the data you explicitly send each time.">MCP tools are stateless</abbr>. Each call is independent. An AI agent changing a single field has no reason to load and resend hundreds of child records. But if it didn't — all of them were gone.

**The lesson:**

> Update means update. Not replace. Not delete-and-recreate.

- **Omission is not deletion.** Sending a partial payload should update only what was sent. If `items` is omitted, existing items must be preserved. Omitting a collection from a PATCH must never be interpreted as "clear this collection" — that intent requires an explicit `DELETE /resources/{id}/items/{itemId}`.

- **`DeleteMany` + re-insert is not an update handler.** If the implementation deletes all existing rows then re-inserts from the incoming array, every client is forced to pre-fetch the full state, reconstruct it, and send it back in full — even to change one field. That cost is invisible in the backend but paid on every call by every consumer.

- **IDs must survive saves.** If your update handler reassigns child record IDs due to delete-and-recreate, any `parentId` reference built from a previous GET is silently broken the moment a write occurs. A parent-child relationship built on ephemeral IDs cannot be trusted. Stable IDs — or a stable `uid` alongside the ephemeral `id` — are required for any reference-based relationship to hold.

- **Read-only fields that have no write counterpart must be explicitly marked.** If a field appears in the GET response but cannot be passed back on update — image paths, certificates, computed values — every update silently wipes them. Either expose them on the write shape, or document them as read-only. Silence means loss.

A proper design makes intent explicit:

```
PATCH /resources/{id}                    → update header fields only
PATCH /resources/{id}/items              → add or update specific items
DELETE /resources/{id}/items/{itemId}    → explicit, intentional removal
```

The delete-and-recreate pattern also has a cascade effect that isn't obvious until you hit it: **IDs are reassigned on every save**. A child record that had `id: 42` before the save will have a completely different ID after it. Any parent-child reference breaks silently on every update. The only workaround is to GET the record again immediately after every save to retrieve the new IDs. That's a hidden tax on every operation, imposed entirely on the client.

There is a subtler variant that is even harder to recover from: **data deleted on every update because the write shape simply doesn't expose the field**. In one resource, data present in the GET response had no corresponding parameter on the update endpoint — it could not be passed back even if the client wanted to preserve it. Every update silently wiped it. There was no workaround because the client had no way to include what the endpoint wouldn't accept.

The pattern also surfaces a dual-identity problem on child records. One approach found in the codebase attempted to solve unstable IDs by exposing two ID fields per child item — an ephemeral `id` (reassigned on every save) and a stable `uid` (a GUID that survives saves). The write endpoint requires the current ephemeral `id` for parent-child references, but the only reliable way to obtain it is to GET immediately before writing, locate the item by its stable `uid`, then read off whatever `id` it currently has. Two parallel identity systems on the same object, each valid for a different operation, with no consistency guarantee between them.

---

## Problem 4: GET and Update Used Different Field Names for the Same Data

**The read shape and the write shape were different. What you got back from GET was not what you sent in on update. Every copy or update required a manual translation step — and there was no error if you got it wrong.**

A concrete example of the mismatch:
- GET returned linked records inside `associations[]`, each with an `id` field
- The update endpoint expected them as `linkedIds[]` on the root object
- That `linkedIds` field was **always null** in the GET response

The update would succeed even with the wrong shape. The linked records would just silently disappear.

**The lesson:**

> What you write and what you read should have the same shape — and the same names.

- **What you read should be what you write.** If the write endpoint accepts `linkedIds: int[]`, the GET response must return `linkedIds: int[]` in the same location — not `associations[].id` buried in a nested array. Every structural difference between read and write is a manual translation step imposed on every consumer, with no error if the mapping is wrong.

```json
// Bad — GET and write use different shapes
// GET /resources/{id} returns:
{ "associations": [{ "id": 1 }, { "id": 2 }], "linkedIds": null }

// PATCH /resources/{id} expects:
{ "linkedIds": [1, 2] }

// Good — mirror shape, no translation needed
// GET /resources/{id} returns:
{ "linkedIds": [1, 2] }

// PATCH /resources/{id} expects:
{ "linkedIds": [1, 2] }
```

- **Different field names for the same value is a type mismatch, not just a naming issue.** A GET returning `image` (a CDN URL) while the write endpoint expects `imagePath` (a blob storage path) looks like a naming inconsistency. It is actually a value type mismatch — forwarding the CDN URL saves without error and silently corrupts the record.

- **Don't include transient or computed fields in GET responses unless they are clearly marked.** The AI forwards everything it reads. If the write endpoint silently ignores a live-computed field passed back from the GET, there is no signal to the caller that it was the wrong thing to send.

There is a subtler version of this problem that I only caught through testing. An AI model carries strong naming intuitions from its training data — it has seen millions of APIs and knows what field names "should" look like. If a GET response returns `salePrice` but the create endpoint expects `salerPrice`, the AI will almost certainly send `salePrice`. Not because it missed the instruction — but because `salePrice` looks correct and `salerPrice` looks like a typo it should silently fix.

This means inconsistent or non-standard field names between GET and write endpoints don't just slow the AI down. They actively mislead it into producing valid-looking but broken payloads, with no error to catch the mistake. Consistent, conventional naming removes the gap between what the AI expects and what the API actually accepts.

---

## Problem 5: The Backend Relied on the Frontend to Enforce Business Rules

**This was the root cause behind all the other problems. The backend was built assuming one client was the only consumer — and that client did a lot of work the backend never checked.**

I was told not to touch the business logic. The uncomfortable discovery was that there wasn't really a business logic layer to protect — the rules were scattered across frontend services, application services, and implicit assumptions the backend had never needed to enforce. The domain layer existed in name. The logic lived everywhere else.

Before saving, the frontend would:
- Validate all required fields and show form errors
- Calculate derived values before saving
- Pre-fetch related data and attach it to the payload
- Prevent the save button from being clicked until everything was ready

The backend trusted all of this. It didn't re-validate, re-calculate, or reject incomplete records. Why would it? The frontend never sent incomplete records.

When MCP bypassed the frontend and called the backend directly, every hidden assumption surfaced:

- **Calculated fields were not enforced server-side** — records could be saved with incorrect derived values if the AI skipped a required step
- **Related data had to be supplied by the client** — missing values saved incomplete, unusable records with no error
- **Required fields could be null** — fields that were functionally mandatory could be saved empty; the UI just looked broken afterward
- **Business rules lived in the frontend service layer**, not in the domain — two different consumers would implement them differently, or not at all

Since I couldn't change the backend, I had no good option. The validation had to live somewhere — so I put it in the MCP tool descriptions. Rules like "this field is required", "this value must be fetched first", "do not skip this step" — written out as instructions for the AI to read before every call. 🤦

That's the moment it really sank in. The same validation that the frontend enforced through form controls, I was now duplicating into tool descriptions — token-heavy, fragile, and invisible to any future consumer that isn't MCP. Three places, same rules, none of them the backend.

The most extreme example: one tool description contains the instruction *"before calling this tool, ask the user to confirm their intent"* — a UX confirmation step, written as a sentence in a tool description, because the backend performs an irreversible action without any guard. Business workflow logic. In a string. Read by an AI. On every call.

**The lesson:**

> A backend that only works correctly when a specific client is in front of it is not a complete backend.

- **Every rule in a tool description is a missing server-side rejection.** If a null owner field causes a blank document, the backend should return a `400` — not a warning sentence that an AI reads before every call. Documentation does not replace validation. It compensates for the absence of it.

```csharp
// Bad — backend accepts anything, frontend guards the gate
public async Task SaveAsync(ResourceDto dto) {
    await _repository.SaveAsync(dto); // null owner saved silently
}

// Good — domain manager enforces rules regardless of caller
public async Task SaveAsync(ResourceDto dto) {
    var resource = await _resourceManager.CreateAsync(
        ownerId: dto.OwnerId,   // throws if null
        status: dto.Status,     // throws if null
        type: dto.Type
    );
    await _repository.InsertAsync(resource);
}

// Domain manager — rules live here, not in the client
public async Task<Resource> CreateAsync(Guid? ownerId, int? status, int type) {
    if (ownerId == null)
        throw new BusinessException("OwnerId is required.");
    if (status == null)
        throw new BusinessException("Status is required.");

    return new Resource(ownerId.Value, status.Value, type);
}
```

- **Conditional required fields must be enforced per type, server-side.** `fieldX required unless type is Y` is a business rule. It belongs in the domain layer, enforced at the API boundary. If the required fields differ by type, the endpoint should differ by type — not share a payload with a footnote.

- **Multi-step prerequisites are backend responsibilities.** Fetch → calculate → save is a workflow. If the backend accepts the final save without verifying the prior steps were completed correctly, the sequence is advisory, not enforced. Any consumer that skips a step saves corrupted data with no error.

- **State transitions are not tool description sentences.** "Confirm before setting terminal state" is a state machine rule. It belongs in explicit transition guards in the application layer — not in a string read by an AI on every call. A backend that accepts invalid state transitions without objection has no state machine; it has fields.

- **Validation copied to each new consumer is validation that will eventually diverge.** The frontend enforced rules in form controls. MCP re-implemented them in tool descriptions. The third consumer will do it a third time, differently. The only place a rule can be enforced consistently is the backend — where every consumer passes through it.

---

## Problem 6: Child Records Were Asked to Repeat What the Parent Already Knew

**In one resource, every line item in a collection required the parent record's ID — even though that ID was already present on the header of the same request. The backend could have inferred it. Instead, clients had to pass it on every single item.**

This pattern created real problems:

- **AI confusion** — a tool description that says "each item must include the parent ID" raises an immediate question: *why?* The backend already has it
- **Inconsistency risk** — if a client passes a mismatched ID on one item, the backend has two conflicting sources of truth and no obvious rule for which to trust
- **Unnecessary payload size** — redundant data on every item in a large collection adds up

**The lesson:**

> A parent record's ID should not travel to every child record in the same payload. The backend can infer it from context.

- **The parent's ID does not belong on every child.** If a payload is already scoped to a parent record, child items must not repeat that parent's ID. When each item in a nested collection carries the parent ID alongside the header that already contains it, there are two sources of truth — and no rule for which one wins when they conflict.

```json
// Bad — parentId repeated on every item (200 redundant values)
{
  "id": 42,
  "items": [
    { "parentId": 42, "name": "Item A" },
    { "parentId": 42, "name": "Item B" }
  ]
}

// Good — backend infers parent from request context
{
  "id": 42,
  "items": [
    { "name": "Item A" },
    { "name": "Item B" }
  ]
}
```

- **Two sources of truth means one hidden bug.** If a child item's parent reference can differ from the parent header's ID, the backend must have a tiebreaker. Having that tiebreaker at all is proof the field should not have been on the child. The backend already knows the parent — it can infer the relationship without the client stating it twice.

- **Redundancy compounds in large collections.** A small payload with redundant IDs is noise. A payload with 200 items, each echoing the same parent ID, is 200 opportunities for a mismatch that produces unpredictable behavior and no validation error.

---

## Problem 7: The Server Stored a Different Value Than It Displayed

**Several date fields had a silent convention: to display date X in the UI, you must store X minus one day at `23:59:59.999Z`. The server applied no normalisation. Every consumer had to perform date arithmetic manually — and there was nothing in any response to confirm whether it got it right.**

This pattern appeared across the majority of date fields in the system. To show `01/01/2026` in the UI, you stored `2025-12-31T23:59:59.999Z`. A local timezone offset applied on display. The AI, which operates in UTC, had no frame of reference for this — and no error when it stored the wrong value.

**The lesson:**

> The server should store what it means and return what it stores. Date normalisation belongs on the server, not in every client independently.

- **Accept dates in a standard format and normalise server-side.** If the UI renders dates in local time, that is a display concern — the API should accept ISO 8601 UTC and apply timezone handling internally.
- **What the server returns should reflect what the server stored.** If the stored value and the displayed value differ, the GET response must return the display-ready value — not a raw value that requires client-side arithmetic to interpret.
- **Silent conventions are undocumented contracts.** A date convention that lives only in tool descriptions or developer memory will be missed by every new consumer.

```json
// Bad — client must subtract a day to get the intended display date
{ "expiryDate": "2025-12-31T23:59:59.999Z" }  // displays as 01/01/2026

// Good — server accepts the intended date, stores and returns it cleanly
{ "expiryDate": "2026-01-01" }  // server normalises to UTC internally
```

---

## Problem 8: No Consistent Contract for What a Write Operation Returns

**Some endpoints returned the newly created record's ID. Some returned an empty object `{}`. Some returned void. There was no pattern. Several tool descriptions had to explicitly state *"returns empty `{}` on success — this is expected"* because the empty response was surprising enough to need normalisation.**

The AI cannot predict what a write returns without reading the description first. After a create, it may need the new ID to continue — but whether the ID comes back in the response, requires a follow-up GET, or isn't available at all depends entirely on which endpoint was called.

**The lesson:**

> Write operations should follow a consistent return contract across the API.

- **Create operations should return the new record's ID at minimum.** A consumer that just created a record almost always needs to reference it next. Returning `{}` forces an immediate follow-up GET — an extra round trip that only exists because the create didn't return what it should have.
- **Consistency reduces description length.** If every write returns the same shape, that contract can be stated once globally. If every write returns something different, every tool description carries its own return-value footnote.

```json
// Bad — unpredictable, requires reading each tool description
POST /resources/a  → { "id": 42 }
POST /resources/b  → {}
POST /resources/c  → void

// Good — consistent contract across all creates
POST /resources/a  → { "id": 42 }
POST /resources/b  → { "id": 17 }
POST /resources/c  → { "id": 91 }
```

---

---

## The Real Lesson

The APIs were working. Users were using the system. Nothing was obviously broken.

But "works when the original client is in front of it" is not the same as "designed correctly."

MCP didn't break the system. It just removed the layer that had been quietly compensating for the backend's gaps. And once that layer was gone, the assumptions underneath became impossible to miss.

If you love software development, this kind of task is a gift. You pick up what looks like plumbing work and come out understanding API design, domain modeling, and the difference between a backend that works and a backend that's correct.

Every task has something to teach you — if you're curious enough to look for it.
