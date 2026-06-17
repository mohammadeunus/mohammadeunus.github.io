---
title: "Model Context Protocol Series 2 — OAuth 2.1 for MCP: Connecting Claude to Your Real Users with OpenIddict"
slug: mcp-series-2-oauth-openiddict-connect-claude-to-real-users
description: "How to wire OAuth 2.1 PKCE authentication into an ASP.NET Core MCP server so Claude authenticates as the real logged-in user — not a service account — using OpenIddict, discovery endpoints, mock DCR, and a bridge middleware that solves the random localhost port problem."
excerpt: "A service account has admin access and no tenant context. This post shows the full OAuth 2.1 flow that makes Claude authenticate as the real user: discovery endpoints, mock Dynamic Client Registration, bearer token forwarding, and the bridge middleware that tames Claude's random callback ports."
date: 2026-06-18T00:00:00+06:00
lastmod: 2026-06-18T00:00:00+06:00
draft: true
weight: 50
images: []
categories: ["Development", "AI", "MCP", ".NET", "Security"]
tags: ["MCP", "Model Context Protocol", "OAuth", "OpenIddict", "ASP.NET Core", "PKCE", "Claude", "Authentication", "JWT", "Bearer Token"]
contributors: []
pinned: false
homepage: false
---

In [Series 1](../mcp-series-1-build-your-first-mcp-server-aspnet-core) I showed how to build a basic MCP server in ASP.NET Core and wire it up to Claude. The server worked — Claude could call tools and get data back. But every outgoing HTTP call from that server used a service account with admin privileges. That is the wrong design for a multi-tenant SaaS application.

This post fixes it. By the end, Claude will authenticate as the actual logged-in user, forward their JWT to every backend API call, and respect their tenant, their permissions, and their data boundaries. The centrepiece is a piece of middleware I wrote to solve a specific, frustrating OAuth spec problem. We will get to that.

---

## Why Not a Service Account

The short answer: a service account has no tenant context and too many permissions.

In our system, the platform is multi-tenant — every API endpoint scopes its results to the requesting user's tenant. If the MCP server authenticates with a service account, it bypasses all of that. A tool that fetches reservations could accidentally expose data from any tenant. There is no audit trail tying actions to a specific user. And if that service account credential is ever compromised, the blast radius is the entire platform.

The right pattern is called bearer token forwarding. When a user authenticates with Claude, the MCP server receives their JWT as a `Bearer` token on every incoming request. Every outgoing call to the backend API re-uses that same token. The backend sees a normal authenticated user request — the MCP server is just a transparent intermediary. The user can only see what they could see if they logged in directly.

This is also the correct audit story. The change log, the activity stream, every modified entity — they are all stamped with the real user's identity.

---

## The Two-Client Design

Before wiring up OAuth, you need to decide which clients OpenIddict will know about. I settled on two distinct clients for different use cases.

**`MyApp_Claude`** is a public client — no secret, PKCE required. This is the client used by Claude Desktop and Claude Code. Because these are installed on a developer's local machine, there is no safe place to store a client secret. PKCE (Proof Key for Code Exchange) fills that role: each authorization request generates a random code verifier, which is hashed and sent with the initial request, then verified at token exchange. Even if someone intercepts the authorization code, they cannot exchange it without the original verifier.

**`MyApp_MCP`** is a confidential client using `client_credentials`. This is for scripts, Postman, background jobs, or CI pipelines that need to call the MCP server without a browser-based login flow. It has a secret and is appropriate where that secret can be stored safely.

In OpenIddict, registering the public client looks roughly like this:

```csharp
await manager.CreateAsync(new OpenIddictApplicationDescriptor
{
    ClientId = "MyApp_Claude",
    ClientType = OpenIddictConstants.ClientTypes.Public,
    ConsentType = OpenIddictConstants.ConsentTypes.Implicit,
    RedirectUris = { new Uri("https://your-identity-server/claude-callback-bridge") },
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

Notice the `RedirectUri` is `/claude-callback-bridge` on the identity server — not a `localhost` port. That is the whole point of the bridge middleware, which I will explain shortly.

{{< figure src="oauth-full-flow.svg" alt="Complete OAuth 2.1 flow for MCP — from discovery through to authenticated API calls" >}}

---

## OAuth Discovery Endpoints

Before Claude can start an OAuth flow, it needs to find your authorization server. It does this through a chain of well-known discovery documents, specified in RFC 8414 and RFC 9728. These endpoints live on the MCP server, not on the identity server itself.

The flow is:

1. Claude calls the MCP server's `/mcp` endpoint without a token. The server returns `401`.
2. Claude looks at the `WWW-Authenticate` header and hits `GET /.well-known/oauth-protected-resource`.
3. That response tells Claude the `authorization_endpoint`, `token_endpoint`, and — critically — the `registration_endpoint`.
4. Claude hits `GET /.well-known/openid-configuration` to get the full OIDC configuration.
5. Claude registers as a client via `POST /connect/register`.
6. Claude starts the PKCE authorization flow.

None of this is magic. It is spec-compliant auto-discovery. The MCP server exposes these endpoints, which point at the real identity server for all the actual OAuth work:

```csharp
[HttpGet(".well-known/oauth-protected-resource")]
[AllowAnonymous]
public ActionResult<object> OAuthProtectedResource()
{
    var identityServer = _configuration["App:IdentityServerUrl"].TrimEnd('/');

    return Ok(new
    {
        issuer = identityServer + "/",
        authorization_endpoint = identityServer + "/connect/authorize",
        token_endpoint = identityServer + "/connect/token",
        registration_endpoint = $"{Request.Scheme}://{Request.Host}/connect/register",
        jwks_uri = identityServer + "/.well-known/jwks",
        scopes_supported = new[] { "openid", "offline_access", "email", "profile", "api" },
        code_challenge_methods_supported = new[] { "S256" }
    });
}
```

The `registration_endpoint` intentionally points back to the MCP server, not to the identity server. That is where the mock DCR lives.

---

## The Mock DCR Endpoint

RFC 7591 defines Dynamic Client Registration — a way for OAuth clients to register themselves on-the-fly with a server they have never talked to before. Claude's SDK implements this. When Claude sees a `registration_endpoint`, it will `POST` to it with a JSON body describing itself before starting any authorization flow.

I do not want to expose a real DCR endpoint. Real DCR would create a new client entry in the database on every connection, which is a maintenance and security headache. The solution is a fake endpoint that always returns the pre-registered `MyApp_Claude` client credentials, regardless of what was sent:

```csharp
[HttpPost("connect/register")]
[AllowAnonymous]
public ActionResult<object> RegisterClient([FromBody] Dictionary<string, object> request)
{
    // Always return the pre-registered public client.
    // We do not actually register anything — we just echo back the right client_id.
    return Ok(new
    {
        client_id = "MyApp_Claude",
        redirect_uris = request?.TryGetValue("redirect_uris", out var r) == true
            ? r
            : new[] { "http://localhost:40383/callback" },
        grant_types = new[] { "authorization_code", "refresh_token" },
        response_types = new[] { "code" },
        token_endpoint_auth_method = "none",
        application_type = "native",
        client_name = "Claude AI Connector",
        client_id_issued_at = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
    });
}
```

Claude gets back what it expects — a `client_id` and a confirmation of its redirect URIs — and proceeds with the authorization flow using `MyApp_Claude` as its client identity. We get a static, auditable client registration with no moving parts.

---

## The Localhost Port Problem

This is where the real friction lives, and where I spent the most debugging time.

Claude CLI and Claude Code pick a **random local port** for their OAuth callback. The redirect URI they send in the authorization request looks like `http://localhost:39616/callback` — where `39616` is chosen at the moment the flow starts. Next time it might be `http://localhost:52041/callback`. There is no way to predict it.

OpenIddict (and the OAuth spec itself) requires that every redirect URI be **pre-registered** for the client. If the redirect URI in the authorization request does not exactly match a registered one, OpenIddict rejects it with a `redirect_uri mismatch` error. This is a security requirement — it prevents an attacker from hijacking the authorization code by sending you to a URI you do not control.

The naive solutions all have problems:

- **Pre-register a long list of localhost ports** — impractical, and OpenIddict would need to support wildcard matching, which it intentionally does not.
- **Use a wildcard redirect URI** — a direct security hole. Any process on the machine could claim to be the redirect target.
- **Patch Claude's SDK** — not possible; it is Anthropic's code.

The solution I built is a bridge middleware that sits in front of OpenIddict on the identity server.

---

## The Bridge Middleware Solution

`ClaudeLocalhostBridgeMiddleware` runs before OpenIddict processes any request. It transparently rewrites the redirect URI in both the authorization request and the subsequent token request, so OpenIddict sees a fixed, pre-registered URI at both steps. Claude never knows any rewriting happened.

The flow has four steps:

**Step 1 — Intercept the authorization request.** When Claude sends `GET /connect/authorize?client_id=MyApp_Claude&redirect_uri=http://localhost:39616/callback&...`, the middleware saves that random URI in an HttpOnly cookie with a 15-minute TTL, then rewrites the query string so OpenIddict sees `redirect_uri=https://identity-server/claude-callback-bridge` — a URI that is pre-registered.

