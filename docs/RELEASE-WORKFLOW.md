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

#### How the test run is sharded

CI splits the test run so no OS has to run the whole suite in one job. Four kinds of job:

- **Static checks** run once on ubuntu: typecheck, lint, format, graph-ui tests, build and
  the plugin checks.
- **Test shards** split each OS's vitest files: four shards on Windows, three on each of the
  others. `tests/shared/duration-sequencer.ts` balances them by the per-OS timings in
  `tests/shard-timings.json`, longest file first. A missing or broken timings file falls back
  to vitest's own split. Stale timings only make the shards less even; no test is skipped or
  run twice. Each shard sets `PAQAD_TEST_SHARD=1`, which turns the coverage floors off for
  that shard only.
- **Merge** runs once per OS, on that same OS, but only when `scope` succeeded, the test
  matrix was not skipped, and the run was not cancelled. It checks every shard sent a report, merges
  them, and enforces the coverage floors on the whole result. It then runs
  `scripts/check-shard-budget.mjs`.
- **Discovery plugin** runs once on ubuntu. See below.
- **Gate** jobs carry the four required check names (`Node 22 / ubuntu-latest` and so on).
  Each is red unless static, every shard, every merge and the discovery plugin job succeeded, so a failing shard on any
  OS turns all four gates red. Look for the red `Shard i/n` job to find the failure. A gate
  also accepts skipped test and merge jobs, but only when the `scope` job succeeded and said
  `skip_matrix` is true.
- **Scope** decides whether the test matrix can be skipped, and writes `skip_matrix` and
  `skip_reason`. It skips test and merge in two cases only:
  - a version-only PR: the diff touches only the `version` field of `package.json`,
    `CHANGELOG.md`, and deleted `.changeset/*.md` files (not `README.md`), the branch contains
    the base, and that base is already proven green. Scope takes the base from the first
    parent of the merge commit CI checks out (`GITHUB_SHA^1`) and ignores the base sha in the
    PR event. If that merge commit's second parent is not the PR head, it runs the full matrix;
  - a push to `main` whose tree matches a PR head that was already green.

  Any error, or any doubt, runs the full matrix. The job reads contents, checks, pull requests
  and actions. Static and discovery plugin always run.

Local `pnpm run ci` is unchanged: one unsharded run with the coverage floors.

**Budget warnings.** `check-shard-budget.mjs` prints a GitHub warning when an OS's slowest
shard runs over 270 s or a single test file over 90 s. Those warnings never fail the build.
CI passes no flag, so the script checks the runner's own OS. It does fail when more than 5%
of that OS's test files have no timing in `tests/shard-timings.json`, because then the split is mostly guesswork.
When a warning fires:

1. Download that OS's `blob-…` artifacts from the CI run and find the
   `.vitest-durations/durations-*.json` files.
2. Run it once per OS, with one `--report` for each shard file of that OS:
   `node scripts/update-shard-timings.mjs --platform <darwin|linux|win32> --report <shard 1 file> --report <shard 2 file> ...`.
   Use the files as downloaded. Paths inside them such as `/home/runner/work/...` or
   `D:/a/...` are matched to this repo by the first `tests/` folder that exists here, so
   `--report-root <dir>` is optional. Entries it cannot place in the repo are skipped and
   counted in the output. The script rewrites that OS's block of `tests/shard-timings.json`
   and drops entries for deleted test files from every block. You can also make one report
   locally with `pnpm vitest run --reporter=json --outputFile=<file>` and leave out
   `--platform` to use your own OS.
3. Commit `tests/shard-timings.json`. CI never commits it for you.

