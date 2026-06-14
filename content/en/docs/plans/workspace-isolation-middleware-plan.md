---
title: "Workspace Isolation Middleware — Plan"
description: "Plan for automatic sub-tenant workspace scoping — query filtering and entity stamping at the workspace level, sitting one layer below ABP multi-tenancy."
lead: "Automatic query filtering and entity stamping at the workspace level, sitting one layer below ABP multi-tenancy (Tenant = Business, Workspace = sub-entity of that business)."
date: 2026-06-15T00:00:00+06:00
lastmod: 2026-06-15T00:00:00+06:00
draft: false
images: []
menu:
  docs:
    parent: "plans"
weight: 20
toc: true
---

## Overview

Adds per-workspace request scoping to a multi-workspace ABP application — automatic query filtering and entity stamping at the workspace level, sitting one layer below ABP's multi-tenancy (Tenant = Business, Workspace = sub-entity of that business).

---

## Decision: Workspace Scoping is BackOffice-only

> **The EF Core `IWorkspace` global query filter and `SaveChanges` stamping live in `BackOfficeDbContext`
> ONLY. `PublicPortalDbContext` does NOT apply them.**

Rationale:

1. **PublicPortal's dominant read path is cross-workspace (and cross-tenant).** A marketplace listing every workspace across every business cannot use an ambient single-workspace filter — it would have to be disabled on nearly every marketplace query.
2. **`SaveChanges` stamping is dead weight / a corruption risk on a projection.** PublicPortal does no business writes; its read models are updated by **distributed event handlers** running in a background consumer context with no HTTP request / no subdomain, so the correct `WorkspaceId` comes from the **event payload**, not ambient request context. Auto-stamping from ambient context would either no-op or write the wrong workspace.
3. **Workspace-site scoping is better explicit.** On `{slug}.{domain}`, read models are denormalized and keyed by `WorkspaceId` for a single indexed lookup — `WHERE WorkspaceId = @id`, with the id supplied by the subdomain resolver via `ICurrentWorkspace.Id`.
4. **Isolation is already handled a level up** by ABP multi-tenancy (cross-business). A customer seeing another workspace's *public* availability is wrong data, not the security breach that a staff member seeing another workspace's bookings is.

| Piece | BackOffice | PublicPortal |
|---|---|---|
| EF query filter (`ShouldFilterEntity` / `CreateFilterExpression`) | ✅ keep | ❌ removed |
| `SaveChanges` stamping (`ApplyCurrentWorkspaceId`) | ✅ keep | ❌ removed |
| Subdomain resolver → `ICurrentWorkspace` | n/a | ✅ keep (workspace sites need to know which workspace) |
| `CurrentWorkspace` property on DbContext | ✅ | ✅ keep (for explicit read-side scoping) |
| Read models implement `IWorkspace` marker | ✅ scoped entities do | ❌ plain `WorkspaceId` property, set from ETO |
| Middleware registered in host | ✅ | ✅ (no subdomain on marketplace → no-op) |

PublicPortal keeps the workspace *context* (populated from the subdomain) but drops the *automatic filtering/stamping*: workspace-site read queries scope explicitly with `CurrentWorkspace.Id`; marketplace queries run unscoped.

---

## Why Workspace-Level Scoping?

```
Tenant (Business)
└── Workspace A   ← staff can be scoped to one workspace
└── Workspace B
└── Workspace C
```

- A business owner may manage multiple workspaces.
- BackOffice staff (Manager, Receptionist) are assigned to ONE workspace; their API calls must only see data for that workspace without every query needing explicit `WHERE WorkspaceId = ?`.
- PublicPortal serves each workspace's public site at `{slug}.{domain}` — the current workspace must be resolved from the subdomain for every request.

---

## Architecture

```
HTTP Request
    │
    ▼
[ABP Multi-Tenancy Middleware]       ← resolves Tenant (Business) first
    │
    ▼
[WorkspaceResolutionMiddleware]      ← lives in YourApp.Core
    │  runs pluggable IWorkspaceResolveContributor chain
    │  cache → DB fallback, no explicit TTL (uses ABP global cache settings)
    │
    ▼
ICurrentWorkspace.Id set in AsyncLocal (CurrentWorkspace singleton in YourApp.Core)
    │
    ▼
[EF Core DbContext]                  ← BackOfficeDbContext ONLY has the workspace filter
    │  global query filter: WHERE WorkspaceId = CurrentWorkspace.Id
    │  SaveChanges: stamps WorkspaceId on new IWorkspace entities
    │  (PublicPortalDbContext does NOT filter/stamp — see "Decision" above)
    ▼
AppService (BackOfficeAppService / PublicPortalAppService)
    │  protected ICurrentWorkspace CurrentWorkspace — available for explicit checks
    ▼
Handler returns data scoped to the workspace
```

