# Release workflow — paqad-ai

This is the steady state. After the public-migration in May 2026, this is
the only document a maintainer needs to ship code.

> **You never run `pnpm publish` manually.** The loop is:
> **branch → PR → CI → squash-merge → bot opens release PR → merge release PR → npm publish.**

---

## 1. The release loop, at a glance

```
You: write code in a branch
You: pnpm changeset → pick bump → write summary
You: commit + push + open PR
GitHub: CI runs (lint, types, sharded tests, build; 4 required checks)
You: review CI, address feedback
You: squash-merge the PR
GitHub: changesets bot opens "chore(release): version packages" PR
You: review the version bump + changelog → squash-merge
GitHub: release workflow publishes to npm with provenance, tags, and creates a GitHub release
```

Branches → main are gated by:

- 4 CI contexts (Node 22 ubuntu, Node 24 ubuntu, Node 22 macOS, Node 22 Windows)
- Linear history
- Resolved conversations
- No force pushes, no deletions

---

## 2. Shipping a feature

```bash
# 1. Start fresh
git checkout main && git pull
git checkout -b feat/new-stack-pack-nextjs

# 2. Do the work
# ... edit files ...
pnpm run ci   # must pass locally

# 3. Record the change
pnpm changeset
# Pick: minor
# Summary: "Add Next.js 15 stack pack with app-router conventions"

# 4. Commit everything including the new .changeset/<id>.md
git add .
git commit -m "Add Next.js stack pack"
git push -u origin feat/new-stack-pack-nextjs

# 5. Open the PR
gh pr create --base main --fill
```

After CI green: **squash-merge in the UI**.

Within ~1 minute, the bot opens `chore(release): version packages`. Review
that PR (check the version bump and the CHANGELOG entry), squash-merge it.
Within ~2 minutes, `paqad-ai@1.1.0` is on npm.

---

## 3. Shipping a bug fix

Same flow, pick `patch`:

```bash
pnpm changeset   # → patch → "Fix crash when onboarding a monorepo with no root package.json"
```

---

## 4. Shipping a breaking change

```bash
pnpm changeset   # → major → "BREAKING: renamed onboard to init. See migration guide."
```

Before merging the release PR for a major bump:

- Make sure a migration guide is published (link from the changeset summary).
- Make sure the README's quick-start reflects the new command name.
- Consider holding the release PR open for a few days so multiple breaking
  changes batch into one 2.0.0.

---

## 5. Batching multiple PRs into one release

This is by design with Changesets. Merge several feature PRs (each with its
own `.changeset/<id>.md`) without merging the release PR in between. The bot's
release PR keeps updating itself to include every pending changeset. When
you're ready (Friday afternoon, end of sprint), merge the release PR — one
npm release contains everything.

---

## 6. Reviewing a contributor PR

1. **CI status.** Must be green. If not, ask them to fix.
2. **Changeset.** Does the change need one? If yes, is there a file in
   `.changeset/`? If missing and needed, comment asking them to run
   `pnpm changeset`.
3. **Tests.** Did they add tests? Pure refactor or docs-only is fine;
   otherwise ask.
4. **Docs.** Did they update relevant docs?
5. **Code.** Read it.

Approve → squash-merge.

---

## 7. Dependabot PRs

Every Monday morning, Dependabot opens:

- One grouped PR for dev-dependency minor/patch bumps.
- One grouped PR for production patch bumps.
- Individual PRs for production minor/major bumps (human judgment required).

For grouped PRs: glance at the diff, wait for CI green, squash-merge. They do
not need a changeset unless a dep upgrade changes user-visible behavior.

---

## 8. Triaging incoming issues

When a new issue arrives:

1. The `bug` or `enhancement` + `needs-triage` labels are auto-applied by the
   issue templates.
2. Within a few days, glance at it:
   - **Valid bug:** remove `needs-triage`, label severity if useful.
   - **Bug that's really a question:** convert to a Discussion.
   - **Feature request, scoped:** remove `needs-triage`. If you're committing
     to do it, label `accepted`.
   - **Feature request, open-ended:** convert to a Discussion.
   - **Duplicate:** close with a link to the existing issue.
   - **Unclear:** ask for more info; add `needs-info`.

---

## 9. Security disclosure

When someone reports a vulnerability via the GitHub Security Advisory or by
email (`haider@eliyce.com`):