If refreshing is not enough, add one shard for that OS in `.github/workflows/ci.yml` (in both
the `test` matrix and the `merge` job's `total`). A single file over budget needs splitting,
the way the onboarding matrix was split into `tests/unit/onboarding/matrix.g1.test.ts` to
`matrix.g5.test.ts`, and the onboarding orchestrator into `orchestrator.g1.test.ts` to
`orchestrator.g4.test.ts`.

### Discovery plugin job

The `discovery-plugin` job in `ci.yml` tests the product-owner skills under `plugins/discovery`
on Python 3.9: it builds every host, runs the unit tests, the content, secret, size and parity
checks, and checks two builds are identical. Last, it runs `node scripts/build-discovery.mjs`
and fails if `runtime/claude-plugin/skills` then differs from what is committed.

Run `pnpm build:discovery` and commit `runtime/claude-plugin/skills` whenever you change a
discovery skill or anything it imports. The skills take their version from the root
`package.json`, and a version bump alone causes no drift, so a release needs no rebuild. More
in [the claude-plugin module doc](modules/claude-plugin/index/summary.md).

### Plugin eval benchmark

- Workflow: [`.github/workflows/plugin-eval.yml`](../.github/workflows/plugin-eval.yml)
- It scores the packed plugin on routing, firewall and receipt cases under `evals/`.
- Needs the `ANTHROPIC_API_KEY` repo secret. How to run it and read the scores is in
  [`evals/README.md`](../evals/README.md).

### Release

- Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml)
- Triggers: `push` to `main`, manual `workflow_dispatch`
- Token: GitHub PAT stored as `GH_RELEASE_TOKEN` repo secret (so the bot's
  release PR can trigger CI; the default `GITHUB_TOKEN` cannot). As a fine-grained token on
  `Eliyce/paqad-ai` it needs Contents, Pull requests and Workflows set to Read and write. The
  `tags` job uses it for the reason given there.
- npm auth: **Trusted Publishing (OIDC)** — configured at
  <https://www.npmjs.com/package/paqad-ai/access>. No `NPM_TOKEN` secret.
- Provenance: enabled (`NPM_CONFIG_PROVENANCE=true`); requires
  `id-token: write` permission (set in the workflow).
- npm CLI: pinned to `>=11.5.1 <12`. Trusted Publishing needs 11.5.1 or newer, and npm 12
  changed the `npm pack --json` output the publish-time end-to-end test reads.
- CI green check: right before the changesets step, `node scripts/release-sync.mjs ci-green`
  proves the tree on `main` already passed CI, so the release does not run the suite again. It
  finds the merged PR for the commit, checks that its head tree matches and that the head
  contains the base, and reads the GitHub Actions check runs whose check suite belongs to a
  `ci.yml` workflow run. For each check it takes the newest completed attempt; an earlier failed
  attempt is written to the log. It refuses on any doubt: a lookup error, a check that is not
  finished or not green, no PR or several PRs, or a tree mismatch. On success it writes the
  tree hash (bare hex) to `PAQAD_RELEASE_VERIFIED_TREE` in `GITHUB_ENV`.
- `prepublishOnly` is `node scripts/release-sync.mjs prepublish`. It skips the suite only inside
  GitHub Actions on the verified tree. Anywhere else, a laptop for example, it runs
  `pnpm run ci` exactly as before. The real control on who can publish is still npm trusted
  publishing, which only accepts `release.yml`.
- No separate build step: `pnpm run release` builds. The build heap,
  `NODE_OPTIONS=--max-old-space-size=4096` (the same as CI), sits on the changesets step so the
  type-declaration build never runs out of memory.
- What was published is read from facts, never from the changesets console output (changesets
  CLI v3 stopped printing the `New tag:` lines the action looked for, so its `published` output
  stayed `false`, and it is still never read). After the changesets step,
  `node scripts/release-sync.mjs state` reads the version in `package.json`, finds its release
  commit and asks `Eliyce/paqad-claude-plugin` whether tag `v<version>` exists. The local
  `v<version>` tag that `changeset publish` creates counts as proof the version was just
  published. Without it (a `workflow_dispatch` recovery run, for example) `state` falls back to
  polling npm. Every `npm view` uses `--prefer-online`. The job outputs `published` (true only
  when the version is published and the plugin tag is missing), `version` and `sha`.
