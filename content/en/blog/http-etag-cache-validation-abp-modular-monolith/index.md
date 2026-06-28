---
title: "Version-Based Cache Validation in ABP — Keeping the Application Layer Clean Without Redis"
slug: http-etag-cache-validation-abp-modular-monolith
description: "How to wire HTTP ETag validation and a Decorator pattern into an ABP modular monolith so caching becomes an infrastructure concern — and why you probably don't need Redis."
excerpt: "Every caching tutorial ends up polluting the application layer with GetAsync, SetAsync, and RemoveAsync. This post shows a different approach: a decorator that intercepts at the DI layer, version-based ETags that validate client caches without a round trip to the database, and why Redis becomes optional once you get the defaults right."
date: 2026-06-28T00:00:00+06:00
lastmod: 2026-06-28T00:00:00+06:00
draft: true
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
- [The write flow: domain events increment the version, the application service sees nothing](#the-write-flow)
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
    private readonly IRoomTypeAppService _inner;
    private readonly IResourceVersionStore _versions;
    private readonly IHttpContextAccessor _httpContext;

    public CachedRoomTypeAppService(
        IRoomTypeAppService inner,
        IResourceVersionStore versions,
        IHttpContextAccessor httpContext)
    {
        _inner = inner;
        _versions = versions;
        _httpContext = httpContext;
    }

    public async Task<List<RoomTypeDto>> GetListAsync()
    {
        var version = await _versions.GetVersionAsync("room-types");
        var etag = $"\"{version}\"";
        var request = _httpContext.HttpContext!.Request;
        var response = _httpContext.HttpContext!.Response;

        response.Headers.ETag = etag;

        if (request.Headers.IfNoneMatch == etag)
        {
            response.StatusCode = 304;
            return [];   // Angular will use its local cache
        }

        return await _inner.GetListAsync();
    }

    // Write methods pass straight through — no caching logic
    public Task<RoomTypeDto> CreateAsync(CreateRoomTypeDto input)
        => _inner.CreateAsync(input);

    public Task DeleteAsync(Guid id)
        => _inner.DeleteAsync(id);
}
```

Register it in your Infrastructure or Web module:

```csharp
public override void ConfigureServices(ServiceConfigurationContext context)
{
    context.Services.Decorate<IRoomTypeAppService, CachedRoomTypeAppService>();
}
```

That single line intercepts every resolution of `IRoomTypeAppService`. The application service stays exactly as it was — no cache key, no `GetAsync`, no `RemoveAsync`. The decorator handles validation and headers; the inner service handles the query.

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

A simple implementation stores versions in a database table or in-memory dictionary:

```csharp
public class DbResourceVersionStore : IResourceVersionStore, ITransientDependency
{
    private readonly IRepository<ResourceVersion, string> _repository;

    public async Task<long> GetVersionAsync(string resourceKey)
    {
        var entry = await _repository.FindAsync(resourceKey);
        return entry?.Version ?? 1;
    }

    public async Task IncrementAsync(string resourceKey)
    {
        var entry = await _repository.FindAsync(resourceKey)
                    ?? new ResourceVersion(resourceKey, 0);
        entry.Version++;
        await _repository.UpsertAsync(entry);
    }
}
```

The entity is minimal:

```csharp
public class ResourceVersion : Entity<string>
{
    public long Version { get; set; }
    public ResourceVersion(string key, long version) : base(key)
        => Version = version;
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

```typescript
@Injectable()
export class EtagInterceptor implements HttpInterceptor {
  private cache = new Map<string, { etag: string; body: unknown }>();

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (req.method !== 'GET') return next.handle(req);

    const entry = this.cache.get(req.url);
    const outgoing = entry
      ? req.clone({ setHeaders: { 'If-None-Match': entry.etag } })
      : req;

    return next.handle(outgoing).pipe(
      map(event => {
        if (event instanceof HttpResponse) {
          if (event.status === 304 && entry) {
            // return the cached body as if it were a fresh response
            return event.clone({ status: 200, body: entry.body });
          }
          const etag = event.headers.get('ETag');
          if (etag) this.cache.set(req.url, { etag, body: event.body });
        }
        return event;
      })
    );
  }
}
```

Register it once in your app module and every GET request gets validation for free.

---

## The Write Flow

When data changes, the version needs to increment. This happens in a **domain event handler** — not in the application service. The application service fires the event; the handler owns the invalidation.

```csharp
// Domain event — published automatically by ABP after a successful write
public class RoomTypeChangedEvent : EtoBase
{
    public string ResourceKey => "room-types";
}

// Handler — lives in Infrastructure, not Application
public class RoomTypeVersionInvalidator :
    IDistributedEventHandler<RoomTypeChangedEvent>,
    ITransientDependency
{
    private readonly IResourceVersionStore _versions;

    public RoomTypeVersionInvalidator(IResourceVersionStore versions)
        => _versions = versions;

    public async Task HandleEventAsync(RoomTypeChangedEvent eventData)
    {
        await _versions.IncrementAsync(eventData.ResourceKey);
    }
}
```

The application service publishes the event and returns. It has no knowledge of versions, ETags, or cache infrastructure:

```csharp
public class RoomTypeAppService : ApplicationService, IRoomTypeAppService
{
    public async Task<RoomTypeDto> CreateAsync(CreateRoomTypeDto input)
    {
        var roomType = new RoomType(GuidGenerator.Create(), input.Name);
        await _repository.InsertAsync(roomType);
        await _distributedEventBus.PublishAsync(new RoomTypeChangedEvent());
        return ObjectMapper.Map<RoomType, RoomTypeDto>(roomType);
    }
}
```

Write path is completely clean. The version increment is a side effect handled in infrastructure.

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
public static class CachePolicies
{
    // Client cache + ETag — the default for most read queries
    public static readonly CachePolicy Lookup = new(
        clientCache: true,
        versionEtag: true,
        redis: false
    );

    // Client cache + ETag — same as Lookup but semantically distinct (user-scoped data)
    public static readonly CachePolicy Entity = new(
        clientCache: true,
        versionEtag: true,
        redis: false
    );

    // No caching at any layer
    public static readonly CachePolicy RealTime = new(
        clientCache: false,
        versionEtag: false,
        redis: false
    );
}
```

The decorator reads the policy and adjusts its behaviour:

```csharp
public CachedRoomTypeAppService(
    IRoomTypeAppService inner,
    IResourceVersionStore versions,
    IHttpContextAccessor httpContext)
{
    _inner = inner;
    _versions = versions;
    _httpContext = httpContext;
    _policy = CachePolicies.Lookup;
}
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
  │   ├─ GetVersionAsync("room-types") → 7
  │   ├─ If-None-Match == "7" → true
  │   └─ 304 Not Modified — stops here
  │
  └─ [RoomTypeAppService never called]

After a write:
  │
  ├─ CreateAsync → publishes RoomTypeChangedEvent
  │
  └─ RoomTypeVersionInvalidator → IncrementAsync("room-types") → version = 8

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
- ✅ Domain event handlers own invalidation — the write path is as clean as the read path
- ✅ Redis remains an option for genuinely expensive queries, not a default you drag into every module
- ✅ Cache policies give new modules a reusable contract instead of ad-hoc decisions

The default should always be: Angular cache + ETag validation. Add Redis only when profiling identifies a specific backend query that justifies the infrastructure cost. Start simple. Scale where the data tells you to.
