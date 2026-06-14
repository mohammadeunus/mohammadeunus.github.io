---
title: "From HIGH RISK to Hardened: Remediating a Security Assessment on an ABP Framework + Angular Application"
description: "A third-party security assessment returned four critical and six high-severity findings across an ABP Framework API and Angular frontends. Here is every finding and exactly how it was fixed."
excerpt: "A production security assessment came back with four critical findings, six high-severity findings, and a verdict nobody wants to read. This is how we fixed all of it — with real code you can lift wholesale if you run ABP + Angular."
date: 2026-02-15T00:00:00+06:00
lastmod: 2026-02-15T00:00:00+06:00
draft: true
images: []
categories: ["Development", "Security", "ABP Framework"]
tags: ["Security", "ABP Framework", "Angular", "OAuth", "JWT", "CSRF", "CSP", "OpenIddict", "ASP.NET Core", "Azure", "Authentication", "Authorization"]
contributors: []
pinned: false
homepage: false
---

A third-party security assessment of a production application built on ABP Framework came back with a verdict nobody wants to read: HIGH RISK, four critical findings, six high-severity findings, spanning multiple Angular frontends and the API. The stack is a common one — ASP.NET Core with ABP, OpenIddict for identity, Angular SPAs served from IIS, all hosted on Azure.

This post walks through every finding and exactly how it was fixed, with real code. If you run ABP + Angular, you can lift most of this wholesale.

**The findings, in severity order:**

- Critical — Missing HTTP security headers on every portal
- Critical — Swagger UI publicly exposed with 1,786 documented paths
- Critical — OAuth tokens stored in localStorage
- Critical — JWTs carrying `role: Administrator` with a one-year expiry
- High — Server technology disclosure (`Server`, `X-Powered-By` headers)
- High — Login form submitting via GET
- High — No CSRF protection on login
- High — No rate limiting / brute-force protection
- High — Dangerous OAuth grant types enabled (implicit, password, custom impersonation)

---

## 1. HTTP Security Headers — The Cheapest, Highest-Leverage Fix

Every portal was missing all six foundational headers. For Angular apps served from IIS, the fix lives entirely in `web.config` — no code changes, no redeploy of the API:

```xml
<httpProtocol>
  <customHeaders>
    <remove name="X-Powered-By" />
    <add name="Strict-Transport-Security" value="max-age=31536000; includeSubDomains" />
    <add name="Content-Security-Policy" value="default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.stripe.com https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; connect-src 'self' https://api.stripe.com https:; frame-src 'self' https://js.stripe.com; frame-ancestors 'self'; object-src 'none'; base-uri 'self';" />
    <add name="X-Frame-Options" value="SAMEORIGIN" />
    <add name="X-Content-Type-Options" value="nosniff" />
    <add name="Referrer-Policy" value="strict-origin-when-cross-origin" />
    <add name="Permissions-Policy" value="camera=(), microphone=(), geolocation=()" />
  </customHeaders>
</httpProtocol>
<security>
  <requestFiltering removeServerHeader="true" />
</security>
```

**Lessons learned the hard way:**

CSP is iterative. Our first CSP broke Stripe Checkout, then hCaptcha, then image uploads. We shipped seven follow-up PRs widening `script-src`, `frame-src`, `img-src`, and `connect-src` one integration at a time. Budget for this: deploy CSP to staging first, click through every third-party integration (payments, captcha, analytics, embedded video), and watch the browser console for violation reports.

`'unsafe-inline'` in `script-src` is a compromise, not an endpoint. Angular's runtime needs it unless you adopt nonces or hashes. We accepted it as a first pass — a CSP with `unsafe-inline` still blocks data exfiltration via `connect-src` and clickjacking via `frame-ancestors`.

Watch out for non-IIS hosts. Headers configured in `web.config` do nothing for the API if it is deployed as an Azure App Service .NET app. Cover the API in code (`app.UseHsts()` or a small header middleware).

Legitimate framing exceptions need surgical handling. We have a cXML PunchOut feature that must render in customer iframes. Rather than weakening the global policy, a dedicated middleware relaxes framing only on those routes:

```csharp
// PunchOut pages only — everything else keeps SAMEORIGIN
context.Response.Headers.Remove("X-Frame-Options");
context.Response.Headers["Content-Security-Policy"] = "frame-ancestors *";
```

