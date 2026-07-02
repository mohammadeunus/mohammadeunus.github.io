---
title: "MCP-First Development: Letting AI Write, Run, and Maintain Your Tests"
slug: mcp-first-development-ai-writes-and-maintains-your-tests
description: "I stopped letting the UI be the first client of my APIs. The MCP server goes first now — AI checks it against the user story through that same interface and writes the tests from what it finds. Here's why I switched, and how it's holding up."
excerpt: "I used to build the API, wire up the UI, and call it done if the screen looked right. Somewhere in building MCP servers for a living, I noticed I'd stopped doing that — and started trusting AI to check my APIs before I ever opened Angular."
date: 2026-07-02T00:00:00+06:00
lastmod: 2026-07-02T00:00:00+06:00
draft: false
images: []
categories: ["Development", "AI", "MCP", "Testing"]
tags: ["MCP", "Model Context Protocol", "TDD", "Testing", "AI", "Claude", "Software Architecture", "Regression Testing", "Debugging"]
contributors: []
pinned: false
homepage: false
---

I didn't set out to change how I test my own code. It happened because of a task that started as plumbing work and ended up rewiring how I think about building anything at all.

I'd been asked to build an MCP server on top of a live production system, under strict rules: no touching the backend, no touching the existing frontend. Just wrap what was there so an AI could call it. The APIs were working. Real users were using them every day. Nothing about the system looked broken.

Then I started writing the MCP tools, and the backend fell apart in my hands — not because it was badly written, but because it had never had to stand on its own. Required fields that weren't actually required, because the frontend form always filled them in first. Business rules that lived in a service layer three folders deep in the Angular app, invisible to any other caller. Updates that silently deleted entire collections if you didn't resend everything the UI happened to have loaded in memory. None of it was a bug, exactly. It was a backend that had quietly outsourced its own correctness to the one client that always compensated for it.

That was the moment it landed: "works when the original client is in front of it" and "designed correctly" are not the same claim. MCP didn't break anything. It just removed the layer that had been covering for the backend the whole time.

## How I Got Here

I couldn't fix that system — I wasn't allowed to touch it. But I could stop building new systems the same way. On the next thing I built, I made the MCP server the first client on purpose, before the UI existed at all. No frontend around to quietly absorb validation the backend should have owned. If something was wrong, there was nowhere for it to hide.

Once that was true, an obvious next step showed up: if the MCP server can call the endpoint, so can AI. So I started having it do exactly what I'd had to do by hand on that first project — check the new endpoint against what the user story actually asked for, with no UI standing between the two. I didn't plan this as a methodology. I just stopped wanting to build another system that only worked because a form happened to fill in the gaps, and eventually noticed I'd been running a different process the whole time.

## The Thing I Had to Admit About My Own Tests

I'll say the quiet part out loud, because I've caught myself doing it: when I write both the code and the test for that code, the test sometimes ends up checking what the code *does*, not what it was *supposed to do*. Not maliciously — usually it's a deadline, or I've been staring at the same function long enough that my mental model of "correct" has quietly drifted to match my implementation. The test goes green. Coverage goes up. The bug ships anyway, with a passing test standing guard over it. I don't think I'm unusual here — it's one of the most talked-about failure modes in testing, and it's the reason code review exists at all: someone who *didn't* write the code has to be the one who checks it.

That's the part MCP-first actually fixes for me. AI checking the live endpoint against the user story isn't grading its own homework — it never read my implementation to write the assertion. It read the user story, called the real tool through MCP, and reported back on whether the two agreed. When they didn't, I found out about assumptions I didn't know I'd baked in — not because the AI is smarter than me, but because it genuinely wasn't checking its own work.

## The Part I Didn't Expect: It Also Speeds Up Fixing Things

I built this for testing. The side benefit I didn't plan for is debugging. Once the MCP server is the standing interface into a product, it's also the fastest way to reproduce a bug — the AI can call the exact failing tool with the exact failing input, against a real or reproducible environment, authenticated as a real user, and hand me back the actual response instead of a screenshot and a guess. That used to be the first twenty minutes of every bug ticket: standing up the right state, hitting the right endpoint, staring at what comes back. Now that step mostly happens before I've finished reading the ticket, and more often than not the AI has a proposed fix ready by the time I sit down with it.

