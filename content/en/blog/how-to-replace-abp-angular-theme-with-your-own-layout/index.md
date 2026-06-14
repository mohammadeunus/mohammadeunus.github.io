---
title: "How to Replace the ABP Angular Theme With Your Own Layout"
description: "ABP Angular ships with LeptonX, but replacing it with your own layout is simpler than it looks — one service call, one component, and the rest is just Angular."
excerpt: "You don't have to live with LeptonX. ABP Angular gives you a clean hook to swap the application layout entirely — while keeping the account pages, permissions, and menu wiring untouched."
date: 2026-03-14T00:00:00+06:00
lastmod: 2026-03-14T00:00:00+06:00
draft: false
images: []
categories: ["Development", "ABP Framework", "Angular"]
tags: ["ABP Framework", "Angular", "LeptonX", "Theme", "Layout", "UI", "Frontend", "Custom Theme"]
contributors: []
pinned: false
homepage: false
---

ABP Angular ships with LeptonX Lite as the default theme on the free tier (the full LeptonX is part of the commercial license). It is functional, it covers login pages, it handles the menu and user dropdown. But on most real projects you will eventually want your own sidebar, your own topbar, your own brand — and LeptonX Lite is not designed to be heavily customised. It is designed to be replaced.

The good news is that ABP gives you a clean, documented way to do exactly that.

---

## The Mechanism — ReplaceableComponentsService

ABP Angular uses a component registry. Every major UI piece — the application layout, the account layout, the navbar — has a key. You can swap out what renders for any key by registering your own component.

For the main application layout, you do this in `AppComponent.ngOnInit`:

```ts
this.replaceableComponents.add({
  component: MyLayoutComponent,
  key: eThemeLeptonXComponents.ApplicationLayout, // same key for both Lite and full LeptonX
});
```

That one call is the entire mechanism. From that point, `<abp-dynamic-layout>` in the root template renders your component instead of LeptonX's for every route marked `layout: eLayoutType.application`.

**LeptonX Lite stays installed.** You are not removing it — it still provides the account layout (login, register, forgot password pages) and the base styles. You only replace the application shell. The account layout can be swapped the same way later if needed via `eThemeLeptonXComponents.AccountLayout`.

---

## What Your Layout Component Needs

Your layout component is a standard standalone Angular component. It needs three things:

1. **A `<router-outlet />`** — where page content renders
2. **Your sidebar** — build it however you want
3. **Your topbar** — page title, user menu, logout

For the menu, do not hardcode it. Use ABP's `RoutesService` — it already knows about every registered route, its icon, its display name, and whether the current user has permission to see it. Iterate over `routesService.flat` (filtering visible items) and your sidebar will automatically include everything ABP and your own modules register, including Administration, Identity, Tenants, and Settings.

For the current user (name, avatar, logout), use `ConfigStateService.getDeep('currentUser')` and `AuthService.logout()`.

---

## Folder Structure That Works

Keep all theme code in one place:

```
src/app/theme/
├── application-layout/   ← the component you register
├── sidebar/              ← menu, collapse state
├── topbar/               ← title, user dropdown
└── theme.scss            ← design tokens, CSS variables
```

A `SidebarService` (singleton) holds collapsed state and mobile drawer state. Components read from it — nothing manages sidebar state inline.

---

## Which UI Library

The replacement mechanism is library-agnostic. What you put inside the layout component is entirely up to you.

**Bootstrap + custom SCSS** — already present in ABP via `theme.shared`. Good choice if you want to keep the dependency tree small. Enough for a sidebar, topbar, and dropdown without adding anything.

**Ng-Zorro (Ant Design)** — `nz-layout`, `nz-sider`, `nz-header`, `nz-menu` map cleanly to a sidebar/topbar shell. The collapsed sidebar behavior is built into `nz-sider`.

**PrimeNG + Tailwind** — works well for teams already using PrimeNG for data tables and forms. The layout itself uses Tailwind for structure; PrimeNG handles UI components inside pages.

Pick one and be consistent. The layout replacement does not care which you choose.

---

## What to Keep in Mind

**Account layout is separate.** Login and register pages use `eThemeLeptonXComponents.AccountLayout`. If you do not replace it, they keep the LeptonX look. That is usually fine for a first pass.

**Mobile needs explicit handling.** On desktop the sidebar is fixed and the content shifts. On mobile it becomes an overlay drawer triggered by a hamburger in the topbar. Build this into `SidebarService` from the start — retrofitting it later is painful.

**LeptonX base styles still apply.** Your custom SCSS goes on top. Use CSS custom properties for your design tokens (sidebar width, brand colors) so the collapsed/expanded transition is just a variable change.

**The registration must run before routing resolves.** `AppComponent.ngOnInit` is the right place. If it runs after the first route renders, the default layout flashes briefly before switching.

---

## The Short Version

1. Create a standalone layout component with sidebar, topbar, and `<router-outlet />`.
2. In `AppComponent.ngOnInit`, call `replaceableComponents.add` with your component and `eThemeLeptonXComponents.ApplicationLayout`.
3. Build your sidebar menu from `RoutesService` — do not hardcode it.
4. Use `ConfigStateService` and `AuthService` for user info and logout.
5. Keep LeptonX installed — it still owns the account pages.

That is it. The rest is just building the layout you actually want.
