# Project Memory

## Repositories
- **Main site**: `H:\me\mohammadeunus.github.io` — Hugo site, deployed to GitHub Pages at `eunus.dev`
- **Portfolio theme**: `H:\me\mohammadeunus.portfolio` — Hugo theme with custom layouts, SCSS, and JS

## Architecture
- Hugo static site with custom portfolio theme
- Portfolio homepage layout: `H:\me\mohammadeunus.portfolio\layouts\index.html`
- Project card data: `H:\me\mohammadeunus.portfolio\data\projects.json`
- Homepage styles: `H:\me\mohammadeunus.portfolio\assets\scss\layouts\_home.scss`
- Card/scroll JS: `H:\me\mohammadeunus.portfolio\assets\js\dynamic-island.js`

## CI/CD
- Workflow: `.github/workflows/hugo.yml`, deploys on push to `master`/`main`
- Hugo is bundled as an npm package, invoked via `exec-bin`
- **Fixed**: switched `npm install` → `npm ci` for reproducible builds.
- **Fixed**: removed redundant `cp CNAME public/CNAME` — `static/CNAME` is already copied by Hugo automatically.
- **Root cause of recurring 404**: `mohammadeunus.github.io` repo Pages source was set to "Deploy from a branch" (master) instead of "GitHub Actions". This caused GitHub's Jekyll build to run on every push, finish after our Hugo deploy, and overwrite it with a broken output. Fixed by changing Settings → Pages → Source to "GitHub Actions".
- If 404 reappears: check Settings → Pages → Source first — must be "GitHub Actions" not a branch.
- Diagnostic commands used to find the issue:
  - List recent runs: `(Invoke-RestMethod "https://api.github.com/repos/mohammadeunus/mohammadeunus.github.io/actions/runs?per_page=3").workflow_runs | Select-Object id, conclusion, name, created_at`
  - List jobs in a run: `(Invoke-RestMethod "https://api.github.com/repos/mohammadeunus/mohammadeunus.github.io/actions/runs/{run_id}/jobs").jobs | Select-Object name, conclusion, started_at, completed_at`
  - No auth token needed — repo is public. API docs: docs.github.com/en/rest/actions

## Homepage sections (order)
1. Hero
2. Key Projects (marquee cards)
3. Work Experience (timeline)
4. Project Contributions (table)
5. Latest Blog Posts
6. GitHub Activity

## Key Projects cards
- Cards click → smooth-scroll + flash-highlight the matching row in Project Contributions table
- `data-project-id` on cards matches `data-project-id` on table rows
- Duplicate marquee set has `aria-hidden="true"` and no click handlers
- Dynamic island modal was intentionally removed — `dynamic-island.js` is now scroll+highlight only