1. Acknowledge within 3 business days.
2. Open a private security advisory in the repo (Security tab).
3. Discuss the fix inside the advisory thread.
4. Develop the fix on the advisory's "Create a private fork".
5. "Publish advisory" simultaneously ships the patched version and the
   public CVE.

See [`SECURITY.md`](../SECURITY.md) for the full policy.

---

## 10. What you no longer do

- ❌ `pnpm publish` from your laptop.
- ❌ `npm version` to bump.
- ❌ Manually edit `CHANGELOG.md`.
- ❌ Manually create git tags.
- ❌ Manually create GitHub releases.
- ❌ Push directly to `main`.
- ❌ Rotate an `NPM_TOKEN` secret (publishes use Trusted Publishing via OIDC —
  there is no token to rotate).

All of these are automated or blocked by branch protection.

---

## 11. Repo configuration reference

The settings below are already configured. This section is for future-you
when something needs to change.

### CI

- Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
- Triggers: `pull_request` to `main`, `push` to `main`
- Matrix: Node 22 (ubuntu, macOS, windows), Node 24 (ubuntu)
- Building needs Node 22.18 or later (24.11 or later on Node 24), because tsup 9
  requires it. CI asks `setup-node` for the latest 22.x and 24.x, which clear that
  floor, so no workflow pins a patch version. The published `engines` field stays
  `>=22.0.0`: installing the package is unaffected.

#### How the test run is sharded (issue #654)

CI splits the test run so no OS has to run the whole suite in one job. Four kinds of job:

- **Static checks** run once on ubuntu: typecheck, lint, format, graph-ui tests, build and
  the plugin checks.
- **Test shards** split each OS's vitest files: four shards on Windows, three on each of the
  others. `tests/shared/duration-sequencer.ts` balances them by the per-OS timings in
  `tests/shard-timings.json`, longest file first. A missing or broken timings file falls back
  to vitest's own split. Stale timings only make the shards less even; no test is skipped or
  run twice. Each shard sets `PAQAD_TEST_SHARD=1`, which turns the coverage floors off for
  that shard only.
- **Merge** runs once per OS, on that same OS. It checks every shard sent a report, merges
  them, and enforces the coverage floors on the whole result. It then runs
  `scripts/check-shard-budget.mjs`.
- **Gate** jobs carry the four required check names (`Node 22 / ubuntu-latest` and so on).
  Each is red unless static, every shard and every merge succeeded, so a failing shard on any
  OS turns all four gates red. Look for the red `Shard i/n` job to find the failure.

Local `pnpm run ci` is unchanged: one unsharded run with the coverage floors.

**Budget warnings.** `check-shard-budget.mjs` prints a GitHub warning when an OS's slowest
shard runs over 270 s or a single test file over 90 s. It never fails the build. When it
fires:

1. Download that OS's `blob-…` artifacts from the CI run and find the
   `.vitest-durations/durations-*.json` files.
2. Run
   `node scripts/update-shard-timings.mjs --platform <win32|linux|darwin> --report <file> [--report <file> ...]`.
   Only that OS's block of `tests/shard-timings.json` changes. You can also make one report
   locally with `pnpm vitest run --reporter=json --outputFile=<file>` and leave out
   `--platform` to use your own OS.
3. Commit `tests/shard-timings.json`. CI never commits it for you.

If refreshing is not enough, add one shard for that OS in `.github/workflows/ci.yml` (in both
the `test` matrix and the `merge` job's `total`). A single file over budget needs splitting,
the way the onboarding matrix was split into `tests/unit/onboarding/matrix.g1.test.ts` to
`matrix.g5.test.ts`.

### Release

- Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml)
- Triggers: `push` to `main`, manual `workflow_dispatch`
- Token: GitHub PAT stored as `GH_RELEASE_TOKEN` repo secret (so the bot's
  release PR can trigger CI; the default `GITHUB_TOKEN` cannot).
- npm auth: **Trusted Publishing (OIDC)** — configured at
  <https://www.npmjs.com/package/paqad-ai/access>. No `NPM_TOKEN` secret.
- Provenance: enabled (`NPM_CONFIG_PROVENANCE=true`); requires
  `id-token: write` permission (set in the workflow).

### Branch protection (`main`)

- Required status checks: `Node 22 / ubuntu-latest`, `Node 24 / ubuntu-latest`,
  `Node 22 / macos-latest`, `Node 22 / windows-latest`
