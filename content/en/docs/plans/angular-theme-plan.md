---
title: "Angular Custom Theme / Layout Replacement — Plan"
description: "Plan for replacing the LeptonX application layout with a custom theme featuring a sidebar with arena switcher."
lead: "Replace the LeptonX application layout with a custom theme featuring a custom sidebar whose top element is an arena switcher."
date: 2026-03-14T00:00:00+06:00
lastmod: 2026-03-14T00:00:00+06:00
draft: false
images: []
menu:
  docs:
    parent: "plans"
weight: 10
toc: true
---

> Target: `new/angular`. Replace the LeptonX application layout with our own theme featuring a
> custom sidebar whose **top element is an arena switcher** — a tenant (business) can own several
> arenas and must be able to manage one arena or **all arenas together** from one dropdown.
> Reference implementation studied: `H:\wafi\SwiftAccessHub\angular` (PrimeNG-based custom theme).
> This is a prerequisite (step 0) for `.claude/plan/ANGULAR_MVP_PLAN.md` — the MVP pages render
> inside this layout and filter by the selected arena.

## How layout replacement works (verified in SwiftAccessHub)

1. Build a standalone layout component (sidebar + topbar + `<router-outlet/>`).
2. In `app.component.ts` `ngOnInit`, register it:
   ```ts
   replaceableComponents.add({
     component: AmarArenaApplicationLayoutComponent,
     key: eThemeLeptonXComponents.ApplicationLayout,   // from '@volosoft/abp.ng.theme.lepton-x'
   });
   ```
   `<abp-dynamic-layout/>` in the root template then renders OUR layout for every route with
   `layout: eLayoutType.application`.
3. LeptonX stays installed: it still provides the **Account layout** (login/register pages) and
   base styles. We only replace `ApplicationLayout` (Account layout can be themed later the same
   way via `eThemeLeptonXComponents.AccountLayout`).
4. The custom sidebar builds its menu from ABP's `RoutesService` (+ `PermissionService` for
   visibility), so existing ABP menu registrations (Administration, Identity, Tenants, Settings)
   and our `route.provider.ts` entries appear automatically — no duplicate menu definition.

**Deliberate deviation from the reference**: SwiftAccessHub pulls in PrimeNG for its theme.
We will NOT add PrimeNG — Bootstrap 5 (already shipped with ABP theme.shared) + our own SCSS
is enough for a sidebar/topbar/dropdown, and keeps the dependency tree small. If we later want
a component library, that's a separate decision.

## Folder structure (new `theme/` folder)

```
src/app/theme/
├── application-layout/
│   ├── application-layout.component.ts|html|scss   # shell: sidebar + topbar + content outlet
├── sidebar/
│   ├── sidebar.component.ts|html|scss               # menu from RoutesService, collapse, mobile drawer
│   └── arena-switcher/
│       └── arena-switcher.component.ts|html|scss    # THE dropdown (top of sidebar)
├── top-navbar/
│   └── top-navbar.component.ts|html|scss            # page title/breadcrumb, user menu (profile, logout)
├── services/
│   ├── sidebar.service.ts                           # collapsed state (signal), mobile drawer, widths
│   └── arena-context.service.ts                     # selected arena state (see below)
└── theme.scss                                       # design tokens: colors, sidebar width vars
```

## Arena switcher (the core requirement)

**`ArenaContextService`** (singleton, `providedIn: 'root'`):

```ts
type ArenaSelection = { mode: 'all' } | { mode: 'single'; arenaId: string };

selection: Signal<ArenaSelection>          // default 'all'
selectedArena: Signal<Arena | null>        // resolved from ArenaService list
arenas: Signal<Arena[]>                    // loaded once from ArenaService (dummy for now)
select(selection: ArenaSelection): void    // updates signal + persists
```

- Persisted to `localStorage` (`amararena.selectedArena`) per user; restored on boot; falls back
  to 'all' if the stored arena no longer exists.
- **Single-arena tenants**: if the tenant has exactly one arena, the switcher renders as a static
  label (no dropdown) and selection is forced to that arena.
- Pages don't talk to the switcher — they inject `ArenaContextService` and react to the signal
  (dashboard stats, schedule grid, bookings list all filter by it; 'all' = no filter, with an
  arena column/grouping shown where relevant).
- When real APIs arrive: selection becomes a `arenaId?` query param on BackOffice calls; service
  is unchanged. (Tenant resolution itself stays ABP's — this is intra-tenant scoping only.)

**Dropdown UI** (top of sidebar, above the menu):
- Collapsed sidebar → shows arena initial/icon only; expanded → arena name + chevron.
- Items: **"All arenas"** (with count badge) + one item per active arena (name, city).
- Bottom action inside dropdown: "+ New arena" → routes to `/arenas` create flow (from MVP plan).

**Dependency**: needs `Arena` model + `ArenaService` abstract class + dummy implementation.
These are defined in `ANGULAR_MVP_PLAN.md` (shared layer) — that shared-layer step moves here
(built together with the theme), the MVP plan then consumes it.

## Layout behavior

- **Desktop**: fixed left sidebar, 260px expanded / 72px collapsed (icons + tooltips), state in
  `SidebarService` + localStorage. Content area shifts via CSS variable.
- **Mobile (≤768px)**: sidebar becomes an overlay drawer, hamburger in the top navbar.
- **Top navbar**: hamburger (mobile), current page title from `RoutesService`, right side =
  current user dropdown (`ConfigStateService.getDeep('currentUser')`): profile → ABP account
  manage, logout → `AuthService.logout()`. Language switcher omitted for MVP (English only).
- Errors/toasts: keep ABP theme.shared defaults (no custom toaster — reference's PrimeNG toaster
  is part of what we're not copying).

## Implementation order

1. `theme/` skeleton: `theme.scss` tokens, `SidebarService`, layout shell component with empty
   sidebar/topbar; register via `ReplaceableComponentsService`; verify home page renders in it.
2. Sidebar menu: render `RoutesService` tree (visible items only), active-route highlight,
   collapse/expand, mobile drawer.
3. Shared layer for arenas: `Arena` model, abstract `ArenaService`, `DummyArenaService` with
   seed data (3 Dhaka arenas), provider wiring. (Pulled forward from the MVP plan.)
4. `ArenaContextService` + arena-switcher component at the top of the sidebar; persistence +
   single-arena behavior.
5. Top navbar: title, user dropdown, logout.
6. `ng build` green; manual smoke test (`ng serve`) — note: login against the backend still
   requires the PostgreSQL fix (known issue in CLAUDE.md); layout can be verified on the home
   route which doesn't require auth.

## Out of scope (this pass)

- Replacing the Account (login) layout — LeptonX default stays for now.
- Dark mode, language switcher, notifications bell.
- Permission-based menu filtering beyond what `RoutesService` already provides (real permissions
  arrive with BackOffice policies).
