# Website and live demo

## helloagents.run

- Static files in `apps/web/public/` (`index.html` is the landing page). Vercel
  serves `www.helloagents.run` from `main` (`apps/web/vercel.json`: no build step,
  output `public`). Pushing to `main` deploys it.
- Dark design. Hero: the version badge, "Hand off the task. Merge the result.",
  sub-copy, **Download for Mac** (Apple logo; links to
  `releases/latest/download/helloagents-mac.dmg`), "See how it works", Claude Code
  ready / Codex coming soon chips, then the live demo.
- **Version badge**: `New in <span data-version>X</span> <span data-headline>· …</span>`.
  The release script rewrites both. A small script on the page also reads GitHub's
  latest release and fixes the number if a release skipped the script.
- Copy was trimmed on request: no "Free and open source", no "Apple silicon and
  Intel", no "uses the plan you already pay for", no internal engine names.

## The live demo

- It's the **real app UI** running against `apps/desktop/src/demo/mockApi.ts`, an
  in-memory implementation of `HelloagentsApi` with sample projects (orbit-app,
  HydraDB, acme-web) and scripted runs (done, failing checks, live, a run waiting
  for approval, a stopped run).
- Build: `pnpm --filter @helloagents/desktop demo` (Vite, `vite.demo.config.ts`,
  `base: "/demo/"`) → `apps/web/public/demo/`. The landing page embeds `/demo/?embed`
  (the `embed` flag hides the strip).
- Whenever the API grows, the mock must implement the new methods (typecheck
  catches it). Keep it free of real user data.
- Fixed bugs: the page jumped down on load (caused by `scrollIntoView`; the feed now
  sets `scrollTop`), `/demo` without a trailing slash broke assets.