---

## YourApp.Core Module

`YourApp.Core` is the right home for all cross-cutting workspace infrastructure — a shared module that neither BackOffice nor PublicPortal depends on directly, keeping the dependency direction clean.

### What goes in Core

```
modules/Core/
├── YourYourApp.Core.csproj
└── MultiWorkspace/
    ├── IWorkspace.cs
    ├── ICurrentWorkspace.cs
    ├── CurrentWorkspace.cs
    ├── WorkspaceDto.cs
    ├── IWorkspaceResolveContributor.cs
    ├── IWorkspaceResolveContext.cs
    ├── WorkspaceResolveContext.cs
    ├── WorkspaceResolveOptions.cs
    └── WorkspaceResolutionMiddleware.cs
WorkspaceCoreModule.cs
```

### What stays in each module

| Concern | Location |
|---------|----------|
| `WorkspaceIdHeaderResolveContributor` | `BackOffice.HttpApi` — knows the Workspace repository |
| `WorkspaceSubdomainResolveContributor` | `PublicPortal.HttpApi` — serves `*.{domain}` |
| `WorkspaceRouteResolveContributor` | `BackOffice.HttpApi` — admin route param |
| EF Core workspace query filter + stamping | Each module's `EntityFrameworkCore` project |
| `BackOfficeAppService.CurrentWorkspace` | `BackOffice.Application` |
| `PublicPortalAppService.CurrentWorkspace` | `PublicPortal.Application` |

---

## Dependency Graph Changes

```
YourApp.Core
    ↑
BackOffice.Domain.Shared   ← add project ref + DependsOn(WorkspaceCoreModule)
PublicPortal.Domain.Shared ← add project ref + DependsOn(WorkspaceCoreModule)
    ↑
BackOffice.Domain / PublicPortal.Domain   (already depend on their Domain.Shared — no change)
    ↑
BackOffice.HttpApi          ← add ref to YourApp.Core (for contributor base types)
PublicPortal.HttpApi        ← add ref to YourApp.Core
    ↑
AppHttpApiHostModule        ← register middleware + configure WorkspaceResolveOptions
```

---

## Layer 1 — YourApp.Core: Interfaces + Context

### `IWorkspace.cs`
```csharp
namespace YourYourApp.Core.MultiWorkspace;

public interface IWorkspace
{
    Guid? WorkspaceId { get; set; }
}
```

### `ICurrentWorkspace.cs`
```csharp
namespace YourYourApp.Core.MultiWorkspace;

public interface ICurrentWorkspace
{
    Guid?  Id          { get; }
    string Name        { get; }
    string Slug        { get; }   // subdomain slug — used by PublicPortal
    bool   IsAvailable { get; }

    IDisposable Change(Guid? id);
    IDisposable Change(Guid? id, string name);
    IDisposable Change(Guid? id, string name, string slug);
}
```

### `CurrentWorkspace.cs`
```csharp
using Volo.Abp.DependencyInjection;

namespace YourYourApp.Core.MultiWorkspace;

public class CurrentWorkspace : ICurrentWorkspace, ISingletonDependency
{
    private readonly AsyncLocal<WorkspaceCacheItem?> _current = new();

    public Guid?  Id          => _current.Value?.WorkspaceId;
    public string Name        => _current.Value?.Name!;
    public string Slug        => _current.Value?.Slug!;
    public bool   IsAvailable => Id.HasValue;

    public IDisposable Change(Guid? id)                              => Change(id, null, null);
    public IDisposable Change(Guid? id, string? name)               => Change(id, name, null);
    public IDisposable Change(Guid? id, string? name, string? slug)
    {
        var prev = _current.Value;
        if (id == prev?.WorkspaceId && name == prev?.Name && slug == prev?.Slug)
            return NullRestore.Instance;

        _current.Value = new WorkspaceCacheItem(id, name, slug);
        return new WorkspaceRestore(this, prev?.WorkspaceId, prev?.Name, prev?.Slug);
    }

    private sealed record WorkspaceCacheItem(Guid? WorkspaceId, string? Name, string? Slug);

    private sealed class WorkspaceRestore(
        CurrentWorkspace owner, Guid? id, string? name, string? slug) : IDisposable
    {
        public void Dispose() =>
            owner._current.Value = id.HasValue ? new WorkspaceCacheItem(id, name, slug) : null;
    }

    private sealed class NullRestore : IDisposable
    {
        public static readonly NullRestore Instance = new();
        private NullRestore() { }
        public void Dispose() { }
    }
}
```