- Linear history required
- Conversation resolution required
- Force pushes and deletions blocked
- Required approvals: 0 (raise to 1+ when contributors join)

### Other automation

- CodeQL: [`.github/workflows/codeql.yml`](../.github/workflows/codeql.yml) —
  runs on push, PR, and Mondays 03:00 UTC.
- Dependabot: [`.github/dependabot.yml`](../.github/dependabot.yml) — npm and
  github-actions, weekly, grouped.

### Build, lint and test config

The reasons behind the root config files, which carry no comments of their own.

- **`tsup.config.ts`.** Besides the main and CLI entries, it builds one small dedicated bundle per
  runtime hook seam (capability gate, stage writer and narration, stage-marker parse, session-id
  alignment and in-flight bundle adoption, the session-start dirty-file baseline, prompt route and
  ticket detection, stage-agent completion, background-stage deferral, HUD snapshot, change cost,
  the disabled-session audit). The hooks lazy-import these so each path stays light. Every hook
  import needs its entry here: a missing entry makes the import throw `ERR_MODULE_NOT_FOUND` on
  every installed copy (that once left the recorded lane always null). Hook paths log such a
  failure and never change a decision. The `rule-scripts` subpath export serves the rule-script
  `.mjs` wrappers through `import 'paqad-ai/rule-scripts'`. The benchmark scripts and the plugin
  manifest generator import their primitives from dist the same way, so nothing is
  re-implemented. Everything except the heavy optional embedding engines is bundled, including
  the pure-JS dependencies tsup would externalise by default, so `dist/` is self-contained and
  the Claude Code plugin works with no `node_modules`. A `createRequire` banner gives bundled CJS
  (such as `yaml`) a real `require`, since esbuild's shim otherwise throws "Dynamic require is not
  supported" without `node_modules`. The package version is injected at build time so it never
  drifts from `package.json`; vitest has its own define block.
- **`eslint.config.js`.** `.paqad/` is a machine-local runtime folder, including generated
  rule-scripts and their pass/fail fixtures that break rules on purpose, so lint ignores it as
  prettier already does. CommonJS files may use `require` and `module.exports`.
- **`vitest.config.ts`.** Every test file gets a throwaway HOME, so onboarding, join and update
  never write the developer's real `~/.paqad-ai`, `~/.claude` or `~/.codex`. Windows runners are
  slower, so the test and hook timeouts are raised there, and suites that need a POSIX bash (the
  `runtime/**/scripts/*.sh` helpers, which the product never runs on Windows) are excluded on
  Windows. The duration sequencer only acts on a sharded run. Coverage leaves out type-only files,
  thin CLI wrappers whose logic is tested elsewhere, and the impure gatherers (codebase health,
  site map, visual-evidence capture) whose pure inputs have their own tests and whose orchestration
  runs against a fake or an env-gated integration test. Only `PAQAD_TEST_SHARD=1` exactly turns
  the floors off, so a stray `0` changes nothing. The stage-evidence spine (block-forward gate,
  marker parse, live writer, narration) holds a 100% floor instead of the repo's 95%, because it
  must never regress unseen.

### Repo scripts under `scripts/`

Why each one works the way it does, for the parts the code does not say.

- **`build-plugin-manifest.mjs`** runs after tsup in `pnpm build`. It writes
  `.claude-plugin/plugin.json` (version from `package.json`), `runtime/claude-plugin/hooks.json`
  and `runtime/claude-plugin/agents/*.md` from the one builder in `dist/plugin/manifest-build.js`,
  which reuses the real hook renderer and stage-agent template, so there is no second copy. The
  agents folder is rebuilt from scratch so a renamed or removed stage never leaves a stale file.
  `tests/unit/plugin/manifest.test.ts` regenerates from the same builder and asserts a byte match.
- **`validate-plugin.mjs`** runs `claude plugin validate` on the repo root (the marketplace file)
  and on the packed tarball (the shipped manifest). Without a `claude` CLI it prints a skip note
  and exits 0, so CI stays green on a runner without Claude Code. "Passed with warnings" (the
  inherent npm-source warning) is allowed.