This same `web.config` block also closed finding #5 (server disclosure): `<remove name="X-Powered-By"/>` kills the ASP.NET banner and `removeServerHeader="true"` suppresses the IIS `Server` header.

---

## 2. Locking Down Swagger — Auth + Permission, Not Just "Hide It"

The assessment found our Swagger UI publicly serving documentation for 1,786 paths, 688 of them sensitive — user, role, token, tenant, audit, import/export endpoints. That is a complete attack-surface map handed to anyone with the URL.

The naive fix is to disable Swagger in production. We kept it — internal teams genuinely use it — but gated it behind OIDC authentication plus an explicit permission, enforced by middleware that runs before the Swagger handler:

```csharp
public async Task InvokeAsync(HttpContext context)
{
    // 1. Must be authenticated — unauthenticated users get the OIDC challenge
    var result = await context.AuthenticateAsync("SwaggerCookie");
    if (!result.Succeeded)
    {
        await context.ChallengeAsync("SwaggerOidc", new AuthenticationProperties
        {
            RedirectUri = "/swagger"
        });
        return;
    }

    // 2. Customer-facing accounts are blocked outright
    if (userSetting?.IsCustomer == true)
    {
        context.Response.StatusCode = 403;
        await context.Response.WriteAsync("Access denied. Swagger is for internal users only.");
        return;
    }

    // 3. Must hold the explicit SwaggerAccess permission (user- or role-granted)
    if (!await HasSwaggerPermissionAsync(scope.ServiceProvider, userId))
    {
        context.Response.StatusCode = 403;
        return;
    }

    await _next(context);
}
```

Registration is environment-conditional, so local development stays frictionless:

```csharp
if (!env.IsDevelopment())
{
    app.UseSwaggerAuth(); // must come BEFORE UseSwagger()
}
app.UseSwagger();
```

Three layers matter here: authentication (who are you), account-type check (customers never need API docs), and permission (a deliberate grant, defaulting to deny). Defining `SwaggerAccess` as a real permission in ABP's permission system means access is auditable and revocable like any other grant — no hardcoded user lists.

---

## 3. Getting Tokens Out of localStorage — HttpOnly Cookies Without Rewriting Auth

`localStorage` is readable by any JavaScript on the page. One XSS bug anywhere — a vulnerable npm package, a malicious browser extension, an injected analytics script — and every stored token is gone. The assessment found access tokens, refresh tokens, ID tokens, and PKCE verifiers all sitting in `localStorage`.

The standard answer is HttpOnly cookies, but a full rewrite of an OAuth SPA flow is a big job. Our approach kept the existing JWT validation pipeline completely untouched by adding two small backend pieces.

**Piece 1 — a cookie-setting endpoint.** After the SPA completes the token exchange, it POSTs the tokens to the API, which stores them in HttpOnly cookies and returns nothing readable to JavaScript:

```csharp
private static string BuildCookie(string name, string value, bool secure, string path = "/")
{
    var sb = new StringBuilder();
    sb.Append($"{name}={value}");
    sb.Append($"; Path={path}");
    sb.Append("; HttpOnly");       // invisible to JavaScript
    sb.Append("; SameSite=None");  // SPA and API on different subdomains
    if (secure) sb.Append("; Secure");
    sb.Append("; Partitioned");    // CHIPS — survives third-party cookie phase-out
    return sb.ToString();
}
```

Two details worth copying: the refresh token cookie is scoped to `Path=/api/auth` so it is only ever transmitted to the token-refresh endpoint, and `Partitioned` keeps cross-site cookies working as browsers roll out CHIPS.

**Piece 2 — a translation middleware.** Instead of teaching the authentication stack about cookies, a tiny middleware turns the cookie back into the `Authorization` header the existing JWT validation already expects:

```csharp
public async Task InvokeAsync(HttpContext context)
{
    // Only synthesise the header if the client didn't send one already
    // (Swagger / server-to-server calls still use Bearer directly)
    if (!context.Request.Headers.ContainsKey("Authorization"))
    {
        var accessToken = context.Request.Cookies["auth_at"];
        if (!string.IsNullOrEmpty(accessToken))
        {
            context.Request.Headers["Authorization"] = $"Bearer {accessToken}";
        }
    }
    await _next(context);
}
```

Register it before `UseAuthentication()` and everything downstream — JWT validation, authorization policies, ABP's permission checks — works unchanged. Machine-to-machine clients keep sending Bearer headers directly; the middleware only fills the gap for browser requests.

