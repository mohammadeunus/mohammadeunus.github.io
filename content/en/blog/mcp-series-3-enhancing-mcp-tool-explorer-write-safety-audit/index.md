---
title: "Model Context Protocol Series 3 — Enhancing Your MCP Server: Tool Explorer UI, Grouping, and Write Safety"
slug: mcp-series-3-enhancing-mcp-tool-explorer-write-safety-audit
description: "After launching a working, secured MCP server, we kept hitting friction in production: tools were invisible, writes were risky, and errors were unreadable by Claude. This post covers the enhancements that fixed all three."
excerpt: "A Swagger-like tool explorer UI, two-step write confirmation, idempotency for retries, structured error envelopes, and an automatic audit trail — everything we added after Series 1 and 2 shipped."
date: 2026-06-18T00:00:00+06:00
lastmod: 2026-06-18T00:00:00+06:00
draft: true
weight: 50
images: []
categories: ["Development", "AI", "MCP", ".NET"]
tags: ["MCP", "Model Context Protocol", "ASP.NET Core", "Tool Explorer", "Write Safety", "Idempotency", "Audit", "Claude", "Enhancement"]
contributors: []
pinned: false
homepage: false
---

Series 1 and 2 gave us a working, secured server. Once it was in production, we kept hitting the same friction points.

The first was visibility. With fifty-plus tools registered, there was no way to see what the server actually offered without asking Claude — which meant waiting for an AI to describe its own capabilities. The second was safety. Write tools worked, but there was nothing stopping Claude from executing a destructive mutation the moment it decided to. The third was errors. When something went wrong, Claude would receive a raw exception message with a stack trace and no clear path forward.

None of these were blockers in development. All three became problems in production, within the first week of real use. This post covers what we built to fix them.

---

## The Tool Explorer — A Swagger UI for MCP

The most visible change is a static HTML page served at `/` from `wwwroot/index.html`. Think Swagger UI, but for an MCP server.

The page has three parts: a stats panel at the top, a filterable sidebar on the left, and expandable tool cards on the right. When it loads, it shows a token input. The user pastes their Bearer token, hits Load, and the page calls the MCP endpoint directly to retrieve the full tool manifest. No backend proxy, no server-side rendering — it is a single-page app that speaks MCP directly.

{{< figure src="tool-explorer-layout.svg" alt="MCP tool explorer UI — sidebar groups, stats panel, and expandable tool cards" >}}

**Why build this instead of relying on Claude?**

Because "ask Claude what tools are available" does not work for a team. Developers want to browse. QA testers want to run things without writing prompts. Onboarding someone to the server should take minutes, not a conversation. A static HTML page gives everyone that, and it stays accurate because it reads the live manifest on every load.

The stats panel at the top gives you a quick read on the server's surface area: total tools, how many groups exist, how many tools have parameters, and the total required-parameter count. Useful for spotting when the server has drifted far from what anyone remembers registering.

### Two Grouping Dimensions

The sidebar supports two views: by Verb and by Domain.

Verb grouping uses a prefix convention. Every tool name follows `verb_noun_context` naming, so the grouping logic is a simple prefix match:

```js
const GROUPS = [
  { key: 'search',  label: 'Search',  icon: 'fa-magnifying-glass' },
  { key: 'get',     label: 'Get',     icon: 'fa-eye'              },
  { key: 'list',    label: 'List',    icon: 'fa-list'             },
  { key: 'create',  label: 'Create',  icon: 'fa-plus'             },
  { key: 'update',  label: 'Update',  icon: 'fa-pen'              },
  { key: 'delete',  label: 'Delete',  icon: 'fa-trash'            },
  { key: 'audit',   label: 'Audit',   icon: 'fa-clipboard-check'  },
  { key: 'send',    label: 'Send',    icon: 'fa-paper-plane'      },
  { key: 'attach',  label: 'Attach',  icon: 'fa-link'             },
  { key: 'detach',  label: 'Detach',  icon: 'fa-link-slash'       },
  { key: 'assign',  label: 'Assign',  icon: 'fa-user-plus'        },
  { key: 'reorder', label: 'Reorder', icon: 'fa-sort'             },
  // ...
];

function groupOf(name) {
  return GROUPS.find(g => name.startsWith(g.key + '_') || name === g.key) ?? OTHER;
}
```

This works cleanly because the naming convention is enforced at tool registration time. A tool named `create_quote` drops into the Create group. A tool named `search_products` drops into Search. No configuration needed.

