---
title: "Model Context Protocol Series 1 — Building a Production MCP Server in .NET with HTTP Transport"
slug: mcp-series-1-building-production-mcp-server-dotnet-http
description: "A practical walkthrough of building an MCP server in ASP.NET Core using HTTP transport — the kind you can actually deploy, not just run locally."
excerpt: "Most MCP tutorials show stdio — a local process Claude talks to directly. That works on your laptop, but it's not deployable. Here's how to build an MCP server in ASP.NET Core that runs over HTTP, where the tools, the transport, and the deployment story all actually make sense."
date: 2026-06-18T00:00:00+06:00
lastmod: 2026-06-18T00:00:00+06:00
draft: true
weight: 50
images: []
categories: ["Development", "AI", "MCP", ".NET"]
tags: ["MCP", "Model Context Protocol", "ASP.NET Core", "HTTP", ".NET", "AI Integration", "Claude", "Tools"]
contributors: []
pinned: false
homepage: false
---

I was building an internal tooling layer for our product — a set of capabilities we wanted Claude to be able to call — and I kept running into the same wall. Every MCP tutorial I found used stdio transport. You run a local process, Claude talks to it over stdin/stdout, and it works on your laptop.

But our tools need to call internal APIs. They need to run on a server. They need to be pointed at by multiple developers' Claude instances, not just mine. stdio is a dead end for that use case.

After spending time with the actual MCP spec and the .NET SDK, here is what I learned about building an MCP server that uses HTTP transport — stateless, load-balancer friendly, and actually deployable.

---

## What MCP Is and Why HTTP Changes Things

Model Context Protocol is a specification that lets AI models call external tools in a structured way. Instead of Claude guessing what API to call or hallucinating function signatures, MCP gives it an explicit list of available tools with typed parameters and descriptions. Claude reads the list, picks the right tool for the job, and calls it with structured arguments.

The transport layer is how Claude reaches your server. Two options exist:

**stdio** — Your MCP server is a process that Claude spawns locally. Claude writes JSON to stdin, your process responds on stdout. This works well for local developer tools (file system access, running build scripts, reading logs). The problem is it cannot be deployed. You cannot point a server-hosted Claude instance at a stdio process, you cannot load-balance it, and you cannot share it across a team.

**HTTP (Streamable HTTP)** — Your MCP server is an HTTP endpoint. Claude POSTs to `/mcp`, your server processes the request and responds with JSON. This is what you would actually deploy. It is stateless, scales like any other web service, and can be placed behind any reverse proxy.

For anything beyond a personal local tool — internal APIs, shared team tooling, production integrations — HTTP is the only sensible choice.

{{< figure src="http-vs-stdio.svg" alt="stdio vs HTTP transport comparison — why HTTP is the right choice for production MCP servers" >}}

---

## Setting Up the Server

The .NET SDK for MCP is the `ModelContextProtocol.AspNetCore` NuGet package. Add it to a standard ASP.NET Core project:

```xml
<PackageReference Include="ModelContextProtocol.AspNetCore" Version="0.3.*" />
```

The server setup in `Program.cs` is minimal. You register the MCP server with the DI container and map it to an endpoint:

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddMcpServer()
    .WithTools<RandomNumberTools>();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

var app = builder.Build();

app.UseCors();

app.MapMcp("/mcp");

await app.RunAsync();
```

That is the entire server setup. `AddMcpServer()` registers the MCP infrastructure. `.WithTools<RandomNumberTools>()` tells it which tool class to expose. `MapMcp("/mcp")` wires up the HTTP endpoint.

CORS is enabled here with a permissive policy because during development you will be calling this from Claude Code running on your machine, and the origin may not match. You will tighten this before going to production — but during Series 1, getting it working without auth or access restrictions is the goal.

One extra endpoint worth adding: a `GET /mcp` that returns a discovery hint. The Claude SDK sometimes probes with a GET before it knows the server supports POST. Without this, you get a confusing 405. With it, you get a clear signal:

```csharp
app.MapGet("/mcp", async (HttpContext context) =>
{
    context.Response.StatusCode = 200;
    context.Response.ContentType = "application/json";
    await context.Response.WriteAsJsonAsync(new
    {
        protocol = "mcp",
        version = "2025-11-25",
        transport = "http",
        endpoint = "/mcp",
        method = "POST",
        message = "Use POST /mcp for MCP protocol communication"
    });
}).WithName("MCPDiscovery");

// POST is handled by MapMcp
app.MapMcp("/mcp");
```

---

## Writing Your First Tool

A tool is a C# class decorated with `[McpServerToolType]` at the class level and `[McpServerTool]` on each method. The descriptions you provide are what Claude reads to decide when and how to call the tool — they matter.

Here is the simplest possible tool: a random number generator. It is deliberately trivial so the mechanics are obvious before you add real business logic.

```csharp
using ModelContextProtocol.Server;
using System.ComponentModel;