- **`test-plugin.mjs`** runs the HUD mod's `claude plugin test` files. The plugin is rooted at the
  repo root, where `claude plugin test` would also pick up the whole vitest suite, so it stages a
  plugin of the mod alone in a temp folder: the real manifest minus agents and skills, a hooks file
  naming only the module, and a copy of `runtime/claude-plugin/mod`. Command hooks are left out
  because they have their own tests. It needs `claude` 2.1.301 or newer (the mod's floor) and
  otherwise skips with exit 0.
- **`check-surface-drift.mjs` and `check-surface-orphans.mjs`** mirror the extension-surface
  verification gate, so a local run and verification agree. Drift is checked per barrel, because
  per-symbol drift means nothing for `export *` barrels. A symbol used only inside its own
  declaring module does not count as consumed. Orphans warn by default; `--strict` fails.
- **`measure-footprint.mjs`** (with `lib/footprint.mjs`) measures what paqad makes the agent load at
  session start: the host entry file plus the resident instruction areas. Inside the lean rule
  slice only the manifest above the loaded-rules heading counts as resident, because the rule
  bodies below it change per session. "Full" swaps the full rule tree back in, so the reported
  saving is honest. It is read-only and uses the real tokenizer from the built dist bundle, or a
  labelled characters-divided-by-4 fallback when the repo is not built. Files are read and caught
  rather than checked first, to avoid a check-then-use race.
- **`rule-findings-stats.mjs`** (with `lib/findings-stats.mjs`) reads the fresh-run findings rows
  from every bundle's `rule-run.jsonl` and nothing else. A row is a snapshot of the findings
  present at that run, not new catches, and cache hits write no row, so summing rows would count a
  standing finding many times. The metric is therefore the per-run snapshot, reported per ISO week
  as median and max. The host tiers are printed with the number so nobody reads it as enforcement
  on advisory hosts. A partial or corrupt line is skipped.
- **`se-mark.ts`** marks stages from the shell. It resolves the same session the live writer and
  the pre-mutation gate key on, so a manual mark really clears the block; `SE_SESSION` overrides.

---

## 12. When something goes wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| Release workflow fails: `E404 Not Found - PUT https://registry.npmjs.org/paqad-ai` | Trusted Publisher config changed, or workflow filename mismatch | Verify `release.yml` is listed at <https://www.npmjs.com/package/paqad-ai/access> with org `Eliyce` and repo `paqad-ai` |
| Release workflow fails: `npm error code EOIDC` or similar OIDC error | npm CLI is too old | Confirm the "Upgrade npm" step is present in `release.yml`; needs npm ≥ 11.5.1 |
| Release workflow fails: `Cannot publish over existing version` | Version in `package.json` already on npm | Add a new changeset and merge a new release PR with a higher bump |
| Release workflow runs but no release PR opens | No pending changesets | Expected when no `.changeset/*.md` files exist |
| Release PR (`chore(release): version packages`) opens but has **no CI checks** | The default `GITHUB_TOKEN` was used instead of `GH_RELEASE_TOKEN` | Confirm `GH_RELEASE_TOKEN` secret exists and `release.yml` references it as `GITHUB_TOKEN` for the changesets step |
| Release PR CI fails on `expected '1.0.X' to be '1.0.Y'` | The build-time `__PKG_VERSION__` injection is broken or missing | Confirm `tsup.config.ts` and `vitest.config.ts` both `define: { __PKG_VERSION__: JSON.stringify(pkg.version) }`. `src/index.ts` reads only this constant — there should be no hardcoded version string anywhere |
| Provenance error in workflow log | Missing `id-token: write` permission | Confirm the `permissions` block in `release.yml` includes `id-token: write` |
| Need to undo a published version (≤ 72 h) | npm policy allows brief unpublish | `npm unpublish paqad-ai@x.y.z --force` then ship a higher version |
| Need to undo a published version (> 72 h) | Cannot unpublish | `npm deprecate paqad-ai@x.y.z "Use x.y.z+1 instead — this version has <bug>"` then ship a fix |
| Need to re-run a stuck release | `package.json` bumped but never published to npm | `gh workflow run release.yml --repo Eliyce/paqad-ai --ref main` |

### Manual recovery: re-fire a stuck release

If `package.json` says `1.2.3` but `npm view paqad-ai version` is still `1.2.2`,
the publish step failed somewhere. After fixing the root cause, re-fire:

```bash
gh workflow run release.yml --repo Eliyce/paqad-ai --ref main
gh run watch $(gh run list --repo Eliyce/paqad-ai --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId') --repo Eliyce/paqad-ai --exit-status
```

The release workflow on `main` with no pending changesets just runs the
publish command, which is idempotent (skips if the version is already on npm).