Domain grouping goes the other direction: instead of asking "what kind of action is this?", it asks "what business entity does this touch?" The domain list — Quote, Shipment, Order, Product, Supplier, Company, Contact, and others — is resolved by keyword match against the tool name. Order resolves overlaps: `quote_request` is matched before `quote`, so `create_quote_request` lands in Quote Request rather than Quote.

Both dimensions are useful. Verb view is natural for understanding permissions ("what can mutate data?"). Domain view is natural for understanding scope ("everything that touches an Order").

### Full-Text Search and Permission Filter

The sidebar has a search box that filters live across all tool names and descriptions. Typing `order` narrows the list to everything order-related regardless of which group it belongs to. There is also a permission filter: tools annotated with specific permission requirements can be filtered to show only what a given user can access.

The tool cards themselves expand on click to show every parameter — name, type, whether it is required, and the description. Enough to understand what to pass without reading source code.

---

## Write Tool Safety

Read tools can be called freely. Write tools — anything that creates, updates, deletes, sends, or attaches — carry real risk when an AI is driving. Two patterns address this.

### Two-Step Confirmation

The first call to a write tool returns a `confirmToken`. Nothing is executed. Claude receives the token, shows the user what it is about to do, and asks for approval. The user confirms. Claude calls the same tool again, this time including the `confirmToken`. The server validates and executes.

{{< figure src="write-tool-safety.svg" alt="Two-step write tool confirmation flow — first call returns a confirm token, second call with token executes the operation" >}}

The `IConfirmTokenService` interface is straightforward:

```csharp
public interface IConfirmTokenService
{
    string GenerateToken(string userId, string toolName, object payload);
    bool ValidateAndConsume(string? token, string userId, string toolName, object payload);
}
```

The token is scoped to a specific user, tool, and payload. A token generated for `create_quote` with a particular set of parameters cannot be replayed against `delete_order` or against `create_quote` with different parameters. Tokens are single-use and expire after five minutes.

The `InMemoryConfirmTokenService` stores tokens in `IMemoryCache`. The cache key is a hash of `userId + toolName + serialized payload`:

```csharp
private string BuildCacheKey(string userId, string toolName, object payload)
{
    var json = JsonSerializer.Serialize(payload);
    var hash = ComputeHash(json);
    return $"confirm:{userId}:{toolName}:{hash}";
}
```

When `ValidateAndConsume` succeeds, it removes the key immediately — the token is gone and cannot be replayed. This matters because Claude might retry on network failure. Without single-use enforcement, a confirmed action could execute twice.

A note on deployment: `InMemoryConfirmTokenService` is scoped to the current process. A multi-instance deployment needs this backed by Redis. The comment in the source is explicit: acceptable for Phase 2A (single-instance), replace with `IDistributedCache` in Phase 2B.

### Idempotency

The confirmation pattern handles accidental execution. Idempotency handles accidental duplication on retry.

Clients pass a `clientRequestId` alongside their write tool parameters. The server deduplicates: if the same ID arrives again with the same payload, it returns the cached result instead of executing again. If the same ID arrives with a different payload, it returns a conflict signal — something is wrong, and the caller should not proceed.

```csharp
public interface IIdempotencyService
{
    // Returns:
    //   (result: non-null, conflict: false) — exact replay; return cached result.
    //   (result: null,     conflict: true)  — same id, different payload; return IdempotencyConflict.
    //   (result: null,     conflict: false) — not seen before; proceed and call Store.
    (object? result, bool conflict) TryGet(string clientRequestId, object payload);

    void Store(string clientRequestId, object payload, object result);
}
```

The three-state return value is the key design decision. A simple hit/miss is not enough — you need to distinguish between "yes, I saw this exact request before" and "I saw a request with this ID but it was different," because those two cases call for completely different responses.

Idempotency results have a 24-hour TTL. Long enough to cover any plausible retry window, short enough that the cache does not grow without bound.

Both services use the same SHA-256 payload hashing approach. Serialization is `System.Text.Json` with default settings, so the payload comparison is deterministic as long as the caller sends the same JSON structure.

---

## Structured Error Envelopes

Every error from the MCP server returns the same JSON shape:

```json
{
  "code": "PERMISSION_DENIED",
  "message": "User does not have access to create quotes for this tenant.",
  "correlationId": "3f8a2c01-..."
}
```

Never a raw exception. Never a stack trace.

The reason is specific to how Claude uses tool responses. When a tool call fails, Claude reads the error message and decides what to do next. A message like `PERMISSION_DENIED` with a clear description gives Claude something to work with — it can tell the user what happened, suggest requesting access, or try a different approach. A 500 with a NullReferenceException and twelve frames of stack trace gives Claude nothing actionable, and it tends to either retry blindly or report a confusing error to the user.

