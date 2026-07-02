---
title: "Version-Based Cache Validation in ABP — Keeping the Application Layer Clean Without Redis"
slug: http-etag-cache-validation-abp-modular-monolith
description: "How to wire HTTP ETag validation and a Decorator pattern into an ABP modular monolith so caching becomes an infrastructure concern — and why you probably don't need Redis."
excerpt: "Every caching tutorial ends up polluting the application layer with GetAsync, SetAsync, and RemoveAsync. This post shows a different approach: a decorator that intercepts at the DI layer, version-based ETags that validate client caches without a round trip to the database, and why Redis becomes optional once you get the defaults right."
date: 2026-06-28T00:00:00+06:00
lastmod: 2026-07-02T00:00:00+06:00
weight: 50
images: []
categories: ["Development", ".NET", "ABP Framework", "Architecture"]
tags: ["Caching", "ETag", "HTTP Caching", "ABP Framework", "Clean Architecture", "DDD", "Decorator Pattern", "Scrutor", "Performance"]
contributors: []
pinned: false
homepage: false
---

Every caching tutorial I found did the same thing: reach into the application service, wrap the method body in `GetOrCreateAsync`, and call it clean architecture. The service now knows it's being cached. It has a cache key. It has an invalidation call in the delete method. It has become a caching service with a thin layer of business logic underneath.

That bothered me. The application layer is supposed to contain orchestration and business use cases — not decide whether a response came from memory or a database.

This post is about getting caching right: an infrastructure-level decorator that intercepts read queries before they reach the application service, version-based HTTP ETags that let Angular validate its local cache without a database round trip, and why that combination makes Redis optional for most APIs. Here's what it covers:

- [Why scattering cache calls through application services is the wrong model](#the-problem)
- [`services.Decorate` — the one line that keeps caching out of your application layer](#servicesDecorate--the-decorator-pattern)
- [Version-based ETags: how the client validates its cache with a single lightweight request](#version-based-etags)
- [The write flow: ABP's local entity events increment the version, the application service sees nothing](#the-write-flow)
- [Query categories: a mental model for deciding what to cache and where](#query-categories)
- [Why Redis becomes optional once the defaults are right](#why-you-probably-dont-need-redis)
- [Cache policies: giving each module a reusable caching contract](#cache-policies)

---

## The Problem

Here is what caching looks like in most codebases:

```csharp
public class RoomTypeAppService : ApplicationService, IRoomTypeAppService
{
    public async Task<List<RoomTypeDto>> GetListAsync()
    {
        var cacheKey = "room-types";
        var cached = await _cache.GetAsync<List<RoomTypeDto>>(cacheKey);
        if (cached != null) return cached;

        var items = await _roomTypeRepository.GetListAsync();
        var dtos = ObjectMapper.Map<List<RoomType>, List<RoomTypeDto>>(items);

        await _cache.SetAsync(cacheKey, dtos, new DistributedCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10)
        });

        return dtos;
    }

    public async Task DeleteAsync(Guid id)
    {
        await _roomTypeRepository.DeleteAsync(id);
        await _cache.RemoveAsync("room-types");  // ← scattered here too
    }
}
```

The application service now has three responsibilities: business orchestration, cache management, and invalidation. Add a second cached query and you have six. Add a third module and you have a pattern that nobody can refactor without touching every service.

The alternative is to treat caching like what it is — a cross-cutting infrastructure concern — and keep it entirely out of the application layer.

---

## `services.Decorate` — the Decorator Pattern

The mechanism that makes this work is the **Scrutor** package and its `services.Decorate<TInterface, TDecorator>()` extension.

```
dotnet add package Scrutor
```

Scrutor wraps an already-registered service with a decorator — at the DI layer, before the application service is ever resolved. The application service has no idea a decorator exists. It just does its job.

The decorator implements the same interface:

```csharp
public class CachedRoomTypeAppService : IRoomTypeAppService
{
    private const string Resource = "room-types";
    private static readonly CachePolicy Policy = CachePolicies.Lookup;

    private readonly IRoomTypeAppService _inner;
    private readonly IResourceVersionStore _versions;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly ICurrentTenant _currentTenant;

    public CachedRoomTypeAppService(
        IRoomTypeAppService inner,
        IResourceVersionStore versions,
        IHttpContextAccessor httpContextAccessor,
        ICurrentTenant currentTenant)
    {
        _inner = inner;
        _versions = versions;
        _httpContextAccessor = httpContextAccessor;
        _currentTenant = currentTenant;
    }

    // Read methods go through the shared validation helper
    public Task<List<RoomTypeDto>> GetListAsync()
        => ReadThroughAsync(ResourceKey.For(Resource, _currentTenant.Id),
            () => _inner.GetListAsync(), []);

    // Write methods pass straight through — no caching logic
    public Task<RoomTypeDto> CreateAsync(CreateRoomTypeDto input)
        => _inner.CreateAsync(input);

    public Task DeleteAsync(Guid id)
        => _inner.DeleteAsync(id);

    private async Task<T> ReadThroughAsync<T>(string key, Func<Task<T>> read, T fallback)
    {
        var http = _httpContextAccessor.HttpContext;
        if (http is null || !Policy.VersionEtag)
            return await read();   // background job / event handler — no request to validate

        var etag = $"\"{await _versions.GetVersionAsync(key)}\"";

        http.Response.Headers.ETag = etag;
        http.Response.Headers.CacheControl = "no-store";   // our interceptor owns caching, not the browser

        if (http.Request.Headers.IfNoneMatch == etag)
        {
            // Do NOT set Response.StatusCode = 304 here — see the result filter below.
            http.Items[EtagConstants.NotModifiedItem] = true;
            return fallback;   // Angular will use its local cache
        }

        return await read();
    }
}
```

One `ReadThroughAsync` helper carries the whole pattern; each read method is a one-liner naming its key. (`ResourceKey`, `CachePolicy`, and `ICurrentTenant` are explained in the next sections.)

Register it in the module that owns the decorator — but **not** in `ConfigureServices`:

```csharp
public override void PostConfigureServices(ServiceConfigurationContext context)
{
    context.Services.Decorate<IRoomTypeAppService, CachedRoomTypeAppService>();
}
```

That single line intercepts every resolution of `IRoomTypeAppService`. The application service stays exactly as it was — no cache key, no `GetAsync`, no `RemoveAsync`. The decorator handles validation and headers; the inner service handles the query.

### Why `PostConfigureServices`, not `ConfigureServices`

This one cost me a startup crash. Scrutor's `Decorate` throws if the service it wraps is not **already registered**:

```
Scrutor.DecorationException: Could not find any registered services for type 'IRoomTypeAppService'.
```

In an ABP modular monolith, the decorator lives in the module's `HttpApi` project (it deals in HTTP headers), which — correctly — depends only on `Application.Contracts`, never on `Application`. But the inner service is registered by ABP's conventional registrar when the **Application** module is configured. Since there is no dependency edge between the two modules, ABP is free to run the HttpApi module's `ConfigureServices` first — and whether it does depends on nothing more stable than the order of `[DependsOn]` entries in the host.

`PostConfigureServices` is the fix: ABP guarantees it runs after **every** module's `ConfigureServices`, so the inner registration exists no matter how the module graph is traversed. (Adding a dependency on the Application module would also fix the order — by breaking your layering.)

### Why the decorator can't set 304 itself

My first version set `Response.StatusCode = 304` directly inside the decorator, like most examples do. It doesn't work with ABP's conventional controllers: after the app service returns, MVC still executes an `ObjectResult` and serializes the return value — writing a JSON body (`[]`) onto a 304 response. A 304 must not have a body; Kestrel either strips it or throws.

The fix is to split the responsibility: the decorator *flags* the request, and a global result filter short-circuits the MVC result before anything is written.

```csharp
public static class EtagConstants
{
    public const string NotModifiedItem = "App.Etag.NotModified";
}

public class EtagResultFilter : IAsyncResultFilter
{
    public async Task OnResultExecutionAsync(
        ResultExecutingContext context, ResultExecutionDelegate next)
    {
        if (context.HttpContext.Items.ContainsKey(EtagConstants.NotModifiedItem))
        {
            // ETag header was already set by the decorator
            context.Result = new StatusCodeResult(StatusCodes.Status304NotModified);
        }
        await next();
    }
}
```

Register it globally in the host-facing module. `Filters.AddService` resolves the filter from DI, so the filter itself must be registered too — miss that line and you get a runtime error on the first request, not at startup:

```csharp
context.Services.AddTransient<EtagResultFilter>();
Configure<MvcOptions>(options =>
{
    options.Filters.AddService<EtagResultFilter>();
});
```

One more detail in the decorator above: the `HttpContext is null` guard. App services aren't only resolved by controllers — a background worker or event handler can resolve the same interface, and there's no request to validate against. The decorator must pass straight through in that case.

---

## Version-Based ETags

The ETag value in this pattern is a **version number** — a monotonically incrementing integer stored per resource type. It is not a hash of the response body, which would require computing the full response before you could validate anything.

### The version store

```csharp
public interface IResourceVersionStore
{
    Task<long> GetVersionAsync(string resourceKey);
    Task IncrementAsync(string resourceKey);
}
```

A simple implementation stores versions in a database table:

```csharp
public class EfResourceVersionStore : IResourceVersionStore, ITransientDependency
{
    private readonly IRepository<ResourceVersion, string> _repository;
    private readonly MyAppDbContext _dbContext;

    public EfResourceVersionStore(
        IRepository<ResourceVersion, string> repository,
        MyAppDbContext dbContext)
    {
        _repository = repository;
        _dbContext = dbContext;
    }

    public async Task<long> GetVersionAsync(string resourceKey)
    {
        var entry = await _repository.FindAsync(resourceKey);
        return entry?.Version ?? 0;   // 0 = never written; increments only go up
    }

    public async Task IncrementAsync(string resourceKey)
    {
        // Atomic upsert — read-modify-write loses increments under concurrent writers.
        await _dbContext.Database.ExecuteSqlRawAsync(
            """INSERT INTO "AppResourceVersions" ("Id", "Version") VALUES ({0}, 1) ON CONFLICT ("Id") DO UPDATE SET "Version" = "AppResourceVersions"."Version" + 1""",
            resourceKey);
    }
}
```

Two details that matter more than they look:

- **`?? 0`, not `?? 1`.** The default doesn't really matter for correctness — what matters is that versions only ever increase. A fresh database serves ETag `"0"`, and any client holding an older numeric ETag revalidates correctly.
- **The increment must be atomic.** The obvious `Find → entry.Version++ → Upsert` loses increments when two writes race. A lost increment means a client keeps getting 304 for data that changed — the one failure mode this whole pattern must never have. A single `ON CONFLICT ... DO UPDATE` statement (PostgreSQL; `MERGE` on SQL Server) closes the race.

### Scope the key to the tenant

In a multi-tenant ABP app, `"room-types"` alone is a bug: tenant A's write would leave tenant B's ETag untouched — correct — but tenant A and tenant B *sharing* one version row means every tenant's cache invalidates when any tenant writes, and worse, a per-tenant query validated against a global version can serve a 304 for data the client has never seen. Build the key from the resource *and* the scope:

```csharp
public static class ResourceKey
{
    public static string For(string resource, Guid? tenantId, Guid? arenaId = null)
    {
        var key = $"{resource}:t:{tenantId}";
        if (arenaId.HasValue)
            key += $":a:{arenaId}";
        return key;
    }
}
```

Every key the decorator reads and every key the invalidator bumps goes through the same builder. If your data is scoped further (per branch, per arena, per user), the scope belongs in the key too — that's what the optional third segment is: a tenant-wide list and an arena-filtered list of the same resource are different responses, so they get different version rows.

The entity is minimal — the resource key is the primary key, so the row is found by ID, never by scan:

```csharp
public class ResourceVersion : Entity<string>
{
    public long Version { get; set; }
}
```

### What the client sends and receives

First request — no cache yet:

```
GET /api/room-types
→ 200 OK
   ETag: "7"
   [full response body]
```

Angular stores the response and the ETag. Next request:

```
GET /api/room-types
If-None-Match: "7"
→ 304 Not Modified
   ETag: "7"
   [empty body]
```

The database query never runs. The response body is empty. Angular continues using its local copy.

After a write happens and the version increments to `8`:

```
GET /api/room-types
If-None-Match: "7"
→ 200 OK
   ETag: "8"
   [fresh response body]
```

Angular replaces its cache and stores the new ETag.

### Angular interceptor

There's a trap here that almost every ETag interceptor example on the internet gets wrong: **Angular's `HttpClient` treats any non-2xx status as an error.** A 304 never reaches your `map` operator as an `HttpResponse` — it arrives in the *error* channel as an `HttpErrorResponse`. The cached body has to be restored in `catchError`:

```typescript
@Injectable()
export class EtagInterceptor implements HttpInterceptor {
  private cache = new Map<string, { etag: string; body: unknown }>();

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (req.method !== 'GET') return next.handle(req);

    const key = req.urlWithParams;
    const entry = this.cache.get(key);
    const outgoing = entry
      ? req.clone({ setHeaders: { 'If-None-Match': entry.etag } })
      : req;

    return next.handle(outgoing).pipe(
      tap(event => {
        if (event instanceof HttpResponse) {
          const etag = event.headers.get('ETag');
          if (etag) this.cache.set(key, { etag, body: event.body });
        }
      }),
      catchError((err: HttpErrorResponse) => {
        if (err.status === 304 && entry) {
          // serve the cached body as if it were a fresh 200
          return of(new HttpResponse({ status: 200, body: entry.body, url: req.url }));
        }
        return throwError(() => err);
      })
    );
  }
}
```

Register it once in your app config and every GET request gets validation for free.

A few practical notes from wiring this into a real app:

- **Key by more than the URL when your data is.** If a header scopes the data (a branch id, an arena id, a tenant), the same URL returns different bodies — include that header value in the cache key, and register this interceptor *after* the one that sets the header.
- **Clear the map on logout and tenant/scope switches.** A `Map.clear()` is cheap; a stale cross-tenant body is not.
- **Let the server send `Cache-Control: no-store`** (as the decorator above does). Otherwise the browser's own HTTP cache can answer the conditional request before your interceptor ever sees the 304, and you end up with two caches disagreeing about ownership.
- **Bound the map** (a simple LRU cap of ~100 entries) so a long-lived session doesn't grow it forever.

---

## The Write Flow

When data changes, the version needs to increment. This happens in an **event handler** — not in the application service.

Here's the part that makes ABP a particularly good fit for this pattern: you don't even have to publish the event. ABP automatically raises **local entity events** — `EntityCreatedEventData<T>`, `EntityUpdatedEventData<T>`, `EntityDeletedEventData<T>` — on every repository write. The handler just subscribes:

```csharp
// Auto-discovered by ABP — no registration, no publish call anywhere.
public class RoomTypeVersionInvalidator :
    ILocalEventHandler<EntityCreatedEventData<RoomType>>,
    ILocalEventHandler<EntityUpdatedEventData<RoomType>>,
    ILocalEventHandler<EntityDeletedEventData<RoomType>>,
    ITransientDependency
{
    private readonly IResourceVersionStore _versions;

    public RoomTypeVersionInvalidator(IResourceVersionStore versions)
        => _versions = versions;

    public Task HandleEventAsync(EntityCreatedEventData<RoomType> e) => BumpAsync(e.Entity);
    public Task HandleEventAsync(EntityUpdatedEventData<RoomType> e) => BumpAsync(e.Entity);
    public Task HandleEventAsync(EntityDeletedEventData<RoomType> e) => BumpAsync(e.Entity);

    private async Task BumpAsync(RoomType entity)
    {
        // Bump every key the decorator can read this entity under.
        await _versions.IncrementAsync(ResourceKey.For("room-types", entity.TenantId));
        if (entity.ArenaId is not null)
            await _versions.IncrementAsync(ResourceKey.For("room-types", entity.TenantId, entity.ArenaId));
    }
}
```

Two details worth copying: the tenant id comes from **the entity on the event data**, not `ICurrentTenant` — the handler then works no matter what ambient context it runs in. And if a resource is served under more than one scope (a tenant-wide list *and* a per-arena list), the handler must bump **every** key the decorator reads — a key that is read but never bumped is a permanent 304.

The application service now publishes **nothing**. It has no knowledge of versions, ETags, or cache infrastructure — it doesn't even know an event exists:

```csharp
public class RoomTypeAppService : ApplicationService, IRoomTypeAppService
{
    public async Task<RoomTypeDto> CreateAsync(CreateRoomTypeDto input)
    {
        var roomType = new RoomType(GuidGenerator.Create(), input.Name);
        await _repository.InsertAsync(roomType);
        return ObjectMapper.Map<RoomType, RoomTypeDto>(roomType);
    }
}
```

### Why local events, not distributed events

My first instinct was a distributed event (`IDistributedEventHandler` + an ETO), since that's the bus I already had wired for cross-module messaging. It's the wrong tool here, for a timing reason: with the transactional outbox pattern, distributed events are published *after* the unit of work commits — by a background worker. That opens a window where the write is committed but the version hasn't incremented yet, and a client that GETs in that window receives a **304 for stale data**.

Local event handlers run *inside* the same unit of work. The version bump commits atomically with the business write — there is no window. In a modular monolith the invalidation is a same-process concern anyway; keep the distributed bus for what actually crosses module boundaries (read-model projections, integrations).

---

## Query Categories

Rather than deciding per-API, it helps to think in terms of categories. Each category has a default caching contract:

| Category | Client Cache | Version ETag | Redis | Example |
|---|---|---|---|---|
| Static Lookups | ✅ | ✅ | Optional | Countries, Room Types, Departments |
| Frequently Read | ✅ | ✅ | ❌ by default | Products, Visitor list |
| User-Specific | ✅ | ✅ | ❌ | My Profile, My Bookings |
| Real-Time | ❌ | ❌ | ❌ | Dashboard counters, live occupancy |

**Cache read queries. Never cache commands.**

```
GetRoomTypes      ✅ — decorate, add ETag
GetVisitor(id)    ✅ — decorate, ETag scoped to entity

CreateVisitor     ❌ — pass through, publish event
UpdateVisitor     ❌ — pass through, publish event
DeleteVisitor     ❌ — pass through, publish event
```

This distinction is what makes the decorator safe. Write methods on the decorated interface always delegate straight to the inner service. The decorator only intercepts reads.

---

## Why You Probably Don't Need Redis

Redis reduces work inside the backend — specifically, it skips the database query. Version-based ETag validation reduces network traffic — it skips the response body on unchanged data.

These solve different problems. And for most APIs, the bottleneck is not the database query. It is the payload.

A typical `GetRoomTypes` call:
- Database query: ~2ms on a warm connection
- Serialization + network transfer of 50 records: ~40ms

With ETag validation, the 304 path runs in ~1ms — the version lookup is a single indexed read. No body is transferred. The application service is never called.

With Redis, the database query is skipped, but you now have:
- Redis infrastructure to operate
- Cache warming on startup
- Eviction policy to tune
- Memory cost per cached item
- Serialization in and out of Redis

For data that costs 2ms to query, Redis saves 2ms per request and adds operational overhead indefinitely. That trade is rarely worth it.

The right rule is **Cost × Frequency**:

```
Room Types
  Database cost:  low (~2ms)
  Request frequency:  very high (every user, every navigation)
  → ETag validation is enough

Aggregated revenue report
  Database cost:  high (~800ms, complex joins)
  Request frequency:  low (managers, daily)
  → Redis justified
```

Start with ETag validation as the default. Add Redis when profiling shows a specific query is a measurable backend bottleneck.

---

## Cache Policies

Once you have the decorator and version store in place, you can formalize the decision into named policies. New modules pick a policy rather than wiring caching logic themselves.

```csharp
public sealed record CachePolicy(bool ClientCache, bool VersionEtag);

public static class CachePolicies
{
    public static readonly CachePolicy Lookup   = new(true,  true);   // the default for most read queries
    public static readonly CachePolicy Entity   = new(true,  true);   // same shape, semantically distinct (user-scoped data)
    public static readonly CachePolicy RealTime = new(false, false);  // no caching at any layer
}
```

Redis is deliberately **not** a flag on the policy record — it is never a default, so it doesn't belong in the contract every module inherits. When a specific query earns Redis (see the Cost × Frequency rule above), that's an explicit, local decision.

The decorator declares its policy as a constant and checks it in the read-through helper (`if (http is null || !Policy.VersionEtag) return await read();` — you saw this earlier):

```csharp
private static readonly CachePolicy Policy = CachePolicies.Lookup;
```

When a new module needs caching, the conversation becomes: "which policy fits?" rather than "how do we wire cache calls into this service?"

---

## What This Looks Like End to End

```
Angular
  │
  ├─ Has cached response + ETag "7"
  │
  ├─ GET /api/room-types
  │  If-None-Match: "7"
  ▼
ASP.NET Core
  │
  ├─ CachedRoomTypeAppService (Decorator)
  │   ├─ GetVersionAsync("room-types:t:<tenant>") → 7
  │   ├─ If-None-Match == "7" → true
  │   └─ flags HttpContext.Items[NotModified]
  │
  ├─ EtagResultFilter → 304 Not Modified, no body
  │
  └─ [RoomTypeAppService never called]

After a write:
  │
  ├─ CreateAsync → InsertAsync (no event code in the app service)
  │
  ├─ ABP raises EntityCreatedEventData<RoomType> — same unit of work
  │
  └─ RoomTypeVersionInvalidator → IncrementAsync → version = 8 (commits with the write)

Next Angular request:
  │
  ├─ If-None-Match: "7"
  │
  └─ GetVersionAsync → 8 ≠ "7"
      → 200 OK, ETag: "8", fresh body
      → Angular updates cache
```

The application service is called exactly once per cache miss. Everything else is handled in infrastructure with no application-layer involvement.

---

## The Outcome

- ✅ Application services contain only orchestration and business logic — no cache keys, no `GetAsync`, no `RemoveAsync`
- ✅ `services.Decorate` wires caching at the DI layer — application services never know they're being cached
- ✅ Version-based ETags eliminate redundant payload transfers without Redis for most APIs
- ✅ ABP's local entity events own invalidation — the version bump commits in the same unit of work as the write, and the application service publishes nothing
- ✅ Redis remains an option for genuinely expensive queries, not a default you drag into every module
- ✅ Cache policies give new modules a reusable contract instead of ad-hoc decisions

The default should always be: Angular cache + ETag validation. Add Redis only when profiling identifies a specific backend query that justifies the infrastructure cost. Start simple. Scale where the data tells you to.