On the Angular side, the only persistent artifact left in `localStorage` is a `token_expiry` timestamp (so the app knows when to refresh) — useless to an attacker. PKCE verifiers and nonces moved to `sessionStorage`, which at least dies with the tab.

**The trap to watch for:** secondary login flows. We migrated the main auth service and later found a second shop-login service still writing `access_token` to `localStorage`, and a "welcome" deep-link page accepting a token via URL query parameter and persisting it. Grep your entire frontend for `localStorage.setItem` and audit every hit — the main flow is never the only flow.

---

## 4. JWT Hygiene — Role Claims and Token Lifetime

The assessment's nastiest finding: end-user portal tokens carried `role: Administrator` with a one-year expiry. Steal one token, get admin for 365 days.

Two separate problems, two separate fixes.

**Role claims.** Custom OpenIddict grant handlers build the claims principal for portal logins. The fix is to filter what goes into the token at the point where claim destinations are assigned — portal-user tokens should carry portal-relevant claims only, never back-office roles. While we were there, we also stripped the ASP.NET Identity `SecurityStamp` claim, which `CreateUserPrincipalAsync()` adds by default and which has no business being in an access token:

```csharp
// Immediately after CreateUserPrincipalAsync()
(principal.Identity as ClaimsIdentity)?.TryRemoveClaim(
    principal.FindFirst("AspNet.Identity.SecurityStamp"));
```

**Lifetime.** The one-year expiry traced back to legacy IdentityServer4 seed data (`AccessTokenLifetime = 31536000`). The durable fix is to set lifetimes explicitly per client in OpenIddict rather than relying on defaults:

```csharp
options.SetAccessTokenLifetime(TimeSpan.FromMinutes(30));
options.SetRefreshTokenLifetime(TimeSpan.FromDays(14));
options.SetRefreshTokenReuseLeeway(TimeSpan.FromSeconds(30)); // rotation tolerance
```

Short access tokens are painless when the refresh flow is solid — which the HttpOnly cookie work from the previous section gives you for free.

**Audit tip:** decode a real token from each client (`jwt.io` or `jwt-cli`) and read every claim and the `exp` value. Do not trust the config — trust the token. This is how the assessors found the issue, and it is how you verify the fix.

---

## 5. Fixing the Login Form — POST, CSRF, and Brute-Force Protection

One portal's login form submitted credentials via GET — putting passwords into browser history, proxy logs, and the `Referer` header — with no CSRF token and no rate limiting. Three findings, one surface.

GET → POST with antiforgery is the easy part for the Razor login page:

```html
<form method="post">
    @Html.AntiForgeryToken()
    ...
</form>
```

CSRF for the SPA login is more interesting. Our portal SPAs authenticate against the OAuth token endpoint (`/connect/token`) with a custom grant — there is no server-rendered form to embed a token into, and we did not want server-side session state. The solution: stateless, HMAC-signed CSRF tokens.

```csharp
/// Token format: {hex_nonce}.{unix_expiry}.{hex_hmac}
/// No cookie or server-side session required — the HMAC signature is self-validating.
public string GenerateToken()
{
    var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
    var expiry = DateTimeOffset.UtcNow.AddMinutes(_tokenExpiryMinutes).ToUnixTimeSeconds();
    var payload = $"{nonce}.{expiry}";
    return $"{payload}.{ComputeHmac(payload)}";
}

public bool ValidateToken(string token)
{
    // Check expiry before verifying HMAC to fail fast on obvious replays
    if (DateTimeOffset.UtcNow.ToUnixTimeSeconds() > expiryUnix)
        return false;

    // Constant-time comparison to prevent timing attacks
    return CryptographicOperations.FixedTimeEquals(expectedBytes, providedBytes);
}
```

The SPA fetches a token from a public endpoint, sends it back in an `X-XSRF-TOKEN` header, and the grant handler validates it before touching credentials:

```csharp
var csrfToken = request.Headers["X-XSRF-TOKEN"].FirstOrDefault();
if (!_csrfTokenService.ValidateToken(csrfToken))
{
    return Forbid("CSRF token validation failed.");
}
// ...only now do we look at username/password
```

Details that matter: the secret key is enforced at startup to be ≥32 characters (fail fast, not fail open), tokens expire in 5 minutes, and the HMAC comparison uses `FixedTimeEquals` so an attacker cannot byte-by-byte forge a signature via timing.