### `WorkspaceDto.cs`  _(cache payload — keep small)_
```csharp
namespace YourYourApp.Core.MultiWorkspace;

public class WorkspaceDto
{
    public Guid   Id       { get; set; }
    public string Name     { get; set; } = default!;
    public string Slug     { get; set; } = default!;
    public Guid?  TenantId { get; set; }
}
```

---

## Layer 2 — YourApp.Core: Resolver Infrastructure + Middleware

### Resolver contracts
```csharp
// IWorkspaceResolveContext.cs
public interface IWorkspaceResolveContext
{
    Guid?  WorkspaceId   { get; set; }
    string WorkspaceSlug { get; set; }
    HttpContext GetHttpContext();
}

// IWorkspaceResolveContributor.cs
public interface IWorkspaceResolveContributor
{
    string Name { get; }
    Task ResolveAsync(IWorkspaceResolveContext context);
}

// WorkspaceResolveOptions.cs
public class WorkspaceResolveOptions
{
    public List<IWorkspaceResolveContributor> WorkspaceResolvers { get; } = [];
}
```

### `WorkspaceResolutionMiddleware.cs`

No explicit TTL on `SetAsync` — defers to ABP's global distributed cache options configured in `appsettings.json`.

```csharp
public class WorkspaceResolutionMiddleware(
    IOptions<WorkspaceResolveOptions> options,
    ILogger<WorkspaceResolutionMiddleware> logger) : IMiddleware, ITransientDependency
{
    private readonly WorkspaceResolveOptions _options = options.Value;

    public async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        var resolveCtx = new WorkspaceResolveContext(context);

        foreach (var resolver in _options.WorkspaceResolvers)
        {
            await resolver.ResolveAsync(resolveCtx);
            if (resolveCtx.WorkspaceId.HasValue)
            {
                logger.LogDebug("Workspace resolved by {Resolver}: {WorkspaceId}",
                    resolver.Name, resolveCtx.WorkspaceId.Value);
                break;
            }
        }

        if (!resolveCtx.WorkspaceId.HasValue)
        {
            await next(context);
            return;
        }

        await SetCurrentWorkspaceAndContinueAsync(context, next, resolveCtx);
    }

    private async Task SetCurrentWorkspaceAndContinueAsync(
        HttpContext context, RequestDelegate next, WorkspaceResolveContext resolveCtx)
    {
        var workspaceId   = resolveCtx.WorkspaceId!.Value;
        var services      = context.RequestServices;

        var cache            = services.GetRequiredService<IDistributedCache<WorkspaceDto, Guid>>();
        var currentTenant    = services.GetRequiredService<ICurrentTenant>();
        var currentWorkspace = services.GetRequiredService<ICurrentWorkspace>();

        var workspaceDto = await cache.GetAsync(workspaceId);

        if (workspaceDto is null)
        {
            logger.LogDebug("Workspace {WorkspaceId} not in cache, querying database.", workspaceId);

            using (currentTenant.Change(currentTenant.Id))
            {
                // IWorkspaceRepository is the Core contract; the EF implementation lives in
                // BackOffice.EntityFrameworkCore. Keeps dependency direction Core ← BackOffice.
                var repo = services.GetRequiredService<IWorkspaceRepository>();
                workspaceDto = await repo.FindByIdAsync(workspaceId);

                if (workspaceDto is not null)
                {
                    // No explicit TTL — respects global AbpDistributedCacheOptions
                    await cache.SetAsync(workspaceDto.Id, workspaceDto);
                    logger.LogDebug("Workspace {WorkspaceId} cached.", workspaceId);
                }
            }
        }

        if (workspaceDto is null)
        {
            logger.LogWarning("Workspace {WorkspaceId} not found in tenant.", workspaceId);
            await next(context);
            return;
        }

        using (currentWorkspace.Change(workspaceDto.Id, workspaceDto.Name, workspaceDto.Slug))
        {
            await next(context);
        }
    }
}
```

