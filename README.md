<p align="center">
  <img src="docs/brand/app-icon.svg" width="88" height="88" alt="helloagents.run logo" />
</p>

# helloagents.run

A free, open-source directory of [Claude Code](https://code.claude.com) **sub-agents** and **skills**. Browse and search them, read the exact file, and install one with a single command.

```sh
npx @helloagents/cli add code-reviewer
```

- **Website**: [helloagents.run](https://helloagents.run). Static, with client-side search. No backend, database, or tracking.
- **CLI**: [`@helloagents/cli`](packages/cli). Installs into `.claude/agents/` or `.claude/skills/`, or `~/.claude/` with `--global`.
- **Registry**: plain files in [`registry/`](registry), added by pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).

It costs $0 to run: the site is static files, and the CLI downloads from the site.

## Using the CLI

```sh
npx @helloagents/cli list                    # everything in the registry
npx @helloagents/cli search sql              # search names, tags, descriptions
npx @helloagents/cli add debugger changelog  # install into ./.claude
npx @helloagents/cli add debugger --global   # install into ~/.claude
npx @helloagents/cli remove debugger         # uninstall
```

The CLI never overwrites a file you've changed without asking (`--force` to skip the prompt), checks every download against its SHA-256, and suggests close matches for mistyped names. Set `HELLOAGENTS_REGISTRY_URL` to use a different registry, such as a local build.

## Repository layout

```
registry/
  agents/<name>.md            one file per sub-agent
  skills/<name>/SKILL.md      one folder per skill (may include extra files)
packages/
  schema/                     zod schemas, validator, registry build
  cli/                        the @helloagents/cli package
apps/
  web/                        the Astro site
docs/design-reference.html    design reference (generated)
.github/                      CI, publish workflow, PR and issue templates
```

## Local development

Requires Node.js 22.12+ and pnpm (`corepack enable` picks up the pinned version).

```sh
pnpm install
pnpm dev                  # site on http://localhost:4321, reloads when registry/ changes
pnpm registry:validate    # check every entry
pnpm test                 # schema, CLI and site tests
pnpm lint                 # ESLint + Prettier
pnpm typecheck
pnpm build                # build schema, site (apps/web/dist) and CLI (packages/cli/dist)
```

Try the CLI against your local registry:

```sh
pnpm registry:build       # writes .registry-out/
HELLOAGENTS_REGISTRY_URL="$PWD/.registry-out" node packages/cli/dist/index.js add code-reviewer
```

Or against the built site: run `pnpm --filter web preview` and set `HELLOAGENTS_REGISTRY_URL=http://localhost:4321/r`.

## Deploying the site

The site is fully static. Either host works on its free tier.

**Cloudflare Pages**: Workers & Pages → Create → Pages → connect this repo.

- Build command: `pnpm build`
- Build output directory: `apps/web/dist`
- The Node version is read from `.nvmrc` and pnpm from `packageManager`.

**Vercel**: New Project → import this repo.

- Framework preset: Astro
- Root directory: leave as the repo root
- Build command: `pnpm build`
- Output directory: `apps/web/dist`

Then point `helloagents.run` at it. The registry is served from the same deploy at `/r/registry.json`, `/r/agents/<name>.md` and `/r/skills/<name>/<file>`, which is what the CLI reads.

## Publishing the CLI

1. Bump `version` in `packages/cli/package.json` and commit.
2. Tag and push: `git tag cli-v0.1.0 && git push origin cli-v0.1.0`.
3. [`.github/workflows/publish-cli.yml`](.github/workflows/publish-cli.yml) checks the tag matches the version, then tests, builds, and publishes with provenance.

One-time setup:

- Create the free `helloagents` organization on npmjs.com so the `@helloagents` scope exists.
- For the **first** publish, add an npm automation token as the `NPM_TOKEN` repository secret, or run `pnpm --filter @helloagents/cli build && cd packages/cli && pnpm publish --access public` locally.
- After that, configure [trusted publishing](https://docs.npmjs.com/trusted-publishers) for `@helloagents/cli`: repository `ShivankK26/helloagents-dot-run`, workflow `publish-cli.yml`, environment `npm`. You can then delete the `NPM_TOKEN` secret.

## License

MIT. Entries are contributed under the same license.
