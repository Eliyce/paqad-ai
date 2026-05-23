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
GitHub: CI runs (lint, types, tests, build × 3 matrix legs)
You: review CI, address feedback
You: squash-merge the PR
GitHub: changesets bot opens "chore(release): version packages" PR
You: review the version bump + changelog → squash-merge
GitHub: release workflow publishes to npm with provenance, tags, and creates a GitHub release
```

Branches → main are gated by:

- 3 CI contexts (Node 22 ubuntu, Node 24 ubuntu, Node 22 macOS)
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
- Matrix: Node 22 (ubuntu, macOS), Node 24 (ubuntu). **Windows is currently
  deferred — see [#17](https://github.com/Eliyce/paqad-ai/issues/17).**

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
  `Node 22 / macos-latest`
- Linear history required
- Conversation resolution required
- Force pushes and deletions blocked
- Required approvals: 0 (raise to 1+ when contributors join)

### Other automation

- CodeQL: [`.github/workflows/codeql.yml`](../.github/workflows/codeql.yml) —
  runs on push, PR, and Mondays 03:00 UTC.
- Dependabot: [`.github/dependabot.yml`](../.github/dependabot.yml) — npm and
  github-actions, weekly, grouped.

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