### `WorkspaceCoreModule.cs`
```csharp
[DependsOn(
    typeof(AbpDddDomainModule),
    typeof(AbpCachingModule),
    typeof(AbpAspNetCoreMvcModule)
)]
public class WorkspaceCoreModule : AbpModule
{
    // CurrentWorkspace is registered automatically via ISingletonDependency convention.
}
```

---

## Layer 3 — BackOffice.Domain.Shared: Depend on Core

**Edit** `BackOfficeDomainSharedModule.cs`:
```csharp
[DependsOn(
    typeof(AbpDddDomainSharedModule),
    typeof(WorkspaceCoreModule)   // ← add
)]
public class BackOfficeDomainSharedModule : AbpModule { }
```

**Edit** `BackOffice.Domain.Shared.csproj`:
```xml
<ProjectReference Include="..\..\..\..\modules\Core\YourYourApp.Core.csproj" />
```

---

## Layer 4 — PublicPortal.Domain.Shared: Depend on Core

**Edit** `PublicPortalDomainSharedModule.cs`:
```csharp
[DependsOn(
    typeof(AbpDddDomainSharedModule),
    typeof(WorkspaceCoreModule)   // ← add
)]
public class PublicPortalDomainSharedModule : AbpModule { }
```

Both modules now have `IWorkspace`, `ICurrentWorkspace`, and `CurrentWorkspace` available without any cross-module reference between BackOffice ↔ PublicPortal.

---

## Layer 5 — AppService Base Classes (both modules)

**Edit** `BackOffice.Application/BackOfficeAppService.cs`:
```csharp
public abstract class BackOfficeAppService : ApplicationService
{
    protected ICurrentWorkspace CurrentWorkspace =>
        LazyServiceProvider.LazyGetRequiredService<ICurrentWorkspace>();

    protected BackOfficeAppService()
    {
        LocalizationResource = typeof(BackOfficeResource);
        ObjectMapperContext  = typeof(BackOfficeApplicationModule);
    }
}
```

**Edit** `PublicPortal.Application/PublicPortalAppService.cs`:
```csharp
public abstract class PublicPortalAppService : ApplicationService
{
    protected ICurrentWorkspace CurrentWorkspace =>
        LazyServiceProvider.LazyGetRequiredService<ICurrentWorkspace>();

    protected PublicPortalAppService()
    {
        LocalizationResource = typeof(PublicPortalResource);
        ObjectMapperContext  = typeof(PublicPortalApplicationModule);
    }
}
```

---

## Layer 6 — EF Core: Workspace Query Filter (BackOfficeDbContext ONLY)

> **Applied to `BackOfficeDbContext` only.** `PublicPortalDbContext` keeps just the `CurrentWorkspace`
> property (for explicit read-side scoping) and omits `IsMultiWorkspaceFilterEnabled`, the `SaveChanges`
> overrides, `ApplyCurrentWorkspaceId`, `ShouldFilterEntity`, and `CreateFilterExpression`. See the
> "Decision: Workspace Scoping is BackOffice-only" section.

> **ABP 10.4.1 note:** `CreateFilterExpression<TEntity>` gained a second parameter vs. 9.x.
> Override is now `CreateFilterExpression<TEntity>(ModelBuilder modelBuilder, EntityTypeBuilder<TEntity> entityTypeBuilder)`
> and must forward both args to `base.CreateFilterExpression(...)`.

