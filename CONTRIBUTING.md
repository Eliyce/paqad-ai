# Contributing to paqad-ai

Thanks for your interest in contributing. This document explains how to get the
project running locally, the kind of changes we welcome, and how to submit them
so they can be reviewed quickly.

By participating, you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

---

## Table of contents

1. [Ways to contribute](#ways-to-contribute)
2. [Before you start](#before-you-start)
3. [Local setup](#local-setup)
4. [Project scripts](#project-scripts)
5. [Branching and commits](#branching-and-commits)
6. [Adding a changeset](#adding-a-changeset)
7. [Submitting a pull request](#submitting-a-pull-request)
8. [Review process](#review-process)
9. [Testing](#testing)
10. [Documentation](#documentation)
11. [Reporting security issues](#reporting-security-issues)

---

## Ways to contribute

- **Bug reports.** Open a
  [bug report issue](https://github.com/Eliyce/paqad-ai/issues/new/choose)
  with reproduction steps and the output of `paqad-ai doctor`.
- **Feature ideas.** For open-ended ideas, open a
  [Discussion](https://github.com/Eliyce/paqad-ai/discussions). For a
  concrete proposal, open a
  [feature request issue](https://github.com/Eliyce/paqad-ai/issues/new/choose).
- **Code contributions.** Bug fixes are always welcome. For new features, please
  open an issue first so we can agree on the approach before you invest time.
- **Documentation improvements.** Typos, clarifications, missing examples — all
  welcome.
- **Stack pack proposals.** New stack packs are welcome. Please open a
  Discussion before opening a PR so we can scope it together.

---

## Before you start

- Search [existing issues](https://github.com/Eliyce/paqad-ai/issues)
  and [Discussions](https://github.com/Eliyce/paqad-ai/discussions) to
  avoid duplicates.
- For non-trivial changes, open an issue first to align on the approach. This
  saves rework on both sides.

---

## Local setup

`paqad-ai` is a Node.js CLI and library built with TypeScript and bundled with
[`tsup`](https://tsup.egoist.dev/).

### Requirements

- **Node.js** `>=22`. Node 22 LTS is recommended.
- **pnpm** at the version pinned in `package.json` under `packageManager`. Use
  [Corepack](https://nodejs.org/api/corepack.html) — do **not** install pnpm
  globally.
- **Git**.

### Install

```bash
git clone https://github.com/Eliyce/paqad-ai.git
cd paqad-ai
corepack enable
pnpm install
```

### Verify

```bash
pnpm run ci
```

This runs typecheck, lint, format-check, tests with coverage, and the production
build. If anything fails on a fresh clone, please open an issue.

---

## Project scripts

| Script                   | What it does                                                       |
| ------------------------ | ------------------------------------------------------------------ |
| `pnpm run dev`           | Run the bundler in watch mode.                                     |
| `pnpm run build`         | Produce the production build under `dist/`.                        |
| `pnpm run typecheck`     | `tsc --noEmit` against the whole codebase.                         |
| `pnpm run lint`          | Run ESLint.                                                        |
| `pnpm run format`        | Format the workspace with Prettier.                                |
| `pnpm run format:check`  | Verify formatting without writing.                                 |
| `pnpm run test`          | Run the test suite.                                                |
| `pnpm run test:watch`    | Run tests in watch mode.                                           |
| `pnpm run test:coverage` | Run tests with coverage (v8).                                      |
| `pnpm run ci`            | Full pipeline. **Run this before opening a PR.**                   |
| `pnpm changeset`         | Add a changeset for your change. See [below](#adding-a-changeset). |

---

## Branching and commits

- Branch off `main`. Use a short, descriptive prefix:
  - `feat/<slug>` for new capabilities
  - `fix/<slug>` for bug fixes
  - `docs/<slug>` for documentation
  - `chore/<slug>` for tooling and refactoring
- Commits within a branch don't need to be pristine — we **squash-merge**. Make
  sure the **PR title** describes the change clearly. The PR title becomes the
  merge commit subject on `main`.

You do **not** need to use Conventional Commits — versioning is driven by
changeset files, not commit messages.

---

## Adding a changeset

This project uses [Changesets](https://github.com/changesets/changesets) to
track user-facing changes and to drive automatic version bumps and changelog
entries.

If your PR changes anything a consumer of the package would notice, add a
changeset:

```bash
pnpm changeset
```

You'll be prompted to pick the bump type and write a short, user-facing
summary. Commit the resulting markdown file under `.changeset/` as part of your
PR.

### What needs a changeset

| Change                                       | Bump  |
| -------------------------------------------- | ----- |
| Bug fix affecting runtime behavior           | patch |
| New CLI command, flag, option, or stack pack | minor |
| Backwards-incompatible API or CLI change     | major |
| Performance improvement users will notice    | patch |
| Internal refactor, no behavioral change      | none  |
| Tests, CI, tooling only                      | none  |
| Docs, comments, README updates               | none  |

When in doubt, add one. The reviewer can downgrade or remove it before merge.

---

## Submitting a pull request

1. Make sure `pnpm run ci` passes locally.
2. Update or add tests where appropriate.
3. Update documentation where appropriate.
4. Add a changeset if needed.
5. Open a pull request against `main` and fill out the PR template.
6. Be patient — most PRs get a first review within a week.

---

## Review process

- A maintainer is auto-assigned via [CODEOWNERS](./.github/CODEOWNERS).
- The CI workflow runs on every PR. It must be green before merge.
- Maintainers may push small fixes (typos, formatting) directly unless you've
  disabled "Allow edits from maintainers."
- PRs are squash-merged. The PR title becomes the merge commit subject.
- After merge, the [release workflow](./.github/workflows/release.yml) will pick
  up your changeset and include it in the next release.

---

## Testing

- We use [Vitest](https://vitest.dev/) for unit tests, with v8 coverage.
- Add tests for new features and for any non-trivial bug fix.
- Tests run in CI on Node 22 and 24 across Ubuntu, macOS, and Windows. If your
  code is platform-sensitive, make sure your tests cover the relevant cases.

---

## Documentation

- Project docs live under `docs/` (in this repo) and at <https://docs.paqad.ai>.
- The `README.md` is the entry point for the npm page and the repo home page.
  Treat it as a contract — be careful with backwards-incompatible changes.
- When you add a feature, update the relevant doc in the same PR.

---

## Reporting security issues

**Do not** open a public issue for security vulnerabilities. See
[`SECURITY.md`](./SECURITY.md) for the disclosure process.

---

Thanks for being here. Every fix, every typo, every new pack helps.
