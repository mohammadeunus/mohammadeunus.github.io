---
title: "Model Context Protocol Series 4 — Serving ChatGPT and Claude from One MCP Server"
slug: mcp-series-4-serving-chatgpt-claude-one-mcp-server
description: "I built an MCP server for Claude across three posts. Then the question came: can ChatGPT use it too? The answer was one server, not two — and the hardest part I built for Claude turned out to be unnecessary for ChatGPT."
excerpt: "After building an OAuth-secured MCP server for Claude, the obvious next ask was ChatGPT support. I expected to build a second server. I didn't have to — and the bridge middleware that cost me the most effort for Claude wasn't needed at all."
date: 2026-06-18T00:00:00+06:00
lastmod: 2026-06-18T00:00:00+06:00
draft: true
weight: 50
images: []
categories: ["Development", "AI", "MCP", ".NET", "Security"]
tags: ["MCP", "Model Context Protocol", "ChatGPT", "OpenAI", "OAuth", "OpenIddict", "ASP.NET Core", "Claude", "Connectors", "Developer Mode"]
contributors: []
pinned: false
homepage: false
series: "MCP Series"
series_weight: 4
---

After three posts building and securing an MCP server for Claude, a colleague asked the obvious question: can ChatGPT use it too? I assumed yes, eventually — after another week of OAuth plumbing, a forked server, and a pile of special-casing I didn't want to write.

It took an afternoon. One server, no fork. And the single most complex piece I built for Claude — the bridge middleware that tamed its random localhost ports — was completely unnecessary for ChatGPT.

Here's what this post covers:

- [Why the MCP protocol layer is genuinely vendor-neutral — one server, both clients, no special-casing](#one-server-or-two)
- [The one fact that explains everything: Claude runs on your laptop, ChatGPT runs in OpenAI's cloud](#the-one-difference-that-explains-everything)
- [Why the bridge middleware isn't needed for ChatGPT — and the one-line gate that kept it from interfering](#why-the-bridge-middleware-isnt-needed)
- [The only config change that actually matters: one new OAuth client with a fixed redirect URI](#what-you-actually-have-to-change)
- [DCR versus Client ID Metadata Documents — two registration paths and which one to reach for](#the-dcr-endpoint-dcr-vs-cimd)
- [What didn't change at all: transport, JWT validation, CORS, discovery, bearer token forwarding](#what-didnt-change-at-all)
- [Two ChatGPT-specific platform gotchas worth knowing before you promise anything to stakeholders](#two-chatgpt-specific-gotchas)

---

## One Server or Two?

The short answer: **one server.**

MCP is a specification. The transport, the JSON-RPC handshake, the `tools/list` and `tools/call` methods, the tool schemas — all of that is vendor-neutral. Claude and ChatGPT are both MCP clients speaking the same protocol to the same `/mcp` endpoint. Nothing in the tool layer cares who is calling.

The only place the two clients diverge is **OAuth client registration** — how each one identifies itself and where it expects to be redirected after login. And even there, ChatGPT turns out to be the *simpler* of the two.

To understand why, you have to look at where each client actually runs.

---

## The One Difference That Explains Everything

Claude Code runs on your laptop. When it starts an OAuth flow, it spins up a temporary listener on a **random localhost port** — `http://localhost:39616/callback` one day, `http://localhost:51244/callback` the next. That randomness is what forced the entire bridge middleware in Series 2: OpenIddict demands pre-registered redirect URIs, and you cannot pre-register a port you cannot predict.

ChatGPT does not run on your laptop. The connector lives in **OpenAI's cloud**. When it performs the OAuth handshake, it always redirects to a single, fixed, public URL:

```
https://chatgpt.com/connector_platform_oauth_redirect
```

That is the whole difference. One client has an unpredictable redirect target; the other has a stable, documented one. Everything else follows from that.

{{< figure src="claude-vs-chatgpt-oauth.svg" alt="Claude runs on the laptop with a random localhost callback needing the bridge middleware, while ChatGPT runs in the cloud with one fixed redirect URI — both hitting the same MCP server" >}}

> A note on stability: OAuth connector details on OpenAI's side have been moving quickly — the platform has been shifting from Dynamic Client Registration toward Client ID Metadata Documents. Treat the exact redirect URI above as something to confirm against the current OpenAI connector docs before you ship, not as a constant carved in stone.

---

## Why the Bridge Middleware Isn't Needed

This is the satisfying part.

The bridge middleware exists for exactly one reason: to absorb Claude's random localhost ports by stashing the real callback in a cookie and rewriting the redirect URI to a pre-registered `/claude-callback-bridge` endpoint. It is genuinely the most intricate code in the whole project.

ChatGPT needs none of it. Its redirect URI is fixed and public, so you simply register it on a client and OpenIddict validates it like any normal web-app callback. No rewriting, no cookie, no four-step dance.

And here is the design detail that made this painless: the bridge middleware is **gated on the client ID**. Recall from Series 2 that it only activates when `clientId == "MyApp_Claude"`:

```csharp
// Inside ClaudeLocalhostBridgeMiddleware
if (clientId == "MyApp_Claude" && redirectUri != bridgeUri)
{
    // save the random localhost port, rewrite to the bridge URI...
}
```

A ChatGPT request carries a *different* client ID, so this branch never runs. The Claude-specific complexity stays scoped to Claude. ChatGPT's authorization request flows straight through the middleware untouched, exactly as a normal OAuth client should. I did not have to write a single line of "ChatGPT bridge" code — I just had to *not* break the pass-through path.

---

## What You Actually Have to Change

The real work was a single OAuth client registration. ChatGPT needs its own client whose redirect URI is the fixed cloud callback:

```csharp
await manager.CreateAsync(new OpenIddictApplicationDescriptor
{
    ClientId = "MyApp_ChatGPT",
    ClientType = OpenIddictConstants.ClientTypes.Public,
    ConsentType = OpenIddictConstants.ConsentTypes.Implicit,
    RedirectUris = { new Uri("https://chatgpt.com/connector_platform_oauth_redirect") },
    Permissions =
    {
        Permissions.Endpoints.Authorization,
        Permissions.Endpoints.Token,
        Permissions.GrantTypes.AuthorizationCode,
        Permissions.GrantTypes.RefreshToken,
        Permissions.ResponseTypes.Code,
        Permissions.Scopes.OpenId,
        Permissions.Scopes.Email,
        Permissions.Scopes.Profile,
        Permissions.Scopes.OfflineAccess,
        Permissions.Prefixes.Scope + "api",
    }
});
```

It is the same shape as the `MyApp_Claude` client — public client, PKCE, authorization code with refresh — with one line changed: a real, predictable `RedirectUri` instead of the bridge endpoint. That single difference is the entire reason ChatGPT is simpler.

You can also register ChatGPT's redirect URI on the *existing* shared client instead of creating a second one. I prefer a dedicated client per consumer: the audit trail tells you which AI initiated a session, and you can revoke one without touching the other.

---

## The DCR Endpoint: DCR vs CIMD

In Series 2, I exposed a mock Dynamic Client Registration endpoint because Claude's SDK insists on "registering" before it will start an OAuth flow. ChatGPT supports DCR too — it calls your `registration_endpoint` once per connector instance, receives a `client_id`, and reuses it.

There is a catch worth flagging. My mock DCR always echoed back the pre-registered `MyApp_Claude` client and ignored the requested redirect URIs. If ChatGPT registers through that same endpoint and gets back a client whose registered redirect URI is the *bridge* endpoint, the flow fails with `invalid_redirect_uri` — because ChatGPT will redirect to its cloud URL, which that client does not allow.

Two clean ways out:

1. **Make the mock DCR return a client whose redirect URIs include ChatGPT's callback.** Simplest if you keep using DCR — the returned client just needs `https://chatgpt.com/connector_platform_oauth_redirect` registered alongside the Claude entries.
2. **Use Client ID Metadata Documents (CIMD).** This is OpenAI's currently recommended path: instead of registering, ChatGPT sends a URL pointing at a JSON document describing the client, and your authorization server reads it directly. It sidesteps the whole "store a registration" problem. It requires your authorization server to advertise CIMD support, so it is more work up front — but it is the more future-proof option on the OpenAI side.

For getting something working today, option 1 is the least friction. If you are starting fresh, look hard at CIMD.

---

## What Didn't Change At All

This is where the "one server" claim pays off. Everything below worked for ChatGPT with **zero modification**, because none of it was ever Claude-specific:

- **HTTP transport.** ChatGPT only connects to remote HTTPS MCP servers — it has no concept of the local stdio servers that desktop clients run. The streamable HTTP endpoint from Series 1 is exactly what it wants. (ChatGPT also accepts the older HTTP/SSE transport, but streamable HTTP is the right default.)
- **JWT validation.** The MCP server validates tokens by *issuer*, with audience validation off (Series 2). A token ChatGPT obtains comes from the *same* OpenIddict identity server as Claude's, so it validates identically. The server never needs to know which AI minted the session.
- **CORS.** The policy already allows any origin. Nothing to add.
- **Discovery endpoints.** `/.well-known/oauth-protected-resource` and `/.well-known/openid-configuration` describe the identity server, not any one client. Both AIs read the same metadata.
- **The `WWW-Authenticate` 401 hint.** Client-agnostic — it points any caller at discovery.
- **Bearer token forwarding.** The handler re-attaches the incoming user JWT to every backend call. It never cared who the client was; it only cares about the token.

The MCP protocol layer is genuinely vendor-neutral. The divergence is entirely at the edge, in OAuth client registration — and I have now accounted for all of it.

---

## Two ChatGPT-Specific Gotchas

These are not server bugs; they are platform realities worth knowing before you promise stakeholders anything.

**Write tools are gated by workspace tier.** OpenAI restricts full, write-capable MCP connectors to Business, Enterprise, and Education workspaces. Plus and Pro individual users — even with Developer Mode on — are limited to read-only connectors. So the carefully built write tools from [Series 3](/blog/model-context-protocol-series-3-enhancing-your-mcp-server-tool-explorer-ui-grouping-and-write-safety/), with their two-step confirmation and idempotency, simply will not be callable for an individual Plus user. Your read tools will. Plan your rollout around who actually needs to mutate data.

**The `search` / `fetch` convention.** ChatGPT's connector and deep-research surfaces expect two read-only tools by convention: a `search` tool that returns relevant result IDs, and a `fetch` tool that returns full content for an ID with citations. Full Developer Mode exposes all your tools regardless, but if you want first-class behavior in the research experience, implement that pair. It is a small adapter over the search tools you already have.

---

## Testing It With ChatGPT

The loop mirrors Claude's, minus the localhost theater:

1. Enable **Developer Mode** in ChatGPT settings (available on Pro, Plus, Business, Enterprise, and Education on the web).
2. Add a **custom connector** pointing at your server's `/mcp` URL.
3. Set authentication to **OAuth**. ChatGPT discovers your authorization server through the same `.well-known` chain Claude uses, runs the PKCE flow, and redirects to its fixed cloud callback.
4. Log in. The token comes back, ChatGPT calls `tools/list`, and your tools appear.

Because the redirect lands on a public OpenAI URL rather than a laptop port, there is nothing local to debug. If the OAuth flow fails, it is almost always a redirect URI that is not registered on the client — the one config that matters.

---

## The Verdict

One server, two AI clients. I did not write a parallel implementation, fork the tool layer, or special-case the protocol. The MCP specification did its job: the tools, transport, and token handling were already client-agnostic.

The only place Claude and ChatGPT diverge is OAuth client registration, and the difference reduces to a single fact — Claude runs on your machine with an unpredictable callback, ChatGPT runs in the cloud with a fixed one. That fact made Claude *harder* (it needed the bridge) and ChatGPT *easier* (it needed one client entry). The instinct to build a second server was exactly wrong. The right move was to add a client and get out of the way.

That closes out this series. From a bare HTTP MCP server, through OAuth and production hardening, to serving two different AI vendors from the same endpoint — it has all been one server, extended in the right direction rather than around itself.

{{< series-next
  label="This series is complete"
  title="Start from the beginning — Model Context Protocol Series 1"
  description="Go back to Series 1 to follow the full journey: from a basic HTTP MCP server, through OAuth 2.1 and production hardening, to serving both Claude and ChatGPT from a single endpoint."
  url="/blog/model-context-protocol-series-1-building-a-production-mcp-server-in-.net-with-http-transport/"
>}}