```csharp
// In BackOfficeDbContext
protected ICurrentWorkspace CurrentWorkspace =>
    LazyServiceProvider.LazyGetRequiredService<ICurrentWorkspace>();

protected bool IsMultiWorkspaceFilterEnabled =>
    DataFilter?.IsEnabled<IWorkspace>() ?? false;

public override int SaveChanges(bool acceptAllChangesOnSuccess)
{
    ApplyCurrentWorkspaceId();
    return base.SaveChanges(acceptAllChangesOnSuccess);
}

public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess,
    CancellationToken ct = default)
{
    ApplyCurrentWorkspaceId();
    return base.SaveChangesAsync(acceptAllChangesOnSuccess, ct);
}

private void ApplyCurrentWorkspaceId()
{
    if (CurrentWorkspace?.Id is null) return;
    var id = CurrentWorkspace.Id.Value;

    foreach (var entry in ChangeTracker.Entries()
        .Where(e => e.Entity is IWorkspace &&
                    (e.State == EntityState.Added || e.State == EntityState.Modified)))
    {
        entry.Property(nameof(IWorkspace.WorkspaceId)).CurrentValue = id;
        if (entry.State == EntityState.Modified)
            entry.Property(nameof(IWorkspace.WorkspaceId)).IsModified = false; // prevent drift
    }
}

protected override bool ShouldFilterEntity<TEntity>(IMutableEntityType entityType)
{
    if (typeof(IWorkspace).IsAssignableFrom(typeof(TEntity))) return true;
    return base.ShouldFilterEntity<TEntity>(entityType);
}

protected override Expression<Func<TEntity, bool>> CreateFilterExpression<TEntity>(
    ModelBuilder modelBuilder,
    EntityTypeBuilder<TEntity> entityTypeBuilder)
{
    var baseExpr = base.CreateFilterExpression<TEntity>(modelBuilder, entityTypeBuilder);
    if (!typeof(IWorkspace).IsAssignableFrom(typeof(TEntity))) return baseExpr;

    Expression<Func<TEntity, bool>> workspaceFilter = e =>
        !IsMultiWorkspaceFilterEnabled
        || CurrentWorkspace.Id == null
        || EF.Property<Guid?>(e, nameof(IWorkspace.WorkspaceId)) == CurrentWorkspace.Id;

    return baseExpr is null
        ? workspaceFilter
        : QueryFilterExpressionHelper.CombineExpressions(baseExpr, workspaceFilter);
}
```

Cross-workspace admin queries: `using (DataFilter.Disable<IWorkspace>()) { ... }`

---

## Layer 7 — Resolver Implementations

### A — `WorkspaceIdHeaderResolveContributor` (BackOffice.HttpApi)

Two employee caches — fast access-check list + full DTO list.

```csharp
public class WorkspaceIdHeaderResolveContributor : IWorkspaceResolveContributor, ITransientDependency
{
    public const string HeaderName      = "X-Workspace-Id";
    public const string ContributorName = "WorkspaceIdHeader";
    public string Name => ContributorName;

    private readonly IDistributedCache<List<Guid>, Guid>                    _employeeWorkspaceIdCache;
    private readonly IDistributedCache<List<WorkspaceEmployeeDto>, Guid>    _employeeWorkspaceDtoCache;
    private readonly ICurrentUser _currentUser;
    private readonly ILogger<WorkspaceIdHeaderResolveContributor> _logger;

    public async Task ResolveAsync(IWorkspaceResolveContext context)
    {
        var httpContext = context.GetHttpContext();
        var headerVal   = httpContext.Request.Headers[HeaderName].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(headerVal)) return;

        if (!Guid.TryParse(headerVal, out var workspaceId)) return;

        var employeeId       = _currentUser.Id.GetValueOrDefault();
        var accessibleSpaces = await _employeeWorkspaceIdCache.GetAsync(employeeId);

        if (accessibleSpaces?.Any() == true && !accessibleSpaces.Contains(workspaceId))
        {
            _logger.LogWarning(
                "User {UserId} attempted to access unauthorized workspace {WorkspaceId}",
                employeeId, workspaceId);
            return;
        }

        _logger.LogDebug("Workspace {WorkspaceId} resolved from header.", workspaceId);
        context.WorkspaceId = workspaceId;
    }
}
```

`WorkspaceEmployeeDto`: `{ Guid WorkspaceId; string WorkspaceName; }` — small DTO. Cache keyed by `UserId`. No explicit TTL.

### B — `WorkspaceSubdomainResolveContributor` (PublicPortal.HttpApi)

Two caches (slug → Guid first, then the main WorkspaceDto cache). No explicit TTL.

