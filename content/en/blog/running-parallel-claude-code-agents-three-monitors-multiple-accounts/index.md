---
title: "Don't Babysit One Coding Agent. Orchestrate a Fleet."
slug: running-parallel-claude-code-agents-three-monitors-multiple-accounts
description: "Orchestrating agents, not babysitting one, is the correct way to use AI. Notes from a month of running parallel coding agents across three monitors and multiple Claude accounts: the setup behind it, and the ceiling I hit at 2-3 agents."
excerpt: "Managing one coding agent is a waste of your time and the resource in front of you. Orchestrating several is the point. Here's what a month of doing that actually looks like."
date: 2026-06-05T00:00:00+06:00
lastmod: 2026-06-05T00:00:00+06:00
draft: false
images: ["parallel-agents-setup.jpg"]
categories: ["Development", "AI", "Claude Code", "Workflow"]
tags: ["Claude Code", "AI", "Parallel Agents", "Worktrees", "Productivity", "Developer Workflow"]
contributors: []
pinned: false
homepage: false
---

Have been running parallel coding agents for more than a month now, so here are some of my takes.

It feels less like using a tool and more like changing how I execute the same kinds of tasks. A lot of it is just wiring things together (the skills) and letting agents handle the repetitive parts. There's a natural ceiling here though: beyond 2-3 agents in parallel, it gets harder to keep track of what's actually going on.

A lot of my time now is less about writing code directly, and more about shaping prompts and reusable skills so the system produces what's needed, consistently, every time.

## Orchestrating Is the Point

If there's one belief this whole setup comes from, it's this: orchestrating agents is the correct way to utilize AI. Running one coding agent and babysitting it is a waste of your time and a waste of the resource in front of you. The value isn't in typing a prompt and staring at one terminal until it finishes. It's in getting multiple things moving at once, each doing something you'd otherwise be doing serially yourself, while you spend your attention on the parts that actually need judgment.

I saw people doing this on YouTube about six months ago, and it genuinely astonished me. I knew immediately that this was the way things were going to work from then on. So I set out to master it, not casually but deliberately, and I'm still deep in that process now. What started as "this looks powerful" has turned into something I actually enjoy doing every day.

## The Claude Loop

Sometimes I still fall into what I'd call the "Claude loop." I delegate a small fix, then go back into the code and realize it was simpler than the round trip I just took. I might actually need a note stuck to the monitor reminding myself not to over-delegate everything.

## The Fleet Needs More Than One Account

A fleet of agents needs enough capacity to run, and that turned out to be the first practical wall I hit. I was burning through the most tokens in my current office, so I asked my manager for a separate account. On top of that I already had access to a couple of other accounts. Running a fleet through one login stopped making sense pretty quickly, so I set up a way to switch cleanly between them: `claude-wafi`, `claude-personal`, `claude-office`.

The mechanism, briefly: Claude Code reads its settings from a config directory (`~/.claude` by default), and `CLAUDE_CONFIG_DIR` points it at a different one, so each account keeps its own config. Pair that with a per-account auth token, and a shell function makes switching one word instead of a login flow:

```powershell
function claude-wafi {
    $env:CLAUDE_CONFIG_DIR = "$HOME\.claude-wafi"
    $env:CLAUDE_CODE_OAUTH_TOKEN = "<WAFI_ACCOUNT_TOKEN>"
    claude @args
}
```

`claude-personal` and `claude-office` are the same function with different values. Each one scopes its own config directory and token to that invocation, so the three are completely separate sessions sharing one machine, with no re-login and no shared state. Project-level `.claude/` config inside a repo is unaffected either way, since that always lives with the repo, not the account.

One thing I'd do differently: don't hardcode the raw token straight into a plaintext profile script the way I initially did. Pull it from a credential manager or a secrets file excluded from version control instead. The function should reference the secret, not contain it.

## Why Three Monitors Stopped Feeling Like Overkill

Once switching accounts was one alias away, three monitors went from "excessive" to "the natural next step." On any given day I'd be running some mix of:

- One feature in a worktree on one screen, a different feature on another.
- Two changes on the same branch, split across different files.
- One agent finishing a user story, then a different account validating the work to make sure it isn't biased.

That last part is the piece that's actually held up over the month. If the same session both writes a change and grades it, the review inherits whatever blind spot the writing had. Switching accounts for review isn't a workaround for rate limits. It's the same reason code review exists between two humans instead of one person reading their own diff twice.

Orchestration also lives in the terminal, not Claude Desktop. Once accounts, worktrees, and multiple sessions all need to compose together, the CLI stops being a preference and becomes the only version of this that actually works.

## Where This Leaves Me

Working across multiple features at once, whether that's the same branch with different files or separate worktrees entirely, surfaces a different problem than working on one thing at a time. It's not "is the code right," it's "do I actually know what's happening across all of these right now." Past 2-3 parallel streams, that tracking cost outpaces whatever time the extra agent was saving me, so I stay under it on purpose.

That's still orchestrating, not babysitting. Babysitting is watching one terminal until it finishes. What I do now is keep 2-3 agents moving on real, separate work, review one with a different session or account than the one that wrote it, and spend my own attention only on the parts that need judgment. A month in, that's the whole shift: less time typing code myself, more time making sure the skills and prompts I hand off are specific enough that I'm not the bottleneck. I'm not interested in going back to running one agent and watching it work.