**Brute-force protection** came almost free from ASP.NET Identity's lockout — it just has to be turned on and enforced in every login path, including custom grants:

```csharp
// Configuration
options.Lockout.AllowedForNewUsers = true;
options.Lockout.MaxFailedAccessAttempts = 5;
options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);

// Enforcement in the custom grant handler — BEFORE password validation
var lockoutEnd = await _userManager.GetLockoutEndDateAsync(user);
if (lockoutEnd.HasValue && lockoutEnd.Value > DateTimeOffset.UtcNow)
{
    _logger.LogWarning("Login blocked: user {UserId} is locked out", user.Id);
    return Forbid("Login blocked. Retry in 15 minutes.");
}
```

Checking lockout before password validation means a locked account rejects correct passwords too — otherwise an attacker confirms a credential hit even while locked.

---

## 6. OAuth Grant Hygiene — Kill Implicit/Password, Harden Custom Grants

The identity server advertised the implicit grant (deprecated since OAuth 2.0 Security BCP — tokens in URL fragments), the password grant (credentials proxied through the client, no MFA, no phishing resistance), and a custom impersonation grant with unknown protections.

Implicit and password: removed from every client registration. The seeding now grants each client only what it needs:

```csharp
// SPA clients: authorization code + PKCE, refresh tokens — nothing else
grantTypes: new[]
{
    OpenIddictConstants.Permissions.GrantTypes.AuthorizationCode,
    OpenIddictConstants.Permissions.GrantTypes.RefreshToken
};

// Machine clients (service-to-service): client credentials only
grantTypes: new[]
{
    OpenIddictConstants.Permissions.GrantTypes.ClientCredentials
};
```

The impersonation grant is the kind of feature security reviews rightly fixate on: it mints tokens as another user. We hardened it with two independent authorization layers, so compromising the API layer alone is not enough.

**Layer 1 — the API endpoint:** `[Authorize]` plus an internal-user check (customer accounts can never impersonate), then a server-to-server call to the identity server passing the caller's own token as evidence:

```csharp
if (callerSetting == null || callerSetting.IsCustomer)
{
    _logger.LogWarning("IMPERSONATE: Caller {CallerId} is a customer user", callerUserId);
    return Forbid();
}
```

**Layer 2 — the grant handler:** does not trust the API. It independently re-validates the forwarded `caller_token` (full signature + expiry check through the OpenIddict validation pipeline) and re-runs the internal-user check against the database before issuing anything.

Every impersonation start and revert is logged with both identities:

```csharp
_logger.LogInformation(
    "IMPERSONATE: Token issued for target {TargetId} by caller {CallerId}",
    userId, callerUserId);
```

The revert flow restores the original session from backup HttpOnly cookies, preserving the remaining lifetime of the original token rather than minting a fresh one.

---

## What We Would Tell Our Past Selves

**Do the `web.config` headers first, today.** It is an hour of work, closes two findings outright, and provides defense-in-depth for two more — CSP mitigates the localStorage XSS risk, and `frame-ancestors` stops clickjacking.

**Never just "hide" Swagger — gate it.** Auth plus an explicit permission keeps it useful internally and invisible externally. Make the gate environment-conditional so local development does not suffer.

**The cookie-translation middleware pattern is the cheat code for migrating SPA auth off localStorage.** Two small files, zero changes to JWT validation, and server-to-server flows are unaffected.

**Audit every login path, not just the main one.** Our stragglers — a secondary shop-login service still writing tokens to localStorage, a deep-link page accepting tokens via query string — were exactly the flows nobody remembered existed. `grep -r "localStorage.setItem"` is the cheapest security tool you own.

**Decode real tokens to verify claims and expiry.** Config archaeology lies; the JWT does not. Make "decode a token from each client" part of the release checklist for any identity change.

**Defense in depth on anything that mints tokens.** The impersonation grant validates the caller at the API and independently at the identity server. Either layer alone would have passed the original assessment — both together survive a partial compromise.

**Plan CSP as a campaign, not a commit.** Seven PRs to stabilize ours. Staging soak time plus browser-console violation monitoring beats finding out from a customer that checkout is broken.

---

The re-assessment scope was identical to the original. The difference is that every finding now maps to a specific commit, a specific middleware, a specific header — and a test that proves it.