```csharp
public class WorkspaceSubdomainResolveContributor : IWorkspaceResolveContributor, ITransientDependency
{
    public const string ContributorName = "WorkspaceSubdomain";
    public string Name => ContributorName;

    private readonly IDistributedCache<WorkspaceDto, string> _cacheBySlug;
    private readonly IDistributedCache<WorkspaceDto, Guid>   _cacheByGuid;
    private readonly IRepository<Workspace, Guid>            _workspaceRepo;
    private readonly IConfiguration                          _config;

    public async Task ResolveAsync(IWorkspaceResolveContext context)
    {
        var host = context.GetHttpContext().Request.Host.Host;
        var slug = ExtractSlug(host);
        if (slug is null) return;

        var dto = await _cacheBySlug.GetAsync(slug);
        if (dto is not null)
        {
            context.WorkspaceId   = dto.Id;
            context.WorkspaceSlug = dto.Slug;
            return;
        }

        var workspace = await _workspaceRepo.FindBySlugAsync(slug);
        if (workspace is null) return;

        dto = new WorkspaceDto { Id = workspace.Id, Name = workspace.Name, Slug = workspace.Slug, TenantId = workspace.TenantId };
        await _cacheBySlug.SetAsync(slug,          dto);
        await _cacheByGuid.SetAsync(workspace.Id,  dto);

        context.WorkspaceId   = workspace.Id;
        context.WorkspaceSlug = workspace.Slug;
    }

    private string? ExtractSlug(string host)
    {
        var rootDomain = _config["RootDomain"] ?? "example.com";
        if (!host.EndsWith($".{rootDomain}", StringComparison.OrdinalIgnoreCase)) return null;
        var sub = host[..^(rootDomain.Length + 1)];
        return string.IsNullOrEmpty(sub) || sub == "www" ? null : sub;
    }
}
```

### C — `WorkspaceRouteResolveContributor` (BackOffice.HttpApi, optional)

```csharp
// Reads workspaceId from route values or query string.
// Only runs if no workspace was resolved by header.
// Gate behind BackOffice.Workspaces.CrossWorkspaceAccess permission at call site.
```

---

## Caching Strategy

No explicit TTL anywhere. TTL is configured globally via ABP:

```json
// appsettings.json
"DistributedCache": {
  "KeyPrefix": "YourApp:",
  "GlobalCacheEntryOptions": {
    "AbsoluteExpirationRelativeToNow": "00:10:00"
  }
}
```

| Cache | Key type | Owned by | Purpose |
|-------|----------|----------|---------|
| `IDistributedCache<WorkspaceDto, Guid>` | `WorkspaceId` | Middleware + subdomain contributor | Main workspace metadata lookup |
| `IDistributedCache<WorkspaceDto, string>` | `Slug` | Subdomain contributor | Slug → WorkspaceDto before Guid is known |
| `IDistributedCache<List<Guid>, Guid>` | `UserId` | Header contributor | Fast access-check (ID list only) |
| `IDistributedCache<List<WorkspaceEmployeeDto>, Guid>` | `UserId` | Header contributor | Full employee-workspace DTO list |

**Cache invalidation** on `WorkspaceUpdatedEto`:
```csharp
await _cacheByGuid.RemoveAsync(eto.Id);
await _cacheBySlug.RemoveAsync(eto.OldSlug);
if (eto.Slug != eto.OldSlug)
    await _cacheBySlug.RemoveAsync(eto.Slug);
```

On employee-workspace assignment change: evict both employee caches keyed by affected `UserId`.

---

## Module Registration

### `BackOfficeHttpApiModule` — header + route contributors
```csharp
Configure<WorkspaceResolveOptions>(options =>
{
    options.WorkspaceResolvers.Add(context.Services
        .GetRequiredService<WorkspaceIdHeaderResolveContributor>());
    options.WorkspaceResolvers.Add(context.Services
        .GetRequiredService<WorkspaceRouteResolveContributor>());
});
```

### `PublicPortalHttpApiModule` — subdomain contributor
```csharp
Configure<WorkspaceResolveOptions>(options =>
{
    options.WorkspaceResolvers.Add(context.Services
        .GetRequiredService<WorkspaceSubdomainResolveContributor>());
});
```

### `AppHttpApiHostModule` — register middleware
```csharp
// OnApplicationInitialization:
app.UseMultiTenancy();
app.UseMiddleware<WorkspaceResolutionMiddleware>();  // ← after tenancy, before UoW
app.UseUnitOfWork();
```

---

## Entity Usage

### The `Workspace` aggregate (`BackOffice.Domain/Workspaces/Workspace.cs`)