- Tags and GitHub Releases: a separate `tags` job (needs `release`) waits for npm to list the
  version and fails if it never appears. Then `node scripts/release-sync.mjs tags` pushes
  `v<version>` on the release commit and creates the GitHub Release (notes from that version's
  `CHANGELOG.md` section) for every published version from the newest existing tag onwards that
  lacks one. Only the current version is marked latest. Its first run backfilled every version
  since 1.78.0. This job pushes with `GH_RELEASE_TOKEN`, because tagging an older version whose
  workflow files differ from `main` needs the Workflows permission, which the default token can
  never have.
- Plugin: `publish-plugin` checks out the release commit, fails if its `package.json` version is
  not the published one, builds, and pushes the plugin with `PAQAD_PLUGIN_PUSH_TOKEN`. Because the
  gate reads facts, any later run on `main`, including a manual `workflow_dispatch`, ships a
  plugin that is behind npm.
- Plugin lag: the `plugin-in-sync` job runs after `release`, `publish-plugin` and `tags`, and
  [`.github/workflows/plugin-sync-check.yml`](../.github/workflows/plugin-sync-check.yml) runs
  daily at 06:00 UTC. Both run `node scripts/release-sync.mjs check`, which fails red when npm
  `latest` is newer than the newest `v*` tag in the plugin repo.

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
- **`validate-plugin.mjs`** runs `claude plugin validate` on the repo root (the plugin manifest),
  on the packed tarball (the shipped manifest), and on a staged copy of the tree the release pushes
  to `Eliyce/paqad-claude-plugin`, with the marketplace file `scripts/assemble-plugin.mjs` writes
  there. This repo keeps no marketplace file of its own. Without a `claude` CLI it prints a skip note
  and exits 0, so CI stays green on a runner without Claude Code. "Passed with warnings" (the
  inherent npm-source warning) is allowed.
