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
- **Known issue (fixed)**: intermittent 404 at `eunus.dev` was caused by `npm install` resolving different Hugo binary versions across runs. Fixed by switching to `npm ci`.
- **Fixed**: removed redundant `cp CNAME public/CNAME` step — `static/CNAME` is already copied by Hugo automatically. Having both caused confusion about source of truth.
- If 404 reappears: check the Actions run log first — a failed build leaves the previous deployment intact but GitHub Pages can sometimes show 404 during propagation (~2–5 min after deploy).

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