```csharp
if (context.Request.Path.StartsWithSegments("/connect/authorize"))
{
    var clientId = context.Request.Query["client_id"].ToString();
    var redirectUri = context.Request.Query["redirect_uri"].ToString();

    if (clientId == "MyApp_Claude" && redirectUri != bridgeUri)
    {
        // Validate: only localhost URIs allowed
        if (!redirectUri.Contains("localhost", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = 400;
            await context.Response.WriteAsync("Only localhost callbacks allowed.");
            return;
        }

        // Save the random port for later
        context.Response.Cookies.Append("ClaudeOriginalRedirectUri", redirectUri, new CookieOptions
        {
            HttpOnly = true,
            Secure = context.Request.IsHttps,
            Expires = DateTimeOffset.UtcNow.AddMinutes(15),
            Path = "/"
        });

        // Rewrite the query string
        var items = QueryHelpers.ParseQuery(context.Request.QueryString.Value)
                                .ToDictionary(k => k.Key, v => v.Value.ToString());
        items["redirect_uri"] = bridgeUri;
        context.Request.QueryString = new QueryString(QueryHelpers.AddQueryString("", items));
    }
}
```

**Step 2 — User logs in normally.** OpenIddict processes the authorization request, presents the login form, and issues an authorization code. The code is sent to `/claude-callback-bridge` — the registered URI.

**Step 3 — Bridge endpoint redirects back to Claude.** The middleware intercepts the request to `/claude-callback-bridge`, reads the original URI from the cookie, appends the `code` and `state` parameters, and redirects the browser to `http://localhost:39616/callback?code=...&state=...`. Claude's local listener receives the code exactly as if it had been sent directly.

```csharp
if (context.Request.Path.StartsWithSegments("/claude-callback-bridge"))
{
    if (context.Request.Cookies.TryGetValue("ClaudeOriginalRedirectUri", out var originalUri))
    {
        var uriBuilder = new UriBuilder(originalUri);
        var qs = context.Request.QueryString.Value?.TrimStart('?') ?? "";
        uriBuilder.Query = qs;

        context.Response.Cookies.Delete("ClaudeOriginalRedirectUri");
        context.Response.Redirect(uriBuilder.Uri.AbsoluteUri);
        return;
    }

    context.Response.StatusCode = 400;
    await context.Response.WriteAsync("Session expired. Please try again.");
    return;
}
```

**Step 4 — Rewrite the token request.** This is the step I missed on the first pass, and it caused an hours-long debugging session. When Claude exchanges the authorization code for a token, it sends `POST /connect/token` with `redirect_uri=http://localhost:39616/callback` in the form body. OpenIddict validates that this `redirect_uri` **exactly matches** what was used in the authorization request. But in the authorization request, we rewrote it to `/claude-callback-bridge`. The middleware must rewrite the form data here too:

```csharp
if (context.Request.Path.StartsWithSegments("/connect/token") &&
    context.Request.Method == "POST" && context.Request.HasFormContentType)
{
    var clientId = context.Request.Form["client_id"].ToString();
    var redirectUri = context.Request.Form["redirect_uri"].ToString();

    if (clientId == "MyApp_Claude" && redirectUri != bridgeUri)
    {
        var formValues = context.Request.Form
            .ToDictionary(k => k.Key,
                v => v.Key == "redirect_uri"
                    ? new StringValues(bridgeUri)
                    : v.Value);

        context.Request.Form = new FormCollection(formValues);
    }
}
```

After this rewrite, OpenIddict validates successfully and issues the token. Claude now has a real JWT for the authenticated user.

{{< figure src="bridge-middleware.svg" alt="ClaudeLocalhostBridgeMiddleware — the 4-step flow that maps Claude's random localhost port to a fixed registered redirect URI" >}}

**Security considerations.** The middleware explicitly validates that every redirect URI contains `localhost` — it will not bridge to an arbitrary external URI. The cookie is HttpOnly (JavaScript cannot read it), has a 15-minute expiry, and is deleted immediately after use. This middleware is registered only in development environments. In production, clients use registered domains and do not need the bridge.

---

## JWT Bearer Authentication on the MCP Server

On the MCP server side, every request to `/mcp` requires a valid JWT from the identity server. The configuration is standard ASP.NET Core JWT Bearer:

```csharp
services.AddAuthentication("Bearer")
    .AddJwtBearer("Bearer", options =>
    {
        options.Authority = identityServerUrl.TrimEnd('/') + "/";
        options.RequireHttpsMetadata = !isLocalDevelopment;

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = false,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ClockSkew = TimeSpan.FromSeconds(5)
        };

        // In local development, the identity server uses a dev certificate
        if (isLocalDevelopment)
        {
            options.BackchannelHttpHandler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback =
                    HttpClientHandler.DangerousAcceptAnyServerCertificateValidator
            };
        }
    });
```

`ValidateAudience = false` is intentional here — our tokens do not include an `aud` claim scoped to the MCP server specifically. If yours do, set `ValidAudiences` accordingly.