- **`test-plugin.mjs`** runs the HUD mod's `claude plugin test` files. The plugin is rooted at the
  repo root, where `claude plugin test` would also pick up the whole vitest suite, so it stages a
  plugin of the mod alone in a temp folder: the real manifest minus agents and skills, a hooks file
  naming only the module, and a copy of `runtime/claude-plugin/mod`. Command hooks are left out
  because they have their own tests. It needs `claude` 2.1.301 or newer (the mod's floor) and
  otherwise skips with exit 0.
- **`assemble-plugin.mjs`** builds the tree the `publish-plugin` release job pushes to
  `Eliyce/paqad-claude-plugin`: the plugin files plus a generated `.claude-plugin/marketplace.json`
  (marketplace `eliyce`, plugin `paqad`, source `./`). The tree includes `SECURITY.md` and the
  listing icon `assets/icon.png`. It leaves out every `*.map` file and the OS junk names
  `.DS_Store`, `Thumbs.db`, `desktop.ini` and `__MACOSX`, because Anthropic's plugin directory
  stops validation on any file over 5 MiB (the source maps are the only files that big) and
  blocks those junk names. Neither the npm package nor the plugin tree ships source maps:
  `tsup.config.ts` builds none, and the assembler still filters `*.map` as a guard. It also leaves out
  `dist/plugin/` (only `scripts/build-plugin-manifest.mjs` imports it, at build time, so the npm
  package keeps it), and it rewrites every raw control byte (0x01-0x08, 0x0B, 0x0C, 0x0E-0x1F) in
  an assembled `.js` file as `\xNN` text, because esbuild writes the bundled yaml lexer's
  `"\x02"`, `"\x18"` and `"\x1f"` as literal bytes and the directory flags them. Each rewritten file
  must pass `node --check` or assembly fails; a file with no such byte is copied byte for byte. It wipes everything in the
  target except `.git`, which is why the marketplace file is written there and not kept here. The job runs only
  when npm has the version and the plugin repo lacks its tag, commits nothing when the tree is
  unchanged, creates `main` on an empty repo, and fails when `PAQAD_PLUGIN_PUSH_TOKEN` is missing
  or the push fails.
- **Submitting to Anthropic's plugin directory.** Always submit `Eliyce/paqad-claude-plugin` (branch `main`, plugin at the root), never this repo. This repo has a `.claude-plugin/plugin.json` at its root so the plugin can be built and tested from source, so the portal accepts it, but it then scans our `CLAUDE.md`, our workflows, the website and every source file, none of which ship. After each release that changes the HUD mod, the manifest or the README, press **Re-validate** in the portal before closing the issue.
- **`release-sync.mjs`** is how the release decides what to ship, from npm and git only, never
  from changesets output. `state` writes `version`, `sha` (the oldest commit whose `package.json`
  carries that version) and `plugin_needed` to `GITHUB_OUTPUT`. It reads `package.json` and its history at `GITHUB_SHA` (else `HEAD`), because with changesets pending the changesets step leaves the checkout on its release branch with the next version already bumped; `state` waits up to 15 minutes for npm to list the new version, because npm takes 3 to 7 minutes after `changeset publish` reports success. It
  returns as soon as npm lists it, and logs one line when it starts waiting and one when the wait ends. `tags` pushes missing `v<version>` tags by commit, so a
  local tag changesets made does not matter for pushing, and creates the missing GitHub Releases, oldest
  first. `check` fails when the plugin lags npm `latest`. A failure to reach npm or a git remote
  fails the step rather than reading as "not published" or "tag missing". Tests in
  `tests/unit/ci/release-sync.test.ts` run it against local bare remotes with fake `npm` and `gh`.
  The full command list is `state`, `tags`, `check`, `ci-green`, `prepublish` and `scope`;
  `ci-green` and `prepublish` are described under Release above, and `scope` under CI.
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
| Tag step fails: `refusing to allow a GitHub App to create or update workflow ... without workflows permission` | The tag was pushed with the default `GITHUB_TOKEN`, or `GH_RELEASE_TOKEN` lacks the Workflows permission | Confirm the `tags` job's checkout `token:` and its `GH_TOKEN` both use `GH_RELEASE_TOKEN`, and that the token has Workflows: Read and write |
| Provenance error in workflow log | Missing `id-token: write` permission | Confirm the `permissions` block in `release.yml` includes `id-token: write` |
| Need to undo a published version (≤ 72 h) | npm policy allows brief unpublish | `npm unpublish paqad-ai@x.y.z --force` then ship a higher version |
| Need to undo a published version (> 72 h) | Cannot unpublish | `npm deprecate paqad-ai@x.y.z "Use x.y.z+1 instead — this version has <bug>"` then ship a fix |
| Need to re-run a stuck release | `package.json` bumped but never published to npm | `gh workflow run release.yml --repo Eliyce/paqad-ai --ref main` |
| `Plugin matches npm` fails: the plugin is behind npm | npm has a version the plugin repo has no tag for | `gh workflow run release.yml --repo Eliyce/paqad-ai --ref main`; the `published` gate sees the missing tag and ships the plugin |
| `Read what npm and the plugin repo have` fails | npm or the plugin repo could not be reached | Re-run the job; the gate never guesses "not published" on a failed lookup |

### Manual recovery: re-fire a stuck release

If `package.json` says `1.2.3` but `npm view paqad-ai version` is still `1.2.2`,
the publish step failed somewhere. After fixing the root cause, re-fire:

```bash
gh workflow run release.yml --repo Eliyce/paqad-ai --ref main
gh run watch $(gh run list --repo Eliyce/paqad-ai --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId') --repo Eliyce/paqad-ai --exit-status
```

The release workflow on `main` with no pending changesets just runs the
publish command, which is idempotent (skips if the version is already on npm).