```csharp
// Workspace itself does NOT implement IWorkspace — it IS the workspace, not an entity owned by one.
public class Workspace : FullAuditedAggregateRoot<Guid>, IMultiTenant
{
    public Guid?  TenantId    { get; private set; }
    public string Name        { get; private set; }   // max 128
    public string Slug        { get; private set; }   // max 64, unique per tenant
    public string Description { get; private set; }   // max 1024, nullable
    public bool   IsActive    { get; private set; }

    private Workspace() { }                            // for ORM
    public Workspace(Guid id, Guid? tenantId, string name, string slug, string description = null);
    public Workspace SetName(string name);
    public Workspace SetSlug(string slug);
    public Workspace SetDescription(string description);
    public void Activate();
    public void Deactivate();
}
```

- Consts in `BackOffice.Domain.Shared/Workspaces/WorkspaceConsts.cs`.
- Mapped with unique index `(TenantId, Slug)`, `IsActive` default `true`.

### Workspace-scoped entities

```csharp
// Any entity scoped to a workspace — implements IWorkspace from YourApp.Core
public class Ground : FullAuditedAggregateRoot<Guid>, IMultiTenant, IWorkspace
{
    public Guid? TenantId    { get; set; }
    public Guid? WorkspaceId { get; set; }   // ← IWorkspace (BackOffice filter scopes on this)
    // ...
}

public class Booking : FullAuditedAggregateRoot<Guid>, IMultiTenant, IWorkspace
{
    public Guid? TenantId    { get; set; }
    public Guid? WorkspaceId { get; set; }
    // ...
}
```

PublicPortal read models carry a **plain** `Guid WorkspaceId` property (NOT the `IWorkspace` marker) set explicitly from event payloads — they are not auto-filtered.

---

## Security / Validation

| Resolver | Validation |
|----------|-----------|
| Header | `_employeeWorkspaceIdCache` checked; unauthorized access logged + silently dropped |
| Subdomain | Slug must resolve to a workspace in the current tenant (repo.FindBySlugAsync scoped by tenancy) |
| Route | Permission gate: `BackOffice.Workspaces.CrossWorkspaceAccess` (owner/admin only) |

---

## Angular BackOffice Changes

### Existing Angular Infrastructure

| File | What it does |
|------|-------------|
| `theme/services/workspace-context.service.ts` | Angular signal-based workspace selection; `localStorage('app.selectedWorkspace')`; auto-selects single workspace |
| `theme/sidebar/workspace-switcher/workspace-switcher.component.ts` | Sidebar dropdown for switching workspaces |
| `shared/models/workspace.model.ts` | `Workspace` interface, `PagedResult<T>` |
| `shared/services/workspace.service.ts` | Abstract `WorkspaceService` DI token |

**`WorkspaceSelection` type:**
```ts
export type WorkspaceSelection = { mode: 'all' } | { mode: 'single'; workspaceId: string };
```
`mode: 'all'` → no header sent → backend cross-workspace view (owner)  
`mode: 'single'` → `X-Workspace-Id` header sent → backend scoped view (staff)

### Missing — Angular Additions

#### A — HTTP Interceptor

**New**: `src/app/shared/interceptors/workspace-header.interceptor.ts`

```ts
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { WorkspaceContextService } from '../../theme/services/workspace-context.service';
import { environment } from '../../../environments/environment';

export const workspaceHeaderInterceptor: HttpInterceptorFn = (req, next) => {
  const apiBase = environment.apis['default'].url;
  if (!req.url.startsWith(apiBase)) return next(req);  // skip auth/external calls

  const sel = inject(WorkspaceContextService).selection();
  if (sel.mode === 'single') {
    req = req.clone({ setHeaders: { 'X-Workspace-Id': sel.workspaceId } });
  }
  return next(req);
};
```

**Edit** `app.config.ts`:
```ts
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { workspaceHeaderInterceptor } from './shared/interceptors/workspace-header.interceptor';

// Add to providers:
provideHttpClient(withInterceptors([workspaceHeaderInterceptor])),
```

> **ABP note**: Verify whether `provideAbpCore` internally calls `provideHttpClient`. If it does, use `HTTP_INTERCEPTORS` multi-token instead of `withInterceptors`.

#### B — Workspace-Required Route Guard

**New**: `src/app/shared/guards/workspace-required.guard.ts`

```ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { WorkspaceContextService } from '../../theme/services/workspace-context.service';

export const workspaceRequiredGuard: CanActivateFn = () => {
  const ctx    = inject(WorkspaceContextService);
  const router = inject(Router);

  if (ctx.selection().mode === 'single') return true;
  if (ctx.isSingleWorkspace()) return true;   // auto-selected — guard passes

  return router.createUrlTree(['/workspaces'], { queryParams: { selectFirst: true } });
};
```