---

## Bearer Token Forwarding

Once the MCP server has validated the incoming JWT, every outgoing HTTP call to the backend API needs to carry that same token. `BearerTokenForwardingHandler` is a `DelegatingHandler` that sits in the HTTP client pipeline:

```csharp
internal class BearerTokenForwardingHandler : DelegatingHandler
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var httpContext = _httpContextAccessor?.HttpContext;

        if (httpContext != null)
        {
            var authHeader = httpContext.Request.Headers["Authorization"].FirstOrDefault();

            if (!string.IsNullOrEmpty(authHeader) &&
                authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                var token = authHeader["Bearer ".Length..];
                request.Headers.Authorization =
                    new AuthenticationHeaderValue("Bearer", token);
            }
        }

        return await base.SendAsync(request, cancellationToken);
    }
}
```

The handler is registered globally so it applies to every HTTP client the server creates — including the ABP-generated proxies that call backend API endpoints:

```csharp
services.ConfigureHttpClientDefaults(builder =>
{
    builder.AddHttpMessageHandler<BearerTokenForwardingHandler>();
});
```

There is also an `X-Modification-Source` header forwarded alongside the token. The backend API middleware reads that header to stamp any created or modified entities with `"MCP"` as the modification source. This gives you an audit trail that distinguishes changes made through Claude from changes made through the regular web UI — useful when you are debugging an unexpected mutation and want to know how it happened.

---

## Disabling the Service Account

One important detail: ABP Framework's HTTP client module (`AbpHttpApiClientModule`) is configured by default to authenticate outgoing requests with a password-grant service account. If you are forwarding user tokens, that default has to be disabled — otherwise ABP will overwrite your forwarded Bearer header with its own service account token.

```csharp
public override void PreConfigureServices(ServiceConfigurationContext context)
{
    // Disable ABP's default service account credential injection.
    // MCP uses bearer token forwarding instead.
    context.Services.PreConfigure<AbpIdentityClientOptions>(options =>
    {
        options.IdentityClients.Default = null;
    });
}
```

This must run in `PreConfigureServices` so it takes precedence over the module's own configuration. I missed this on the first attempt and spent an afternoon wondering why the API was returning data for the wrong tenant.

---

## Testing the Full Flow

When everything is wired up, the experience in Claude Code looks like this:

```
$ claude
⠼ Connecting to MCP server...
→ GET /mcp → 401 Unauthorized
→ GET /.well-known/oauth-protected-resource
→ GET /.well-known/openid-configuration
→ POST /connect/register
→ Opening browser for authentication...

[Browser opens, user logs in to the identity server]

→ GET /claude-callback-bridge?code=...&state=...
→ Redirect to http://localhost:52041/callback?code=...&state=...
→ POST /connect/token
✓ Authenticated as user@example.com
✓ Connected to the MCP server
```

Claude then has a JWT for the authenticated user. Every tool call Claude makes on that session runs with that user's exact permissions. If a tool queries reservations, it gets only that user's tenant's reservations. If a tool tries to create a record, the audit log shows the real user's ID. The service account is never involved.

---

## What This Unlocks

A few things became immediately obvious once bearer token forwarding was working:

**Multi-tenancy just works.** Every backend API call respects tenant isolation automatically, because the token carries the tenant claim. No extra plumbing needed.

**Row-level security is free.** Any permission check that your API already enforces — field-level visibility, resource ownership, role guards — applies equally to Claude's calls. Claude cannot see anything the user cannot see.

**The audit log is honest.** When you look at the change history for an entity and it says "modified by sarah@example.com via MCP," that is accurate. Before this change, it would have said "modified by service-account," which told you nothing.

**Debugging is tractable.** When something goes wrong, the request traces show a real user identity. You can reproduce the problem by logging in as that user and making the same call yourself.

---

## What Is Next

Series 3 covers two-step confirmation for destructive tools. Some MCP tools — deleting a reservation, issuing a refund, changing a tenant's subscription — should not execute on the first request. They should pause, summarize what they are about to do, and require explicit confirmation before proceeding.

The challenge is that MCP is stateless. There is no native "are you sure?" primitive. Series 3 shows how to build a confirmation token system on top of ASP.NET Core's `IMemoryCache` that gives Claude safe, auditable two-step execution for any tool you want to protect.

{{< series-next
  title="Model Context Protocol Series 3 — Enhancing Your MCP Server: Tool Explorer UI, Grouping, and Write Safety"
  description="Authentication is done. Series 3 adds a Swagger-like tool explorer, verb and domain grouping, two-step write confirmation, idempotency, and a full audit trail."
  url="/blog/model-context-protocol-series-3-enhancing-your-mcp-server-tool-explorer-ui-grouping-and-write-safety/"
>}}