[McpServerToolType]
internal class RandomNumberTools
{
    [McpServerTool(ReadOnly = true)]
    [Description("Generates a random number between the specified minimum and maximum values.")]
    public int GetRandomNumber(
        [Description("Minimum value (inclusive)")] int min = 0,
        [Description("Maximum value (exclusive)")] int max = 100)
    {
        return Random.Shared.Next(min, max);
    }
}
```

A few things to note:

`ReadOnly = true` is a hint to Claude that this tool has no side effects. It affects how Claude describes the tool in its UI and how cautious it is about calling it without asking you. Mark it accurately — read-only tools get called more freely, write tools prompt for confirmation.

The `[Description]` attributes on the method and each parameter are what Claude reads when it decides whether to call this tool. Write them the way you would write documentation for a junior developer: clear, specific, and honest about units and edge cases. Claude is reading these at inference time, not at compile time.

Your tools can take any injected services as constructor parameters. `WithTools<T>()` registers the tool type with the DI container, so if your tool needs an `IHttpClientFactory`, a repository, or any other registered service, just add it to the constructor and it will be resolved.

```csharp
[McpServerToolType]
internal class OrderTools
{
    private readonly IOrderService _orders;

    public OrderTools(IOrderService orders)
    {
        _orders = orders;
    }

    [McpServerTool(ReadOnly = true)]
    [Description("Looks up the current status of an order by its ID.")]
    public async Task<string> GetOrderStatus(
        [Description("The order ID to look up")] string orderId)
    {
        var order = await _orders.GetByIdAsync(orderId);
        return order is null ? "Order not found" : $"Order {orderId}: {order.Status}";
    }
}
```

---

## How Claude Discovers and Calls Your Tools

The MCP handshake is worth understanding because it changes how you debug problems.

When Claude Code connects to an MCP server, it goes through an initialization exchange first. It sends an `initialize` request to `POST /mcp` with its client information and the protocol version it supports. Your server responds with its capabilities, including the list of tools. Claude caches this tool list for the session.

{{< figure src="mcp-handshake.svg" alt="MCP protocol handshake sequence — initialize, tools/list, and tools/call over POST /mcp" >}}

When you ask Claude to do something and it decides a tool is relevant, it sends a `tools/call` request to the same `POST /mcp` endpoint with the tool name and the arguments it has constructed.

```
POST /mcp
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "GetRandomNumber",
    "arguments": { "min": 1, "max": 50 }
  },
  "id": 1
}
```

Your server routes this to the right tool method, executes it, and returns the result:

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "result": {
    "content": [{ "type": "text", "text": "37" }]
  },
  "id": 1
}
```

The `GET /mcp` discovery endpoint you added earlier handles the case where Claude probes to check if the endpoint is live before sending the initialize request. It is not part of the official MCP spec, but it prevents confusing 404 or 405 errors when Claude first tries to reach your server.

---

## Testing It with Claude Code

Once the server is running, point Claude Code at it with the `/mcp` command:

```
/mcp add
```

Claude Code will prompt you for the server URL and a name. Enter the URL where your server is listening — `http://localhost:5000` if you are running locally — and give it a name like `my-server`.

If the connection succeeds, Claude Code will show the server as connected and list the tools it found. You can verify by asking Claude something that would require the tool:

> "Give me a random number between 10 and 20"

If the tool is wired up correctly, Claude will call `GetRandomNumber` with `min: 10, max: 20` and return the result. In Claude Code, you will see the tool call logged in the conversation with the arguments and response.

When something goes wrong, the failure modes are usually:

- **Connection refused** — the server is not running, or the URL is wrong
- **405 on GET /mcp** — you mapped `MapMcp` but did not add the GET discovery endpoint
- **Tool not found** — the tool class was not registered with `.WithTools<T>()`, or the `[McpServerToolType]` attribute is missing
- **Argument mismatch** — parameter names or types do not match what Claude sends; check that your `[Description]` attributes match your actual parameter names

Running the server with `dotnet run` and watching the console output while you trigger tool calls is the fastest way to diagnose any of these.

---

## What Is Missing

This setup works. Tools are callable, the transport is HTTP, and you can deploy it.

What it does not have: any form of access control. Right now, anyone who knows the URL of your `/mcp` endpoint can connect and call every tool on your server. For a local development server this is fine. For anything shared — a staging environment, a server multiple people access, anything with real data — this is not acceptable.

The production version of this server requires authentication. Claude needs a way to identify itself, your server needs a way to verify that identity, and unauthorized requests need to be rejected before they reach any tool code.

That is what Series 2 covers: adding OAuth 2.0 Bearer authentication to the MCP endpoint, how Claude handles the `WWW-Authenticate` challenge, and what changes in `Program.cs` when you add `.RequireAuthorization()` to `MapMcp`.

For now, the server works without it. Get comfortable with the tool lifecycle, the discovery handshake, and the request/response format — then add the auth layer on top of a working foundation rather than debugging both at once.

---

**Series 2 →** Securing the MCP server with OAuth Bearer tokens, the `WWW-Authenticate` header flow, and how Claude Code handles authentication challenges automatically.

{{< series-next
  title="Model Context Protocol Series 2 — OAuth 2.1 for MCP: Connecting Claude to Your Real Users with OpenIddict"
  description="The server works — but anyone who knows the URL can call your tools. Series 2 adds OAuth 2.1 with OpenIddict: two clients, discovery endpoints, and the bridge middleware that solves Claude's random localhost port problem."
  url="/blog/model-context-protocol-series-2-oauth-2.1-for-mcp-connecting-claude-to-your-real-users-with-openiddict/"
>}}