The `code` field is a machine-readable string from a fixed vocabulary: `PERMISSION_DENIED`, `NOT_FOUND`, `VALIDATION_ERROR`, `IDEMPOTENCY_CONFLICT`, `CONFIRM_TOKEN_REQUIRED`, `CONFIRM_TOKEN_INVALID`, and so on. Claude can be prompted to react to specific codes — pausing on `CONFIRM_TOKEN_REQUIRED`, stopping on `PERMISSION_DENIED`, retrying with a new `clientRequestId` on `IDEMPOTENCY_CONFLICT`.

The `correlationId` ties the error back to the Serilog structured log entry. When something goes wrong in production, the `correlationId` from the MCP response leads directly to the full request context in the log.

---

## Audit Trail — Knowing What the AI Did

The MCP server sits between Claude and the backend API. Every write operation passes through `BearerTokenForwardingHandler`, a `DelegatingHandler` registered on all outgoing `HttpClient` instances. Its primary job is to forward the Bearer token from the incoming MCP request to every outgoing backend API call.

After Series 2 shipped, a second responsibility was added: stamping each outgoing request with a modification source header.

```csharp
protected override async Task<HttpResponseMessage> SendAsync(
    HttpRequestMessage request, CancellationToken cancellationToken)
{
    var httpContext = _httpContextAccessor?.HttpContext;

    if (httpContext != null)
    {
        // Forward Bearer token
        var authHeader = httpContext.Request.Headers["Authorization"].FirstOrDefault();
        if (!string.IsNullOrEmpty(authHeader) && authHeader.StartsWith("Bearer "))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue(
                "Bearer", authHeader["Bearer ".Length..]);
        }

        // Stamp modification source
        var provider = httpContext.RequestServices.GetService<IModificationSourceProvider>();
        if (!string.IsNullOrEmpty(provider?.Current))
            request.Headers.TryAddWithoutValidation(
                ModificationSourceHeaders.HeaderName, provider.Current);
    }

    return await base.SendAsync(request, cancellationToken);
}
```

When the modification source is `MCP`, the backend API middleware stamps that value onto every entity change — in the ABP audit log, in the entity's `LastModifiedBy` context, and in any domain event. The backend does not need to know anything about MCP specifically. It reads a header it already supports.

The result: every change made via the MCP server is distinguishable from a change made via the human portal in every backend audit log, automatically, with no per-tool code.

Serilog LogContext is enriched per request with `userId`, `userEmail`, and `correlationId`. Any log entry written during an MCP request carries these fields. Structured log queries like "all write operations by this user in the last hour via MCP" work out of the box.

This matters for incidents. When something unexpected changes in production, the first question is always "was this the AI or was this a human?" With the `X-Modification-Source` header and Serilog enrichment in place, that question has a one-second answer.

---

## What These Enhancements Unlock

The tool explorer makes the MCP server self-documenting. Any developer, QA engineer, or product manager on the team can open it, paste a token, and browse what the AI can and cannot do. Tool descriptions, parameter names, required fields — all visible without writing a prompt. The server stops being a black box the moment this page ships.

Write safety makes AI-driven mutations production-worthy. The two-step confirmation pattern ensures that destructive actions require an explicit human approval in the loop before they execute. Idempotency ensures that network retries, which are inevitable in any distributed system, cannot cause duplicate operations. Together they address the two most common failure modes for AI write tools: executing something the user did not intend, and executing something twice.

The audit trail answers the question that comes up after every incident: "what did the AI do, exactly, and when?" The modification source header and Serilog enrichment give you that answer from existing backend logs with no extra instrumentation.

None of these were complex to build. The tool explorer is a single HTML file. The confirmation and idempotency services are two interfaces and two in-memory implementations. The audit stamping is twelve lines in a handler that was already running on every request. The total investment was a few days of work. The return was a server the team trusts to run in production against real data.

Everything so far has been tested against one AI client: Claude. The next post tackles the obvious follow-up question — can ChatGPT use the same server? The answer turns out to be one server, not two, and the hardest piece built for Claude isn't needed at all.

{{< series-next
  title="Model Context Protocol Series 4 — Serving ChatGPT and Claude from One MCP Server"
  description="One server, two AI clients. ChatGPT runs in the cloud with a fixed redirect URI — so the bridge middleware Claude needed isn't required at all. Here's the handful of OAuth config changes that were."
  url="/blog/model-context-protocol-series-4-serving-chatgpt-and-claude-from-one-mcp-server/"
>}}