Apply to workspace-specific pages:
```ts
// app.routes.ts
{ path: 'schedule',            canActivate: [workspaceRequiredGuard], loadComponent: () => ... },
{ path: 'workspaces/:id/items', canActivate: [workspaceRequiredGuard], loadComponent: () => ... },
```

---

## End-to-End Flow (Angular BackOffice → Backend)

```
Staff selects workspace in WorkspaceSwitcherComponent
    → WorkspaceContextService.select({ mode: 'single', workspaceId })
    → persisted to localStorage

Staff opens Schedule page
    → workspaceRequiredGuard: mode='single' → pass
    → ScheduleComponent calls BookingService.getSchedule()
    → workspaceHeaderInterceptor: appends X-Workspace-Id header

Backend:
    → WorkspaceResolutionMiddleware: reads X-Workspace-Id
    → WorkspaceIdHeaderResolveContributor: validates employee access via cache
    → cache hit: WorkspaceDto loaded without DB
    → ICurrentWorkspace.Change(id, name, slug) — AsyncLocal set
    → EF Core query filter: WHERE WorkspaceId = <id>
    → Only this workspace's data returned

Angular renders schedule grid scoped to the selected workspace.
```

---

## Implementation Checklist

- [ ] Create `YourApp.Core` project with `MultiWorkspace/` folder (all interfaces + middleware)
- [ ] Register `YourApp.Core` in solution + add `WorkspaceCoreModule` `[DependsOn]`
- [ ] Wire `BackOffice.Domain.Shared` + `PublicPortal.Domain.Shared` → `WorkspaceCoreModule`
- [ ] Add `protected ICurrentWorkspace CurrentWorkspace` to both AppService base classes
- [ ] Add EF Core filter + SaveChanges stamping to `BackOfficeDbContext` ONLY
- [ ] Implement `WorkspaceIdHeaderResolveContributor` in `BackOffice.HttpApi`
- [ ] Implement `WorkspaceSubdomainResolveContributor` in `PublicPortal.HttpApi`
- [ ] Implement optional `WorkspaceRouteResolveContributor` in `BackOffice.HttpApi`
- [ ] Register contributors in both HttpApi modules via `WorkspaceResolveOptions`
- [ ] Register `app.UseMiddleware<WorkspaceResolutionMiddleware>()` in host (between tenancy and UoW)
- [ ] Add `DistributedCache.GlobalCacheEntryOptions` (10 min TTL) to host `appsettings.json`
- [ ] Create `Workspace` aggregate + consts + EF mapping + migration
- [ ] Implement `WorkspaceRepository : IWorkspaceRepository` via `IDbContextProvider<BackOfficeDbContext>`
- [ ] Create Angular `workspace-header.interceptor.ts` + register in `app.config.ts`
- [ ] Create Angular `workspace-required.guard.ts` + apply to workspace-specific routes
- [ ] Add `IWorkspace` to real scoped entities when they're created
- [ ] Integration test: `X-Workspace-Id` header → verify BackOffice EF filter scopes results

---

## Key Design Decisions

| Concern | Decision | Why |
|---------|----------|-----|
| Resolution strategies | Header + Subdomain + Route | Different callers need different resolution paths |
| Slug cache | Separate slug → Guid cache | Subdomain resolution knows slug before Guid; avoids extra DB round-trip |
| Extra context field | Slug on `ICurrentWorkspace` | PublicPortal needs the slug, not just the id |
| Caching | No explicit TTL anywhere | Defer to global `AbpDistributedCacheOptions` in `appsettings.json` |
| Employee caches | Two: `List<Guid>` (fast check) + `List<EmployeeWorkspaceDto>` (full DTO) | Access check uses only IDs; full DTO only needed when richer context is required |
| Filter scope | BackOffice only | PublicPortal is a projection — auto-filtering would require disabling on nearly every read |
| Repository coupling | `IWorkspaceRepository` contract in Core, EF impl in BackOffice | Keeps dependency direction Core ← BackOffice; avoids cycle |
| ABP version | 10.4.1 | `CreateFilterExpression` gained `EntityTypeBuilder<TEntity>` second param vs. earlier versions |