## What This Actually Looks Like

A feature request comes in as a well-defined user story: arena owners should be able to block out maintenance slots, and any booking already in that window must be rejected.

{{< figure src="mcp-first-flow.svg" alt="MCP-first development flow — user story to AI-drafted tests, API built and exposed via MCP, merge triggers Claude, Claude tests the live tool and reports on the PR, green signal starts UI work" >}}

1. **AI reads the user story and drafts the test cases first** — before I write a line of the endpoint. These are real integration tests, written against the application service, not against the MCP tool — the tool is just a thin wrapper around it:

```csharp
public class MaintenanceSlotAppService_Tests : ArenaApplicationTestBase
{
    private readonly IMaintenanceSlotAppService _maintenanceSlotAppService;

    public MaintenanceSlotAppService_Tests()
    {
        _maintenanceSlotAppService = GetRequiredService<IMaintenanceSlotAppService>();
    }

    [Fact]
    public async Task BlockAsync_WithOverlappingBooking_ThrowsConflict()
    {
        var exception = await Assert.ThrowsAsync<BusinessException>(async () =>
        {
            await _maintenanceSlotAppService.BlockAsync(new BlockMaintenanceSlotDto
            {
                ArenaId = _testArena.Id,
                Start = DateTime.Parse("2026-08-01T10:00:00Z"),
                End = DateTime.Parse("2026-08-01T12:00:00Z")
            });
        });

        exception.Code.ShouldBe("Arena:MaintenanceSlotOverlapsBooking");
    }
}
```

2. **I write the API, wire it up to that application service, and expose it as an MCP tool** — `block_maintenance_slot` — no UI involved at this point.
3. **I merge the branch into `dev`.** That merge triggers a call out to Claude: go run the cases you wrote, against the real, deployed thing.
4. **Claude calls the live MCP tool** — the same one wrapping the same application service the tests above already cover — and checks the response against each case. Then it posts the result as a report on the pull request headed toward production. Not "tests passed," but which user-story checks passed and which didn't, against the deployed API itself:

```
✅ block_maintenance_slot — 4/4 cases passed
✅ get_arena_availability — 2/2 cases passed
❌ update_maintenance_slot — 1/2 cases failed
   expected 409 Conflict on overlapping update, got 200 OK
```

5. **A green signal is what tells me the UI work is safe to start.** Red, and the PR doesn't move toward production — I fix the API first. Nobody's building a screen against an endpoint that hasn't been checked against what it was supposed to do.

I didn't write that assertion by reading my own controller — it exists because the user story says overlapping maintenance slots must be rejected, and Claude confirmed the *deployed* tool actually rejects them before the PR was allowed near production, not just the in-process test suite. The application-service test above doesn't retire once the feature ships either — it's what CI runs on every build, while Claude's live MCP pass is what runs against the real thing, authenticated as a real tenant-scoped user via the bearer token forwarding from [Series 2A](/blog/model-context-protocol-series-2a-oauth-2.1-for-mcp-connecting-claude-to-your-real-users-with-openiddict/) — never a service account with a blank check — through the same interface I wrote about in the [MCP series](/blog/model-context-protocol-series-1-building-a-production-mcp-server-in-.net-with-http-transport/) on this site. If I later relax the conflict rule to allow back-to-back slots, the AI notices the live behavior no longer matches the recorded expectation, updates both the test and the case it runs through MCP, and tells me why in the next report — instead of either one quietly rotting into a false pass, or someone silencing a false failure with `[Skip]` at 6pm on a Friday. When the UI finally gets built, it calls the same `block_maintenance_slot` tool Claude already greenlit. It's the second client. It was never going to be the first again.

## Where This Leaves Me

I'm not claiming this replaces good judgment about what a feature should do — that still has to come from a person reading the actual request. What it's removed for me is the specific failure I kept walking into: being both the author and the sole grader of my own tests, and losing the first chunk of every bug investigation to manual reproduction. A few months in, across the projects I've run this on, it's held up well enough that I'm not interested in going back to letting the UI be the first thing that touches a new API.
